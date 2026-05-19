// All shared TypeScript interfaces for permit-conductor

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum PermitStage {
  DISCOVER   = 'DISCOVER',
  PREPARE    = 'PREPARE',
  REVIEW     = 'REVIEW',
  SUBMIT     = 'SUBMIT',
  MONITOR    = 'MONITOR',
  RESPOND    = 'RESPOND',
  APPROVE    = 'APPROVE',
  COMPLETE   = 'COMPLETE',
  CANCELLED  = 'CANCELLED',
}

export enum CorrectionType {
  MISSING_DOCUMENT      = 'missing_document',
  DIMENSION_ERROR       = 'dimension_error',
  MISSING_SIGNATURE     = 'missing_signature',
  WRONG_FORM_VERSION    = 'wrong_form_version',
  FEE_DISCREPANCY       = 'fee_discrepancy',
  SETBACK_VIOLATION     = 'setback_violation',
  ZONING_CONFLICT       = 'zoning_conflict',
  STRUCTURAL_DEFICIENCY = 'structural_deficiency',
  CODE_REFERENCE_NEEDED = 'code_reference_needed',
  PERMIT_TYPE_MISMATCH  = 'permit_type_mismatch',
  UNKNOWN               = 'unknown',
}

export enum SubmissionStatusCode {
  SUBMITTED          = 'SUBMITTED',
  IN_REVIEW          = 'IN_REVIEW',
  APPROVED           = 'APPROVED',
  CORRECTION_REQUIRED = 'CORRECTION_REQUIRED',
  REJECTED           = 'REJECTED',
  EXPIRED            = 'EXPIRED',
}

// ---------------------------------------------------------------------------
// Core data models
// ---------------------------------------------------------------------------

export interface Applicant {
  id:       string;
  name:     string;
  email:    string;
  phone?:   string;
  address?: string;
}

export interface Document {
  id:        string;
  name:      string;
  type:      string;   // e.g. 'site_plan', 'architectural_drawings'
  url:       string;   // stored by reference
  mimeType:  string;
  uploadedAt: string;  // ISO timestamp
}

export interface PermitDocument {
  id:  string;
  url: string;
  issuedAt: string;
}

export interface CorrectionParsedFields {
  correctionItems:    string[];
  deadlineDate?:      string;
  jurisdictionContact?: string;
  referenceNumber?:   string;
}

export interface CorrectionGuidance {
  summary:       string;
  steps:         string[];
  examples?:     string[];
  estimatedTime?: string;
}

export interface Correction {
  id:            string;
  rawText:       string;
  receivedAt:    string;
  resolvedAt?:   string;
  parsedFields?: CorrectionParsedFields;
  guidance?:     CorrectionGuidance;
  type?:         CorrectionType;
  autoFixable?:  boolean;
}

export interface Submission {
  id:          string;
  submittedAt: string;
  status:      SubmissionStatusCode;
  referenceId?: string;
}

export interface StageTransition {
  from:        PermitStage;
  to:          PermitStage;
  occurredAt:  string;
  meta?:       Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Requirements & checklist
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  id:           string;
  label:        string;
  documentType: string;
  required:     boolean;
  satisfied:    boolean;
}

export interface Checklist {
  items:   ChecklistItem[];
  missing: ChecklistItem[];
}

export interface Requirements {
  permitTypes:   string[];
  jurisdiction:  string;
  checklist:     ChecklistItem[];
  notes?:        string[];
}

// ---------------------------------------------------------------------------
// Compliance & verification
// ---------------------------------------------------------------------------

export interface ComplianceFailure {
  code:        string;
  description: string;
  documentId?: string;
}

export interface ComplianceResult {
  passed:    boolean;
  failures:  ComplianceFailure[];
}

export interface SubmissionStatus {
  code:         SubmissionStatusCode;
  message?:     string;
  correction?:  Correction;
  updatedAt:    string;
}

export interface VerificationStatus {
  code:         SubmissionStatusCode;
  message?:     string;
  correction?:  Correction;
  updatedAt:    string;
}

// ---------------------------------------------------------------------------
// GOAP world state
// ---------------------------------------------------------------------------

export interface CorrectionWorldState {
  correctionReceived:      boolean;
  correctionParsed:        boolean;
  correctionClassified:    boolean;
  affectedDocsIdentified:  boolean;
  fixGuidanceGenerated:    boolean;
  userActionRequired:      boolean;
  userActionComplete:      boolean;
  autoFixApplied:          boolean;
  fixValidated:            boolean;
  applicationReady:        boolean;
  correctionResolved:      boolean;
  // Metadata used by executors (not planning keys)
  correctionType?:         CorrectionType;
  autoFixable?:            boolean;
  affectedDocumentIds?:    string[];
  /** Structured responses written by AutoFixDocument, read by ValidateFix for QC. */
  fixResponses?:           Array<{ number: number; response: string; sheetRef?: string }>;
}

