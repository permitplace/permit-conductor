/**
 * GOAP World State for Correction Handling
 * Defined by ADR-002. Extended by ADR-071 (unified world state schema).
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
 * Unified world state for all three GOAP implementations across PermitPlace.
 * ADR-071: permit-conductor (correction), permit-verified (verification), and
 * permitapproved (ops) all conform to this superset schema. Each implementation
 * uses only the fields relevant to its domain.
 *
 * Exported from @permitplace/permit-conductor@0.2.0 so downstream repos
 * can import without re-declaring.
 */
export interface UnifiedPermitWorldState extends CorrectionWorldState {
  // ── Project identity ──────────────────────────────────────────────────────
  projectId?:             string;
  jurisdiction?:          string;
  permitTypes?:           string[];

  // ── Workflow stage (permit-conductor) ─────────────────────────────────────
  stageDiscoverComplete?: boolean;
  stagePrepareComplete?:  boolean;
  stageReviewComplete?:   boolean;
  stageSubmitComplete?:   boolean;
  stageMonitorActive?:    boolean;
  stageRespondActive?:    boolean;
  stageApproveComplete?:  boolean;

  // ── Verification research (permit-verified GOAP — ADR-071) ────────────────
  ahjResolved?:           boolean;
  portalIdentified?:      boolean;
  portalAuthenticated?:   boolean;
  permitRecordFound?:     boolean;
  inspectionDataFetched?: boolean;
  reportGenerated?:       boolean;
  reportDelivered?:       boolean;

  // ── Ops agent (permitapproved GOAP — ADR-071) ─────────────────────────────
  acceloJobSynced?:        boolean;
  clientNotified?:         boolean;
  internalNoteCreated?:    boolean;
  escalationRequired?:     boolean;
  episodeStoredInAgentDB?: boolean;
}

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
