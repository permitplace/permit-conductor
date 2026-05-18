/**
 * GOAP Action interfaces for the Correction Handling system.
 * Defined by ADR-002.
 */

import type { CorrectionWorldState, CorrectionInput, GOAPProject } from './WorldState';

export type EventEmitter = (event: string, payload?: unknown) => void;

export interface ActionContext {
  project:    GOAPProject;
  correction: CorrectionInput;
  worldState: CorrectionWorldState;
  emit:       EventEmitter;
}

export interface ActionResult {
  success:   boolean;
  paused?:   boolean;   // true when execution must wait for external input
  error?:    string;
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
