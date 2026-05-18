/**
 * CorrectionHandler — main entry point for the RESPOND stage.
 *
 * Responsibilities:
 *   1. Build world state from project + correction
 *   2. Run the GOAP planner to find the cheapest valid plan
 *   3. Execute the plan via GOAPExecutor
 *   4. Handle multi-correction bundling (one GOAP run per item)
 *   5. Handle escalation when no plan is found
 *
 * Defined by ADR-002.
 */

import { buildWorldState } from './WorldState';
import type { CorrectionInput, GOAPProject, CorrectionWorldState } from './WorldState';
import type { ActionContext, EventEmitter } from './Action';
import type { IAction } from './Action';
import { GOAPPlanner } from './GOAPPlanner';
import { GOAPExecutor } from './GOAPExecutor';
import type { ExecutionStatus } from './GOAPExecutor';

// Actions
import { ParseCorrection }            from './actions/ParseCorrection';
import { ClassifyCorrection }         from './actions/ClassifyCorrection';
import { IdentifyAffectedDocuments }  from './actions/IdentifyAffectedDocuments';
import { GenerateFixGuidance }        from './actions/GenerateFixGuidance';
import { AutoFixDocument }            from './actions/AutoFixDocument';
import { RequestUserInput }           from './actions/RequestUserInput';
import { ValidateFix }                from './actions/ValidateFix';
import { PrepareResubmission }        from './actions/PrepareResubmission';

const GOAL: Partial<CorrectionWorldState> = {
  correctionResolved: true,
  applicationReady:   true,
};

/** The result returned by CorrectionHandler.handle(). */
export interface CorrectionResult {
  correctionId: string;
  status:       ExecutionStatus | 'ESCALATED';
  worldState:   CorrectionWorldState;
  pausedAt?:    string;
  error?:       string;
}

/** Options for the handler — allows injecting custom action sets for testing. */
export interface CorrectionHandlerOptions {
  availableActions?: IAction[];
}

export class CorrectionHandler {
  private readonly planner:  GOAPPlanner;
  private readonly executor: GOAPExecutor;
  private readonly actions:  IAction[];

  constructor(options: CorrectionHandlerOptions = {}) {
    this.planner  = new GOAPPlanner();
    this.executor = new GOAPExecutor();
    this.actions  = options.availableActions ?? this.defaultActions();
  }

  /**
   * Pre-classification pass: run ParseCorrection + ClassifyCorrection eagerly
   * so the world state has `autoFixable` set before GOAP planning starts.
   * The main plan will still include these actions (their preconditions will
   * already be satisfied, so they will be skipped by precondition checks;
   * or we mark the flags as already done so the planner skips them).
   *
   * After this method, worldState.correctionParsed = true,
   * worldState.correctionClassified = true, and worldState.autoFixable is set.
   * The main planner will then skip ParseCorrection + ClassifyCorrection
   * (preconditions require them to be false) and plan from the seeded state.
   */
  private async seedAutoFixable(ctx: ActionContext): Promise<void> {
    const parse    = new ParseCorrection();
    const classify = new ClassifyCorrection();

    try {
      const parseResult = await parse.execute(ctx.worldState, ctx);
      if (parseResult.success) {
        ctx.worldState.correctionParsed = true;

        const classifyResult = await classify.execute(ctx.worldState, ctx);
        if (classifyResult.success) {
          ctx.worldState.correctionClassified = true;
          // autoFixable is now set on worldState by ClassifyCorrection.execute()
        }
      }
    } catch {
      // Seed failed — leave autoFixable undefined; planner falls back to user-input path
    }
  }

  private defaultActions(): IAction[] {
    return [
      new ParseCorrection(),
      new ClassifyCorrection(),
      new IdentifyAffectedDocuments(),
      new GenerateFixGuidance(),
      new AutoFixDocument(),
      new RequestUserInput(),
      new ValidateFix(),
      new PrepareResubmission(),
    ];
  }

  /**
   * Handle a single correction notice.
   *
   * Implementation note: `autoFixable` is a metadata field set by
   * ClassifyCorrection at execute-time. To allow the GOAP planner to route
   * correctly (AutoFixDocument requires `autoFixable: true` as a precondition),
   * we run a lightweight pre-classification pass before planning to seed the
   * world state with `autoFixable`. This is the standard GOAP "pre-planning
   * world-state initialization" pattern.
   */
  async handle(
    project:    GOAPProject,
    correction: CorrectionInput,
    emit:       EventEmitter,
  ): Promise<CorrectionResult> {
    const worldState = buildWorldState(project, correction);

    // Build context for action execution
    const ctx: ActionContext = {
      project,
      correction,
      worldState,
      emit,
    };

    // Pre-seed autoFixable by running ParseCorrection + ClassifyCorrection
    // before planning. This ensures the planner can discover the auto-fix path.
    await this.seedAutoFixable(ctx);

    // Plan (worldState now has autoFixable set if classification succeeded)
    const plan = this.planner.plan(worldState, GOAL, this.actions);

    if (plan.length === 0) {
      // No valid plan found — escalate
      emit('correction:escalation_required', {
        correctionId: correction.id,
        reason:       'GOAP planner could not find a valid plan within max depth',
      });

      return {
        correctionId: correction.id,
        status:       'ESCALATED',
        worldState,
      };
    }

    // Execute
    const result = await this.executor.execute(plan, ctx);

    return {
      correctionId: correction.id,
      status:       result.status,
      worldState:   result.worldState,
      pausedAt:     result.pausedAt,
      error:        result.error,
    };
  }

  /**
   * Handle a multi-correction bundle.
   * Runs a separate GOAP cycle for each correction in the array.
   * PrepareResubmission is only triggered once all corrections are resolved.
   */
  async handleBundle(
    project:     GOAPProject,
    corrections: CorrectionInput[],
    emit:        EventEmitter,
  ): Promise<CorrectionResult[]> {
    const results: CorrectionResult[] = [];

    for (const correction of corrections) {
      const result = await this.handle(project, correction, emit);
      results.push(result);
    }

    return results;
  }

  /**
   * Resume execution for a correction that was paused at RequestUserInput.
   * The caller resolves the pending user action (e.g. via POST /corrections/:id/resolve)
   * and passes the remaining plan.
   */
  async resume(
    project:       GOAPProject,
    correction:    CorrectionInput,
    worldState:    CorrectionWorldState,
    remainingPlan: IAction[],
    emit:          EventEmitter,
  ): Promise<CorrectionResult> {
    // Mark user action complete before resuming
    worldState.userActionComplete = true;

    const ctx: ActionContext = {
      project,
      correction,
      worldState,
      emit,
    };

    const result = await this.executor.execute(remainingPlan, ctx);

    return {
      correctionId: correction.id,
      status:       result.status,
      worldState:   result.worldState,
      pausedAt:     result.pausedAt,
      error:        result.error,
    };
  }
}
