/**
 * GOAP Planner fuzz test — 1,000 random world states.
 *
 * Verifies:
 *   1. The planner never throws for any boolean combination of world state.
 *   2. The result is always an array (never undefined / null).
 *   3. No single run exceeds 500 ms.
 *   4. When the initial state already satisfies the goal, plan is [].
 *   5. From the canonical "auto-fixable correction received" start state,
 *      a non-empty plan is found.
 */

import { GOAPPlanner }               from '../../src/goap/GOAPPlanner';
import type { CorrectionWorldState } from '../../src/goap/WorldState';
import { CorrectionType }            from '../../src/goap/WorldState';
import { ParseCorrection }           from '../../src/goap/actions/ParseCorrection';
import { ClassifyCorrection }        from '../../src/goap/actions/ClassifyCorrection';
import { IdentifyAffectedDocuments } from '../../src/goap/actions/IdentifyAffectedDocuments';
import { GenerateFixGuidance }       from '../../src/goap/actions/GenerateFixGuidance';
import { AutoFixDocument }           from '../../src/goap/actions/AutoFixDocument';
import { RequestUserInput }          from '../../src/goap/actions/RequestUserInput';
import { ValidateFix }               from '../../src/goap/actions/ValidateFix';
import { PrepareResubmission }       from '../../src/goap/actions/PrepareResubmission';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOAL: Partial<CorrectionWorldState> = {
  correctionResolved: true,
  applicationReady:   true,
};

const ALL_ACTIONS = [
  new ParseCorrection(),
  new ClassifyCorrection(),
  new IdentifyAffectedDocuments(),
  new GenerateFixGuidance(),
  new AutoFixDocument(),
  new RequestUserInput(),
  new ValidateFix(),
  new PrepareResubmission(),
];

const FUZZ_RUNS = 1_000;
const MAX_MS_PER_RUN = 500;

// Boolean keys that the planner reasons over (excludes optional metadata fields)
const BOOL_KEYS: Array<keyof CorrectionWorldState> = [
  'correctionReceived',
  'correctionParsed',
  'correctionClassified',
  'affectedDocsIdentified',
  'fixGuidanceGenerated',
  'userActionRequired',
  'userActionComplete',
  'autoFixApplied',
  'fixValidated',
  'applicationReady',
  'correctionResolved',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeded pseudo-random number generator (xorshift32) — deterministic across runs. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffff_ffff;
  };
}

function randomBool(rng: () => number): boolean {
  return rng() < 0.5;
}

function buildRandomState(rng: () => number): CorrectionWorldState {
  const state: Partial<CorrectionWorldState> = {};
  for (const key of BOOL_KEYS) {
    (state as Record<string, boolean>)[key] = randomBool(rng);
  }
  // Include optional metadata: randomly add correctionType and autoFixable
  if (randomBool(rng)) {
    const types = Object.values(CorrectionType);
    const idx = Math.floor(rng() * types.length);
    state.correctionType = types[idx];
  }
  if (randomBool(rng)) {
    state.autoFixable = randomBool(rng);
  }
  return state as CorrectionWorldState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GOAPPlanner fuzz (1,000 random world states)', () => {
  const planner = new GOAPPlanner();

  it('never throws, always returns an array, completes within 500 ms per run', () => {
    const rng = makeRng(0xdeadbeef);

    for (let i = 0; i < FUZZ_RUNS; i++) {
      const worldState = buildRandomState(rng);

      const start = Date.now();
      let result: ReturnType<GOAPPlanner['plan']>;

      expect(() => {
        result = planner.plan(worldState, GOAL, ALL_ACTIONS);
      }).not.toThrow();

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(MAX_MS_PER_RUN);

      // result is assigned inside expect() callback above; TypeScript needs the cast
      expect(Array.isArray(result!)).toBe(true);
    }
  });

  it('returns [] when the initial state already satisfies the goal', () => {
    const goalSatisfied: CorrectionWorldState = {
      correctionReceived:     true,
      correctionParsed:       true,
      correctionClassified:   true,
      affectedDocsIdentified: true,
      fixGuidanceGenerated:   true,
      userActionRequired:     false,
      userActionComplete:     false,
      autoFixApplied:         true,
      fixValidated:           true,
      applicationReady:       true,   // goal key satisfied
      correctionResolved:     true,   // goal key satisfied
    };

    const plan = planner.plan(goalSatisfied, GOAL, ALL_ACTIONS);
    expect(plan).toEqual([]);
  });

  it('finds a non-empty plan from canonical auto-fixable start state', () => {
    const canonicalStart: CorrectionWorldState = {
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
      correctionType:         CorrectionType.DIMENSION_ERROR,
      autoFixable:            true,
    };

    const plan = planner.plan(canonicalStart, GOAL, ALL_ACTIONS);
    expect(plan.length).toBeGreaterThan(0);
  });
});
