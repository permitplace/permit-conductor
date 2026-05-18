/**
 * Action 1: ParseCorrection
 * Extracts structured fields from a raw correction notice.
 * Cost: 1
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import { recordOutcome } from '../Action';
import type { CorrectionWorldState } from '../WorldState';

export class ParseCorrection implements IAction {
  readonly name = 'ParseCorrection';

  readonly preconditions: Partial<CorrectionWorldState> = {
    correctionReceived: true,
    correctionParsed:   false,
  };

  readonly effects: Partial<CorrectionWorldState> = {
    correctionParsed: true,
  };

  readonly cost = 1;

  async execute(
    _state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      // NLP field extraction from raw correction text.
      // In production: delegates to an AI skill (IBrainSkill).
      // Here we produce a deterministic parsed structure so the executor
      // can proceed without a real NLP dependency.
      const rawText = ctx.correction.rawText ?? '';

      // Simple keyword scan — real impl would call brain NLP.
      const correctionItems = rawText
        .split(/[.\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      ctx.correction.parsedFields = {
        correctionItems,
        deadlineDate:        extractDate(rawText),
        jurisdictionContact: extractContact(rawText),
        referenceNumber:     extractRef(rawText),
      };

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

function extractDate(text: string): string | undefined {
  const m = text.match(/deadline[:\s]+([^\n.,]+)/i);
  return m?.[1]?.trim();
}

function extractContact(text: string): string | undefined {
  const m = text.match(/contact[:\s]+([^\n.,]+)/i);
  return m?.[1]?.trim();
}

function extractRef(text: string): string | undefined {
  const m = text.match(/ref(?:erence)?[:\s#]+([A-Z0-9-]+)/i);
  return m?.[1]?.trim();
}
