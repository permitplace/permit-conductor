/**
 * Action 2: ClassifyCorrection
 * Matches parsed correction fields against known correction patterns.
 * Sets correctionType and autoFixable on worldState.
 * Cost: 1
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import { recordOutcome } from '../Action';
import type { CorrectionWorldState } from '../WorldState';
import { CorrectionType } from '../WorldState';

/** Keyword map for lightweight classification without a real NLP brain. */
const KEYWORD_MAP: Array<{ keywords: string[]; type: CorrectionType; autoFixable: boolean }> = [
  { keywords: ['missing document', 'missing doc', 'document not provided'], type: CorrectionType.MISSING_DOCUMENT,      autoFixable: false },
  { keywords: ['dimension', 'measurement', 'size error', 'incorrect size'],  type: CorrectionType.DIMENSION_ERROR,       autoFixable: true  },
  { keywords: ['signature', 'seal', 'notariz'],                              type: CorrectionType.MISSING_SIGNATURE,     autoFixable: false },
  { keywords: ['wrong form', 'outdated form', 'form version'],               type: CorrectionType.WRONG_FORM_VERSION,    autoFixable: true  },
  { keywords: ['fee', 'payment', 'discrepancy'],                             type: CorrectionType.FEE_DISCREPANCY,       autoFixable: true  },
  { keywords: ['setback', 'property line', 'buffer'],                        type: CorrectionType.SETBACK_VIOLATION,     autoFixable: false },
  { keywords: ['zoning', 'zone conflict', 'use not permitted'],              type: CorrectionType.ZONING_CONFLICT,       autoFixable: false },
  { keywords: ['structural', 'load-bearing', 'engineering'],                 type: CorrectionType.STRUCTURAL_DEFICIENCY, autoFixable: false },
  { keywords: ['code reference', 'code section', 'ibc', 'irc', 'nfpa'],     type: CorrectionType.CODE_REFERENCE_NEEDED, autoFixable: true  },
  { keywords: ['permit type', 'wrong permit', 'incorrect permit'],           type: CorrectionType.PERMIT_TYPE_MISMATCH,  autoFixable: false },
];

function classify(items: string[]): { type: CorrectionType; autoFixable: boolean } {
  const combined = items.join(' ').toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some((kw) => combined.includes(kw))) {
      return { type: entry.type, autoFixable: entry.autoFixable };
    }
  }
  return { type: CorrectionType.UNKNOWN, autoFixable: false };
}

export class ClassifyCorrection implements IAction {
  readonly name = 'ClassifyCorrection';

  readonly preconditions: Partial<CorrectionWorldState> = {
    correctionParsed:     true,
    correctionClassified: false,
  };

  readonly effects: Partial<CorrectionWorldState> = {
    correctionClassified: true,
  };

  readonly cost = 1;

  async execute(
    _state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      const items = ctx.correction.parsedFields?.correctionItems ?? [ctx.correction.rawText];
      const match = classify(items);

      ctx.worldState.correctionType = match.type;
      ctx.worldState.autoFixable    = match.autoFixable;

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
