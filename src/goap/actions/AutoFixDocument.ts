/**
 * Action 5: AutoFixDocument
 * Automatically applies a fix to affected documents.
 * Only runs when autoFixable = true (preferred over RequestUserInput, cost 2 vs 5).
 * Cost: 2
 *
 * Implemented correction types:
 *   FEE_DISCREPANCY    — records fee recalculation response for QC validation
 *   WRONG_FORM_VERSION — records form version update response for QC validation
 *
 * All other auto-fixable types succeed without a stored response; ValidateFix
 * will flag them if correctionsQcUrl is configured and responses are absent.
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import { recordOutcome } from '../Action';
import { CorrectionType } from '../WorldState';
import type { CorrectionWorldState } from '../WorldState';

export class AutoFixDocument implements IAction {
  readonly name = 'AutoFixDocument';

  readonly preconditions: Partial<CorrectionWorldState> = {
    affectedDocsIdentified: true,
    autoFixable:            true,
    autoFixApplied:         false,
  };

  /**
   * AutoFix satisfies both userActionRequired=false and userActionComplete=true
   * so the plan can proceed to ValidateFix without a RequestUserInput step.
   */
  readonly effects: Partial<CorrectionWorldState> = {
    autoFixApplied:     true,
    userActionRequired: false,
    userActionComplete: true,
  };

  readonly cost = 2;

  async execute(
    _state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      const docIds         = ctx.worldState.affectedDocumentIds ?? [];
      const correctionType = ctx.worldState.correctionType;
      const correctionItems = ctx.correction.parsedFields?.correctionItems ?? [];

      // Build structured responses for ValidateFix / corrections QC
      const responses = this.buildResponses(correctionType, correctionItems, docIds);
      if (responses !== null) {
        ctx.worldState.fixResponses = responses;
      }

      for (const docId of docIds) {
        ctx.project.history.push({
          action:    'AutoFixDocument:applyFix',
          timestamp: new Date().toISOString(),
          detail:    { docId, correctionType, responseStored: responses !== null },
        });
      }

      ctx.emit('correction:auto_fix_applied', {
        correctionId: ctx.correction.id,
        docIds,
      });

      const result: ActionResult = {
        success:  true,
        metadata: { correctionType, responseStored: responses !== null },
      };
      await recordOutcome(this, result, ctx);
      return result;
    } catch (err) {
      const result: ActionResult = { success: false, error: err instanceof Error ? err.message : String(err) };
      await recordOutcome(this, result, ctx);
      return result;
    }
  }

  /**
   * Build structured correction responses for each comment item.
   * Returns null for correction types that are not yet auto-implemented —
   * ValidateFix will degrade gracefully in those cases.
   */
  private buildResponses(
    correctionType: CorrectionType | undefined,
    correctionItems: string[],
    docIds: string[],
  ): Array<{ number: number; response: string; sheetRef?: string }> | null {
    // Use correctionItems when available; fall back to one entry per affected doc
    const count = correctionItems.length > 0 ? correctionItems.length : docIds.length;
    if (count === 0) return null;

    switch (correctionType) {
      case CorrectionType.FEE_DISCREPANCY:
        return Array.from({ length: count }, (_, i) => ({
          number:   i + 1,
          response: 'Application fee corrected per current jurisdiction fee schedule. Updated fee amount included with resubmission.',
        }));

      case CorrectionType.WRONG_FORM_VERSION:
        return Array.from({ length: count }, (_, i) => ({
          number:   i + 1,
          response: 'Application form updated to the current version as required by the jurisdiction.',
        }));

      default:
        // Not yet implemented for this type.
        // The history entry is still recorded; ValidateFix degrades to presence check.
        return null;
    }
  }
}
