import type { CanonicalTrace } from '../types';
import type { TraceComparison, DivergenceType } from '../compare';

export interface TaskFingerprint {
  hash: string;
  instruction_preview: string;
}

export interface RunRef {
  trace: CanonicalTrace;
  source_label?: string;
}

export interface RunGroup {
  fingerprint: TaskFingerprint;
  runs: RunRef[];
  golden_trace_id?: string;
  golden_source: 'manual' | 'auto' | 'none';
  golden_rationale?: string[];
}

export interface DistributionStats {
  count: number;
  mean: number;
  min: number;
  max: number;
  stddev: number;
}

export interface StepFlakiness {
  step_key: string;
  presence_rate: number;
  divergence_rate: number;
  divergent_run_count: number;
  aligned_run_count: number;
  top_divergence_types: Array<{ type: DivergenceType; count: number }>;
  duration_stats?: DistributionStats;
}

export interface GroupFlakinessReport {
  fingerprint: TaskFingerprint;
  run_count: number;
  verdict_counts: { pass: number; fail: number; unknown: number };
  status_counts: { success: number; failure: number; unknown: number };
  pass_rate: number;
  pass_rate_interval: { low: number; high: number };
  verdict_status_mismatch_count: number;
  flakiness_score: number;
  data_confidence: number;
  flip_rate: number;
  is_flaky: boolean;
  duration_stats?: DistributionStats;
  cost_stats: DistributionStats;
  step_flakiness: StepFlakiness[];
  most_divergent_step_key?: string;
  comparisons_vs_golden: TraceComparison[];
  evidence: {
    golden_trace_id?: string;
    compared_pairs: Array<{ baseline: string; candidate: string }>;
  };
}
