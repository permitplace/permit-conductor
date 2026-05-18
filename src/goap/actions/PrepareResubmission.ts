/**
 * Action 8: PrepareResubmission
 * Builds the resubmission payload and marks the correction resolved.
 * Cost: 1
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import type { CorrectionWorldState } from '../WorldState';

export class PrepareResubmission implements IAction {
  readonly name = 'PrepareResubmission';

  readonly preconditions: Partial<CorrectionWorldState> = {
    fixValidated:     true,
    applicationReady: false,
  };

  readonly effects: Partial<CorrectionWorldState> = {
    applicationReady:    true,
    correctionResolved:  true,
  };

  readonly cost = 1;

  async execute(
    _state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      const correctionResponse = ctx.correction.guidance?.summary ?? '';
      const correctionRef      = ctx.correction.parsedFields?.referenceNumber ?? '';

      ctx.project.resubmissionPayload = {
        projectId:           ctx.project.id,
        jurisdiction:        ctx.project.jurisdiction,
        documents:           ctx.project.documents,
        correctionResponse,
        correctionRef,
        preparedAt:          new Date().toISOString(),
      };

      ctx.emit('correction:resubmission_ready', {
        correctionId: ctx.correction.id,
        correctionRef,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
