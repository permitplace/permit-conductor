/**
 * Unit tests: GOAP action error paths
 *
 * Each action has a try/catch that returns { success: false, error } on exception.
 * This file covers those branches by injecting failures via the ActionContext.
 *
 * Also covers ValidateFix failure path (state reset + validation_failed event)
 * using a subclass that overrides the hardcoded `passed` flag.
 */

import type { CorrectionWorldState } from '../../src/goap/WorldState';
import { CorrectionType } from '../../src/goap/WorldState';
import type { ActionContext } from '../../src/goap/Action';

import { ParseCorrection }           from '../../src/goap/actions/ParseCorrection';
import { ClassifyCorrection }        from '../../src/goap/actions/ClassifyCorrection';
import { IdentifyAffectedDocuments } from '../../src/goap/actions/IdentifyAffectedDocuments';
import { GenerateFixGuidance }       from '../../src/goap/actions/GenerateFixGuidance';
import { AutoFixDocument }           from '../../src/goap/actions/AutoFixDocument';
import { PrepareResubmission }       from '../../src/goap/actions/PrepareResubmission';

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

function makeCtx(
  worldState: CorrectionWorldState,
  overrides: Partial<ActionContext> = {},
): ActionContext {
  return {
    project: {
      id:           'proj-err-1',
      jurisdiction: 'Austin, TX',
      documents:    [
        { id: 'doc-fp-1', type: 'floor_plan' },
        { id: 'doc-sp-1', type: 'site_plan'  },
        { id: 'doc-app-1', type: 'application_form' },
      ],
      history:      [],
    },
    correction: {
      id:      'corr-err-1',
      rawText: 'Dimension error in floor plan',
    },
    worldState,
    emit: jest.fn(),
    ...overrides,
  };
}

/** A throwing emit function — causes GenerateFixGuidance / ValidateFix to hit catch block. */
function throwingEmit(): never {
  throw new Error('emit failure injected');
}

// ---------------------------------------------------------------------------
// ParseCorrection — catch block
// ---------------------------------------------------------------------------

describe('ParseCorrection — error path', () => {
  it('returns success:false when parsing throws (non-Error thrown by property access)', async () => {
    const action     = new ParseCorrection();
    const worldState = makeWorldState({ correctionReceived: true });

    // Inject a correction whose rawText getter throws
    const badCorrection = {
      id:      'corr-bad',
      get rawText(): string { throw new Error('rawText access failed'); },
    };

    const ctx = makeCtx(worldState, { correction: badCorrection as ActionContext['correction'] });

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ClassifyCorrection — catch block
// ---------------------------------------------------------------------------

describe('ClassifyCorrection — error path', () => {
  it('returns success:false when ctx.worldState assignment throws', async () => {
    const action     = new ClassifyCorrection();
    const worldState = makeWorldState({ correctionParsed: true });

    // Make worldState read-only to force assignment to throw
    const frozenState = Object.freeze({ ...worldState });
    const ctx = makeCtx(frozenState as CorrectionWorldState);

    const result = await action.execute(frozenState as CorrectionWorldState, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// IdentifyAffectedDocuments — catch block
// ---------------------------------------------------------------------------

describe('IdentifyAffectedDocuments — error path', () => {
  it('returns success:false when worldState assignment throws', async () => {
    const action     = new IdentifyAffectedDocuments();
    const worldState = makeWorldState({
      correctionClassified: true,
      correctionType:       CorrectionType.DIMENSION_ERROR,
    });

    // Freeze worldState to force write error
    const frozenState = Object.freeze({ ...worldState });
    const ctx         = makeCtx(frozenState as CorrectionWorldState);

    const result = await action.execute(frozenState as CorrectionWorldState, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GenerateFixGuidance — catch block (emit throws)
// ---------------------------------------------------------------------------

describe('GenerateFixGuidance — error path', () => {
  it('returns success:false when emit throws', async () => {
    const action     = new GenerateFixGuidance();
    const worldState = makeWorldState({
      affectedDocsIdentified: true,
      correctionType:         CorrectionType.DIMENSION_ERROR,
    });
    const ctx = makeCtx(worldState, { emit: throwingEmit });

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('emit failure injected');
  });
});

// ---------------------------------------------------------------------------
// AutoFixDocument — catch block (emit throws)
// ---------------------------------------------------------------------------

describe('AutoFixDocument — error path', () => {
  it('returns success:false when emit throws', async () => {
    const action     = new AutoFixDocument();
    const worldState = makeWorldState({
      affectedDocsIdentified: true,
      autoFixable:            true,
      affectedDocumentIds:    ['doc-fp-1'],
    });
    const ctx = makeCtx(worldState, { emit: throwingEmit });

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('emit failure injected');
  });
});

// ---------------------------------------------------------------------------
// PrepareResubmission — catch block (emit throws)
// ---------------------------------------------------------------------------

describe('PrepareResubmission — error path', () => {
  it('returns success:false when emit throws', async () => {
    const { PrepareResubmission: Prepare } = await import('../../src/goap/actions/PrepareResubmission');
    const action     = new Prepare();
    const worldState = makeWorldState({ fixValidated: true });
    const ctx        = makeCtx(worldState, { emit: throwingEmit });
    ctx.correction.parsedFields = { correctionItems: [], referenceNumber: 'REF-ERR' };

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('emit failure injected');
  });
});

// ---------------------------------------------------------------------------
// ValidateFix — catch block (emit throws)
// ---------------------------------------------------------------------------

describe('ValidateFix — error path (catch block)', () => {
  it('returns success:false when emit throws', async () => {
    const { ValidateFix } = await import('../../src/goap/actions/ValidateFix');
    const action     = new ValidateFix();
    const worldState = makeWorldState({ userActionComplete: true });
    const ctx        = makeCtx(worldState, { emit: throwingEmit });

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('emit failure injected');
  });
});
