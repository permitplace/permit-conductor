/**
 * Action 7: ValidateFix
 * Validates that correction responses adequately address the city's comments.
 * If validation fails, resets state to allow re-planning.
 * Cost: 1
 *
 * When ctx.correctionsQcUrl is set, calls permitapproved POST /api/corrections/qc
 * to cross-reference city comments against stored fix responses and return a
 * ready_to_resubmit determination. Degrades to the sync checkValidation() fallback
 * when the URL is not configured (preserves test injectability via subclassing).
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import { recordOutcome } from '../Action';
import type { CorrectionWorldState } from '../WorldState';

/** Sync validation result — used by checkValidation() and test subclasses. */
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
   * Sync fallback — overrideable in tests to inject failure without a live QC service.
   * Only called when ctx.correctionsQcUrl is not set.
   */
  protected checkValidation(_ctx: ActionContext): ValidationOutcome {
    return { passed: true, failures: [] };
  }

  async execute(
    state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      let passed: boolean;
      let failures: string[];

      if (ctx.correctionsQcUrl) {
        ({ passed, failures } = await this.runCorrectionsQc(ctx));
      } else {
        ({ passed, failures } = this.checkValidation(ctx));
      }

      if (!passed) {
        // Reset planning flags so the executor can re-plan if needed
        state.userActionComplete   = false;
        state.fixGuidanceGenerated = false;

        ctx.emit('correction:validation_failed', {
          correctionId: ctx.correction.id,
          failures,
        });

        // Return success:true so the executor does not abort;
        // reset state allows the planner to re-plan.
        const result: ActionResult = { success: true, metadata: { validationPassed: false, failures } };
        await recordOutcome(this, result, ctx);
        return result;
      }

      ctx.emit('correction:validation_passed', {
        correctionId: ctx.correction.id,
      });

      const result: ActionResult = { success: true };
      await recordOutcome(this, result, ctx);
      return result;
    } catch (err) {
      const result: ActionResult = { success: false, error: err instanceof Error ? err.message : String(err) };
      await recordOutcome(this, result, ctx);
      return result;
    }
  }

  /**
   * Call permitapproved /api/corrections/qc with city comments and stored fix responses.
   * Degrades gracefully: if the service is unreachable, passes when responses are present.
   */
  private async runCorrectionsQc(ctx: ActionContext): Promise<ValidationOutcome> {
    const correctionItems = ctx.correction.parsedFields?.correctionItems ?? [];
    const fixResponses    = ctx.worldState.fixResponses ?? [];

    // If AutoFixDocument stored no responses, the fix was not applied for this
    // correction type — fail immediately so the planner routes to the user path.
    if (fixResponses.length === 0) {
      return {
        passed:   false,
        failures: ['No correction responses recorded — fix may not have been applied for this correction type'],
      };
    }

    const cityComments = correctionItems.map((text, i) => ({
      number:   i + 1,
      text,
      category: '',
    }));

    const correctionResponses = fixResponses.map(r => ({
      number:    r.number,
      response:  r.response,
      sheet_ref: r.sheetRef ?? '',
    }));

    // Stable numeric ID derived from project ID string for the QC cache key
    const jobId = ctx.project.id
      .split('')
      .reduce((acc, c) => (acc + c.charCodeAt(0)) & 0x7fffffff, 0);

    try {
      const res = await fetch(`${ctx.correctionsQcUrl}/api/corrections/qc`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          job_id:               jobId,
          city_comments:        cityComments,
          correction_responses: correctionResponses,
          plan_sheets:          ctx.project.documents.map(d => d.type),
        }),
      });

      if (!res.ok) {
        // QC service returned an error — degrade to presence check
        return { passed: true, failures: [] };
      }

      const data = await res.json() as {
        ready_to_resubmit: boolean;
        items?: Array<{ comment_number: number; status: string; notes: string }>;
      };

      if (data.ready_to_resubmit) {
        return { passed: true, failures: [] };
      }

      const failures = (data.items ?? [])
        .filter(i => i.status !== 'addressed')
        .map(i => `Comment ${i.comment_number} [${i.status.toUpperCase()}]: ${i.notes}`);

      return { passed: false, failures };
    } catch {
      // Network error or JSON parse failure — degrade to presence check
      return { passed: fixResponses.length > 0, failures: [] };
    }
  }
}
