# ADR-001: SPARC Analysis — Permit Orchestration Agent

**Status:** Proposed  
**Date:** 2026-05-17  
**Author:** PermitPlace Platform Team

---

## Context

PermitPlace operates six products that collectively cover the full permit workflow but do not form a unified consumer experience. A user must navigate between PermitNow.io (research), plansready (plan review), permit-connect (submission), and permit-verified (status) manually. There is no stateful layer that persists context across these stages or routes intelligently between them.

The Permit Orchestration Agent (permit-conductor) is the connective tissue that transforms this pile of components into a single permit journey. This ADR documents the SPARC analysis used to design it.

---

## SPARC Analysis

### S — Specification

#### Problem Statement
A permit applicant today must manually coordinate across multiple systems, losing context between stages, receiving no guidance on what to do next, and having no automated response when corrections arrive. The result is permit abandonment, delays, and continued reliance on human permit expediters for tasks an AI system can perform.

#### Stakeholders
- **Consumers** (GCs, developers, property owners) — want permits in hand with minimal effort
- **PermitPlace ops team** — want internal visibility into same workflow via permitapproved
- **Licensees** — third-party permitting platforms wanting to embed this workflow engine
- **Jurisdictions** — indirect stakeholders; consistent, well-formed submissions reduce their review burden

#### Functional Requirements
1. Accept a project description and jurisdiction, resolve required permit types
2. Generate and present a document checklist based on jurisdiction-specific requirements
3. Accept document uploads, validate completeness
4. Submit the plan compliance check to plansready
5. Surface compliance failures to the user with actionable guidance
6. Submit the application to the jurisdiction via the submission skill
7. Poll and report status changes proactively
8. Receive, parse, and classify correction notices
9. Explain corrections in plain English, guide user to resolution
10. Resubmit corrected application
11. Deliver approved permit document to applicant
12. Persist full project state across sessions
13. Emit events for UI, webhooks, and audit trail

#### Non-Functional Requirements
- **Latency:** Stage transitions complete in < 5s for skill calls; async for long-running operations
- **Reliability:** At-least-once delivery for submission and correction actions
- **Auditability:** Every stage transition, skill call, and correction event logged with timestamps
- **Portability:** No hard dependency on any PermitPlace-specific backend; all connections via ISkillConnector interface
- **Testability:** Each stage independently testable with mock skill connectors

#### Out of Scope (v1)
- Inspection scheduling (post-approval)
- Payment processing for permit fees
- Multi-applicant / team collaboration
- Native mobile SDK

---

### P — Pseudocode

#### Core Workflow State Machine

```
function advance(projectId):
  project = state.load(projectId)

  match project.stage:
    DISCOVER:
      requirements = brain.lookupRequirements(project.jurisdiction, project.permitTypes)
      project.requirements = requirements
      project.stage = PREPARE
      emit('stage:transition', { from: DISCOVER, to: PREPARE, requirements })

    PREPARE:
      checklist = brain.getDocumentChecklist(project.requirements)
      project.checklist = checklist
      if all checklist.items are satisfied by project.documents:
        project.stage = REVIEW
        emit('stage:transition', { from: PREPARE, to: REVIEW })
      else:
        emit('documents:required', { missing: checklist.missing })
        return WAITING_FOR_DOCUMENTS

    REVIEW:
      result = plansReview.checkCompliance(project.documents.plans, project.jurisdiction)
      project.complianceResult = result
      if result.passed:
        project.stage = SUBMIT
        emit('stage:transition', { from: REVIEW, to: SUBMIT })
      else:
        emit('review:failed', { corrections: result.failures })
        return WAITING_FOR_PLAN_FIXES

    SUBMIT:
      submission = submission.submit(project.jurisdiction, buildPayload(project))
      project.submissions.push(submission)
      project.stage = MONITOR
      emit('stage:transition', { from: SUBMIT, to: MONITOR, submissionId: submission.id })

    MONITOR:
      status = verification.getStatus(project.activeSubmission.id)
      project.lastStatus = status
      match status.code:
        APPROVED:
          project.stage = APPROVE
          advance(projectId)
        CORRECTION_REQUIRED:
          project.stage = RESPOND
          project.corrections.push(status.correction)
          advance(projectId)
        IN_REVIEW:
          scheduleNextPoll(projectId, jurisdiction.avgReviewTime)
          emit('monitor:update', { status })
        _:
          emit('monitor:update', { status })

    RESPOND:
      correction = project.corrections.last()
      goapPlan = goap.plan(
        worldState: buildWorldState(project, correction),
        goal: { correctionResolved: true, applicationReady: true }
      )
      result = goap.execute(goapPlan, project)
      if result.readyToResubmit:
        project.stage = SUBMIT
        advance(projectId)
      else:
        emit('correction:guidance', { steps: result.pendingUserActions })
        return WAITING_FOR_USER

    APPROVE:
      document = submission.retrieve(project.activeSubmission.id)
      project.permitDocument = document
      project.stage = COMPLETE
      emit('permit:approved', { documentUrl: document.url, project })

  state.save(project)
```

