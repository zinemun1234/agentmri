'use client';

import { useMemo, useState } from 'react';
import { compareTraces, type ComparisonRowStatus } from '@/lib/compare';
import type { CanonicalTrace } from '@/lib/types';

export interface CompareSource {
  key: string;
  label: string;
  trace: CanonicalTrace;
}

interface TraceCompareProps {
  sources: CompareSource[];
  defaultBaselineKey: string;
  defaultCandidateKey: string;
  onInspectSpan: (trace: CanonicalTrace, sourceLabel: string, spanId: string) => void;
}

const statusLabels: Record<ComparisonRowStatus, string> = {
  same: 'same',
  changed: 'changed',
  added: 'added',
  removed: 'removed'
};

function formatDuration(ms?: number): string {
  if (ms === undefined) return '-';
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSignedDuration(ms?: number): string {
  if (ms === undefined) return '-';
  const sign = ms > 0 ? '+' : '';
  return `${sign}${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatSignedCost(cost: number): string {
  const sign = cost > 0 ? '+' : '';
  return `${sign}$${cost.toFixed(4)}`;
}

function formatSignedCount(count: number): string {
  return count > 0 ? `+${count}` : `${count}`;
}

export default function TraceCompare({
  sources,
  defaultBaselineKey,
  defaultCandidateKey,
  onInspectSpan
}: TraceCompareProps) {
  const [baselineKey, setBaselineKey] = useState(defaultBaselineKey);
  const [candidateKey, setCandidateKey] = useState(defaultCandidateKey);
  const baseline = sources.find((source) => source.key === baselineKey) ?? sources[0];
  const candidate = sources.find((source) => source.key === candidateKey) ?? sources[1] ?? sources[0];
  const comparison = useMemo(() => compareTraces(baseline.trace, candidate.trace), [baseline, candidate]);
  const changedCount = comparison.rows.filter((row) => row.status !== 'same').length;

  function spanButton(source: CompareSource, spanId?: string, label?: string) {
    if (!spanId || !label) return <span className="missing-step">—</span>;
    return (
      <button type="button" onClick={() => onInspectSpan(source.trace, source.label, spanId)} title={spanId}>
        {label}
      </button>
    );
  }

  return (
    <section className="compare-panel panel" aria-label="Trace compare">
      <div className="panel-header">
        <h2>Trace Compare</h2>
        <span>{changedCount} divergent steps</span>
      </div>

      <div className="compare-controls">
        <label>
          baseline
          <select value={baselineKey} onChange={(event) => setBaselineKey(event.target.value)}>
            {sources.map((source) => (
              <option key={source.key} value={source.key}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          candidate
          <select value={candidateKey} onChange={(event) => setCandidateKey(event.target.value)}>
            {sources.map((source) => (
              <option key={source.key} value={source.key}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="compare-metrics" aria-label="comparison metrics">
        <div>
          <span>duration</span>
          <strong>
            {formatDuration(comparison.baseline_metrics.duration_ms)} → {formatDuration(comparison.candidate_metrics.duration_ms)}
          </strong>
          <small>{formatSignedDuration(comparison.metric_deltas.duration_ms)}</small>
        </div>
        <div>
          <span>cost</span>
          <strong>
            {formatCost(comparison.baseline_metrics.cost_usd)} → {formatCost(comparison.candidate_metrics.cost_usd)}
          </strong>
          <small>{formatSignedCost(comparison.metric_deltas.cost_usd)}</small>
        </div>
        <div>
          <span>tool calls</span>
          <strong>
            {comparison.baseline_metrics.tool_call_count} → {comparison.candidate_metrics.tool_call_count}
          </strong>
          <small>{formatSignedCount(comparison.metric_deltas.tool_call_count)}</small>
        </div>
        <div>
          <span>errors</span>
          <strong>
            {comparison.baseline_metrics.error_span_count} → {comparison.candidate_metrics.error_span_count}
          </strong>
          <small>{formatSignedCount(comparison.metric_deltas.error_span_count)}</small>
        </div>
      </div>

      {comparison.first_divergence ? (
        <div className={`divergence-card ${comparison.first_divergence.status}`}>
          <span>first divergence 후보</span>
          <strong>{comparison.first_divergence.summary}</strong>
          <div className="divergence-links">
            {spanButton(baseline, comparison.first_divergence.baseline_span_id, 'baseline step 열기')}
            {spanButton(candidate, comparison.first_divergence.candidate_span_id, 'candidate step 열기')}
          </div>
        </div>
      ) : (
        <div className="divergence-card same">
          <span>first divergence 후보</span>
          <strong>두 실행은 현재 비교 규칙 기준으로 divergence가 없습니다.</strong>
        </div>
      )}

      <div className="compare-table" role="table" aria-label="step alignment">
        <div className="compare-row compare-head" role="row">
          <span>#</span>
          <span>baseline</span>
          <span>candidate</span>
          <span>status</span>
        </div>
        {comparison.rows.map((row, index) => (
          <div key={row.row_id} className={`compare-row ${row.status}`} role="row">
            <span>{index + 1}</span>
            <div>{spanButton(baseline, row.baseline_span?.span_id, row.baseline_step_key)}</div>
            <div>{spanButton(candidate, row.candidate_span?.span_id, row.candidate_step_key)}</div>
            <div className="compare-status">
              <strong>{statusLabels[row.status]}</strong>
              {row.differences.length > 0 ? <small>{row.differences.join(', ')}</small> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
