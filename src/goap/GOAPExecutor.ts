/**
 * GOAP Executor — runs a planned sequence of actions asynchronously.
 * Handles pausing on RequestUserInput and resuming via resolveCorrection.
 * Logs each action to project.history.
 *
 * Defined by ADR-002.
 */

import type { IAction, ActionContext } from './Action';
import type { CorrectionWorldState } from './WorldState';

export type ExecutionStatus =
  | 'COMPLETED'
  | 'WAITING_FOR_USER'
  | 'FAILED'
  | 'ESCALATED';

export interface ExecutionResult {
  status:      ExecutionStatus;
  worldState:  CorrectionWorldState;
  pausedAt?:   string;   // action name where execution paused
  error?:      string;
}

export class GOAPExecutor {
  /**
   * Execute an ordered plan of actions sequentially.
   *
   * - If an action returns `paused: true`, execution stops and returns
   *   WAITING_FOR_USER. The caller must persist state and resume later.
   * - If an action fails, execution stops and returns FAILED.
   * - Each action is logged to ctx.project.history.
   */
  async execute(
    plan: IAction[],
    ctx: ActionContext,
  ): Promise<ExecutionResult> {
    const state = ctx.worldState;

    for (const action of plan) {
      // Record the action attempt in history
      ctx.project.history.push({
        action:    action.name,
        timestamp: new Date().toISOString(),
        detail:    { preconditions: action.preconditions, effects: action.effects },
      });

      let result;
      try {
        result = await action.execute(state, ctx);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        ctx.project.history.push({
          action:    `${action.name}:error`,
          timestamp: new Date().toISOString(),
          detail:    { error },
        });
        return { status: 'FAILED', worldState: state, error };
      }

      if (!result.success) {
        return {
          status:     'FAILED',
          worldState: state,
          error:      result.error ?? `Action ${action.name} returned failure`,
        };
      }

      // Apply the action's effects to worldState
      Object.assign(state, action.effects);

      if (result.paused) {
        return {
          status:     'WAITING_FOR_USER',
          worldState: state,
          pausedAt:   action.name,
        };
      }
    }

    return { status: 'COMPLETED', worldState: state };
  }
}
