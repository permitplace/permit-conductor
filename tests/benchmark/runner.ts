/**
 * Benchmark runner for permit-conductor.
 * Run via: npx ts-node tests/benchmark/runner.ts
 *
 * Benchmarks:
 *   1. GOAP planner: plan time for 3 correction scenarios (1000 iterations each)
 *   2. WorkflowEngine: stage transition time for each stage (100 iterations each)
 *   3. CorrectionHandler: end-to-end handle() for auto-fix scenario (500 iterations)
 *   4. InMemoryStateStore: save/load/list throughput (10,000 iterations)
 *
 * Exits with code 1 if any p99 exceeds thresholds.
 */

import { GOAPPlanner }               from '../../src/goap/GOAPPlanner';
import { CorrectionHandler }         from '../../src/goap/CorrectionHandler';
import { WorkflowEngine }            from '../../src/agent/WorkflowEngine';
import { InMemoryStateStore }        from '../../src/state/InMemoryStateStore';
import { MockBrainSkill }            from '../../src/skills/mocks/MockBrainSkill';
import { MockSubmissionSkill }       from '../../src/skills/mocks/MockSubmissionSkill';
import { ParseCorrection }           from '../../src/goap/actions/ParseCorrection';
import { ClassifyCorrection }        from '../../src/goap/actions/ClassifyCorrection';
import { IdentifyAffectedDocuments } from '../../src/goap/actions/IdentifyAffectedDocuments';
import { GenerateFixGuidance }       from '../../src/goap/actions/GenerateFixGuidance';
import { AutoFixDocument }           from '../../src/goap/actions/AutoFixDocument';
import { RequestUserInput }          from '../../src/goap/actions/RequestUserInput';
import { ValidateFix }               from '../../src/goap/actions/ValidateFix';
import { PrepareResubmission }       from '../../src/goap/actions/PrepareResubmission';
import type {
  CorrectionWorldState,
  ConductorConfig,
  PermitProject,
  PermitStage,
  Correction,
  SubmissionStatusCode as StatusCodeType,
} from '../../src/types';
import { PermitStage as Stage, SubmissionStatusCode } from '../../src/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  name:   string;
  iters:  number;
  p50:    number;
  p95:    number;
  p99:    number;
  passed: boolean;
  threshold: number;
}

// ---------------------------------------------------------------------------
// Percentile helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(times: number[]): { p50: number; p95: number; p99: number } {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

function now(): number {
  return Number(process.hrtime.bigint()) / 1_000_000; // ms with sub-ms precision
}

// ---------------------------------------------------------------------------
// Benchmark helpers
// ---------------------------------------------------------------------------

async function runAsync(
  name: string,
  iters: number,
  threshold: number,
  fn: () => Promise<void>,
): Promise<BenchmarkResult> {
  // Warm up — 10% of iterations
  const warmup = Math.max(10, Math.floor(iters * 0.1));
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  const times: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = now();
    await fn();
    times.push(now() - t0);
  }

  const s      = stats(times);
  const passed = s.p99 < threshold;
  return { name, iters, ...s, passed, threshold };
}

function runSync(
  name: string,
  iters: number,
  threshold: number,
  fn: () => void,
): BenchmarkResult {
  // Warm up
  const warmup = Math.max(10, Math.floor(iters * 0.1));
  for (let i = 0; i < warmup; i++) {
    fn();
  }

  const times: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = now();
    fn();
    times.push(now() - t0);
  }

  const s      = stats(times);
  const passed = s.p99 < threshold;
  return { name, iters, ...s, passed, threshold };
}

// ---------------------------------------------------------------------------
// Shared action set
// ---------------------------------------------------------------------------

const ALL_ACTIONS = [
  new ParseCorrection(),
  new ClassifyCorrection(),
  new IdentifyAffectedDocuments(),
  new GenerateFixGuidance(),
  new AutoFixDocument(),
  new RequestUserInput(),
  new ValidateFix(),
  new PrepareResubmission(),
];

// ---------------------------------------------------------------------------
// Benchmark 1: GOAP Planner
// ---------------------------------------------------------------------------

