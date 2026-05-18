import { WorkflowEngine } from '../../src/agent/WorkflowEngine';
import { InMemoryStateStore } from '../../src/state/InMemoryStateStore';
import {
  PermitProject,
  PermitStage,
  ConductorConfig,
  Correction,
  SubmissionStatusCode,
} from '../../src/types';
import { MockBrainSkill } from '../../src/skills/mocks/MockBrainSkill';
import { MockSubmissionSkill } from '../../src/skills/mocks/MockSubmissionSkill';

// ---------------------------------------------------------------------------
// Mock skill helpers
// ---------------------------------------------------------------------------

function makeMockVerificationSkill(code: SubmissionStatusCode, correction?: Correction) {
  return {
    async getStatus(_submissionId: string) {
      return {
        code,
        message:    `Status: ${code}`,
        correction,
        updatedAt:  new Date().toISOString(),
      };
    },
  };
}

function makeMockPlansReviewSkill(passed: boolean) {
  return {
    async checkCompliance() {
      return {
        passed,
        failures: passed ? [] : [{ code: 'DIM-001', description: 'Dimension mismatch' }],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Project factory
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<PermitProject> = {}): PermitProject {
  const now = new Date().toISOString();
  return {
    id:           'proj-engine-1',
    stage:        PermitStage.DISCOVER,
    jurisdiction: 'Austin, TX',
    permitTypes:  ['building'],
    applicant: {
      id:    'app-1',
      name:  'Test User',
      email: 'test@example.com',
    },
    documents:    [],
    submissions:  [],
    corrections:  [],
    history:      [],
    createdAt:    now,
    updatedAt:    now,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ConductorConfig['skills']> = {}): ConductorConfig {
  const brain        = new MockBrainSkill();
  const submission   = new MockSubmissionSkill();
  const verification = makeMockVerificationSkill(SubmissionStatusCode.IN_REVIEW);
  const plansReview  = makeMockPlansReviewSkill(true);
  const stateStore   = new InMemoryStateStore();

  return {
    skills: { brain, submission, verification, plansReview, ...overrides },
    stateStore,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  const emitMock = jest.fn();

  beforeEach(() => {
    engine    = new WorkflowEngine();
    emitMock.mockClear();
  });

  // -------------------------------------------------------------------------
  // DISCOVER → PREPARE
  // -------------------------------------------------------------------------

  describe('DISCOVER stage', () => {
    it('advances to PREPARE and sets requirements', async () => {
      const project = makeProject({ stage: PermitStage.DISCOVER });
      const config  = makeConfig();

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('ADVANCED');
      expect(result.project.stage).toBe(PermitStage.PREPARE);
      expect(result.project.requirements).toBeDefined();
    });

    it('records stage transition in history', async () => {
      const project = makeProject({ stage: PermitStage.DISCOVER });
      const config  = makeConfig();

      const result = await engine.processStage(project, config, emitMock);

      const transition = result.project.history[0];
      expect(transition.from).toBe(PermitStage.DISCOVER);
      expect(transition.to).toBe(PermitStage.PREPARE);
      expect(transition.occurredAt).toBeTruthy();
    });

    it('emits stage:transition event', async () => {
      const project = makeProject({ stage: PermitStage.DISCOVER });
      const config  = makeConfig();

      await engine.processStage(project, config, emitMock);

      expect(emitMock).toHaveBeenCalledWith(
        'stage:transition',
        expect.objectContaining({ from: PermitStage.DISCOVER, to: PermitStage.PREPARE }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // PREPARE → REVIEW (all documents satisfied)
  // -------------------------------------------------------------------------

  describe('PREPARE stage', () => {
    it('advances to REVIEW when all documents are satisfied', async () => {
      const brain = new MockBrainSkill();
      brain.allDocumentsSatisfied = true;
      const config = makeConfig({ brain });

      // Build project at PREPARE with requirements already set
      const requirements = await brain.lookupRequirements('Austin, TX', ['building']);
      const project = makeProject({
        stage:        PermitStage.PREPARE,
        requirements,
      });

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('ADVANCED');
      expect(result.project.stage).toBe(PermitStage.REVIEW);
    });

    it('returns WAITING_FOR_DOCUMENTS when checklist has missing items', async () => {
      const brain = new MockBrainSkill();
      brain.allDocumentsSatisfied = false;
      const config = makeConfig({ brain });

      const requirements = await brain.lookupRequirements('Austin, TX', ['building']);
      const project = makeProject({
        stage:        PermitStage.PREPARE,
        requirements,
      });

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('WAITING_FOR_DOCUMENTS');
      expect(result.project.stage).toBe(PermitStage.PREPARE); // stays in PREPARE
    });

    it('emits documents:required when checklist incomplete', async () => {
      const brain = new MockBrainSkill();
      brain.allDocumentsSatisfied = false;
      const config = makeConfig({ brain });

      const requirements = await brain.lookupRequirements('Austin, TX', ['building']);
      const project = makeProject({
        stage:        PermitStage.PREPARE,
        requirements,
      });

      await engine.processStage(project, config, emitMock);

      expect(emitMock).toHaveBeenCalledWith(
        'documents:required',
        expect.objectContaining({ projectId: project.id }),
      );
    });

    it('records transition in history when advancing to REVIEW', async () => {
      const brain = new MockBrainSkill();
      brain.allDocumentsSatisfied = true;
      const config = makeConfig({ brain });

      const requirements = await brain.lookupRequirements('Austin, TX', ['building']);
      const project = makeProject({
        stage:        PermitStage.PREPARE,
        requirements,
      });

      const result = await engine.processStage(project, config, emitMock);
      const transition = result.project.history.find(
        (h) => h.from === PermitStage.PREPARE && h.to === PermitStage.REVIEW,
      );
      expect(transition).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // REVIEW → SUBMIT
  // -------------------------------------------------------------------------

  describe('REVIEW stage', () => {
    it('advances to SUBMIT when compliance passes', async () => {
      const config  = makeConfig({ plansReview: makeMockPlansReviewSkill(true) });
      const project = makeProject({ stage: PermitStage.REVIEW });

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('ADVANCED');
      expect(result.project.stage).toBe(PermitStage.SUBMIT);
    });

    it('returns WAITING_FOR_PLAN_FIXES when compliance fails', async () => {
      const config  = makeConfig({ plansReview: makeMockPlansReviewSkill(false) });
      const project = makeProject({ stage: PermitStage.REVIEW });

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('WAITING_FOR_PLAN_FIXES');
      expect(result.project.stage).toBe(PermitStage.REVIEW);
    });

    it('emits review:failed when compliance fails', async () => {
      const config  = makeConfig({ plansReview: makeMockPlansReviewSkill(false) });
      const project = makeProject({ stage: PermitStage.REVIEW });

      await engine.processStage(project, config, emitMock);

      expect(emitMock).toHaveBeenCalledWith(
        'review:failed',
        expect.objectContaining({ projectId: project.id }),
      );
    });

    it('records transition in history on advance', async () => {
      const config  = makeConfig({ plansReview: makeMockPlansReviewSkill(true) });
      const project = makeProject({ stage: PermitStage.REVIEW });

      const result = await engine.processStage(project, config, emitMock);
      const transition = result.project.history.find(
        (h) => h.from === PermitStage.REVIEW && h.to === PermitStage.SUBMIT,
      );
      expect(transition).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // SUBMIT → MONITOR
  // -------------------------------------------------------------------------

  describe('SUBMIT stage', () => {
    it('advances to MONITOR and records submission', async () => {
      const config  = makeConfig();
      const project = makeProject({ stage: PermitStage.SUBMIT });

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('ADVANCED');
      expect(result.project.stage).toBe(PermitStage.MONITOR);
      expect(result.project.submissions).toHaveLength(1);
    });

    it('records transition in history', async () => {
      const config  = makeConfig();
      const project = makeProject({ stage: PermitStage.SUBMIT });

      const result = await engine.processStage(project, config, emitMock);
      const transition = result.project.history.find(
        (h) => h.from === PermitStage.SUBMIT && h.to === PermitStage.MONITOR,
      );
      expect(transition).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // MONITOR — IN_REVIEW
  // -------------------------------------------------------------------------

  describe('MONITOR stage', () => {
    function makeProjectWithSubmission(stage: PermitStage): PermitProject {
      return makeProject({
        stage,
        submissions: [{
          id:          'sub-1',
          submittedAt: new Date().toISOString(),
          status:      SubmissionStatusCode.SUBMITTED,
        }],
      });
    }

    it('returns WAITING_FOR_USER when status is IN_REVIEW', async () => {
      const config  = makeConfig({
        verification: makeMockVerificationSkill(SubmissionStatusCode.IN_REVIEW),
      });
      const project = makeProjectWithSubmission(PermitStage.MONITOR);

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('WAITING_FOR_USER');
      expect(emitMock).toHaveBeenCalledWith('monitor:update', expect.anything());
    });

    it('advances to COMPLETE when status is APPROVED', async () => {
      const config  = makeConfig({
        verification: makeMockVerificationSkill(SubmissionStatusCode.APPROVED),
      });
      const project = makeProjectWithSubmission(PermitStage.MONITOR);

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('COMPLETE');
      expect(result.project.stage).toBe(PermitStage.COMPLETE);
      expect(result.project.permitDocument).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // APPROVE → COMPLETE
  // -------------------------------------------------------------------------

  describe('APPROVE stage', () => {
    it('retrieves permit document and advances to COMPLETE', async () => {
      const config  = makeConfig();
      const project = makeProject({
        stage: PermitStage.APPROVE,
        submissions: [{
          id:          'sub-1',
          submittedAt: new Date().toISOString(),
          status:      SubmissionStatusCode.APPROVED,
        }],
      });

      const result = await engine.processStage(project, config, emitMock);

      expect(result.status).toBe('COMPLETE');
      expect(result.project.stage).toBe(PermitStage.COMPLETE);
      expect(result.project.permitDocument?.url).toMatch(/pdf/);
    });

    it('emits permit:approved event', async () => {
      const config  = makeConfig();
      const project = makeProject({
        stage: PermitStage.APPROVE,
        submissions: [{
          id:          'sub-1',
          submittedAt: new Date().toISOString(),
          status:      SubmissionStatusCode.APPROVED,
        }],
      });

      await engine.processStage(project, config, emitMock);

      expect(emitMock).toHaveBeenCalledWith(
        'permit:approved',
        expect.objectContaining({ documentUrl: expect.any(String) }),
      );
    });
  });
});
