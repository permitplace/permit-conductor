#!/usr/bin/env node
/**
 * validate-types.mjs — Synthetic consumer type validation
 *
 * Writes a strict TypeScript consumer test that imports key types from the
 * built dist/types declarations and runs tsc --strict --noEmit against it.
 * Exits 0 on success, 1 on failure.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const TYPES_INDEX = join(ROOT, 'dist', 'types', 'index.d.ts');

if (!existsSync(TYPES_INDEX)) {
  console.error('ERROR: dist/types/index.d.ts not found. Run `npm run build` first.');
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'permit-conductor-typecheck-'));

const consumerTs = join(tmpDir, 'consumer-test.ts');
const tsconfigJson = join(tmpDir, 'tsconfig.json');

// Consumer test — imports from the package name resolved via paths mapping
const consumerContent = `
import {
  PermitConductor,
  InMemoryStateStore,
  PermitStage,
  GOAPPlanner,
  GOAPExecutor,
  buildWorldState,
  ParseCorrection,
  ClassifyCorrection,
  AutoFixDocument,
  ValidateFix,
  PrepareResubmission,
  RequestUserInput,
  GenerateFixGuidance,
  IdentifyAffectedDocuments,
} from '@permitplace/permit-conductor';

import type {
  IBrainSkill,
  ISubmissionSkill,
  IVerificationSkill,
  IPlansReviewSkill,
  StateStore,
  ConductorConfig,
  PermitProject,
} from '@permitplace/permit-conductor';

// Verify InMemoryStateStore satisfies StateStore interface
const store: StateStore = new InMemoryStateStore();

// Verify PermitStage enum values are accessible
const stage: PermitStage = PermitStage.DISCOVER;
const reviewStage: PermitStage = PermitStage.REVIEW;

// Verify PermitProject type shape
declare const project: PermitProject;
const _stage: PermitStage = project.stage;
const _id: string = project.id;

// Verify GOAP classes are accessible
const planner: GOAPPlanner = new GOAPPlanner();
const executor: GOAPExecutor = new GOAPExecutor();

// Verify buildWorldState is callable
declare const goapProject: Parameters<typeof buildWorldState>[0];

// Verify GOAP action classes are accessible (structural check)
declare const _parseAction: InstanceType<typeof ParseCorrection>;
declare const _classifyAction: InstanceType<typeof ClassifyCorrection>;
declare const _autoFixAction: InstanceType<typeof AutoFixDocument>;
declare const _validateAction: InstanceType<typeof ValidateFix>;
declare const _prepareAction: InstanceType<typeof PrepareResubmission>;
declare const _requestAction: InstanceType<typeof RequestUserInput>;
declare const _guidanceAction: InstanceType<typeof GenerateFixGuidance>;
declare const _identifyAction: InstanceType<typeof IdentifyAffectedDocuments>;

// Verify skill interfaces are importable as types
type BrainCheck = IBrainSkill;
type SubmissionCheck = ISubmissionSkill;
type VerificationCheck = IVerificationSkill;
type PlansReviewCheck = IPlansReviewSkill;

// Verify ConductorConfig is accessible
type ConfigCheck = ConductorConfig;

export {};
`;

writeFileSync(consumerTs, consumerContent, 'utf8');

// Write a tsconfig that maps the package name to our built types via paths
const tsconfigContent = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'commonjs',
    moduleResolution: 'node',
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    skipLibCheck: false,
    baseUrl: '.',
    paths: {
      '@permitplace/permit-conductor': [`${ROOT}/dist/types/index.d.ts`],
    },
  },
  files: [consumerTs],
}, null, 2);

writeFileSync(tsconfigJson, tsconfigContent, 'utf8');

console.log('Running type validation against dist/types/index.d.ts ...');

try {
  execSync(`npx tsc --project "${tsconfigJson}"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  console.log('Type validation PASSED.');
  process.exitCode = 0;
} catch {
  console.error('Type validation FAILED.');
  process.exitCode = 1;
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
