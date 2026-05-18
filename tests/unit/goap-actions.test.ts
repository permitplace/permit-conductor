/**
 * Unit tests: All 8 GOAP Actions
 *
 * For each action:
 *   - Preconditions satisfied → execute() succeeds and effects are meaningful
 *   - Preconditions not satisfied → planner skips the action
 */

import type { CorrectionWorldState, CorrectionInput } from '../../src/goap/WorldState';
import { CorrectionType } from '../../src/goap/WorldState';
import type { ActionContext } from '../../src/goap/Action';
import type { GOAPProject } from '../../src/goap/WorldState';

import { ParseCorrection }           from '../../src/goap/actions/ParseCorrection';
import { ClassifyCorrection }        from '../../src/goap/actions/ClassifyCorrection';
import { IdentifyAffectedDocuments } from '../../src/goap/actions/IdentifyAffectedDocuments';
import { GenerateFixGuidance }       from '../../src/goap/actions/GenerateFixGuidance';
import { AutoFixDocument }           from '../../src/goap/actions/AutoFixDocument';
import { RequestUserInput }          from '../../src/goap/actions/RequestUserInput';
import { ValidateFix }               from '../../src/goap/actions/ValidateFix';
import { PrepareResubmission }       from '../../src/goap/actions/PrepareResubmission';
import { GOAPPlanner }               from '../../src/goap/GOAPPlanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(): GOAPProject {
  return {
    id:           'proj-1',
    jurisdiction: 'Los Angeles, CA',
    documents: [
      { id: 'doc-fp-1',  type: 'floor_plan' },
      { id: 'doc-sp-1',  type: 'site_plan'  },
      { id: 'doc-app-1', type: 'application_form' },
    ],
    history: [],
  };
}

function makeCorrection(overrides: Partial<CorrectionInput> = {}): CorrectionInput {
  return {
    id:      'corr-1',
    rawText: 'There is a dimension error in the floor plan. Please correct measurements.',
    ...overrides,
  };
}

