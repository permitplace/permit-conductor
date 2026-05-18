/**
 * ADR-071 Phase 7: getActionPriors() + adaptive ParseCorrection behaviour
 *
 * Verifies:
 * - getActionPriors() returns source='none' when no brainProxyUrl and no patterns file
 * - ParseCorrection records parserStrategy='simple' when priors show nlp_timeout ≥ 2
 * - ParseCorrection records parserStrategy='standard' when no prior failures exist
 */

import type { ActionContext, ActionPrior } from '../../src/goap/Action';
import { getActionPriors } from '../../src/goap/Action';
import { ParseCorrection } from '../../src/goap/actions/ParseCorrection';
import type { CorrectionWorldState, GOAPProject } from '../../src/goap/WorldState';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(jurisdiction = 'CA-LA'): GOAPProject {
  return { id: 'proj-test', jurisdiction, documents: [], history: [] };
}

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  const worldState: CorrectionWorldState = {
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
  };

  return {
    project:    makeProject(),
    correction: { id: 'c-1', rawText: 'Missing dimension. Deadline: 2026-07-01. Ref: A-99.' },
    worldState,
    emit:       jest.fn(),
    ...overrides,
  };
}

// ── getActionPriors: baseline (no data) ──────────────────────────────────────

describe('getActionPriors — no brainProxyUrl, no patterns file', () => {
  it('returns source=none and zeroed counts', async () => {
    const ctx = makeCtx();  // no brainProxyUrl set
    const prior = await getActionPriors('ParseCorrection', ctx);

    expect(prior.source).toBe('none');
    expect(prior.total).toBe(0);
    expect(prior.successCount).toBe(0);
    expect(prior.failureCount).toBe(0);
    expect(prior.failureModes).toEqual({});
    expect(prior.suggestion).toBeUndefined();
  });
});

// ── ParseCorrection: adaptive strategy selection ──────────────────────────────

describe('ParseCorrection — adaptive parser strategy', () => {
  const action = new ParseCorrection();

  it('uses standard strategy when priors show no failures', async () => {
    const ctx = makeCtx();
    const result = await action.execute(ctx.worldState, ctx);

    expect(result.success).toBe(true);
    expect(result.metadata?.parserStrategy).toBe('standard');
    expect(result.metadata?.priorsSource).toBe('none');
  });

  it('uses simple strategy when patterns file signals use_simple_parser', async () => {
    const originalFetch = global.fetch;
    const okNoContent = { ok: true, json: async () => ({}) } as Response;

    global.fetch = jest.fn()
      // First call: getActionPriors search
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { metadata: { actionName: 'ParseCorrection', jurisdiction: 'CA-LA', success: false, errorCode: 'nlp_timeout', latencyMs: 5000 } },
            { metadata: { actionName: 'ParseCorrection', jurisdiction: 'CA-LA', success: false, errorCode: 'nlp_timeout', latencyMs: 4800 } },
            { metadata: { actionName: 'ParseCorrection', jurisdiction: 'CA-LA', success: true,  latencyMs: 120 } },
          ],
        }),
      } as Response)
      // Second call: recordOutcome — absorb silently
      .mockResolvedValueOnce(okNoContent);

    const ctx = makeCtx({ brainProxyUrl: 'http://localhost:3010' });
    const result = await action.execute(ctx.worldState, ctx);

    global.fetch = originalFetch;

    expect(result.success).toBe(true);
    expect(result.metadata?.parserStrategy).toBe('simple');
    expect(result.metadata?.priorsSource).toBe('brain');
  });

  it('uses standard strategy when priors show only 1 nlp_timeout', async () => {
    const originalFetch = global.fetch;
    const okNoContent = { ok: true, json: async () => ({}) } as Response;

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { metadata: { actionName: 'ParseCorrection', jurisdiction: 'CA-LA', success: false, errorCode: 'nlp_timeout', latencyMs: 3000 } },
            { metadata: { actionName: 'ParseCorrection', jurisdiction: 'CA-LA', success: true,  latencyMs: 100 } },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce(okNoContent);

    const ctx = makeCtx({ brainProxyUrl: 'http://localhost:3010' });
    const result = await action.execute(ctx.worldState, ctx);

    global.fetch = originalFetch;

    expect(result.success).toBe(true);
    // Only 1 timeout — threshold is 2, so still use standard
    expect(result.metadata?.parserStrategy).toBe('standard');
  });

  it('still parses rawText correctly under both strategies', async () => {
    const ctx = makeCtx();
    const result = await action.execute(ctx.worldState, ctx);

    expect(result.success).toBe(true);
    expect(ctx.correction.parsedFields?.correctionItems.length).toBeGreaterThan(0);
    expect(ctx.correction.parsedFields?.deadlineDate).toBe('2026-07-01');
    expect(ctx.correction.parsedFields?.referenceNumber).toBe('A-99');
  });
});

// ── getActionPriors: live brain aggregation ──────────────────────────────────

describe('getActionPriors — live brain fallback aggregation', () => {
  it('aggregates success/failure counts from brain search results', async () => {
    const originalFetch = global.fetch;

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { metadata: { success: true,  latencyMs: 100 } },
          { metadata: { success: true,  latencyMs: 200 } },
          { metadata: { success: false, errorCode: 'parse_error', latencyMs: 50 } },
        ],
      }),
    } as Response);

    const ctx = makeCtx({ brainProxyUrl: 'http://localhost:3010' });
    const prior = await getActionPriors('ParseCorrection', ctx);

    global.fetch = originalFetch;

    expect(prior.source).toBe('brain');
    expect(prior.total).toBe(3);
    expect(prior.successCount).toBe(2);
    expect(prior.failureCount).toBe(1);
    expect(prior.failureModes['parse_error']).toBe(1);
    expect(prior.avgLatencyMs).toBe(117); // Math.round((100+200+50)/3)
  });

  it('returns source=none when brain-proxy returns non-ok status', async () => {
    const originalFetch = global.fetch;

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    const ctx = makeCtx({ brainProxyUrl: 'http://localhost:3010' });
    const prior = await getActionPriors('ParseCorrection', ctx);

    global.fetch = originalFetch;

    expect(prior.source).toBe('none');
    expect(prior.total).toBe(0);
  });

  it('returns source=none when fetch throws (network error)', async () => {
    const originalFetch = global.fetch;

    global.fetch = jest.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const ctx = makeCtx({ brainProxyUrl: 'http://localhost:3010' });
    const prior = await getActionPriors('ParseCorrection', ctx);

    global.fetch = originalFetch;

    expect(prior.source).toBe('none');
    expect(prior.total).toBe(0);
  });
});
