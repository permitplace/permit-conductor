# ADR-002: GOAP Correction Handling Architecture

**Status:** Proposed  
**Date:** 2026-05-17  
**Author:** PermitPlace Platform Team

---

## Context

The RESPOND stage of the permit journey is where most permits get abandoned. A jurisdiction reviews an application, returns a correction notice in regulatory language, and expects the applicant to understand what is wrong, fix the specific documents, and resubmit — often within a deadline. This cycle typically takes 2-6 weeks per round and requires either a permit expediter or deep knowledge of local codes.

This ADR defines how Goal-Oriented Action Planning (GOAP) is used to automate correction handling within permit-conductor. GOAP is already proven in the PermitPlace codebase: permit-connect uses it for self-healing jurisdiction adapters, and permitapproved uses it for internal permit operations. This is the third and most consumer-critical instance.

---

## Why GOAP Over Rule-Based Logic

Correction handling is not a linear process. The path from "correction received" to "ready to resubmit" depends on:
- The type of correction (document gap, dimension error, missing signature, wrong form, wrong fee)
- Whether the fix is automatable or requires user action
- Whether multiple corrections are bundled in one notice
- Whether a fix to one item creates a new issue in another

Rule-based (if/else) logic breaks on novel correction types. GOAP searches the action graph at runtime, finding the cheapest valid plan for the current world state. Adding a new correction type means adding a new action — not modifying branching logic.

---

## World State

The GOAP world state for the correction cycle:

```typescript
interface CorrectionWorldState {
  // Input state
  correctionReceived:       boolean;  // correction notice arrived
  correctionParsed:         boolean;  // fields extracted from raw text
  correctionClassified:     boolean;  // matched to a known pattern type
  affectedDocsIdentified:   boolean;  // which documents need changing

  // Resolution state
  fixGuidanceGenerated:     boolean;  // plain-English explanation ready
  userActionRequired:       boolean;  // fix requires human input
  userActionComplete:       boolean;  // human confirmed fix done
  autoFixApplied:           boolean;  // automated fix applied
  fixValidated:             boolean;  // compliance re-check passed

  // Output state
  applicationReady:         boolean;  // payload ready to resubmit
  correctionResolved:       boolean;  // goal achieved

  // Metadata (not part of planning, used by executors)
  correctionType?:          CorrectionType;
  autoFixable?:             boolean;
  affectedDocumentIds?:     string[];
}
```

### Correction Types

```typescript
enum CorrectionType {
  MISSING_DOCUMENT       = 'missing_document',
  DIMENSION_ERROR        = 'dimension_error',
  MISSING_SIGNATURE      = 'missing_signature',
  WRONG_FORM_VERSION     = 'wrong_form_version',
  FEE_DISCREPANCY        = 'fee_discrepancy',
  SETBACK_VIOLATION      = 'setback_violation',
  ZONING_CONFLICT        = 'zoning_conflict',
  STRUCTURAL_DEFICIENCY  = 'structural_deficiency',
  CODE_REFERENCE_NEEDED  = 'code_reference_needed',
  PERMIT_TYPE_MISMATCH   = 'permit_type_mismatch',
  UNKNOWN                = 'unknown'
}
```

---

## Action Definitions

### Action 1: ParseCorrection

```typescript
{
  name: 'ParseCorrection',
  preconditions: {
    correctionReceived:  true,
    correctionParsed:    false
  },
  effects: {
    correctionParsed:    true
  },
  cost: 1,
  execute: async (state, ctx) => {
    const fields = await nlp.extractFields(ctx.correction.rawText);
    // Fields: correctionItems[], deadlineDate, jurisdictionContact, referenceNumber
    ctx.correction.parsedFields = fields;
  }
}
```

### Action 2: ClassifyCorrection

```typescript
{
  name: 'ClassifyCorrection',
  preconditions: {
    correctionParsed:      true,
    correctionClassified:  false
  },
  effects: {
    correctionClassified:  true
  },
  cost: 1,
  execute: async (state, ctx) => {
    // brain.getCorrectionPatterns() returns 5,266 real patterns
    const patterns = await brain.getCorrectionPatterns(ctx.project.jurisdiction);
    const match = classifier.match(ctx.correction.parsedFields, patterns);
    ctx.worldState.correctionType = match.type;
    ctx.worldState.autoFixable    = match.autoFixable;
  }
}
```

### Action 3: IdentifyAffectedDocuments

```typescript
{
  name: 'IdentifyAffectedDocuments',
  preconditions: {
    correctionClassified:        true,
    affectedDocsIdentified:      false
  },
  effects: {
    affectedDocsIdentified:      true
  },
  cost: 1,
  execute: async (state, ctx) => {
    const affected = await brain.getAffectedDocuments(
      ctx.worldState.correctionType,
      ctx.project.documents
    );
    ctx.worldState.affectedDocumentIds = affected.map(d => d.id);
  }
}
```

### Action 4: GenerateFixGuidance

```typescript
{
  name: 'GenerateFixGuidance',
  preconditions: {
    affectedDocsIdentified:   true,
    fixGuidanceGenerated:     false
  },
  effects: {
    fixGuidanceGenerated:     true,
    userActionRequired:       true   // guidance implies user needs to act
  },
  cost: 1,
  execute: async (state, ctx) => {
    const guidance = await brain.explainCorrection({
      type:          ctx.worldState.correctionType,
      rawText:       ctx.correction.rawText,
      affectedDocs:  ctx.worldState.affectedDocumentIds,
      jurisdiction:  ctx.project.jurisdiction
    });
    // Returns: { summary, steps[], examples[], estimatedTime }
    ctx.correction.guidance = guidance;
    emit('correction:guidance', guidance);
  }
}
```

