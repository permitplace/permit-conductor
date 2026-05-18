/**
 * Integration test: Full DISCOVER → COMPLETE happy path with mock connectors.
 * Tests stage sequence, final state, and emitted events.
 */

import { PermitConductor } from '../../src/agent/PermitConductor';
import { InMemoryStateStore } from '../../src/state/InMemoryStateStore';
import { MockBrainSkill } from '../../src/skills/mocks/MockBrainSkill';
import { MockSubmissionSkill } from '../../src/skills/mocks/MockSubmissionSkill';
import {
  PermitStage,
  ConductorConfig,
  SubmissionStatusCode,
  VerificationStatus,
} from '../../src/types';

// ---------------------------------------------------------------------------
// Mock skill connectors
// ---------------------------------------------------------------------------

class MockVerificationSkill {
  private _code: SubmissionStatusCode;

  constructor(code: SubmissionStatusCode) {
    this._code = code;
  }

  setCode(code: SubmissionStatusCode): void {
    this._code = code;
  }

  async getStatus(_submissionId: string): Promise<VerificationStatus> {
    return {
      code:      this._code,
      message:   `Status: ${this._code}`,
      updatedAt: new Date().toISOString(),
    };
  }
}

class MockPlansReviewSkill {
  async checkCompliance() {
    return { passed: true, failures: [] };
  }
}

function makeConfig(): {
  config: ConductorConfig;
  verification: MockVerificationSkill;
} {
  const brain        = new MockBrainSkill();
  const submission   = new MockSubmissionSkill();
  const verification = new MockVerificationSkill(SubmissionStatusCode.APPROVED);
  const plansReview  = new MockPlansReviewSkill();
  const stateStore   = new InMemoryStateStore();

  return {
    config: { skills: { brain, submission, verification, plansReview }, stateStore },
    verification,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Happy Path Integration: DISCOVER → COMPLETE', () => {
  it('completes the full workflow and returns an approved project', async () => {
    const { config } = makeConfig();
    const conductor  = new PermitConductor(config);

    // start() runs DISCOVER → PREPARE
    const project = await conductor.start({
      jurisdiction: 'Austin, TX',
      permitTypes:  ['building'],
      applicant: {
        id:    'app-1',
        name:  'Jane Doe',
        email: 'jane@permitplace.com',
      },
    });

    // After start(): should be in PREPARE or REVIEW (depending on checklist)
    // MockBrainSkill.allDocumentsSatisfied = true by default
    expect([PermitStage.PREPARE, PermitStage.REVIEW]).toContain(project.stage);

    // Advance through REVIEW → SUBMIT → MONITOR → APPROVE → COMPLETE
    let result = await conductor.advance(project.id);
    while (result.status === 'ADVANCED' && result.project.stage !== PermitStage.COMPLETE) {
      result = await conductor.advance(project.id);
    }

    expect(result.project.stage).toBe(PermitStage.COMPLETE);
    expect(result.project.permitDocument).toBeDefined();
    expect(result.project.permitDocument?.url).toMatch(/pdf/);
    expect(result.project.submissions.length).toBeGreaterThan(0);
  });

  it('records a stage sequence in history', async () => {
    const { config } = makeConfig();
    const conductor  = new PermitConductor(config);

    const project = await conductor.start({
      jurisdiction: 'Austin, TX',
      permitTypes:  ['building'],
      applicant: { id: 'app-1', name: 'Test', email: 't@t.com' },
    });

    let result = await conductor.advance(project.id);
    let maxSteps = 10;
    while (result.status === 'ADVANCED' && result.project.stage !== PermitStage.COMPLETE && maxSteps-- > 0) {
      result = await conductor.advance(project.id);
    }

    const finalProject = await conductor.getProject(project.id);
    const stages = finalProject.history.map((h) => h.to);

    // Expect DISCOVER → PREPARE to appear
    expect(stages).toContain(PermitStage.PREPARE);
    // And project should ultimately be COMPLETE
    expect(finalProject.stage).toBe(PermitStage.COMPLETE);
  });

  it('emits permit:approved event on completion', async () => {
    const { config } = makeConfig();
    const conductor  = new PermitConductor(config);

    const approvedPayloads: unknown[] = [];
    conductor.on('permit:approved', (payload) => {
      approvedPayloads.push(payload);
    });

    const project = await conductor.start({
      jurisdiction: 'Austin, TX',
      permitTypes:  ['building'],
      applicant: { id: 'app-1', name: 'Test', email: 't@t.com' },
    });

    let result = await conductor.advance(project.id);
    let maxSteps = 10;
    while (result.status === 'ADVANCED' && result.project.stage !== PermitStage.COMPLETE && maxSteps-- > 0) {
      result = await conductor.advance(project.id);
    }

    expect(approvedPayloads.length).toBeGreaterThan(0);
    const payload = approvedPayloads[0] as { documentUrl: string };
    expect(payload.documentUrl).toMatch(/https?:\/\//);
  });

  it('getProject returns the persisted final state', async () => {
    const { config } = makeConfig();
    const conductor  = new PermitConductor(config);

    const started = await conductor.start({
      jurisdiction: 'Chicago, IL',
      permitTypes:  ['electrical'],
      applicant: { id: 'app-2', name: 'Bob Builder', email: 'bob@build.com' },
    });

    let result = await conductor.advance(started.id);
    let maxSteps = 10;
    while (result.status === 'ADVANCED' && result.project.stage !== PermitStage.COMPLETE && maxSteps-- > 0) {
      result = await conductor.advance(started.id);
    }

    const persisted = await conductor.getProject(started.id);
    expect(persisted.stage).toBe(PermitStage.COMPLETE);
    expect(persisted.jurisdiction).toBe('Chicago, IL');
  });
});
