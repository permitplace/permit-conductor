/**
 * GOAP Action interfaces for the Correction Handling system.
 * Defined by ADR-002. Extended by ADR-071 (recordOutcome + getActionPriors learning loop).
 */

import type { CorrectionWorldState, CorrectionInput, GOAPProject } from './WorldState';

// ── ActionPrior ──────────────────────────────────────────────────────────────

/**
 * Aggregated prior outcomes for a specific action+jurisdiction pair.
 * Returned by getActionPriors() to enable adaptive behavior inside execute().
 */
export interface ActionPrior {
  actionName:   string;
  jurisdiction: string;
  total:        number;
  successCount: number;
  failureCount: number;
  /** errorCode → occurrence count, e.g. { nlp_timeout: 4, parse_error: 2 } */
  failureModes: Record<string, number>;
  avgLatencyMs: number;
  /** Distilled suggestion from nightly job, e.g. 'use_simple_parser' */
  suggestion?:  string;
  source:       'patterns' | 'brain' | 'none';
}

// ── Jurisdiction normalization ────────────────────────────────────────────────

/** Normalize jurisdiction to canonical "City State" format (no comma, trimmed). */
function normalizeJurisdiction(j: string): string {
  return j.replace(/,\s*/g, ' ').trim();
}

// ── Two-tier patterns cache (mirrors jurisdiction_intelligence.py in permitapproved) ──

let _goapPatternsCache: Record<string, unknown> | null = null;
let _goapPatternsCacheTime = 0;
const _CACHE_TTL_MS = 300_000; // 5 minutes

function _loadGoapPatterns(): Record<string, unknown> {
  const now = Date.now();
  if (_goapPatternsCache !== null && (now - _goapPatternsCacheTime) < _CACHE_TTL_MS) {
    return _goapPatternsCache;
  }
  try {
    if (typeof require !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs   = require('fs')   as typeof import('fs');
      const file = path.join(__dirname, '..', '..', '..', 'data', 'goap-patterns.json');
      if (fs.existsSync(file)) {
        _goapPatternsCache     = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        _goapPatternsCacheTime = now;
        return _goapPatternsCache;
      }
    }
  } catch {
    // Silently fall through — file may not exist until first nightly distillation run
  }
  _goapPatternsCache     = { actions: {} };
  _goapPatternsCacheTime = now;
  return _goapPatternsCache;
}

/** For tests only: inject patterns directly (bypasses file I/O and TTL). */
export function _setGoapPatternsForTest(data: Record<string, unknown>): void {
  _goapPatternsCache     = data;
  _goapPatternsCacheTime = Date.now();
}

export type EventEmitter = (event: string, payload?: unknown) => void;

export interface ActionContext {
  project:       GOAPProject;
  correction:    CorrectionInput;
  worldState:    CorrectionWorldState;
  emit:          EventEmitter;
  /** Optional brain proxy base URL — used by recordOutcome (ADR-071). */
  brainProxyUrl?: string;
}

export interface ActionResult {
  success:    boolean;
  paused?:    boolean;   // true when execution must wait for external input
  error?:     string;
  latencyMs?: number;    // ADR-071: populated by executor for outcome recording
  errorCode?: string;    // ADR-071: machine-readable error code
  metadata?:  Record<string, unknown>;
}

/**
 * A GOAP action. The planner uses preconditions and effects for graph search;
 * the executor calls execute() when the action is reached in a plan.
 */
export interface IAction {
  readonly name:          string;
  readonly preconditions: Partial<CorrectionWorldState>;
  readonly effects:       Partial<CorrectionWorldState>;
  readonly cost:          number;
  execute(state: CorrectionWorldState, ctx: ActionContext): Promise<ActionResult>;
}

/**
 * Records a GOAP action outcome to brain-proxy for the learning loop.
 * ADR-071: every action calls this at the end of execute().
 *
 * Silently skips when brainProxyUrl is not set or the POST fails —
 * the learning loop must never block or throw from a GOAP action.
 *
 * @param action   The action being recorded
 * @param result   The ActionResult returned by execute()
 * @param ctx      The ActionContext (provides projectId, jurisdiction, brainProxyUrl)
 */
