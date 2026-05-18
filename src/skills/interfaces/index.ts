/**
 * Skill interfaces — referenced by GOAP actions for type safety.
 * Phase 1+2 implementations will satisfy these contracts.
 * Defined here so GOAP module compiles independently.
 */

import type { CorrectionType } from '../../goap/WorldState';

// ---------------------------------------------------------------------------
// Correction pattern from the Brain corpus (5,266 patterns)
// ---------------------------------------------------------------------------

export interface CorrectionPattern {
  id:                 string;
  jurisdiction?:      string;   // null = applies nationwide
  type:               CorrectionType;
  keywords:           string[];
  affectedDocs:       string[];
  autoFixable:        boolean;
  guidanceTemplate:   string;
  exampleFix:         string;
  avgResolutionDays:  number;
}

export interface PatternMatchResult {
  type:        CorrectionType;
  autoFixable: boolean;
  pattern?:    CorrectionPattern;
}

// ---------------------------------------------------------------------------
// Brain skill — correction intelligence
// ---------------------------------------------------------------------------

export interface IBrainSkill {
  getCorrectionPatterns(jurisdiction: string): Promise<CorrectionPattern[]>;

  getAffectedDocuments(
    correctionType: CorrectionType,
    documents: Array<{ id: string; type: string }>,
  ): Promise<Array<{ id: string; type: string }>>;

  explainCorrection(params: {
    type:         CorrectionType;
    rawText:      string;
    affectedDocs: string[];
    jurisdiction: string;
  }): Promise<{
    summary:       string;
    steps:         string[];
    examples:      string[];
    estimatedTime: string;
  }>;
}

// ---------------------------------------------------------------------------
// Plans review skill — compliance checking
// ---------------------------------------------------------------------------

export interface IPlansReviewSkill {
  checkCompliance(
    documents: Array<{ id: string; type: string }>,
    jurisdiction: string,
  ): Promise<{
    passed:   boolean;
    failures: string[];
  }>;
}
