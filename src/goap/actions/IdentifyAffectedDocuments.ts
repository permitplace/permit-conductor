/**
 * Action 3: IdentifyAffectedDocuments
 * Determines which project documents are affected by this correction.
 * Cost: 1
 */

import type { IAction, ActionContext, ActionResult } from '../Action';
import type { CorrectionWorldState } from '../WorldState';
import { CorrectionType } from '../WorldState';

/** Document types typically affected by each correction type. */
const AFFECTED_DOC_TYPES: Partial<Record<CorrectionType, string[]>> = {
  [CorrectionType.MISSING_DOCUMENT]:      ['site_plan', 'elevation_plan'],
  [CorrectionType.DIMENSION_ERROR]:       ['floor_plan', 'site_plan'],
  [CorrectionType.MISSING_SIGNATURE]:     ['application_form', 'engineer_letter'],
  [CorrectionType.WRONG_FORM_VERSION]:    ['application_form'],
  [CorrectionType.FEE_DISCREPANCY]:       ['fee_schedule', 'application_form'],
  [CorrectionType.SETBACK_VIOLATION]:     ['site_plan', 'survey'],
  [CorrectionType.ZONING_CONFLICT]:       ['zoning_compliance_letter', 'site_plan'],
  [CorrectionType.STRUCTURAL_DEFICIENCY]: ['structural_plan', 'engineer_letter'],
  [CorrectionType.CODE_REFERENCE_NEEDED]: ['construction_specs', 'floor_plan'],
  [CorrectionType.PERMIT_TYPE_MISMATCH]:  ['application_form'],
  [CorrectionType.UNKNOWN]:               [],
};

export class IdentifyAffectedDocuments implements IAction {
  readonly name = 'IdentifyAffectedDocuments';

  readonly preconditions: Partial<CorrectionWorldState> = {
    correctionClassified:   true,
    affectedDocsIdentified: false,
  };

  readonly effects: Partial<CorrectionWorldState> = {
    affectedDocsIdentified: true,
  };

  readonly cost = 1;

  async execute(
    _state: CorrectionWorldState,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      const correctionType = ctx.worldState.correctionType ?? CorrectionType.UNKNOWN;
      const targetTypes    = AFFECTED_DOC_TYPES[correctionType] ?? [];

      // Filter project documents to those matching the affected types.
      const affected = ctx.project.documents.filter(
        (doc) => targetTypes.includes(doc.type as string),
      );

      ctx.worldState.affectedDocumentIds = affected.map((d) => d.id);

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