function makeWorldState(overrides: Partial<CorrectionWorldState> = {}): CorrectionWorldState {
  return {
    correctionReceived:     false,
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
  correction?: Partial<CorrectionInput>,
): ActionContext {
  const project = makeProject();
  return {
    project,
    correction: makeCorrection(correction),
    worldState,
    emit: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// ParseCorrection
// ---------------------------------------------------------------------------

describe('ParseCorrection', () => {
  const action = new ParseCorrection();

  it('has correct metadata', () => {
    expect(action.name).toBe('ParseCorrection');
    expect(action.cost).toBe(1);
    expect(action.preconditions.correctionReceived).toBe(true);
    expect(action.preconditions.correctionParsed).toBe(false);
    expect(action.effects.correctionParsed).toBe(true);
  });

  it('succeeds when preconditions are met and populates parsedFields', async () => {
    const worldState = makeWorldState({ correctionReceived: true });
    const ctx = makeCtx(worldState, {
      rawText: 'Correction: dimension error. Deadline: 2026-06-01. Ref: A-1234.',
    });

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.correction.parsedFields).toBeDefined();
    expect(ctx.correction.parsedFields!.correctionItems.length).toBeGreaterThan(0);
  });

  it('is skipped by planner when correctionReceived = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ correctionReceived: false });
    const plan = planner.plan(state as CorrectionWorldState, { correctionResolved: true }, [action]);
    expect(plan).toEqual([]);
  });

  it('is skipped by planner when correctionParsed = true', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ correctionReceived: true, correctionParsed: true });
    const plan = planner.plan(state as CorrectionWorldState, { correctionParsed: true }, [action]);
    // Goal already satisfied — plan returns []
    expect(plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ClassifyCorrection
// ---------------------------------------------------------------------------

describe('ClassifyCorrection', () => {
  const action = new ClassifyCorrection();

  it('has correct metadata', () => {
    expect(action.name).toBe('ClassifyCorrection');
    expect(action.cost).toBe(1);
    expect(action.preconditions.correctionParsed).toBe(true);
    expect(action.preconditions.correctionClassified).toBe(false);
    expect(action.effects.correctionClassified).toBe(true);
  });

  it('classifies a dimension error and sets autoFixable=true', async () => {
    const worldState = makeWorldState({ correctionParsed: true });
    const ctx = makeCtx(worldState);
    ctx.correction.parsedFields = {
      correctionItems: ['dimension error in floor plan'],
    };

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.worldState.correctionType).toBe(CorrectionType.DIMENSION_ERROR);
    expect(ctx.worldState.autoFixable).toBe(true);
  });

  it('classifies a missing signature and sets autoFixable=false', async () => {
    const worldState = makeWorldState({ correctionParsed: true });
    const ctx = makeCtx(worldState);
    ctx.correction.parsedFields = {
      correctionItems: ['missing engineer seal on structural plan'],
    };

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.worldState.correctionType).toBe(CorrectionType.MISSING_SIGNATURE);
    expect(ctx.worldState.autoFixable).toBe(false);
  });

  it('falls back to UNKNOWN for unrecognised correction text', async () => {
    const worldState = makeWorldState({ correctionParsed: true });
    const ctx = makeCtx(worldState);
    ctx.correction.parsedFields = {
      correctionItems: ['something completely unrecognised xyz'],
    };

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.worldState.correctionType).toBe(CorrectionType.UNKNOWN);
  });

  it('is skipped by planner when correctionParsed = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ correctionParsed: false });
    const plan = planner.plan(state as CorrectionWorldState, { correctionClassified: true }, [action]);
    expect(plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// IdentifyAffectedDocuments
// ---------------------------------------------------------------------------

describe('IdentifyAffectedDocuments', () => {
  const action = new IdentifyAffectedDocuments();

  it('has correct metadata', () => {
    expect(action.name).toBe('IdentifyAffectedDocuments');
    expect(action.cost).toBe(1);
    expect(action.preconditions.correctionClassified).toBe(true);
    expect(action.preconditions.affectedDocsIdentified).toBe(false);
    expect(action.effects.affectedDocsIdentified).toBe(true);
  });

  it('identifies floor_plan and site_plan for DIMENSION_ERROR', async () => {
    const worldState = makeWorldState({
      correctionClassified:   true,
      correctionType:         CorrectionType.DIMENSION_ERROR,
    });
    const ctx = makeCtx(worldState);

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.worldState.affectedDocumentIds).toBeDefined();
    expect(ctx.worldState.affectedDocumentIds).toContain('doc-fp-1');
    expect(ctx.worldState.affectedDocumentIds).toContain('doc-sp-1');
  });

  it('identifies application_form for WRONG_FORM_VERSION', async () => {
    const worldState = makeWorldState({
      correctionClassified: true,
      correctionType:       CorrectionType.WRONG_FORM_VERSION,
    });
    const ctx = makeCtx(worldState);

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.worldState.affectedDocumentIds).toContain('doc-app-1');
  });

  it('returns empty array for UNKNOWN type', async () => {
    const worldState = makeWorldState({
      correctionClassified: true,
      correctionType:       CorrectionType.UNKNOWN,
    });
    const ctx = makeCtx(worldState);

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.worldState.affectedDocumentIds).toEqual([]);
  });

  it('is skipped by planner when correctionClassified = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ correctionClassified: false });
    const plan = planner.plan(state as CorrectionWorldState, { affectedDocsIdentified: true }, [action]);
    expect(plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GenerateFixGuidance
// ---------------------------------------------------------------------------

describe('GenerateFixGuidance', () => {
  const action = new GenerateFixGuidance();

  it('has correct metadata', () => {
    expect(action.name).toBe('GenerateFixGuidance');
    expect(action.cost).toBe(1);
    expect(action.preconditions.affectedDocsIdentified).toBe(true);
    expect(action.preconditions.fixGuidanceGenerated).toBe(false);
    expect(action.effects.fixGuidanceGenerated).toBe(true);
    expect(action.effects.userActionRequired).toBe(true);
  });

  it('populates guidance and emits correction:guidance', async () => {
    const worldState = makeWorldState({
      affectedDocsIdentified: true,
      correctionType:         CorrectionType.MISSING_SIGNATURE,
      affectedDocumentIds:    ['doc-app-1'],
    });
    const ctx = makeCtx(worldState);

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.correction.guidance).toBeDefined();
    expect(ctx.correction.guidance!.summary).toBeTruthy();
    expect(ctx.emit).toHaveBeenCalledWith('correction:guidance', expect.objectContaining({
      correctionId: 'corr-1',
    }));
  });

  it('is skipped by planner when affectedDocsIdentified = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ affectedDocsIdentified: false });
    const plan = planner.plan(state as CorrectionWorldState, { fixGuidanceGenerated: true }, [action]);
    expect(plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AutoFixDocument
// ---------------------------------------------------------------------------

describe('AutoFixDocument', () => {
  const action = new AutoFixDocument();

  it('has correct metadata', () => {
    expect(action.name).toBe('AutoFixDocument');
    expect(action.cost).toBe(2);
    expect(action.preconditions.affectedDocsIdentified).toBe(true);
    expect(action.preconditions.autoFixable).toBe(true);
    expect(action.preconditions.autoFixApplied).toBe(false);
    expect(action.effects.autoFixApplied).toBe(true);
    expect(action.effects.userActionRequired).toBe(false);
    expect(action.effects.userActionComplete).toBe(true);
  });

  it('applies fix and emits auto_fix_applied event', async () => {
    const worldState = makeWorldState({
      affectedDocsIdentified: true,
      autoFixable:            true,
      affectedDocumentIds:    ['doc-fp-1', 'doc-sp-1'],
    });
    const ctx = makeCtx(worldState);

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith('correction:auto_fix_applied', expect.objectContaining({
      docIds: ['doc-fp-1', 'doc-sp-1'],
    }));
    // Should have added history entries for each doc
    expect(ctx.project.history.length).toBeGreaterThanOrEqual(2);
  });

  it('is skipped by planner when autoFixable = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({
      affectedDocsIdentified: true,
      autoFixable:            false,
    });
    const plan = planner.plan(state as CorrectionWorldState, { autoFixApplied: true }, [action]);
    expect(plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RequestUserInput
// ---------------------------------------------------------------------------

describe('RequestUserInput', () => {
  const action = new RequestUserInput();

  it('has correct metadata', () => {
    expect(action.name).toBe('RequestUserInput');
    expect(action.cost).toBe(5);
    expect(action.preconditions.fixGuidanceGenerated).toBe(true);
    expect(action.preconditions.userActionRequired).toBe(true);
    expect(action.preconditions.userActionComplete).toBe(false);
    expect(action.effects.userActionComplete).toBe(true);
  });

  it('emits user_action_required and returns paused=true', async () => {
    const worldState = makeWorldState({
      fixGuidanceGenerated: true,
      userActionRequired:   true,
    });
    const ctx = makeCtx(worldState);
    ctx.correction.guidance = {
      summary:       'Please provide missing seal.',
      steps:         [],
      examples:      [],
      estimatedTime: '3 days',
    };

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(result.paused).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith(
      'correction:user_action_required',
      expect.objectContaining({ correctionId: 'corr-1' }),
    );
  });

  it('is skipped by planner when fixGuidanceGenerated = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({
      fixGuidanceGenerated: false,
      userActionRequired:   true,
    });
    const plan = planner.plan(state as CorrectionWorldState, { userActionComplete: true }, [action]);
    expect(plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ValidateFix
// ---------------------------------------------------------------------------

describe('ValidateFix', () => {
  const action = new ValidateFix();

  it('has correct metadata', () => {
    expect(action.name).toBe('ValidateFix');
    expect(action.cost).toBe(1);
    expect(action.preconditions.userActionComplete).toBe(true);
    expect(action.preconditions.fixValidated).toBe(false);
    expect(action.effects.fixValidated).toBe(true);
  });

  it('validates successfully and emits validation_passed', async () => {
    const worldState = makeWorldState({ userActionComplete: true });
    const ctx = makeCtx(worldState);

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith(
      'correction:validation_passed',
      expect.objectContaining({ correctionId: 'corr-1' }),
    );
  });

  it('is skipped by planner when userActionComplete = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ userActionComplete: false });
    const plan = planner.plan(state as CorrectionWorldState, { fixValidated: true }, [action]);
    expect(plan).toEqual([]);
  });

  it('resets state and emits validation_failed when validation fails', async () => {
    // Subclass ValidateFix to inject a failing validation outcome
    const { ValidateFix: VF } = await import('../../src/goap/actions/ValidateFix');
    class FailingValidateFix extends VF {
      protected override checkValidation(): { passed: boolean; failures: string[] } {
        return { passed: false, failures: ['DIM-001: Measurement too small'] };
      }
    }
    const failAction = new FailingValidateFix();
    const worldState = makeWorldState({ userActionComplete: true });
    const ctx        = makeCtx(worldState);

    const result = await failAction.execute(worldState, ctx);

    // Should return success:true so executor doesn't abort
    expect(result.success).toBe(true);
    // State flags should be reset
    expect(worldState.userActionComplete).toBe(false);
    expect(worldState.fixGuidanceGenerated).toBe(false);
    // validation_failed event should be emitted
    expect(ctx.emit).toHaveBeenCalledWith(
      'correction:validation_failed',
      expect.objectContaining({ correctionId: 'corr-1' }),
    );
  });
});

// ---------------------------------------------------------------------------
// PrepareResubmission
// ---------------------------------------------------------------------------

describe('PrepareResubmission', () => {
  const action = new PrepareResubmission();

  it('has correct metadata', () => {
    expect(action.name).toBe('PrepareResubmission');
    expect(action.cost).toBe(1);
    expect(action.preconditions.fixValidated).toBe(true);
    expect(action.preconditions.applicationReady).toBe(false);
    expect(action.effects.applicationReady).toBe(true);
    expect(action.effects.correctionResolved).toBe(true);
  });

  it('builds resubmission payload and emits resubmission_ready', async () => {
    const worldState = makeWorldState({ fixValidated: true });
    const ctx = makeCtx(worldState);
    ctx.correction.parsedFields  = { correctionItems: [], referenceNumber: 'REF-001' };
    ctx.correction.guidance      = {
      summary:       'Dimension fixed.',
      steps:         [],
      examples:      [],
      estimatedTime: '1 day',
    };

    const result = await action.execute(worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.project.resubmissionPayload).toBeDefined();
    expect((ctx.project.resubmissionPayload as Record<string, unknown>).correctionRef).toBe('REF-001');
    expect(ctx.emit).toHaveBeenCalledWith(
      'correction:resubmission_ready',
      expect.objectContaining({ correctionId: 'corr-1', correctionRef: 'REF-001' }),
    );
  });

  it('is skipped by planner when fixValidated = false', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ fixValidated: false });
    const plan = planner.plan(state as CorrectionWorldState, { applicationReady: true }, [action]);
    expect(plan).toEqual([]);
  });
});