export async function recordOutcome(
  action: IAction,
  result: ActionResult,
  ctx: ActionContext,
): Promise<void> {
  const brainProxyUrl = ctx.brainProxyUrl;
  if (!brainProxyUrl) return;

  const p = ctx.project;
  const body = {
    actionName:    action.name,
    projectId:     p.id,
    jurisdiction:  normalizeJurisdiction(p.jurisdiction ?? ''),
    preconditions: action.preconditions,
    effects:       action.effects,
    result: {
      success:   result.success,
      paused:    result.paused,
      error:     result.error,
      latencyMs: result.latencyMs,
      errorCode: result.errorCode,
      metadata:  result.metadata,
    },
    episodeType: 'goap_outcome',
    scrubPii:    true,
  };

  try {
    const serviceToken = typeof process !== 'undefined'
      ? (process.env?.GOAP_SERVICE_TOKEN ?? '')
      : '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (serviceToken) headers['x-service-token'] = serviceToken;

    const res = await fetch(`${brainProxyUrl}/api/brain/goap-outcome`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      // Log and continue — never throw from recordOutcome
      console.warn(
        `[recordOutcome] brain-proxy returned ${res.status} for action ${action.name}`,
      );
    }
  } catch (err) {
    // Network error, brain down, etc. — log and continue
    console.warn(
      `[recordOutcome] failed for action ${action.name}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Get prior outcomes for an action+jurisdiction pair.
 * ADR-071 Phase 7: enables adaptive behavior inside execute() based on historical outcomes.
 *
 * Two-tier lookup (mirrors jurisdiction_intelligence.py in permitapproved):
 * 1. data/goap-patterns.json — pre-computed nightly by scripts/distill-goap-patterns.js (<1ms)
 * 2. brain-proxy /api/brain/search — live fallback (~50ms, used until patterns file exists)
 *
 * Never throws — always returns a valid ActionPrior with source='none' on any failure.
 *
 * @example
 *   const priors = await getActionPriors('ParseCorrection', ctx);
 *   if ((priors.failureModes['nlp_timeout'] ?? 0) >= 2) {
 *     // This jurisdiction times out NLP — skip to simple parser
 *   }
 */
export async function getActionPriors(
  actionName: string,
  ctx: ActionContext,
): Promise<ActionPrior> {
  const jurisdiction = normalizeJurisdiction(ctx.project.jurisdiction ?? '');
  const empty: ActionPrior = {
    actionName, jurisdiction,
    total: 0, successCount: 0, failureCount: 0,
    failureModes: {}, avgLatencyMs: 0,
    source: 'none',
  };

  // ── Tier 1: Pre-computed patterns (instant) ──────────────────────────────
  const patterns = _loadGoapPatterns();
  const actions  = (patterns as { actions?: Record<string, unknown> }).actions ?? {};
  const key      = `${actionName}|${jurisdiction}`;
  const entry    = actions[key] as Record<string, unknown> | undefined;

  if (entry && typeof entry.total === 'number' && entry.total > 0) {
    return {
      actionName,
      jurisdiction,
      total:        entry.total as number,
      successCount: (entry.success_count as number) ?? 0,
      failureCount: (entry.failure_count as number) ?? 0,
      failureModes: (entry.failure_modes as Record<string, number>) ?? {},
      avgLatencyMs: (entry.avg_latency_ms as number) ?? 0,
      suggestion:   entry.suggestion as string | undefined,
      source:       'patterns',
    };
  }

  // ── Tier 2: Live brain-proxy search (fallback) ───────────────────────────
  const brainProxyUrl = ctx.brainProxyUrl;
  if (!brainProxyUrl) return empty;

  try {
    const serviceToken = typeof process !== 'undefined'
      ? (process.env?.GOAP_SERVICE_TOKEN ?? '')
      : '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (serviceToken) headers['x-service-token'] = serviceToken;

    const res = await fetch(`${brainProxyUrl}/api/brain/goap-search`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        query:  `goap_outcome ${actionName} ${jurisdiction}`,
        topK:   10,
        filter: { category: 'goap_outcome' },
      }),
    });

    if (!res.ok) return empty;

    const data = await res.json() as { results?: unknown[] };
    const results = data.results ?? [];
    if (results.length === 0) return empty;

    let successCount = 0;
    let totalLatency = 0;
    const failureModes: Record<string, number> = {};

    for (const r of results as Array<Record<string, unknown>>) {
      const meta = r.metadata as Record<string, unknown> | undefined;
      if (!meta) continue;
      const result = (meta.result as Record<string, unknown> | undefined) ?? meta;
      if (result.success === true) successCount++;
      if (result.errorCode) {
        const code = String(result.errorCode);
        failureModes[code] = (failureModes[code] ?? 0) + 1;
      }
      if (typeof result.latencyMs === 'number') totalLatency += result.latencyMs;
    }

    return {
      actionName, jurisdiction,
      total:        results.length,
      successCount,
      failureCount: results.length - successCount,
      failureModes,
      avgLatencyMs: results.length > 0 ? Math.round(totalLatency / results.length) : 0,
      source:       'brain',
    };
  } catch {
    return empty;
  }
}
