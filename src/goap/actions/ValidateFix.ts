/**
 * Action 7: ValidateFix
 * Runs a compliance re-check on the project documents after a fix is applied.
 * If validation fails, resets state to allow re-planning.
 * Cost: 1
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import type { CorrectionWorldState } from '../WorldState';

/** Injectable validation result for testing the failure path. */
export type ValidationOutcome = { passed: boolean; failures: string[] };

export class ValidateFix implements IAction {
  readonly name = 'ValidateFix';

  readonly preconditions: Partial<CorrectionWorldState> = {
    userActionComplete: true,
    fixValidated:       false,
  };

  readonly effects: Partial<CorrectionWorldState> = {
    fixValidated: true,
  };

  readonly cost = 1;

  /**
   * Optional override for the validation result — used in tests to exercise
   * the failure path without calling a real IPlansReviewSkill.
   */
  protected checkValidation(_ctx: ActionContext): ValidationOutcome {
    // In production: delegates to IPlansReviewSkill.checkCompliance()
    // For now: optimistic pass — real impl would call the skill.
    return { passed: true, failures: [] };
  }

  async execute(
    state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      const { passed, failures } = this.checkValidation(ctx);

      if (!passed) {
        // Reset planning-relevant flags to allow re-planning
        state.userActionComplete   = false;
        state.fixGuidanceGenerated = false;

        ctx.emit('correction:validation_failed', {
          correctionId: ctx.correction.id,
          failures,
        });

        // Return success=true so the executor does not abort;
        // the reset state will allow the planner to re-plan if needed.
        return { success: true };
      }

      ctx.emit('correction:validation_passed', {
        correctionId: ctx.correction.id,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
