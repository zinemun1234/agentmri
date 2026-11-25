import { compareTraces, type DivergenceType } from '../compare';
import { passKCurve } from './passk';
import type { RunGroup, GroupFlakinessReport, DistributionStats, StepFlakiness } from './types';

function distribution(values: number[]): DistributionStats | undefined {
  if (values.length === 0) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  return {
    count: values.length,
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    stddev: Math.sqrt(variance)
  };
}

// Wilson score interval for binomial proportion (small-sample safe)
export function wilsonInterval(successes: number, total: number, z = 1.96): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 1 };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function traceDurationMs(trace: { started_at: string; ended_at?: string }): number | undefined {
  if (!trace.ended_at) return undefined;
  return Date.parse(trace.ended_at) - Date.parse(trace.started_at);
}

function traceCost(trace: { spans: Array<{ usage?: { cost_usd?: number } }> }): number {
  return trace.spans.reduce((sum, span) => sum + (span.usage?.cost_usd ?? 0), 0);
}

function baseKey(stepKey?: string): string | undefined {
  return stepKey?.split('#')[0];
}

export function analyzeRunGroup(group: RunGroup): GroupFlakinessReport {
  const runs = [...group.runs].sort((a, b) => Date.parse(a.trace.started_at) - Date.parse(b.trace.started_at));
  const golden = runs.find((run) => run.trace.trace_id === group.golden_trace_id);

  const verdictCounts = { pass: 0, fail: 0, unknown: 0 };
  const statusCounts = { success: 0, failure: 0, unknown: 0 };
  let mismatch = 0;
  for (const run of runs) {
    const verdict = run.trace.evaluation?.verdict ?? 'unknown';
    const status = run.trace.status ?? 'unknown';
    if (verdict === 'pass') verdictCounts.pass += 1;
    else if (verdict === 'fail') verdictCounts.fail += 1;
    else verdictCounts.unknown += 1;
    if (status === 'success') statusCounts.success += 1;
    else if (status === 'failure') statusCounts.failure += 1;
    else statusCounts.unknown += 1;
    if ((verdict === 'pass' && status === 'failure') || (verdict === 'fail' && status === 'success')) mismatch += 1;
  }

  const decided = verdictCounts.pass + verdictCounts.fail;
  const passRate = decided > 0 ? verdictCounts.pass / decided : 0;
  const interval = wilsonInterval(verdictCounts.pass, decided);
  // normalized instability: 0 = consistent, 1 = coin-flip
  const flakinessScore = decided > 0 ? 2 * Math.min(passRate, 1 - passRate) : 0;
  const dataConfidence = runs.length > 0 ? 1 - 1 / Math.sqrt(runs.length) : 0;

  // flip rate over time-ordered runs (verdict transitions)
  const verdictSeries = runs.map((run) => run.trace.evaluation?.verdict ?? 'unknown').filter((v) => v !== 'unknown');
  let flips = 0;
  for (let index = 1; index < verdictSeries.length; index += 1) {
    if (verdictSeries[index] !== verdictSeries[index - 1]) flips += 1;
  }
  const flipRate = verdictSeries.length > 1 ? flips / (verdictSeries.length - 1) : 0;

  // comparisons vs golden
  const comparisons = golden
    ? runs
        .filter((run) => run.trace.trace_id !== golden.trace.trace_id)
        .map((run) => compareTraces(golden.trace, run.trace))
    : [];

  // step-level flakiness aggregation
  const stepMap = new Map<
    string,
    { aligned: number; divergent: number; presentRuns: Set<number>; types: Map<DivergenceType, number>; durations: number[] }
  >();
  comparisons.forEach((comparison, runIndex) => {
    const seenInRun = new Set<string>();
    for (const row of comparison.rows) {
      const key = baseKey(row.baseline_step_key ?? row.candidate_step_key);
      if (!key) continue;
      let entry = stepMap.get(key);
      if (!entry) {
        entry = { aligned: 0, divergent: 0, presentRuns: new Set(), types: new Map(), durations: [] };
        stepMap.set(key, entry);
      }
      if (row.baseline_span && row.candidate_span) {
        entry.aligned += 1;
        if (row.status !== 'same') {
          entry.divergent += 1;
          if (row.divergence_type) {
            entry.types.set(row.divergence_type, (entry.types.get(row.divergence_type) ?? 0) + 1);
          }
        }
        if (row.candidate_span.ended_at) {
          entry.durations.push(Date.parse(row.candidate_span.ended_at) - Date.parse(row.candidate_span.started_at));
        }
      }
      if (row.candidate_span) {
        seenInRun.add(key);
      }
    }
    for (const key of seenInRun) {
      stepMap.get(key)?.presentRuns.add(runIndex);
    }
  });

  const comparedRunCount = comparisons.length;
  const stepFlakiness: StepFlakiness[] = [...stepMap.entries()]
    .map(([key, entry]) => ({
      step_key: key,
      presence_rate: comparedRunCount > 0 ? entry.presentRuns.size / comparedRunCount : 0,
      divergence_rate: entry.aligned > 0 ? entry.divergent / entry.aligned : 0,
      divergent_run_count: entry.divergent,
      aligned_run_count: entry.aligned,
      top_divergence_types: [...entry.types.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
      duration_stats: distribution(entry.durations)
    }))
    .sort((a, b) => b.divergence_rate - a.divergence_rate || b.divergent_run_count - a.divergent_run_count);

  return {
    fingerprint: group.fingerprint,
    run_count: runs.length,
    verdict_counts: verdictCounts,
    status_counts: statusCounts,
    pass_rate: passRate,
    pass_rate_interval: interval,
    pass_k_curve: passKCurve(runs.length, verdictCounts.pass),
    verdict_status_mismatch_count: mismatch,
    flakiness_score: flakinessScore,
    data_confidence: dataConfidence,
    flip_rate: flipRate,
    is_flaky: verdictCounts.pass > 0 && verdictCounts.fail > 0,
    duration_stats: distribution(runs.map((run) => traceDurationMs(run.trace)).filter((v): v is number => v !== undefined)),
    cost_stats: distribution(runs.map((run) => traceCost(run.trace))) ?? { count: 0, mean: 0, min: 0, max: 0, stddev: 0 },
    step_flakiness: stepFlakiness,
    most_divergent_step_key: stepFlakiness.find((step) => step.divergence_rate > 0)?.step_key,
    comparisons_vs_golden: comparisons,
    evidence: {
      golden_trace_id: golden?.trace.trace_id,
      compared_pairs: comparisons.map((comparison) => ({
        baseline: comparison.baseline_trace_id,
        candidate: comparison.candidate_trace_id
      }))
    }
  };
}
