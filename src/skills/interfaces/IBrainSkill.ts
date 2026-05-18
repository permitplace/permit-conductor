import {
  Requirements,
  Checklist,
  CorrectionPattern,
  CorrectionGuidance,
  CorrectionType,
  Document,
} from '../../types';

export interface ExplainCorrectionParams {
  type:         CorrectionType;
  rawText:      string;
  affectedDocs: string[];
  jurisdiction: string;
}

export interface IBrainSkill {
  /**
   * Resolve required permit types and jurisdiction-specific requirements.
   */
  lookupRequirements(
    jurisdiction: string,
    permitTypes: string[]
  ): Promise<Requirements>;

  /**
   * Generate a document checklist from resolved requirements.
   */
  getDocumentChecklist(requirements: Requirements): Promise<Checklist>;

  /**
   * Retrieve correction patterns for a jurisdiction (5,266 patterns in production).
   */
  getCorrectionPatterns(jurisdiction: string): Promise<CorrectionPattern[]>;

  /**
   * Produce plain-English explanation and resolution steps for a correction.
   */
  explainCorrection(params: ExplainCorrectionParams): Promise<CorrectionGuidance>;

  /**
   * Match parsed correction fields against the pattern corpus.
   */
  matchCorrectionPattern(
    parsedFields: Record<string, unknown>,
    patterns: CorrectionPattern[]
  ): Promise<{ type: CorrectionType; autoFixable: boolean }>;

  /**
   * Identify which project documents are affected by a given correction type.
   */
  getAffectedDocuments(
    correctionType: CorrectionType,
    documents: Document[]
  ): Promise<Document[]>;
}
