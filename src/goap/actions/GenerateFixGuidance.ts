/**
 * Action 4: GenerateFixGuidance
 * Produces plain-English explanation of what needs to be fixed.
 * Side-effect: sets userActionRequired = true in worldState (guidance implies user action).
 * Cost: 1
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import { recordOutcome } from '../Action';
import type { CorrectionWorldState } from '../WorldState';
import { CorrectionType } from '../WorldState';

const GUIDANCE_TEMPLATES: Partial<Record<CorrectionType, string>> = {
  [CorrectionType.MISSING_DOCUMENT]:      'A required document is missing from your application. Please upload the missing document.',
  [CorrectionType.DIMENSION_ERROR]:       'There is a dimensional discrepancy in your plans. Please correct the measurements and reupload.',
  [CorrectionType.MISSING_SIGNATURE]:     'Your application requires a professional signature or seal. Please have a licensed professional sign the document.',
  [CorrectionType.WRONG_FORM_VERSION]:    'You used an outdated form version. Please download and complete the current form from the jurisdiction website.',
  [CorrectionType.FEE_DISCREPANCY]:       'There is a discrepancy in the fee submitted. Please verify the correct fee and submit a corrected payment.',
  [CorrectionType.SETBACK_VIOLATION]:     'Your plans show a setback violation. Please revise the site plan to comply with setback requirements.',
  [CorrectionType.ZONING_CONFLICT]:       'Your proposed use conflicts with the zoning ordinance. Please consult with the zoning department.',
  [CorrectionType.STRUCTURAL_DEFICIENCY]: 'The structural plans contain deficiencies. Please have a licensed structural engineer revise and re-stamp the plans.',
  [CorrectionType.CODE_REFERENCE_NEEDED]: 'Your plans must reference the applicable code sections. Please add the required code citations.',
  [CorrectionType.PERMIT_TYPE_MISMATCH]:  'The permit type does not match the scope of work. Please submit the correct permit application type.',
  [CorrectionType.UNKNOWN]:               'The jurisdiction has issued a correction that requires your attention. Please review the notice and take the necessary action.',
};

export class GenerateFixGuidance implements IAction {
  readonly name = 'GenerateFixGuidance';

  readonly preconditions: Partial<CorrectionWorldState> = {
    affectedDocsIdentified: true,
    fixGuidanceGenerated:   false,
  };

  /**
   * Effects include userActionRequired = true because generating guidance
   * implies the user needs to act (per ADR-002).
   */
  readonly effects: Partial<CorrectionWorldState> = {
    fixGuidanceGenerated: true,
    userActionRequired:   true,
  };

  readonly cost = 1;

  async execute(
    _state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      const correctionType = ctx.worldState.correctionType ?? CorrectionType.UNKNOWN;
      const summary = GUIDANCE_TEMPLATES[correctionType]
        ?? GUIDANCE_TEMPLATES[CorrectionType.UNKNOWN]!;

      const guidance = {
        summary,
        steps:         [summary],
        examples:      [],
        estimatedTime: '2-5 business days',
      };

      ctx.correction.guidance = guidance;

      ctx.emit('correction:guidance', {
        correctionId: ctx.correction.id,
        guidance,
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
