/**
 * GOAP World State for Correction Handling
 * Defined by ADR-002.
 *
 * CorrectionWorldState and CorrectionType are the canonical types in
 * src/types/index.ts. Re-exported here so GOAP action files can import
 * from a single local path without traversing to types directly.
 */

import {
  CorrectionType,
  CorrectionWorldState,
  CorrectionParsedFields,
  CorrectionGuidance,
  Correction,
} from '../types';

// Re-export canonical types so all goap/ modules import from one place
export { CorrectionType, CorrectionWorldState };
export type { CorrectionParsedFields, CorrectionGuidance, Correction };

/**
 * Minimal project shape used by GOAP — avoids importing the full PermitProject
 * from src/agent/ during Phase 1+2 reconciliation.
 */
export interface GOAPProject {
  id:           string;
  jurisdiction: string;
  documents:    Array<{ id: string; type: string; [key: string]: unknown }>;
  history:      Array<{ action: string; timestamp: string; detail?: unknown }>;
  resubmissionPayload?: unknown;
}

/**
 * Minimal correction shape accepted by buildWorldState.
 * The full Correction type (from src/types) adds receivedAt and other fields
 * that are not needed for initial world-state construction.
 */
export type CorrectionInput = Pick<Correction, 'id' | 'rawText'> &
  Partial<Omit<Correction, 'id' | 'rawText'>>;

/**
 * Build the initial CorrectionWorldState from a project and correction.
 * The correction is assumed to have been received but not yet processed.
 */
export function buildWorldState(
  _project: GOAPProject,
  _correction: CorrectionInput,
): CorrectionWorldState {
  return {
    correctionReceived:     true,
    correctionParsed:       false,
    correctionClassified:   false,
    affectedDocsIdentified: false,

    fixGuidanceGenerated:   false,
    userActionRequired:     false,
    userActionComplete:     false,
    autoFixApplied:         false,
    fixValidated:           false,

    applicationReady:       false,
    correctionResolved:     false,
  };
}
