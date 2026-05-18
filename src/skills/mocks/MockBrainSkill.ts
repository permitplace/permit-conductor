/**
 * MockBrainSkill — deterministic test double for IBrainSkill.
 */

import { IBrainSkill, ExplainCorrectionParams } from '../interfaces/IBrainSkill';
import {
  Requirements,
  Checklist,
  ChecklistItem,
  CorrectionPattern,
  CorrectionGuidance,
  CorrectionType,
  Document,
} from '../../types';

export class MockBrainSkill implements IBrainSkill {
  /** Override to control checklist satisfaction in tests */
  allDocumentsSatisfied = true;

  async lookupRequirements(jurisdiction: string, permitTypes: string[]): Promise<Requirements> {
    const items: ChecklistItem[] = permitTypes.map((pt, i) => ({
      id:           `item-${i}`,
      label:        `${pt} application`,
      documentType: `${pt}_form`,
      required:     true,
      satisfied:    this.allDocumentsSatisfied,
    }));

    return {
      jurisdiction,
      permitTypes,
      checklist: items,
    };
  }

  async getDocumentChecklist(requirements: Requirements): Promise<Checklist> {
    const items: ChecklistItem[] = requirements.checklist.map((item) => ({
      ...item,
      satisfied: this.allDocumentsSatisfied,
    }));
    const missing = items.filter((i) => !i.satisfied);
    return { items, missing };
  }

  async getCorrectionPatterns(_jurisdiction: string): Promise<CorrectionPattern[]> {
    return [
      {
        id:                'pattern-1',
        type:              CorrectionType.DIMENSION_ERROR,
        keywords:          ['dimension', 'measurement'],
        affectedDocs:      ['floor_plan', 'site_plan'],
        autoFixable:       true,
        guidanceTemplate:  'Correct the measurement on {{document}}.',
        exampleFix:        'Update floor plan dimensions to match survey.',
        avgResolutionDays: 2,
      },
    ];
  }

  async explainCorrection(_params: ExplainCorrectionParams): Promise<CorrectionGuidance> {
    return {
      summary:       'Please correct the flagged items and resubmit.',
      steps:         ['Review the correction notice', 'Update the affected documents', 'Resubmit'],
      examples:      ['See jurisdiction guide §4.2'],
      estimatedTime: '2-5 business days',
    };
  }

  async matchCorrectionPattern(
    _parsedFields: Record<string, unknown>,
    _patterns: CorrectionPattern[],
  ): Promise<{ type: CorrectionType; autoFixable: boolean }> {
    return { type: CorrectionType.DIMENSION_ERROR, autoFixable: true };
  }

  async getAffectedDocuments(
    _correctionType: CorrectionType,
    documents: Document[],
  ): Promise<Document[]> {
    return documents.slice(0, 1);
  }
}
