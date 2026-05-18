/**
 * Unit tests: GOAPExecutor
 *
 * Covers the previously uncovered branches:
 *   - action.execute() throws an Error → FAILED with error message (lines 52-58)
 *   - action returns success:false → FAILED with action error (line 62)
 *   - action returns paused:true → WAITING_FOR_USER with pausedAt set
 *   - All actions succeed → COMPLETED
 *   - Empty plan → COMPLETED immediately
 */

import { GOAPExecutor } from '../../src/goap/GOAPExecutor';
import type { IAction, ActionContext, ActionResult } from '../../src/goap/Action';
import type { CorrectionWorldState } from '../../src/goap/WorldState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorldState(overrides: Partial<CorrectionWorldState> = {}): CorrectionWorldState {
  return {
    correctionReceived:     true,
    correctionParsed:       false,
    correctionClassified:   false,
    affectedDocsIdentified: false,
    fixGuidanceGenerated:   false,
    userActionRequired:     false,
    userActionComplete:     false,
    autoFixApplied:         false,
    fixValidated:           false,
    applicationReady:       false,
    correctionResolved:     false,
    ...overrides,
  };
}

function makeCtx(worldState: CorrectionWorldState): ActionContext {
  return {
    project: {
      id:           'proj-exec-1',
      jurisdiction: 'Austin, TX',
      documents:    [],
      history:      [],
    },
    correction: {
      id:      'corr-exec-1',
      rawText: 'Dimension error',
    },
    worldState,
    emit: jest.fn(),
  };
}

/** A simple action stub that returns a given result. */
function makeAction(
  name: string,
  result: ActionResult | (() => Promise<ActionResult>),
  effects: Partial<CorrectionWorldState> = {},
): IAction {
  return {
    name,
    preconditions: {},
    effects,
    cost: 1,
    async execute(): Promise<ActionResult> {
      if (typeof result === 'function') {
        return result();
      }
      return result;
    },
  };
}

/** An action stub that throws when executed. */
function makeThrowingAction(name: string, errorMessage: string): IAction {
  return {
    name,
    preconditions: {},
    effects:       {},
    cost:          1,
    async execute(): Promise<ActionResult> {
      throw new Error(errorMessage);
    },
  };
}

/** An action stub that throws a non-Error when executed. */
function makeThrowingNonErrorAction(name: string, thrown: unknown): IAction {
  return {
    name,
    preconditions: {},
    effects:       {},
    cost:          1,
    async execute(): Promise<ActionResult> {
      throw thrown;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GOAPExecutor', () => {
  let executor: GOAPExecutor;

  beforeEach(() => {
    executor = new GOAPExecutor();
  });

  // -------------------------------------------------------------------------
  // Empty plan
  // -------------------------------------------------------------------------

  describe('empty plan', () => {
    it('returns COMPLETED immediately when plan is empty', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const result = await executor.execute([], ctx);

      expect(result.status).toBe('COMPLETED');
      expect(ctx.project.history).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // All actions succeed
  // -------------------------------------------------------------------------

  describe('all actions succeed', () => {
    it('returns COMPLETED and applies all effects', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [
        makeAction('ActionA', { success: true }, { correctionParsed: true }),
        makeAction('ActionB', { success: true }, { correctionClassified: true }),
      ];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('COMPLETED');
      expect(result.worldState.correctionParsed).toBe(true);
      expect(result.worldState.correctionClassified).toBe(true);
    });

    it('logs each action to project history', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [
        makeAction('ActionA', { success: true }),
        makeAction('ActionB', { success: true }),
      ];

      await executor.execute(plan, ctx);

      // Each action gets one history entry (the "attempt" record)
      expect(ctx.project.history).toHaveLength(2);
      expect(ctx.project.history[0].action).toBe('ActionA');
      expect(ctx.project.history[1].action).toBe('ActionB');
    });
  });

  // -------------------------------------------------------------------------
  // Action throws an Error
  // -------------------------------------------------------------------------

  describe('action throws an Error', () => {
    it('returns FAILED status with the error message', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [
        makeAction('ActionOK', { success: true }),
        makeThrowingAction('ActionFails', 'Something went wrong'),
      ];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('Something went wrong');
    });

    it('logs an :error entry to project history when action throws', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [makeThrowingAction('ActionThrows', 'Boom')];

      await executor.execute(plan, ctx);

      const errorEntry = ctx.project.history.find((h) => h.action === 'ActionThrows:error');
      expect(errorEntry).toBeDefined();
      expect((errorEntry!.detail as Record<string, unknown>).error).toBe('Boom');
    });

    it('handles non-Error throws and converts to string', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [makeThrowingNonErrorAction('ActionStringThrow', 'raw string error')];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('raw string error');
    });

    it('handles non-Error object throws', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [makeThrowingNonErrorAction('ActionObjThrow', { code: 42 })];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Action returns success:false
  // -------------------------------------------------------------------------

  describe('action returns success:false', () => {
    it('returns FAILED status with action error message', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [
        makeAction('ActionFailed', { success: false, error: 'Validation rejected' }),
      ];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('Validation rejected');
    });

    it('returns FAILED with default message when no error provided', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [
        makeAction('ActionNoMsg', { success: false }),
      ];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('ActionNoMsg');
    });

    it('stops execution and does not run subsequent actions', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const secondAction = makeAction('ActionAfterFail', { success: true }, { correctionParsed: true });
      const executeSpy   = jest.spyOn(secondAction, 'execute');

      const plan = [
        makeAction('ActionFailed', { success: false, error: 'Stop here' }),
        secondAction,
      ];

      await executor.execute(plan, ctx);

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Action returns paused:true
  // -------------------------------------------------------------------------

  describe('action returns paused:true', () => {
    it('returns WAITING_FOR_USER with pausedAt set to the action name', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [
        makeAction('ActionOK', { success: true }, { correctionParsed: true }),
        makeAction('ActionPause', { success: true, paused: true }, { correctionClassified: true }),
        makeAction('ActionAfterPause', { success: true }),
      ];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('WAITING_FOR_USER');
      expect(result.pausedAt).toBe('ActionPause');
    });

    it('applies effects of the paused action before stopping', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const plan = [
        makeAction('ActionPause', { success: true, paused: true }, { correctionParsed: true }),
      ];

      const result = await executor.execute(plan, ctx);

      expect(result.status).toBe('WAITING_FOR_USER');
      // Effects were applied despite pause
      expect(result.worldState.correctionParsed).toBe(true);
    });

    it('does not run actions after the paused one', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const afterAction = makeAction('AfterPause', { success: true }, { fixValidated: true });
      const executeSpy  = jest.spyOn(afterAction, 'execute');

      const plan = [
        makeAction('ActionPause', { success: true, paused: true }),
        afterAction,
      ];

      await executor.execute(plan, ctx);

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // History recording
  // -------------------------------------------------------------------------

  describe('history recording', () => {
    it('records preconditions and effects in the history detail', async () => {
      const worldState = makeWorldState();
      const ctx        = makeCtx(worldState);

      const action: IAction = {
        name:          'TestAction',
        preconditions: { correctionReceived: true },
        effects:       { correctionParsed: true },
        cost:          1,
        async execute(): Promise<ActionResult> {
          return { success: true };
        },
      };

      await executor.execute([action], ctx);

      const entry = ctx.project.history[0];
      expect(entry.action).toBe('TestAction');
      expect(entry.timestamp).toBeTruthy();
      const detail = entry.detail as Record<string, unknown>;
      expect(detail.preconditions).toEqual({ correctionReceived: true });
      expect(detail.effects).toEqual({ correctionParsed: true });
    });
  });
});
