<div align="center">

# permit-conductor

[![License](https://img.shields.io/badge/license-MIT-6366f1?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/status-alpha-f59e0b?style=for-the-badge)]()

**The permit workflow orchestration engine.**

A stateful, agentic 7-stage permit journey manager with GOAP-powered correction handling and pluggable skill connectors. License it into any permitting platform — bring your own data, adapters, and submission backends.

[Quickstart](#quickstart) · [Architecture](#architecture) · [ADRs](docs/adr/) · [Contributing](#contributing)

</div>

---

## Why permit-conductor?

Every permit — residential, commercial, specialty — follows the same journey: discover → prepare → review → submit → monitor → respond → approve. Every permitting platform reinvents this state machine from scratch.

**permit-conductor is that state machine, done once, done right.**

- **Stateful** — each permit project persists its stage, context, and history across sessions
- **Agentic** — a thin orchestration agent routes to the right skill at each step automatically
- **GOAP correction handling** — Goal-Oriented Action Planning resolves correction cycles without brittle if/else logic
- **Pluggable** — bring your own brain, submission API, plan review, and verification skills
- **Observable** — full audit trail, stage transitions, and correction history per project

> Built by [PermitPlace](https://permitplace.com) as the backbone of [PermitNow.io](https://permitnow.io). Licensed for use in any permitting platform.

---

## The 7-Stage Permit Journey

```
DISCOVER → PREPARE → REVIEW → SUBMIT → MONITOR → RESPOND → APPROVE
```

| Stage | What Happens | Skills Called |
|---|---|---|
| **DISCOVER** | Identify required permits for a project | `brain.lookupRequirements()` |
| **PREPARE** | Generate document checklist, collect uploads | `brain.getDocumentChecklist()` |
| **REVIEW** | Validate plans against jurisdiction rules | `plansReview.checkCompliance()` |
| **SUBMIT** | File application with the jurisdiction | `submission.submit()` |
| **MONITOR** | Poll status, notify on changes | `verification.getStatus()` |
| **RESPOND** | Parse corrections, guide fixes, resubmit | GOAP Correction Planner |
| **APPROVE** | Retrieve permit, schedule inspections | `submission.retrieve()` |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Your Application / UI                  │
└─────────────────────┬───────────────────────────────┘
                      │  permit-conductor SDK
┌─────────────────────▼───────────────────────────────┐
│           PERMIT ORCHESTRATION AGENT                │
│  Stateful workflow manager                          │
│  Routes to skills · persists stage · escalates      │
└──┬──────┬──────┬──────┬──────┬──────┬───────────────┘
   │      │      │      │      │      │
   ▼      ▼      ▼      ▼      ▼      ▼
Brain  Review Submit Monitor GOAP  Retrieve
Skill  Skill  Skill   Skill  Planner Skill
   │      │      │      │      │      │
   └──────┴──────┴──────┴──────┴──────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│              SKILL CONNECTOR LAYER                  │
│  Implement ISkillConnector to wire your backends    │
│  Reference: PermitPlace brain · permit-connect ·    │
│             permit-verified · plansready            │
└─────────────────────────────────────────────────────┘
```

### GOAP Correction Planner

When a correction arrives, the GOAP planner searches the action graph for the lowest-cost resolution path:

```
Correction received
      ↓
parse_correction()    → classify type, affected documents
      ↓
identify_fix()        → brain lookup → plain-English explanation
      ↓
[prepare_document() | request_user_input() | auto_fix()]
      ↓
validate_fix()        → compliance check before resubmit
      ↓
resubmit()            → back to SUBMIT stage
      ↓
monitor()             → back to MONITOR stage
```

---

## Quickstart

```bash
npm install @permitplace/permit-conductor
```

```typescript
import { PermitConductor, PermitProject } from '@permitplace/permit-conductor';

const conductor = new PermitConductor({
  skills: {
    brain:        new MyBrainSkill(),
    submission:   new MySubmissionSkill(),
    verification: new MyVerificationSkill(),
    plansReview:  new MyPlansReviewSkill(),
  }
});

// Start a permit project
const project = await conductor.start({
  description: 'CO2 beverage system installation',
  jurisdiction: 'Austin, TX',
  permitTypes:  ['mechanical', 'refrigeration'],
  applicant:    { name: 'Acme Corp', email: 'permits@acme.com' }
});

// Advance through stages
await conductor.advance(project.id);  // DISCOVER → PREPARE
await conductor.advance(project.id);  // PREPARE → REVIEW (after docs uploaded)

// Subscribe to events
conductor.on('stage:transition', (e) => console.log(`${e.from} → ${e.to}`));
conductor.on('correction:received', (e) => console.log('Correction:', e.summary));
conductor.on('permit:approved', (e) => console.log('Permit:', e.documentUrl));
```

---

## Skill Connectors

Implement the `ISkillConnector` interface to wire permit-conductor into your stack:

```typescript
interface IBrainSkill {
  lookupRequirements(jurisdiction: string, permitType: string): Promise<Requirements>;
  getDocumentChecklist(requirements: Requirements): Promise<Checklist>;
  getCorrectionPatterns(jurisdiction: string): Promise<CorrectionPattern[]>;
}

interface ISubmissionSkill {
  submit(jurisdiction: string, payload: PermitPayload): Promise<Submission>;
  getStatus(submissionId: string): Promise<SubmissionStatus>;
  retrieve(submissionId: string): Promise<PermitDocument>;
  resubmit(submissionId: string, response: CorrectionResponse): Promise<Submission>;
}

interface IVerificationSkill {
  getStatus(submissionId: string): Promise<VerificationStatus>;
}

interface IPlansReviewSkill {
  checkCompliance(pdfUrl: string, jurisdiction: string): Promise<ComplianceResult>;
}
```

<details>
<summary>Reference implementation (PermitPlace stack)</summary>

The PermitPlace reference implementation wires:
- **Brain** → `brain-proxy` (pi.ruv.io, 98K+ episodes, HNSW vector search)
- **Submission** → `permit-connect` (19K+ US jurisdictions, Tyler Tech, OpenGov, Accela, email)
- **Verification** → `permit-verified` (PVS/FOR/CPI portal scraping)
- **Plans Review** → `plansready` (45-item jurisdiction-specific checklist)

</details>

---

## Project State Model

```typescript
interface PermitProject {
  id:           string;
  stage:        PermitStage;          // DISCOVER | PREPARE | REVIEW | SUBMIT | MONITOR | RESPOND | APPROVE
  jurisdiction: string;
  permitTypes:  string[];
  applicant:    Applicant;
  documents:    Document[];
  submissions:  Submission[];
  corrections:  Correction[];
  goapState:    WorldState;           // GOAP planner world state
  history:      StageTransition[];
  createdAt:    Date;
  updatedAt:    Date;
}
```

---

## ADRs

| ADR | Title | Status |
|---|---|---|
| [ADR-001](docs/adr/ADR-001-sparc-permit-orchestration-agent.md) | SPARC Analysis — Permit Orchestration Agent | Proposed |
| [ADR-002](docs/adr/ADR-002-goap-correction-handling.md) | GOAP Correction Handling Architecture | Proposed |

---

## Roadmap

- [x] SPARC architecture analysis (ADR-001)
- [x] GOAP correction handler design (ADR-002)
- [ ] Core state machine implementation
- [ ] Skill connector interfaces + validation
- [ ] GOAP planner engine
- [ ] REST API + webhook delivery
- [ ] TypeScript SDK + npm package
- [ ] Reference implementation (PermitPlace stack)
- [ ] Test suite (unit + integration)
- [ ] Benchmarks + performance baseline
- [ ] Hosted demo

---

## Contributing

permit-conductor is developed by [PermitPlace](https://permitplace.com). External contributions welcome — open an issue first for anything beyond a small fix.

```bash
git clone https://github.com/permitplace/permit-conductor.git
cd permit-conductor
npm install
npm test
```

---

## License

MIT © [PermitPlace](https://permitplace.com)
