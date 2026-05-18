# ADR-003: Phase 8 — npm Package + TypeScript Declarations

**Status:** Accepted  
**Date:** 2026-05-17  
**Author:** PermitPlace Platform Team  
**Branch:** feat/phase-8-npm-package

---

## Context

Phases 1–7 delivered a fully working permit orchestration engine: WorkflowEngine, GOAP correction handler, REST API, SSE, webhooks, Postgres/SQLite state stores, mock skill connectors, and a benchmark suite. The engine lives in a monorepo directory (`permit-conductor/`) but is not yet consumable as a standalone package.

Phase 8 makes permit-conductor a first-class npm package so that:
- `permit-platform` and `permitapproved` can install it as a dependency
- Third-party licensees can embed the orchestration engine in their own stacks
- The public API is explicit, versioned, and documented

---

## Decision

Publish `@permitplace/permit-conductor` to npm (scoped, public) with:
- Full TypeScript declarations (`.d.ts`) for all public interfaces
- A clean `exports` map separating the engine core, API server, and types
- CJS + ESM dual build
- `npm pack` dry-run as part of CI

---

## SPARC Analysis

### S — Specification

#### Goals
1. `npm install @permitplace/permit-conductor` works from any Node ≥ 20 project
2. All public interfaces are exported with full TypeScript types (zero `any` in public surface)
3. Consumers can use the engine standalone without pulling in the HTTP server
4. Package size is lean — no test fixtures, benchmarks, or dev tooling in the published artifact

#### Public API Surface

```typescript
// Engine (tree-shakeable core — no Express dependency)
export { PermitConductor }        from './agent/PermitConductor'
export { WorkflowEngine }         from './agent/WorkflowEngine'

// GOAP
export { GOAPPlanner }            from './goap/GOAPPlanner'
export { GOAPExecutor }           from './goap/GOAPExecutor'
export { WorldState, buildWorldState } from './goap/WorldState'
export * from './goap/actions'

// Skill interfaces (implement these to wire in your backend)
export type { IBrainSkill }       from './skills/interfaces/IBrainSkill'
export type { ISubmissionSkill }  from './skills/interfaces/ISubmissionSkill'
export type { IVerificationSkill } from './skills/interfaces/IVerificationSkill'
export type { IPlansReviewSkill } from './skills/interfaces/IPlansReviewSkill'

// State store interface + bundled implementations
export type { IStateStore }       from './state/StateStore'
export { InMemoryStateStore }     from './state/InMemoryStateStore'
export { PostgresStateStore }     from './state/PostgresStateStore'
export { SQLiteStateStore }       from './state/SQLiteStateStore'

// All shared types
export * from './types'

// API server (optional — consumers that want Express routing)
export { createRouter }           from './api/router'
export { WebhookDelivery }        from './api/webhooks'
```

#### Exports Map (package.json)

```json
{
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types": "./dist/types/index.d.ts"
    },
    "./api": {
      "import": "./dist/esm/api/index.js",
      "require": "./dist/cjs/api/index.js",
      "types": "./dist/types/api/index.d.ts"
    }
  },
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "files": [
    "dist/",
    "README.md",
    "LICENSE"
  ]
}
```

#### Non-Goals (Phase 8)
- Browser bundle (WASM/bundler target) — future phase
- Automatic changelog / release notes — future phase
- CDN distribution — future phase

---

### P — Pseudocode

#### Build Pipeline

```
function build():
  clean dist/

  // CJS build
  tsc --project tsconfig.cjs.json
    → outDir: dist/cjs
    → module: commonjs
    → declaration: false   (types generated once, below)

  // ESM build
  tsc --project tsconfig.esm.json
    → outDir: dist/esm
    → module: ES2022
    → declaration: false

  // Types-only build (single source of truth for .d.ts)
  tsc --project tsconfig.types.json
    → outDir: dist/types
    → emitDeclarationOnly: true
    → declaration: true
    → declarationMap: true

  verify:
    assert dist/cjs/index.js exists
    assert dist/esm/index.js exists
    assert dist/types/index.d.ts exists
    assert no *.test.* files in dist/
    assert no benchmarks/ in dist/

function pack-dry-run():
  npm pack --dry-run
  assert packed file list contains only dist/, README.md, LICENSE
  assert total size < 500KB unpacked

function validate-types():
  // Instantiate a synthetic consumer project (TypeScript strict)
  writeTempFile('consumer-test.ts', `
    import {
      PermitConductor, InMemoryStateStore,
      IBrainSkill, ISubmissionSkill, IVerificationSkill, IPlansReviewSkill,
      PermitProject, WorkflowStage
    } from '@permitplace/permit-conductor'

    const store = new InMemoryStateStore()
    const conductor = new PermitConductor({ stateStore: store, skills: {} })
    const project: PermitProject = await conductor.createProject({ jurisdiction: 'CA-LA', permitTypes: ['building'] })
    assert project.stage === WorkflowStage.DISCOVER
  `)
  tsc --strict --noEmit consumer-test.ts
  assert exit code 0
```

