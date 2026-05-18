/**
 * Action 6: RequestUserInput
 * Notifies the user that manual action is required and pauses execution.
 * Execution resumes when the caller invokes resolveCorrection().
 * Cost: 5 (high — planner prefers AutoFixDocument when available)
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import type { CorrectionWorldState } from '../WorldState';

export class RequestUserInput implements IAction {
  readonly name = 'RequestUserInput';

  readonly preconditions: Partial<CorrectionWorldState> = {
    fixGuidanceGenerated: true,
    userActionRequired:   true,
    userActionComplete:   false,
  };

  readonly effects: Partial<CorrectionWorldState> = {
    userActionComplete: true,
  };

  readonly cost = 5;

  async execute(
    _state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    ctx.emit('correction:user_action_required', {
      correctionId: ctx.correction.id,
      guidance:     ctx.correction.guidance,
      deadline:     ctx.correction.parsedFields?.deadlineDate,
    });

    // Signal the executor to pause here.
    // The caller persists state; execution resumes via resolveCorrection().
    return { success: true, paused: true };
  }
}