function makeBaseWorldState(): CorrectionWorldState {
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

import { CorrectionType } from '../../src/goap/WorldState';

const GOAL: Partial<CorrectionWorldState> = {
  correctionResolved: true,
  applicationReady:   true,
};

async function benchmarkGOAPPlanner(): Promise<BenchmarkResult[]> {
  const planner = new GOAPPlanner();
  const ITERS   = 1000;
  const THRESH  = 5; // p99 < 5ms

  const scenarioA = runSync(
    'GOAP planner — auto-fix (Scenario A)',
    ITERS,
    THRESH,
    () => {
      const state: CorrectionWorldState = {
        ...makeBaseWorldState(),
        correctionType: CorrectionType.DIMENSION_ERROR,
        autoFixable:    true,
      };
      planner.plan(state, GOAL, ALL_ACTIONS);
    },
  );

  const scenarioB = runSync(
    'GOAP planner — user-input (Scenario B)',
    ITERS,
    THRESH,
    () => {
      const state: CorrectionWorldState = {
        ...makeBaseWorldState(),
        correctionType: CorrectionType.MISSING_SIGNATURE,
        autoFixable:    false,
      };
      planner.plan(state, GOAL, ALL_ACTIONS);
    },
  );

  const scenarioC = runSync(
    'GOAP planner — unknown type (Scenario C)',
    ITERS,
    THRESH,
    () => {
      const state: CorrectionWorldState = {
        ...makeBaseWorldState(),
        correctionType: CorrectionType.UNKNOWN,
        autoFixable:    false,
      };
      planner.plan(state, GOAL, ALL_ACTIONS);
    },
  );

  return [scenarioA, scenarioB, scenarioC];
}

// ---------------------------------------------------------------------------
// Benchmark 2: WorkflowEngine stage transitions
// ---------------------------------------------------------------------------

function makeNow(): string {
  return new Date().toISOString();
}

function makeProject(stage: typeof Stage[keyof typeof Stage], overrides: Partial<PermitProject> = {}): PermitProject {
  return {
    id:           `bench-proj-${stage}`,
    stage:        stage as PermitStage,
    jurisdiction: 'Austin, TX',
    permitTypes:  ['building'],
    applicant:    { id: 'app-bench', name: 'Bench User', email: 'bench@example.com' },
    documents:    [],
    submissions:  [],
    corrections:  [],
    history:      [],
    createdAt:    makeNow(),
    updatedAt:    makeNow(),
    ...overrides,
  };
}

function makeConfig(verificationCode: StatusCodeType = SubmissionStatusCode.IN_REVIEW): ConductorConfig {
  const brain      = new MockBrainSkill();
  const submission = new MockSubmissionSkill();
  return {
    skills: {
      brain,
      submission,
      verification: {
        async getStatus() {
          return { code: verificationCode, updatedAt: makeNow() };
        },
      },
      plansReview: {
        async checkCompliance() {
          return { passed: true, failures: [] };
        },
      },
    },
    stateStore: new InMemoryStateStore(),
  };
}

async function benchmarkWorkflowEngine(): Promise<BenchmarkResult[]> {
  const engine  = new WorkflowEngine();
  const ITERS   = 100;
  const THRESH  = 100; // p99 < 100ms
  const emitFn  = () => { /* noop */ };

  const results: BenchmarkResult[] = [];

  // DISCOVER
  const discoverResult = await runAsync(
    'WorkflowEngine — DISCOVER stage',
    ITERS,
    THRESH,
    async () => {
      const project = makeProject(Stage.DISCOVER);
      const config  = makeConfig();
      await engine.processStage(project, config, emitFn);
    },
  );
  results.push(discoverResult);

  // PREPARE (with requirements pre-set, all satisfied)
  const brain        = new MockBrainSkill();
  brain.allDocumentsSatisfied = true;
  const requirements = await brain.lookupRequirements('Austin, TX', ['building']);

  const prepareResult = await runAsync(
    'WorkflowEngine — PREPARE stage (satisfied)',
    ITERS,
    THRESH,
    async () => {
      const project = makeProject(Stage.PREPARE, { requirements });
      const config  = makeConfig();
      await engine.processStage(project, config, emitFn);
    },
  );
  results.push(prepareResult);

  // REVIEW (passing)
  const reviewResult = await runAsync(
    'WorkflowEngine — REVIEW stage (pass)',
    ITERS,
    THRESH,
    async () => {
      const project = makeProject(Stage.REVIEW);
      const config  = makeConfig();
      await engine.processStage(project, config, emitFn);
    },
  );
  results.push(reviewResult);

  // SUBMIT
  const submitResult = await runAsync(
    'WorkflowEngine — SUBMIT stage',
    ITERS,
    THRESH,
    async () => {
      const project = makeProject(Stage.SUBMIT);
      const config  = makeConfig();
      await engine.processStage(project, config, emitFn);
    },
  );
  results.push(submitResult);

  // MONITOR (IN_REVIEW — no tail call)
  const monitorResult = await runAsync(
    'WorkflowEngine — MONITOR stage (IN_REVIEW)',
    ITERS,
    THRESH,
    async () => {
      const project = makeProject(Stage.MONITOR, {
        submissions: [{
          id:          'sub-bench',
          submittedAt: makeNow(),
          status:      SubmissionStatusCode.SUBMITTED,
        }],
      });
      const config = makeConfig(SubmissionStatusCode.IN_REVIEW);
      await engine.processStage(project, config, emitFn);
    },
  );
  results.push(monitorResult);

  // APPROVE
  const approveResult = await runAsync(
    'WorkflowEngine — APPROVE stage',
    ITERS,
    THRESH,
    async () => {
      const project = makeProject(Stage.APPROVE, {
        submissions: [{
          id:          'sub-bench-approve',
          submittedAt: makeNow(),
          status:      SubmissionStatusCode.APPROVED,
        }],
      });
      const config = makeConfig();
      await engine.processStage(project, config, emitFn);
    },
  );
  results.push(approveResult);

  return results;
}

// ---------------------------------------------------------------------------
// Benchmark 3: CorrectionHandler — auto-fix scenario
// ---------------------------------------------------------------------------

async function benchmarkCorrectionHandler(): Promise<BenchmarkResult> {
  const ITERS  = 500;
  const THRESH = 50; // p99 < 50ms

  const goapProject = {
    id:           'bench-goap-proj',
    jurisdiction: 'Austin, TX',
    documents: [
      { id: 'doc-fp-1', type: 'floor_plan' },
      { id: 'doc-sp-1', type: 'site_plan'  },
    ],
    history: [] as Array<{ action: string; timestamp: string; detail?: unknown }>,
  };

  const correction = {
    id:      'bench-corr-1',
    rawText: 'There is a dimension error in the floor plan. Please correct measurements.',
  };

  const emitFn = () => { /* noop */ };

  return runAsync(
    'CorrectionHandler — auto-fix end-to-end',
    ITERS,
    THRESH,
    async () => {
      // Reset history on each iteration
      goapProject.history = [];
      const handler = new CorrectionHandler();
      await handler.handle(goapProject, { ...correction }, emitFn);
    },
  );
}

// ---------------------------------------------------------------------------
// Benchmark 4: InMemoryStateStore throughput
// ---------------------------------------------------------------------------

async function benchmarkStateStore(): Promise<BenchmarkResult[]> {
  const ITERS  = 10_000;
  const THRESH = 1; // p99 < 1ms

  const store = new InMemoryStateStore();
  const project = makeProject(Stage.DISCOVER);

  // Pre-populate for load/list tests
  await store.save(project);
  for (let i = 0; i < 99; i++) {
    await store.save({ ...project, id: `bench-bulk-${i}` });
  }

  const saveResult = await runAsync(
    'InMemoryStateStore — save',
    ITERS,
    THRESH,
    async () => {
      await store.save(project);
    },
  );

  const loadResult = await runAsync(
    'InMemoryStateStore — load',
    ITERS,
    THRESH,
    async () => {
      await store.load(project.id);
    },
  );

  const listResult = await runAsync(
    'InMemoryStateStore — list (100 items)',
    Math.floor(ITERS / 10), // fewer iterations — list is heavier
    THRESH * 5,             // 5ms threshold for list with 100 items
    async () => {
      await store.list();
    },
  );

  return [saveResult, loadResult, listResult];
}

// ---------------------------------------------------------------------------
// Table output
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function formatMs(n: number): string {
  return `${n.toFixed(3)}ms`;
}

function printTable(results: BenchmarkResult[]): void {
  const nameW     = Math.max(50, ...results.map((r) => r.name.length)) + 2;
  const colW      = 12;

  const header = [
    pad('Benchmark', nameW),
    pad('Iters', colW),
    pad('p50', colW),
    pad('p95', colW),
    pad('p99', colW),
    pad('Threshold', colW),
    'Pass',
  ].join('  ');

  const sep = '-'.repeat(header.length);

  console.log('\n' + sep);
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const pass = r.passed ? 'PASS' : 'FAIL';
    const row = [
      pad(r.name, nameW),
      pad(String(r.iters), colW),
      pad(formatMs(r.p50), colW),
      pad(formatMs(r.p95), colW),
      pad(formatMs(r.p99), colW),
      pad(`< ${r.threshold}ms`, colW),
      pass,
    ].join('  ');
    console.log(row);
  }

  console.log(sep + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('permit-conductor benchmark suite');
  console.log('=================================\n');

  const allResults: BenchmarkResult[] = [];

  // 1. GOAP planner
  console.log('Running GOAP planner benchmarks (3 scenarios × 1000 iters)...');
  const plannerResults = await benchmarkGOAPPlanner();
  allResults.push(...plannerResults);

  // 2. WorkflowEngine stage transitions
  console.log('Running WorkflowEngine stage benchmarks (6 stages × 100 iters)...');
  const engineResults = await benchmarkWorkflowEngine();
  allResults.push(...engineResults);

  // 3. CorrectionHandler
  console.log('Running CorrectionHandler benchmark (500 iters)...');
  const handlerResult = await benchmarkCorrectionHandler();
  allResults.push(handlerResult);

  // 4. InMemoryStateStore
  console.log('Running InMemoryStateStore benchmark (10,000 iters)...');
  const storeResults = await benchmarkStateStore();
  allResults.push(...storeResults);

  printTable(allResults);

  const failures = allResults.filter((r) => !r.passed);

  if (failures.length > 0) {
    console.error(`FAILED: ${failures.length} benchmark(s) exceeded p99 threshold:`);
    for (const f of failures) {
      console.error(`  - ${f.name}: p99=${formatMs(f.p99)} > threshold ${f.threshold}ms`);
    }
    process.exit(1);
  } else {
    console.log(`All ${allResults.length} benchmarks passed.`);
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  console.error('Benchmark runner error:', err);
  process.exit(1);
});