#### CI Integration

```
on: [push, pull_request] to feat/phase-8-npm-package

jobs:
  build:
    run: npm run build
    run: npm run pack:dry-run
    run: npm run validate:types

  test:
    run: npm test

  publish (on tag v*):
    run: npm publish --access public
    requires: NPM_TOKEN secret
```

#### src/index.ts (public barrel)

```typescript
// Core engine
export { PermitConductor } from './agent/PermitConductor'
export { WorkflowEngine }  from './agent/WorkflowEngine'

// GOAP
export { GOAPPlanner }     from './goap/GOAPPlanner'
export { GOAPExecutor }    from './goap/GOAPExecutor'
export { WorldState, buildWorldState } from './goap/WorldState'
export * from './goap/actions'

// Skill interfaces
export type { IBrainSkill }        from './skills/interfaces/IBrainSkill'
export type { ISubmissionSkill }   from './skills/interfaces/ISubmissionSkill'
export type { IVerificationSkill } from './skills/interfaces/IVerificationSkill'
export type { IPlansReviewSkill }  from './skills/interfaces/IPlansReviewSkill'

// State
export type { IStateStore }        from './state/StateStore'
export { InMemoryStateStore }      from './state/InMemoryStateStore'
export { PostgresStateStore }      from './state/PostgresStateStore'
export { SQLiteStateStore }        from './state/SQLiteStateStore'

// Types
export * from './types'
```

---

### A — Architecture

#### Directory Changes

```
permit-conductor/
  src/
    index.ts                ← NEW: public barrel export
    api/
      index.ts              ← NEW: api sub-barrel (router + webhooks)
  dist/                     ← generated; gitignored
    cjs/                    ← CommonJS build
    esm/                    ← ESM build
    types/                  ← .d.ts declarations
  tsconfig.json             ← updated: no longer emits, just validates
  tsconfig.cjs.json         ← NEW: CJS emit config
  tsconfig.esm.json         ← NEW: ESM emit config
  tsconfig.types.json       ← NEW: declaration-only emit config
  package.json              ← updated: exports map, files, scripts
  .npmignore                ← NEW: exclude tests, benchmarks, coverage
```

#### tsconfig Split

```
tsconfig.json (base — validation only, no emit):
  strict: true, noEmit: true — used by IDE and typecheck script

tsconfig.cjs.json (extends base):
  module: CommonJS, outDir: dist/cjs, declaration: false

tsconfig.esm.json (extends base):
  module: ES2022, outDir: dist/esm, declaration: false

tsconfig.types.json (extends base):
  emitDeclarationOnly: true, outDir: dist/types, declaration: true
```

---

### R — Refinement

#### Edge Cases

| Scenario | Handling |
|---|---|
| Consumer uses CJS `require()` | `main` field + `dist/cjs` resolves correctly |
| Consumer uses ESM `import` | `module` field + `dist/esm` resolves correctly |
| TypeScript consumer with `moduleResolution: bundler` | `exports` map covers it |
| Consumer only wants types, no runtime | `export type` re-exports in index.ts prevent accidental runtime import |
| PostgreSQL optional — consumer doesn't use it | `pg` listed as `peerDependency` optional, not bundled |
| SQLite optional — consumer doesn't use it | `better-sqlite3` listed as `peerDependency` optional |
| Test files accidentally published | `.npmignore` + `files` field both exclude `tests/`, `coverage/`, `benchmarks/` |

#### Peer Dependencies

```json
"peerDependencies": {
  "pg": ">=8.0.0",
  "better-sqlite3": ">=9.0.0"
},
"peerDependenciesMeta": {
  "pg": { "optional": true },
  "better-sqlite3": { "optional": true }
}
```

---

### C — Completion

#### Acceptance Criteria

- [ ] `npm run build` produces `dist/cjs`, `dist/esm`, `dist/types` with zero errors
- [ ] `npm run pack:dry-run` confirms only `dist/`, `README.md`, `LICENSE` in artifact
- [ ] `npm run validate:types` — synthetic consumer compiles under `strict` with zero errors
- [ ] `npm test` — all 209 existing tests still pass
- [ ] `npm run typecheck` — zero type errors across full source
- [ ] `dist/` is gitignored; `npm pack` artifact is ≤ 500KB unpacked
- [ ] `pg` and `better-sqlite3` moved to `peerDependencies` (optional)
- [ ] CI workflow validates build + pack + types on every push

---

## Consequences

- permit-platform and permitapproved can install `@permitplace/permit-conductor` as a versioned dependency
- The API surface is now explicit and breaking changes require a semver major bump
- Dual CJS/ESM build adds ~10s to CI but eliminates consumer compatibility issues
- `pg` and `better-sqlite3` moving to peer deps means consumers who don't use those stores don't install them