// ---------------------------------------------------------------------------
// Correction patterns (brain corpus)
// ---------------------------------------------------------------------------

export interface CorrectionPattern {
  id:                string;
  jurisdiction?:     string;
  type:              CorrectionType;
  keywords:          string[];
  affectedDocs:      string[];
  autoFixable:       boolean;
  guidanceTemplate:  string;
  exampleFix:        string;
  avgResolutionDays: number;
}

// ---------------------------------------------------------------------------
// Main project model
// ---------------------------------------------------------------------------

export interface PermitProject {
  id:              string;
  stage:           PermitStage;
  jurisdiction:    string;
  permitTypes:     string[];
  applicant:       Applicant;
  documents:       Document[];
  submissions:     Submission[];
  corrections:     Correction[];
  requirements?:   Requirements;
  checklist?:      Checklist;
  complianceResult?: ComplianceResult;
  lastStatus?:     VerificationStatus;
  permitDocument?: PermitDocument;
  goapState?:      CorrectionWorldState;
  resubmissionPayload?: Record<string, unknown>;
  history:         StageTransition[];
  createdAt:       string;
  updatedAt:       string;
}

// ---------------------------------------------------------------------------
// Conductor config
// Skills and StateStore are structurally typed — no circular import needed
// ---------------------------------------------------------------------------

export interface ConductorSkills {
  brain: {
    lookupRequirements(jurisdiction: string, permitTypes: string[]): Promise<Requirements>;
    getDocumentChecklist(requirements: Requirements): Promise<Checklist>;
    getCorrectionPatterns(jurisdiction: string): Promise<CorrectionPattern[]>;
    explainCorrection(params: unknown): Promise<CorrectionGuidance>;
    matchCorrectionPattern(parsedFields: Record<string, unknown>, patterns: CorrectionPattern[]): Promise<{ type: CorrectionType; autoFixable: boolean }>;
    getAffectedDocuments(correctionType: CorrectionType, documents: Document[]): Promise<Document[]>;
  };
  submission: {
    submit(jurisdiction: string, payload: Record<string, unknown>): Promise<Submission>;
    getStatus(submissionId: string): Promise<SubmissionStatus>;
    retrieve(submissionId: string): Promise<PermitDocument>;
    resubmit(submissionId: string, response: Record<string, unknown>): Promise<Submission>;
  };
  verification: {
    getStatus(submissionId: string): Promise<VerificationStatus>;
  };
  plansReview: {
    checkCompliance(documents: Document[], jurisdiction: string): Promise<ComplianceResult>;
  };
}

export interface ConductorStateStore {
  load(projectId: string): Promise<PermitProject>;
  save(project: PermitProject): Promise<void>;
  list(filter?: { stage?: PermitStage; jurisdiction?: string }): Promise<PermitProject[]>;
  delete(projectId: string): Promise<void>;
}

export interface ConductorConfig {
  skills:     ConductorSkills;
  stateStore: ConductorStateStore;
}

// ---------------------------------------------------------------------------
// Stage result
// ---------------------------------------------------------------------------

export type StageResultStatus =
  | 'ADVANCED'
  | 'WAITING_FOR_DOCUMENTS'
  | 'WAITING_FOR_PLAN_FIXES'
  | 'WAITING_FOR_USER'
  | 'COMPLETE';

export interface StageResult {
  status:   StageResultStatus;
  project:  PermitProject;
  meta?:    Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ConductorEvent =
  | { type: 'stage:transition';                   payload: { from: PermitStage; to: PermitStage; project: PermitProject; meta?: Record<string, unknown> } }
  | { type: 'documents:required';                 payload: { projectId: string; missing: ChecklistItem[] } }
  | { type: 'review:failed';                      payload: { projectId: string; failures: ComplianceFailure[] } }
  | { type: 'monitor:update';                     payload: { projectId: string; status: VerificationStatus } }
  | { type: 'correction:guidance';                payload: { projectId: string; guidance: CorrectionGuidance } }
  | { type: 'correction:user_action_required';    payload: { correctionId: string; guidance: CorrectionGuidance; deadline?: string } }
  | { type: 'correction:validation_failed';       payload: { projectId: string; failures: ComplianceFailure[] } }
  | { type: 'correction:escalation_required';     payload: { projectId: string; correctionId: string } }
  | { type: 'permit:approved';                    payload: { documentUrl: string; project: PermitProject } }
  | { type: 'permit:expiry_warning';              payload: { projectId: string } };
