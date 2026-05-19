/**
 * WorkflowEngine — 7-stage permit workflow state machine.
 * Implements the advance() pseudocode from ADR-001.
 */

import {
  PermitProject,
  PermitStage,
  StageResult,
  StageTransition,
  Submission,
  CorrectionWorldState,
  SubmissionStatusCode,
} from '../types';
import { ConductorConfig } from '../types';
import { GOAPPlanner } from '../goap/GOAPPlanner';
import { GOAPExecutor } from '../goap/GOAPExecutor';
import { buildWorldState } from '../goap/WorldState';

// GOAP action imports (all 8 actions from ADR-002)
import { ParseCorrection }            from '../goap/actions/ParseCorrection';
import { ClassifyCorrection }         from '../goap/actions/ClassifyCorrection';
import { IdentifyAffectedDocuments }  from '../goap/actions/IdentifyAffectedDocuments';
import { GenerateFixGuidance }        from '../goap/actions/GenerateFixGuidance';
import { AutoFixDocument }            from '../goap/actions/AutoFixDocument';
import { RequestUserInput }           from '../goap/actions/RequestUserInput';
import { ValidateFix }                from '../goap/actions/ValidateFix';
import { PrepareResubmission }        from '../goap/actions/PrepareResubmission';

type EmitFn = (event: string, payload?: unknown) => void;

export class WorkflowEngine {
  private readonly planner  = new GOAPPlanner();
  private readonly executor = new GOAPExecutor();

