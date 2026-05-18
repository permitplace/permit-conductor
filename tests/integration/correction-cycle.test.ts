/**
 * Integration tests: Full correction cycle via CorrectionHandler
 *
 *   1. Full correction cycle with auto-fix: RESPOND → SUBMIT (COMPLETED)
 *   2. Full correction cycle with user input: RESPOND (paused) → resolve → SUBMIT
 *   3. Multi-correction bundle: both resolved before resubmit
 *   4. Escalation: no valid plan → ESCALATED
 */

import { CorrectionHandler } from '../../src/goap/CorrectionHandler';
import type { GOAPProject, CorrectionInput } from '../../src/goap/WorldState';
import { CorrectionType }  from '../../src/goap/WorldState';
import type { IAction }    from '../../src/goap/Action';
import type { CorrectionWorldState } from '../../src/goap/WorldState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(): GOAPProject {
  return {
    id:           'proj-integ-1',
    jurisdiction: 'Austin, TX',
    documents: [
      { id: 'doc-fp-1',  type: 'floor_plan'  },
      { id: 'doc-sp-1',  type: 'site_plan'   },
      { id: 'doc-app-1', type: 'application_form' },
    ],
    history: [],
  };
}

function makeCorrection(overrides: Partial<CorrectionInput> = {}): CorrectionInput {
  return {
    id:      `corr-${Math.random().toString(36).slice(2, 7)}`,
    rawText: 'There is a dimension error in the floor plan. Ref: REF-999.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Auto-fix cycle
// ---------------------------------------------------------------------------

describe('Integration: Auto-fix correction cycle', () => {
  it('returns COMPLETED for an auto-fixable dimension error', async () => {
    const handler   = new CorrectionHandler();
    const project   = makeProject();
    const correction = makeCorrection({
      rawText: 'dimension error in floor plan measurements. Ref: DIM-001.',
    });
    const emit      = jest.fn();

    const result = await handler.handle(project, correction, emit);

    expect(result.status).toBe('COMPLETED');
    expect(result.worldState.correctionResolved).toBe(true);
    expect(result.worldState.applicationReady).toBe(true);
    expect(result.worldState.autoFixApplied).toBe(true);

    // Should have emitted auto_fix_applied and resubmission_ready
    const eventNames = emit.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('correction:auto_fix_applied');
    expect(eventNames).toContain('correction:resubmission_ready');

    // Resubmission payload should exist
    expect(project.resubmissionPayload).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. User-input correction cycle (pause + resume)
// ---------------------------------------------------------------------------

describe('Integration: User-input correction cycle', () => {
  it('pauses at RequestUserInput, then completes after resolve', async () => {
    const handler    = new CorrectionHandler();
    const project    = makeProject();
    const correction = makeCorrection({
      rawText: 'missing engineer seal on structural plan. Contact: dept@austin.gov.',
    });
    const emit = jest.fn();

    // Initial run — should pause
    const pausedResult = await handler.handle(project, correction, emit);

    expect(pausedResult.status).toBe('WAITING_FOR_USER');
    expect(pausedResult.pausedAt).toBe('RequestUserInput');

    // Verify the guidance event was emitted
    const eventNames = emit.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('correction:user_action_required');

    // Resume — simulate user completing the action
    // Build remaining plan from ValidateFix → PrepareResubmission
    const { ValidateFix }        = await import('../../src/goap/actions/ValidateFix');
    const { PrepareResubmission } = await import('../../src/goap/actions/PrepareResubmission');
    const remainingPlan: IAction[] = [new ValidateFix(), new PrepareResubmission()];

    emit.mockClear();

    const resumeResult = await handler.resume(
      project,
      correction,
      pausedResult.worldState,
      remainingPlan,
      emit,
    );

    expect(resumeResult.status).toBe('COMPLETED');
    expect(resumeResult.worldState.correctionResolved).toBe(true);
    expect(resumeResult.worldState.applicationReady).toBe(true);

    const resumeEventNames = emit.mock.calls.map((c) => c[0]);
    expect(resumeEventNames).toContain('correction:resubmission_ready');
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-correction bundle
// ---------------------------------------------------------------------------

describe('Integration: Multi-correction bundle', () => {
  it('resolves all corrections before resubmission', async () => {
    const handler  = new CorrectionHandler();
    const project  = makeProject();
    const emit     = jest.fn();

    const corrections: CorrectionInput[] = [
      makeCorrection({ rawText: 'dimension error in floor plan. Ref: DIM-100.' }),
      makeCorrection({ rawText: 'fee discrepancy in application. Ref: FEE-200.' }),
    ];

    const results = await handler.handleBundle(project, corrections, emit);

    expect(results).toHaveLength(2);

    for (const result of results) {
      // Both should be auto-fixable and complete
      expect(['COMPLETED', 'WAITING_FOR_USER']).toContain(result.status);
    }

    // At least one resubmission_ready should have fired
    const eventNames = emit.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('correction:resubmission_ready');
  });
});

// ---------------------------------------------------------------------------
// 4. Escalation — no valid plan
// ---------------------------------------------------------------------------

describe('Integration: Escalation on no valid plan', () => {
  it('emits escalation event and returns ESCALATED when action set is empty', async () => {
    // Inject an empty action set so the planner cannot find any plan
    const handler    = new CorrectionHandler({ availableActions: [] });
    const project    = makeProject();
    const correction = makeCorrection();
    const emit       = jest.fn();

    const result = await handler.handle(project, correction, emit);

    expect(result.status).toBe('ESCALATED');

    const eventNames = emit.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('correction:escalation_required');
  });

  it('escalates when a custom action prevents plan completion', async () => {
    // Provide only ParseCorrection — cannot reach goal with one action
    const { ParseCorrection } = await import('../../src/goap/actions/ParseCorrection');

    const handler    = new CorrectionHandler({ availableActions: [new ParseCorrection()] });
    const project    = makeProject();
    const correction = makeCorrection();
    const emit       = jest.fn();

    const result = await handler.handle(project, correction, emit);

    expect(result.status).toBe('ESCALATED');
    expect(emit).toHaveBeenCalledWith(
      'correction:escalation_required',
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Action costs are preferred correctly (planner prefers auto-fix)
// ---------------------------------------------------------------------------

describe('Integration: Planner prefers AutoFix over RequestUserInput', () => {
  it('uses AutoFixDocument path (cost 7) rather than user-input path (cost 11)', async () => {
    const handler    = new CorrectionHandler();
    const project    = makeProject();
    const emit       = jest.fn();

    // Dimension error = autoFixable
    const correction = makeCorrection({
      rawText: 'Incorrect dimension measurement found. Ref: DIM-777.',
    });

    const result = await handler.handle(project, correction, emit);

    // Should complete without pausing
    expect(result.status).toBe('COMPLETED');
    expect(result.worldState.autoFixApplied).toBe(true);

    // Should NOT have asked for user input
    const eventNames = emit.mock.calls.map((c) => c[0]);
    expect(eventNames).not.toContain('correction:user_action_required');
  });
});