#### GOAP World State

```
WorldState {
  correctionReceived:    boolean
  correctionParsed:      boolean
  correctionClassified:  boolean
  affectedDocsIdentified: boolean
  fixGuidanceGenerated:  boolean
  userActionRequired:    boolean
  userActionComplete:    boolean
  fixValidated:          boolean
  applicationReady:      boolean
  correctionResolved:    boolean
}
```

#### GOAP Actions

```
ParseCorrection:
  preconditions:  { correctionReceived: true, correctionParsed: false }
  effects:        { correctionParsed: true }
  cost:           1
  execute:        nlp.extractCorrectionFields(correction.rawText)

ClassifyCorrection:
  preconditions:  { correctionParsed: true, correctionClassified: false }
  effects:        { correctionClassified: true }
  cost:           1
  execute:        brain.matchCorrectionPattern(correction.fields)

IdentifyAffectedDocuments:
  preconditions:  { correctionClassified: true, affectedDocsIdentified: false }
  effects:        { affectedDocsIdentified: true }
  cost:           1
  execute:        brain.getAffectedDocuments(correction.classification)

GenerateFixGuidance:
  preconditions:  { affectedDocsIdentified: true, fixGuidanceGenerated: false }
  effects:        { fixGuidanceGenerated: true, userActionRequired: true }
  cost:           1
  execute:        brain.explainCorrection(correction) → plain English + steps

AutoFixDocument:
  preconditions:  { correctionClassified: true, correction.autoFixable: true }
  effects:        { userActionRequired: false, userActionComplete: true }
  cost:           2
  execute:        documentEditor.applyFix(correction.fix, project.documents)

RequestUserInput:
  preconditions:  { userActionRequired: true, userActionComplete: false }
  effects:        { userActionComplete: true }
  cost:           5  // high cost — prefer auto-fix when possible
  execute:        emit('correction:user_action_required', guidance)

ValidateFix:
  preconditions:  { userActionComplete: true, fixValidated: false }
  effects:        { fixValidated: true }
  cost:           1
  execute:        plansReview.checkCompliance(updatedDocs, jurisdiction)

PrepareResubmission:
  preconditions:  { fixValidated: true, applicationReady: false }
  effects:        { applicationReady: true, correctionResolved: true }
  cost:           1
  execute:        buildPayload(project, correctionResponse)
```

---

### A — Architecture

#### Component Map

```
permit-conductor/
  src/
    agent/
      PermitConductor.ts      — main entry point, event emitter
      WorkflowEngine.ts       — stage machine, advance() logic
      ProjectManager.ts       — CRUD for PermitProject state
    goap/
      GOAPPlanner.ts          — BFS planner over action graph
      GOAPExecutor.ts         — executes planned action sequence
      WorldState.ts           — world state definition + builder
      actions/
        ParseCorrection.ts
        ClassifyCorrection.ts
        IdentifyAffectedDocuments.ts
        GenerateFixGuidance.ts
        AutoFixDocument.ts
        RequestUserInput.ts
        ValidateFix.ts
        PrepareResubmission.ts
    skills/
      interfaces/
        IBrainSkill.ts
        ISubmissionSkill.ts
        IVerificationSkill.ts
        IPlansReviewSkill.ts
      mocks/
        MockBrainSkill.ts     — for testing
        MockSubmissionSkill.ts
    state/
      StateStore.ts           — interface (implement with Postgres, SQLite, Redis)
      InMemoryStateStore.ts   — default for testing
    api/
      router.ts               — Express/Fastify REST endpoints
      webhooks.ts             — outbound webhook delivery
    types/
      index.ts                — all shared TypeScript interfaces
```

