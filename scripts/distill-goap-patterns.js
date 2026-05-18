#!/usr/bin/env node
/**
 * distill-goap-patterns.js
 *
 * Nightly job: scans brain-proxy for all goap_outcome memories,
 * aggregates them by action+jurisdiction, and writes data/goap-patterns.json.
 *
 * The output JSON is the Tier-1 cache read by getActionPriors() in Action.ts.
 * Pattern: mirrors nightly distillation in permitapproved's run-nightly-learner.js Step 6.
 *
 * Usage:
 *   node scripts/distill-goap-patterns.js
 *   BRAIN_PROXY_URL=http://localhost:3010 node scripts/distill-goap-patterns.js
 *
 * Cron (add to crontab):
 *   0 2 * * * cd /home/mrobinson/permit-conductor && node scripts/distill-goap-patterns.js >> /var/log/goap-distill.log 2>&1
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const BRAIN_PROXY_URL  = process.env.BRAIN_PROXY_URL  ?? 'http://localhost:3010';
const GOAP_SERVICE_TOKEN = process.env.GOAP_SERVICE_TOKEN ?? '';
const OUTPUT_FILE      = path.join(__dirname, '..', 'data', 'goap-patterns.json');
const SEARCH_LIMIT     = 500; // max outcomes to pull per query

// Threshold: suggest 'use_simple_parser' when nlp_timeout count reaches this
const NLP_TIMEOUT_THRESHOLD = 2;
// Threshold: suggest 'add_retry' when failure rate exceeds this
const FAILURE_RATE_THRESHOLD = 0.35;

// Brain vector search caps results per query. Query once per action name so
// the result set is distributed across all action types rather than biased
// toward whichever embeddings are closest to the generic 'goap_outcome' query.
const GOAP_ACTION_NAMES = [
  'ParseCorrection',
  'ClassifyCorrection',
  'IdentifyAffectedDocuments',
  'GenerateFixGuidance',
  'AutoFixDocument',
  'RequestUserInput',
  'ValidateFix',
  'PrepareResubmission',
  'SubmitApplication',
];

async function fetchGoapOutcomes() {
  const headers = { 'Content-Type': 'application/json' };
  if (GOAP_SERVICE_TOKEN) headers['x-service-token'] = GOAP_SERVICE_TOKEN;

  const seen = new Set();
  const all  = [];

  // One search per action name, then one broad fallback sweep
  const queries = [...GOAP_ACTION_NAMES.map(n => `goap_outcome ${n}`), 'goap_outcome'];

  for (const query of queries) {
    const res = await fetch(`${BRAIN_PROXY_URL}/api/brain/goap-search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        topK:   SEARCH_LIMIT,
        filter: { category: 'goap_outcome' },
      }),
    });

    if (!res.ok) {
      // Non-fatal — log and continue to next query
      console.warn(`[distill-goap-patterns] goap-search "${query}" returned ${res.status}`);
      continue;
    }

    const data = await res.json();
    for (const r of data.results ?? []) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        all.push(r);
      }
    }
  }

  return all;
}

function aggregate(outcomes) {
  const buckets = {};

  for (const outcome of outcomes) {
    const meta = outcome.metadata ?? {};
    const actionName   = meta.actionName  ?? 'unknown';
    const jurisdiction = (meta.jurisdiction ?? '').replace(/,\s*/g, ' ').trim();
    const key = `${actionName}|${jurisdiction}`;

    if (!buckets[key]) {
      buckets[key] = {
        actionName,
        jurisdiction,
        total:         0,
        success_count: 0,
        failure_count: 0,
        failure_modes: {},
        latency_sum:   0,
        latency_count: 0,
      };
    }

    const b = buckets[key];
    b.total++;

    // The brain stores result fields nested under meta.result (from recordOutcome payload)
    const result = meta.result ?? meta;
    const success    = result.success === true;
    const errorCode  = result.errorCode ?? meta.errorCode;
    const latencyMs  = result.latencyMs ?? meta.latencyMs;

    if (success) {
      b.success_count++;
    } else {
      b.failure_count++;
      const code = errorCode ?? 'unknown_error';
      b.failure_modes[code] = (b.failure_modes[code] ?? 0) + 1;
    }

    if (typeof latencyMs === 'number') {
      b.latency_sum   += latencyMs;
      b.latency_count += 1;
    }
  }

  return buckets;
}

function deriveSuggestions(buckets) {
  const actions = {};

  for (const [key, b] of Object.entries(buckets)) {
    const avg_latency_ms = b.latency_count > 0
      ? Math.round(b.latency_sum / b.latency_count)
      : 0;

    const entry = {
      total:         b.total,
      success_count: b.success_count,
      failure_count: b.failure_count,
      failure_modes: b.failure_modes,
      avg_latency_ms,
    };

    // Derive suggestion
    const nlpTimeouts   = b.failure_modes['nlp_timeout'] ?? 0;
    const failureRate   = b.total > 0 ? b.failure_count / b.total : 0;

    if (nlpTimeouts >= NLP_TIMEOUT_THRESHOLD) {
      entry.suggestion = 'use_simple_parser';
    } else if (failureRate >= FAILURE_RATE_THRESHOLD && b.total >= 5) {
      entry.suggestion = 'add_retry';
    }

    actions[key] = entry;
  }

  return actions;
}

async function main() {
  console.log(`[distill-goap-patterns] starting — brain: ${BRAIN_PROXY_URL}`);
  const startMs = Date.now();

  let outcomes;
  try {
    outcomes = await fetchGoapOutcomes();
  } catch (err) {
    console.error(`[distill-goap-patterns] failed to fetch outcomes: ${err.message}`);
    console.error('  Brain may be down — patterns file left unchanged.');
    process.exit(1);
  }

  console.log(`[distill-goap-patterns] fetched ${outcomes.length} outcomes`);

  const buckets = aggregate(outcomes);
  const actions = deriveSuggestions(buckets);

  const output = {
    _meta: {
      generated_by:              'scripts/distill-goap-patterns.js',
      last_run:                  new Date().toISOString(),
      total_outcomes_processed:  outcomes.length,
      distinct_action_jurisdiction_pairs: Object.keys(actions).length,
    },
    actions,
  };

  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  const elapsed = Date.now() - startMs;
  console.log(`[distill-goap-patterns] wrote ${OUTPUT_FILE} in ${elapsed}ms`);
  console.log(`  ${Object.keys(actions).length} action+jurisdiction pairs distilled`);
}

main().catch((err) => {
  console.error('[distill-goap-patterns] fatal:', err);
  process.exit(1);
});
