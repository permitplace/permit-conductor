/**
 * Action 1: ParseCorrection
 * Extracts structured fields from a raw correction notice.
 * Cost: 1
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import { recordOutcome, getActionPriors } from '../Action';
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
      // ADR-071 Phase 7: query prior outcomes before executing.
      // If this jurisdiction has accumulated nlp_timeout failures, skip the
      // expensive NLP path and use the simple parser (same adaptive pattern as
      // jurisdiction_intelligence.py in permitapproved).
      const priors = await getActionPriors('ParseCorrection', ctx);
      const nlpTimeouts = priors.failureModes['nlp_timeout'] ?? 0;
      const useSimpleParser =
        nlpTimeouts >= 2 || priors.suggestion === 'use_simple_parser';

      const rawText = ctx.correction.rawText ?? '';

      let correctionItems: string[];
      if (useSimpleParser) {
        // Fast path: sentence split only — no NLP call.
        // Brain priors showed NLP timeouts ≥2 times for this jurisdiction.
        correctionItems = rawText
          .split(/[.\n]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } else {
        // Standard path: sentence split + keyword extraction.
        // In production this delegates to IBrainSkill NLP; here deterministic.
        correctionItems = rawText
          .split(/[.\n]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        // TODO (Phase 8): call ctx.skills?.brain?.parseCorrection(rawText) here
        // and fall back to simple split on NLP timeout, recording errorCode='nlp_timeout'.
      }

      ctx.correction.parsedFields = {
        correctionItems,
        deadlineDate:        extractDate(rawText),
        jurisdictionContact: extractContact(rawText),
        referenceNumber:     extractRef(rawText),
      };

      const result: ActionResult = {
        success:  true,
        metadata: { parserStrategy: useSimpleParser ? 'simple' : 'standard', priorsSource: priors.source },
      };
      await recordOutcome(this, result, ctx);
      return result;
    } catch (err) {
      const result: ActionResult = {
        success:   false,
        error:     err instanceof Error ? err.message : String(err),
        errorCode: 'parse_error',
      };
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
