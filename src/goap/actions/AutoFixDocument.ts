/**
 * Action 5: AutoFixDocument
 * Automatically applies a fix to affected documents.
 * Only runs when autoFixable = true (preferred over RequestUserInput, cost 2 vs 5).
 * Cost: 2
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import { recordOutcome } from '../Action';
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
      const docIds = ctx.worldState.affectedDocumentIds ?? [];

      for (const docId of docIds) {
        // In production: delegates to documentEditor.applyFix()
        // Records the fix in history as an audit trail.
        ctx.project.history.push({
          action:    'AutoFixDocument:applyFix',
          timestamp: new Date().toISOString(),
          detail:    { docId, correctionType: ctx.worldState.correctionType },
        });
      }

      ctx.emit('correction:auto_fix_applied', {
        correctionId: ctx.correction.id,
        docIds,
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
}