### Action 5: AutoFixDocument

```typescript
{
  name: 'AutoFixDocument',
  preconditions: {
    affectedDocsIdentified:   true,
    autoFixable:              true,   // only when brain says auto-fixable
    autoFixApplied:           false
  },
  effects: {
    autoFixApplied:           true,
    userActionRequired:       false,
    userActionComplete:       true
  },
  cost: 2,  // preferred over RequestUserInput (cost 5)
  execute: async (state, ctx) => {
    for (const docId of ctx.worldState.affectedDocumentIds) {
      await documentEditor.applyFix(docId, ctx.worldState.correctionType, ctx.project);
    }
  }
}
```

### Action 6: RequestUserInput

```typescript
{
  name: 'RequestUserInput',
  preconditions: {
    fixGuidanceGenerated:   true,
    userActionRequired:     true,
    userActionComplete:     false
  },
  effects: {
    userActionComplete:     true
  },
  cost: 5,  // high cost — planner prefers AutoFix when available
  execute: async (state, ctx) => {
    emit('correction:user_action_required', {
      correctionId:  ctx.correction.id,
      guidance:      ctx.correction.guidance,
      deadline:      ctx.correction.parsedFields.deadlineDate
    });
    // Execution pauses here; resumes when user calls /corrections/:id/resolve
  }
}
```

### Action 7: ValidateFix

```typescript
{
  name: 'ValidateFix',
  preconditions: {
    userActionComplete:   true,
    fixValidated:         false
  },
  effects: {
    fixValidated:         true
  },
  cost: 1,
  execute: async (state, ctx) => {
    const result = await plansReview.checkCompliance(
      ctx.project.documents,
      ctx.project.jurisdiction
    );
    if (!result.passed) {
      // Reset to allow re-planning
      ctx.worldState.userActionComplete = false;
      ctx.worldState.fixGuidanceGenerated = false;
      emit('correction:validation_failed', { failures: result.failures });
    }
  }
}
```

### Action 8: PrepareResubmission

```typescript
{
  name: 'PrepareResubmission',
  preconditions: {
    fixValidated:          true,
    applicationReady:      false
  },
  effects: {
    applicationReady:      true,
    correctionResolved:    true
  },
  cost: 1,
  execute: async (state, ctx) => {
    ctx.project.resubmissionPayload = buildPayload(ctx.project, {
      correctionResponse: ctx.correction.guidance.summary,
      correctionRef:      ctx.correction.parsedFields.referenceNumber
    });
  }
}
```

---

## Planner

BFS search over the action graph. Finds the lowest-cost plan from initial world state to goal state `{ correctionResolved: true, applicationReady: true }`.

```typescript
class GOAPPlanner {
  plan(initialState: CorrectionWorldState, goal: Partial<CorrectionWorldState>): Action[] {
    // BFS with cost accumulation
    // Pruning: skip branches where preconditions can never be satisfied
    // Max depth: 10 actions
    // Typical plan length: 4-6 actions
  }
}
```

### Example Plans

**Scenario A: Auto-fixable dimension error**
```
Plan: ParseCorrection → ClassifyCorrection → IdentifyAffectedDocuments
    → AutoFixDocument → ValidateFix → PrepareResubmission
Total cost: 7
```

**Scenario B: Missing professional seal (requires user)**
```
Plan: ParseCorrection → ClassifyCorrection → IdentifyAffectedDocuments
    → GenerateFixGuidance → RequestUserInput → ValidateFix → PrepareResubmission
Total cost: 11
```

**Scenario C: Unknown correction type**
```
Plan: ParseCorrection → ClassifyCorrection [type=UNKNOWN]
    → GenerateFixGuidance [generic explanation] → RequestUserInput
    → ValidateFix → PrepareResubmission
Total cost: 10
```

---

## Integration with Permit Brain

The brain's 5,266 correction patterns are the primary data source for:
- `ClassifyCorrection` — pattern matching against known types
- `IdentifyAffectedDocuments` — which document types this correction typically affects
- `GenerateFixGuidance` — what this correction means in plain English, with jurisdiction-specific examples

Pattern format in brain:
```typescript
interface CorrectionPattern {
  id:             string;
  jurisdiction?:  string;    // null = applies nationwide
  type:           CorrectionType;
  keywords:       string[];  // matched against parsed correction text
  affectedDocs:   string[];  // document types typically affected
  autoFixable:    boolean;
  guidanceTemplate: string;  // handlebars template for explanation
  exampleFix:     string;
  avgResolutionDays: number;
}
```

---

## Multi-Correction Handling

When a jurisdiction bundles multiple corrections in one notice:

```typescript
// Each item in parsedFields.correctionItems becomes a separate Correction object
// GOAP runs independently per correction
// PrepareResubmission waits for all corrections resolved before building payload
```

---

## Escalation

If GOAP cannot find a valid plan (no path from initial state to goal within max depth):
1. Emit `correction:escalation_required`
2. Create internal ticket (via permitapproved integration)
3. Notify applicant that human review is needed
4. Expected escalation rate: < 5% of corrections

---

## Decision

Implement GOAP correction handling as specified, integrated as the RESPOND stage handler in the WorkflowEngine. The 8 actions defined here are the v1 action set; new correction types can be added by implementing new Action classes without modifying the planner or executor.

## Consequences

- Correction handling is explainable and auditable (plan is logged with each project)
- Novel correction types degrade gracefully to RequestUserInput rather than crashing
- The brain's correction pattern corpus becomes more valuable as the action set uses it more deeply
- Escalation rate serves as a metric for brain corpus completeness