#### Data Flow

```
Client request
    ↓
PermitConductor.advance(projectId)
    ↓
WorkflowEngine.processStage(project)
    ↓
SkillConnector.call(skill, params)   ← external; customer-provided
    ↓ (if RESPOND stage)
GOAPPlanner.plan(worldState, goal)
    ↓
GOAPExecutor.execute(plan, project)
    ↓
StateStore.save(project)
    ↓
EventEmitter.emit(event)             ← webhooks, SSE, internal
```

#### State Persistence

The `StateStore` interface is intentionally abstract. Default implementations:
- `InMemoryStateStore` — testing and local dev
- `PostgresStateStore` — production (uses single `permit_projects` table with JSONB for flexible schema)
- `SQLiteStateStore` — embedded / edge deployments

#### API Endpoints

```
POST   /projects                    — create project, returns projectId
GET    /projects/:id                — get project state + history
POST   /projects/:id/advance        — advance to next stage
POST   /projects/:id/documents      — upload documents
POST   /projects/:id/corrections/:correctionId/resolve — user confirms fix
GET    /projects/:id/events         — SSE stream of project events
DELETE /projects/:id                — cancel project
```

---

### R — Refinement

#### Edge Cases

| Scenario | Handling |
|---|---|
| Jurisdiction not supported by submission skill | Fallback to email submission; surface warning to user |
| Plan review skill unavailable | Skip REVIEW stage; log warning; proceed to SUBMIT |
| Correction notice in non-English | Translate before classification; log original |
| Multiple corrections in single notice | Split into individual Correction objects; GOAP plans each |
| Correction requires professional seal (cannot auto-fix) | RequestUserInput action; escalation path |
| Submission skill timeout | Retry with exponential backoff (3 attempts); then escalate |
| Permit expires before approval | Emit `permit:expiry_warning`; re-enter SUBMIT |

#### Security
- Skill connectors receive only the data needed for their call (principle of least privilege)
- Project documents stored by reference (URL), not embedded in state
- Webhook payloads signed with HMAC-SHA256
- No PII logged beyond applicant ID; full data in customer-controlled StateStore

#### Performance
- Stage transitions are async; long-running skill calls (submission, plan review) return immediately with a job ID and poll/webhook for completion
- GOAP BFS is bounded: max plan depth 10, max branching factor 8 → worst-case 10^8 nodes (in practice < 20 nodes for correction workflows)
- State store reads/writes use optimistic locking to prevent concurrent stage transitions on the same project

---

### C — Completion

#### Implementation Phases

| Phase | Deliverables | Tests |
|---|---|---|
| 1 | Types, interfaces, InMemoryStateStore, WorkflowEngine skeleton | Unit: state transitions |
| 2 | Full WorkflowEngine (all 7 stages), PermitConductor entry point | Unit: each stage; integration: full happy path |
| 3 | GOAP planner + executor + all 8 actions | Unit: each action; integration: correction cycle |
| 4 | REST API + SSE + webhook delivery | Integration: API surface |
| 5 | PostgresStateStore + SQLiteStateStore | Integration: persistence |
| 6 | Mock skill connectors + test harness | Regression suite |
| 7 | Benchmark suite + performance baseline | Latency p50/p95/p99 per stage |
| 8 | npm package + TypeScript declarations | Build validation |

#### Acceptance Criteria
- Full happy path (DISCOVER → APPROVE) completes in < 30s on mock skills
- Correction cycle (RESPOND → SUBMIT → APPROVE) resolves correctly for all 8 GOAP action types
- Zero unhandled exceptions across 1,000-run fuzz test with randomized inputs
- TypeScript strict mode, zero `any` types in public interfaces
- 90%+ test coverage on core engine and GOAP planner

---

## Decision

Proceed with implementation as specified. Start with Phase 1 (types + state machine skeleton) on branch `feat/permit-orchestration-agent`.

## Consequences

- permit-conductor becomes a standalone licensable TypeScript package
- All PermitPlace products (permit-platform, permitapproved) become skill-connector clients
- The correction handling GOAP pattern extends the existing pattern from permit-connect and permitapproved
- New consumer permit experience is built on top of permit-conductor, not directly on skill backends