  /**
   * Process the current stage of a project.
   * Returns a StageResult indicating what happened and whether caller should wait.
   */
  async processStage(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    switch (project.stage) {
      case PermitStage.DISCOVER:
        return this.handleDiscover(project, config, emit);

      case PermitStage.PREPARE:
        return this.handlePrepare(project, config, emit);

      case PermitStage.REVIEW:
        return this.handleReview(project, config, emit);

      case PermitStage.SUBMIT:
        return this.handleSubmit(project, config, emit);

      case PermitStage.MONITOR:
        return this.handleMonitor(project, config, emit);

      case PermitStage.RESPOND:
        return this.handleRespond(project, config, emit);

      case PermitStage.APPROVE:
        return this.handleApprove(project, config, emit);

      case PermitStage.COMPLETE:
        return { status: 'COMPLETE', project };

      case PermitStage.CANCELLED:
        return { status: 'COMPLETE', project };

      default: {
        const exhaustive: never = project.stage;
        throw new Error(`Unhandled stage: ${exhaustive}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DISCOVER — resolve requirements
  // ---------------------------------------------------------------------------

  private async handleDiscover(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    const { brain } = config.skills;

    const requirements = await brain.lookupRequirements(
      project.jurisdiction,
      project.permitTypes,
    );

    project.requirements = requirements;
    this.transition(project, PermitStage.DISCOVER, PermitStage.PREPARE);

    emit('stage:transition', {
      from:         PermitStage.DISCOVER,
      to:           PermitStage.PREPARE,
      project,
      meta:         { requirements },
    });

    return { status: 'ADVANCED', project };
  }

  // ---------------------------------------------------------------------------
  // PREPARE — build checklist, check document completeness
  // ---------------------------------------------------------------------------

  private async handlePrepare(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    if (!project.requirements) {
      throw new Error('Cannot enter PREPARE without requirements — run DISCOVER first');
    }

    const { brain } = config.skills;
    const checklist = await brain.getDocumentChecklist(project.requirements);
    project.checklist = checklist;

    const allSatisfied = checklist.items.every((item) => item.satisfied);

    if (allSatisfied) {
      this.transition(project, PermitStage.PREPARE, PermitStage.REVIEW);
      emit('stage:transition', {
        from:    PermitStage.PREPARE,
        to:      PermitStage.REVIEW,
        project,
      });
      return { status: 'ADVANCED', project };
    }

    emit('documents:required', {
      projectId: project.id,
      missing:   checklist.missing,
    });

    return { status: 'WAITING_FOR_DOCUMENTS', project, meta: { missing: checklist.missing } };
  }

  // ---------------------------------------------------------------------------
  // REVIEW — compliance check via plansReview skill
  // ---------------------------------------------------------------------------

  private async handleReview(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    const { plansReview } = config.skills;

    const result = await plansReview.checkCompliance(
      project.documents,
      project.jurisdiction,
    );
    project.complianceResult = result;

    if (result.passed) {
      this.transition(project, PermitStage.REVIEW, PermitStage.SUBMIT);
      emit('stage:transition', {
        from:    PermitStage.REVIEW,
        to:      PermitStage.SUBMIT,
        project,
      });
      return { status: 'ADVANCED', project };
    }

    emit('review:failed', {
      projectId: project.id,
      failures:  result.failures,
    });

    return { status: 'WAITING_FOR_PLAN_FIXES', project, meta: { failures: result.failures } };
  }

  // ---------------------------------------------------------------------------
  // SUBMIT — send application to jurisdiction
  // ---------------------------------------------------------------------------

  private async handleSubmit(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    const { submission } = config.skills;

    const activeSubmission = project.submissions[project.submissions.length - 1];
    const isResubmission   = activeSubmission !== undefined
                          && project.resubmissionPayload !== undefined;

    let sub: Submission;
    if (isResubmission) {
      sub = await submission.resubmit(
        activeSubmission.id,
        project.resubmissionPayload as Record<string, unknown>,
      );
      // Clear so a second correction round builds a fresh payload
      project.resubmissionPayload = undefined;
    } else {
      sub = await submission.submit(project.jurisdiction, this.buildPayload(project));
    }

    project.submissions.push(sub);
    this.transition(project, PermitStage.SUBMIT, PermitStage.MONITOR);

    emit('stage:transition', {
      from:    PermitStage.SUBMIT,
      to:      PermitStage.MONITOR,
      project,
      meta:    { submissionId: sub.id, isResubmission },
    });

    return { status: 'ADVANCED', project };
  }

  // ---------------------------------------------------------------------------
  // MONITOR — poll status of active submission
  // ---------------------------------------------------------------------------

  private async handleMonitor(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    const { verification } = config.skills;

    const activeSubmission = project.submissions[project.submissions.length - 1];
    if (!activeSubmission) {
      throw new Error('Cannot enter MONITOR without an active submission');
    }

    const status = await verification.getStatus(activeSubmission.id);
    project.lastStatus = status;

    switch (status.code) {
      case SubmissionStatusCode.APPROVED:
        this.transition(project, PermitStage.MONITOR, PermitStage.APPROVE);
        // Tail-call: advance through APPROVE immediately
        return this.handleApprove(project, config, emit);

      case SubmissionStatusCode.CORRECTION_REQUIRED: {
        if (!status.correction) {
          throw new Error('CORRECTION_REQUIRED status missing correction payload');
        }
        project.corrections.push(status.correction);
        this.transition(project, PermitStage.MONITOR, PermitStage.RESPOND);
        // Tail-call: advance through RESPOND immediately
        return this.handleRespond(project, config, emit);
      }

      default:
        emit('monitor:update', { projectId: project.id, status });
        return { status: 'WAITING_FOR_USER', project, meta: { status } };
    }
  }

  // ---------------------------------------------------------------------------
  // RESPOND — GOAP correction handling
  // ---------------------------------------------------------------------------

  private async handleRespond(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    const correction = project.corrections[project.corrections.length - 1];
    if (!correction) {
      throw new Error('Cannot enter RESPOND without a correction on the project');
    }

    const goapProjectForState = this.toGOAPProject(project);
    const worldState: CorrectionWorldState = buildWorldState(
      goapProjectForState,
      correction,
    );

    const goal: Partial<CorrectionWorldState> = {
      correctionResolved: true,
      applicationReady:   true,
    };

    // Wire the emit function for GOAP actions
    const goapEmit = (event: string, payload?: unknown) => emit(event, payload);

    // Assemble available actions (all 8 from ADR-002)
    const actions = [
      new ParseCorrection(),
      new ClassifyCorrection(),
      new IdentifyAffectedDocuments(),
      new GenerateFixGuidance(),
      new AutoFixDocument(),
      new RequestUserInput(),
      new ValidateFix(),
      new PrepareResubmission(),
    ];

    const plan = this.planner.plan(worldState, goal, actions);

    if (plan.length === 0) {
      // GOAP could not find a plan — escalate
      emit('correction:escalation_required', {
        projectId:    project.id,
        correctionId: correction.id,
      });
      project.goapState = worldState;
      return { status: 'WAITING_FOR_USER', project };
    }

    // Build the GOAPProject adapter (GOAPExecutor expects GOAPProject shape)
    const goapProject = goapProjectForState;

    // Use the full correction object (already typed as Correction from types)
    const goapCorrection = correction;

    const ctx = {
      project:    goapProject,
      correction: goapCorrection,
      worldState,
      emit:       goapEmit,
    };

    const result = await this.executor.execute(plan, ctx);

    // Sync GOAP history back onto permit project history
    for (const entry of goapProject.history) {
      project.history.push({
        from:       PermitStage.RESPOND,
        to:         PermitStage.RESPOND,
        occurredAt: entry.timestamp,
        meta:       { goapAction: entry.action, detail: entry.detail },
      });
    }

    // goapCorrection IS the correction reference — mutations are already reflected
    // Sync resubmission payload from goapProject
    if (goapProject.resubmissionPayload !== undefined) {
      project.resubmissionPayload = goapProject.resubmissionPayload as Record<string, unknown>;
    }

    project.goapState = result.worldState;

    if (result.status === 'WAITING_FOR_USER') {
      if (result.worldState.fixGuidanceGenerated && correction.guidance) {
        emit('correction:guidance', {
          projectId: project.id,
          guidance:  correction.guidance,
        });
      }
      return { status: 'WAITING_FOR_USER', project };
    }

    if (result.status !== 'COMPLETED') {
      return { status: 'WAITING_FOR_USER', project, meta: { error: result.error } };
    }

    // GOAP completed — ready to resubmit
    this.transition(project, PermitStage.RESPOND, PermitStage.SUBMIT);
    return this.handleSubmit(project, config, emit);
  }

  // ---------------------------------------------------------------------------
  // APPROVE — retrieve permit document
  // ---------------------------------------------------------------------------

  private async handleApprove(
    project: PermitProject,
    config: ConductorConfig,
    emit: EmitFn,
  ): Promise<StageResult> {
    const { submission } = config.skills;

    const activeSubmission = project.submissions[project.submissions.length - 1];
    if (!activeSubmission) {
      throw new Error('Cannot enter APPROVE without an active submission');
    }

    const document = await submission.retrieve(activeSubmission.id);
    project.permitDocument = document;

    this.transition(project, PermitStage.APPROVE, PermitStage.COMPLETE);

    emit('permit:approved', {
      documentUrl: document.url,
      project,
    });

    return { status: 'COMPLETE', project };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Record a stage transition in project history */
  private transition(
    project: PermitProject,
    from: PermitStage,
    to: PermitStage,
    meta?: Record<string, unknown>,
  ): void {
    const transition: StageTransition = {
      from,
      to,
      occurredAt: new Date().toISOString(),
      meta,
    };
    project.history.push(transition);
    project.stage    = to;
    project.updatedAt = transition.occurredAt;
  }

  /** Build a submission payload from the current project state */
  private buildPayload(project: PermitProject): Record<string, unknown> {
    return {
      projectId:    project.id,
      jurisdiction: project.jurisdiction,
      permitTypes:  project.permitTypes,
      applicant:    project.applicant,
      documentUrls: project.documents.map((d) => d.url),
    };
  }

  /** Adapt PermitProject to GOAPProject shape expected by GOAPExecutor */
  private toGOAPProject(project: PermitProject): {
    id: string;
    jurisdiction: string;
    documents: Array<{ id: string; type: string; [key: string]: unknown }>;
    history: Array<{ action: string; timestamp: string; detail?: unknown }>;
    resubmissionPayload?: unknown;
  } {
    return {
      id:           project.id,
      jurisdiction: project.jurisdiction,
      documents:    project.documents.map((d) => ({ id: d.id, type: d.type, url: d.url })),
      history:      [],
      resubmissionPayload: project.resubmissionPayload,
    };
  }
}
