/**
 * GOAP Action interfaces for the Correction Handling system.
 * Defined by ADR-002. Extended by ADR-071 (recordOutcome brain feedback loop).
 */

import type { CorrectionWorldState, CorrectionInput, GOAPProject } from './WorldState';

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
    jurisdiction:  p.jurisdiction,
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
