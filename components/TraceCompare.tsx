'use client';

import { useMemo, useState } from 'react';
import { compareTraces, type TraceComparison, type ComparisonRow, type ComparisonRowStatus } from '@/lib/compare';
import { IconBolt, IconChain, IconDiff, IconFlask } from './icons';
import { semanticDifferences, type FieldDifference } from '@/lib/compare/diff';
import { buildRegressionCandidate } from '@/lib/regression';
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

const roleLabels: Record<string, string> = {
  origin: 'origin — 첫 divergence',
  propagated: 'propagated — 값 전파',
  detected: 'detected — verification 감지',
  outcome: 'outcome — 최종 결과'
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

function spanDurationMs(span?: { started_at: string; ended_at?: string }): number | undefined {
  if (!span?.ended_at) return undefined;
  return Date.parse(span.ended_at) - Date.parse(span.started_at);
}

function MetricBar({ baseline, candidate, max }: { baseline: number; candidate: number; max: number }) {
  const scale = max > 0 ? max : 1;
  return (
    <div className="metric-bars" aria-hidden="true">
      <div className="metric-bar baseline" style={{ width: `${Math.max(2, (baseline / scale) * 100)}%` }} />
      <div className="metric-bar candidate" style={{ width: `${Math.max(2, (candidate / scale) * 100)}%` }} />
    </div>
  );
}

const SUBWAY_ROW_H = 30;

function shortStepLabel(key?: string): string {
  if (!key) return '';
  const base = key.split('#')[0];
  return base.length > 26 ? `${base.slice(0, 25)}…` : base;
}

function AlignmentMap({
  comparison,
  selectedRowId,
  onSelectRow
}: {
  comparison: TraceComparison;
  selectedRowId?: string;
  onSelectRow(rowId: string): void;
}) {
  const rows = comparison.rows;
  const laneUnits = rows.reduce(
    (max, row) => Math.max(max, (row.baseline_index ?? -1) + 1, (row.candidate_index ?? -1) + 1),
    1
  );
  const laneHeight = laneUnits * SUBWAY_ROW_H;

  return (
    <div className="alignment-map" aria-label="alignment subway map">
      <div className="alignment-head">
        <span className="alignment-lane-title">baseline</span>
        <span className="alignment-lane-mid" />
        <span className="alignment-lane-title right">candidate</span>
      </div>
      <div className="alignment-body" style={{ height: laneHeight }}>
        <div className="alignment-lane">
          {rows.map((row) =>
            row.baseline_index !== undefined ? (
              <button
                key={`b-${row.row_id}`}
                type="button"
                className={`alignment-node ${row.status} ${row.row_id === selectedRowId && row.status !== 'same' ? 'selected' : ''}`}
                style={{ top: row.baseline_index * SUBWAY_ROW_H + 4 }}
                title={row.baseline_step_key}
                onClick={() => row.status !== 'same' && onSelectRow(row.row_id)}
              >
                {row.row_id === comparison.first_divergence?.row_id ? <i className="alignment-zap">⚡</i> : null}
                {shortStepLabel(row.baseline_step_key)}
              </button>
            ) : null
          )}
        </div>
        <svg
          className="alignment-links"
          viewBox={`0 0 100 ${laneUnits}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {rows.map((row) => {
            if (row.baseline_index === undefined || row.candidate_index === undefined) return null;
            const y1 = row.baseline_index + 0.5;
            const y2 = row.candidate_index + 0.5;
            return (
              <path
                key={row.row_id}
                d={`M1,${y1} C35,${y1} 65,${y2} 99,${y2}`}
                className={`alignment-link ${row.status}`}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        <div className="alignment-lane right">
          {rows.map((row) =>
            row.candidate_index !== undefined ? (
              <button
                key={`c-${row.row_id}`}
                type="button"
                className={`alignment-node ${row.status} ${row.row_id === selectedRowId && row.status !== 'same' ? 'selected' : ''}`}
                style={{ top: row.candidate_index * SUBWAY_ROW_H + 4 }}
                title={row.candidate_step_key}
                onClick={() => row.status !== 'same' && onSelectRow(row.row_id)}
              >
                {row.row_id === comparison.first_divergence?.row_id ? <i className="alignment-zap">⚡</i> : null}
                {shortStepLabel(row.candidate_step_key)}
              </button>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  const serialized = JSON.stringify(value);
  if (!serialized) return String(value);
  return serialized.length > 80 ? `${serialized.slice(0, 80)}…` : serialized;
}

const kindLabels: Record<FieldDifference['kind'], string> = {
  value_changed: '변경',
  field_added: '추가됨',
  field_removed: '제거됨',
  array_item_added: '항목 추가',
  array_item_removed: '항목 제거',
  array_item_changed: '항목 변경'
};


function DivergenceRiver({
  comparison,
  candidate
}: {
  comparison: TraceComparison;
  candidate: { trace: { spans: Array<{ span_id: string; started_at: string; ended_at?: string; name: string; type: string }> } };
}) {
  const chain = comparison.propagation_chain;
  if (!chain || chain.nodes.length === 0) return null;

  const spans = candidate.trace.spans;
  if (spans.length === 0) return null;
  const start = Math.min(...spans.map((span) => Date.parse(span.started_at)));
  const end = Math.max(...spans.map((span) => Date.parse(span.ended_at ?? span.started_at)));
  const total = Math.max(1, end - start);
  const xOf = (ms: number) => ((ms - start) / total) * 100;

  const spanById = new Map(spans.map((span) => [span.span_id, span]));
  const chainPoints = chain.nodes
    .map((node, order) => {
      const span = spanById.get(node.span_id);
      if (!span) return undefined;
      const mid = Date.parse(span.started_at) + Math.max(1, Date.parse(span.ended_at ?? span.started_at) - Date.parse(span.started_at)) / 2;
      return { node, x: xOf(mid), order };
    })
    .filter((point): point is NonNullable<typeof point> => point !== undefined);

  const ROWS = 4;
  const yOfOrder = (order: number) => 14 + (order % ROWS) * 26;

  return (
    <div className="divergence-river" aria-label="divergence river">
      <div className="field-diff-head">
        <h3>divergence river</h3>
        <span>candidate 실행 시간축 위의 evidence 전파 경로</span>
      </div>
      <div className="river-canvas">
        <div className="river-waterfall" aria-hidden="true">
          {spans.map((span) => {
            const left = xOf(Date.parse(span.started_at));
            const width = Math.max(1, ((Date.parse(span.ended_at ?? span.started_at) - Date.parse(span.started_at)) / total) * 100);
            return (
              <div
                key={span.span_id}
                className="river-span-bar"
                style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                title={span.name}
              />
            );
          })}
        </div>
        <svg className="river-svg" viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true">
          {chainPoints.slice(0, -1).map((point, index) => {
            const next = chainPoints[index + 1];
            const y1 = yOfOrder(point.order);
            const y2 = yOfOrder(next.order);
            return (
              <path
                key={`flow-${index}`}
                d={`M${point.x},${y1} C${point.x + (next.x - point.x) * 0.4},${y1 + 14} ${next.x - (next.x - point.x) * 0.4},${y2 - 14} ${next.x},${y2}`}
                className="river-flow"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {chainPoints.map((point) => (
          <div
            key={`${point.node.span_id}-${point.node.role}`}
            className={`river-node ${point.node.role}`}
            style={{ left: `${point.x}%`, top: yOfOrder(point.order) }}
            title={`${point.node.step_label} — ${point.node.evidence}`}
          >
            <i className="river-node-dot" />
            <span className="river-node-label">{point.node.step_label}</span>
            {point.node.field_paths[0] ? <code className="river-node-field">{point.node.field_paths[0]}</code> : null}
          </div>
        ))}
      </div>
      <div className="river-footer">
        <span>0s</span>
        <span>{(total / 2000).toFixed(1)}s</span>
        <span>{(total / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}

export default function TraceCompare({
  sources,
  defaultBaselineKey,
  defaultCandidateKey,
  onInspectSpan
}: TraceCompareProps) {
  const [baselineKey, setBaselineKey] = useState(defaultBaselineKey);
  const [candidateKey, setCandidateKey] = useState(defaultCandidateKey);
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(undefined);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const baseline = sources.find((source) => source.key === baselineKey) ?? sources[0];
  const candidate = sources.find((source) => source.key === candidateKey) ?? sources[1] ?? sources[0];
  const comparison = useMemo(() => compareTraces(baseline.trace, candidate.trace), [baseline, candidate]);
  const changedCount = comparison.rows.filter((row) => row.status !== 'same').length;

  const selectedRow: ComparisonRow | undefined =
    comparison.rows.find((row) => row.row_id === selectedRowId && row.status !== 'same') ??
    comparison.rows.find((row) => row.row_id === comparison.first_divergence?.row_id);
  const selectedDiffs = selectedRow ? semanticDifferences(selectedRow.field_differences) : [];

  const durationRows = useMemo(() => {
    const rows = comparison.rows
      .map((row) => ({
        key: row.row_id,
        label: row.candidate_step_key ?? row.baseline_step_key ?? 'unknown',
        baselineMs: spanDurationMs(row.baseline_span),
        candidateMs: spanDurationMs(row.candidate_span),
        status: row.status
      }))
      .filter((row) => row.baselineMs !== undefined || row.candidateMs !== undefined);
    const maxMs = rows.reduce((max, row) => Math.max(max, row.baselineMs ?? 0, row.candidateMs ?? 0), 0);
    return { rows, maxMs };
  }, [comparison]);

  const regression = useMemo(
    () => buildRegressionCandidate(comparison, baseline.trace, candidate.trace),
    [comparison, baseline, candidate]
  );
  const regressionJson = useMemo(() => (regression ? JSON.stringify(regression, null, 2) : ''), [regression]);

  function spanButton(source: CompareSource, spanId?: string, label?: string) {
    if (!spanId || !label) return <span className="missing-step">—</span>;
    return (
      <button type="button" onClick={() => onInspectSpan(source.trace, source.label, spanId)} title={spanId}>
        {label}
      </button>
    );
  }

  async function copyRegression() {
    try {
      await navigator.clipboard.writeText(regressionJson);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  }

  function downloadRegression() {
    if (!regression) return;
    const blob = new Blob([regressionJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${regression.candidate_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="compare-panel panel" aria-label="Trace compare">
      <div className="panel-header">
        <h2><IconDiff size={15} /> Trace Compare</h2>
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
          <MetricBar
            baseline={comparison.baseline_metrics.duration_ms ?? 0}
            candidate={comparison.candidate_metrics.duration_ms ?? 0}
            max={Math.max(comparison.baseline_metrics.duration_ms ?? 0, comparison.candidate_metrics.duration_ms ?? 0)}
          />
        </div>
        <div>
          <span>cost</span>
          <strong>
            {formatCost(comparison.baseline_metrics.cost_usd)} → {formatCost(comparison.candidate_metrics.cost_usd)}
          </strong>
          <small>{formatSignedCost(comparison.metric_deltas.cost_usd)}</small>
          <MetricBar
            baseline={comparison.baseline_metrics.cost_usd}
            candidate={comparison.candidate_metrics.cost_usd}
            max={Math.max(comparison.baseline_metrics.cost_usd, comparison.candidate_metrics.cost_usd)}
          />
        </div>
        <div>
          <span>tool calls</span>
          <strong>
            {comparison.baseline_metrics.tool_call_count} → {comparison.candidate_metrics.tool_call_count}
          </strong>
          <small>{formatSignedCount(comparison.metric_deltas.tool_call_count)}</small>
          <MetricBar
            baseline={comparison.baseline_metrics.tool_call_count}
            candidate={comparison.candidate_metrics.tool_call_count}
            max={Math.max(comparison.baseline_metrics.tool_call_count, comparison.candidate_metrics.tool_call_count, 1)}
          />
        </div>
        <div>
          <span>errors</span>
          <strong>
            {comparison.baseline_metrics.error_span_count} → {comparison.candidate_metrics.error_span_count}
          </strong>
          <small>{formatSignedCount(comparison.metric_deltas.error_span_count)}</small>
          <MetricBar
            baseline={comparison.baseline_metrics.error_span_count}
            candidate={comparison.candidate_metrics.error_span_count}
            max={Math.max(comparison.baseline_metrics.error_span_count, comparison.candidate_metrics.error_span_count, 1)}
          />
        </div>
      </div>

      {comparison.first_divergence ? (
        <div className={`divergence-card ${comparison.first_divergence.status}`}>
          <span>
            <IconBolt size={13} /> first divergence · {comparison.first_divergence.type} · confidence {comparison.first_divergence.confidence}
          </span>
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

      {selectedDiffs.length > 0 ? (
        <div className="field-diff" aria-label="field diff viewer">
          <div className="field-diff-head">
            <h3><IconDiff size={13} /> field-level diff</h3>
            <span>
              {selectedRow?.baseline_step_key ?? selectedRow?.candidate_step_key} · semantic diff {selectedDiffs.length}건
            </span>
          </div>
          <div className="field-diff-table" role="table" aria-label="field differences">
            <div className="field-diff-row field-diff-header" role="row">
              <span>field path</span>
              <span>baseline</span>
              <span>candidate</span>
            </div>
            {selectedDiffs.slice(0, 12).map((difference) => (
              <div key={`${difference.path}-${difference.kind}`} className={`field-diff-row ${difference.kind}`} role="row">
                <div className="field-path">
                  <code>{difference.path}</code>
                  <small>{kindLabels[difference.kind]}</small>
                </div>
                <div className="field-value baseline">{formatValue(difference.baseline_value)}</div>
                <div className="field-value candidate">{formatValue(difference.candidate_value)}</div>
              </div>
            ))}
          </div>
          {selectedDiffs.length > 12 ? <p className="field-diff-more">외 {selectedDiffs.length - 12}개 필드 차이</p> : null}
        </div>
      ) : null}

      {comparison.propagation_chain ? (
        <div className="propagation-chain" aria-label="propagation chain">
          <div className="field-diff-head">
            <h3><IconChain size={13} /> propagation chain</h3>
            <span>confidence {comparison.propagation_chain.confidence}</span>
          </div>
          <ol>
            {comparison.propagation_chain.nodes.map((node) => (
              <li key={`${node.span_id}-${node.role}`} className={`chain-node ${node.role}`}>
                <div className="chain-node-head">
                  <strong>{node.step_label}</strong>
                  <span>{roleLabels[node.role] ?? node.role}</span>
                </div>
                <p>{node.evidence}</p>
                <div className="chain-node-foot">
                  {node.field_paths.slice(0, 3).map((path) => (
                    <code key={path}>{path}</code>
                  ))}
                  <button type="button" onClick={() => onInspectSpan(candidate.trace, candidate.label, node.span_id)} title={node.span_id}>
                    evidence 열기
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <DivergenceRiver comparison={comparison} candidate={candidate} />

      <AlignmentMap comparison={comparison} selectedRowId={selectedRow?.row_id} onSelectRow={setSelectedRowId} />

      <div className="compare-table" role="table" aria-label="step alignment">
        <div className="compare-row compare-head" role="row">
          <span>#</span>
          <span>baseline</span>
          <span>candidate</span>
          <span>status</span>
        </div>
        {comparison.rows.map((row, index) => (
          <div
            key={row.row_id}
            className={`compare-row ${row.status} ${row.row_id === selectedRow?.row_id && row.status !== 'same' ? 'selected' : ''}`}
            role="row"
            onClick={() => row.status !== 'same' && setSelectedRowId(row.row_id)}
          >
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

      {durationRows.rows.length > 0 ? (
        <div className="duration-chart" aria-label="step duration comparison">
          <div className="field-diff-head">
            <h3>step duration 비교</h3>
            <span>
              <i className="legend-dot baseline" /> baseline · <i className="legend-dot candidate" /> candidate
            </span>
          </div>
          <div className="duration-chart-rows">
            {durationRows.rows.slice(0, 12).map((row) => {
              const scale = durationRows.maxMs > 0 ? durationRows.maxMs : 1;
              const delta = (row.candidateMs ?? 0) - (row.baselineMs ?? 0);
              return (
                <div key={row.key} className={`duration-row ${row.status}`}>
                  <span className="duration-label" title={row.label}>
                    {row.label}
                  </span>
                  <div className="duration-bars">
                    <div className="duration-bar-line">
                      <div className="duration-bar baseline" style={{ width: `${Math.max(1.5, ((row.baselineMs ?? 0) / scale) * 100)}%` }} />
                      <small>{row.baselineMs !== undefined ? `${(row.baselineMs / 1000).toFixed(1)}s` : '—'}</small>
                    </div>
                    <div className="duration-bar-line">
                      <div className="duration-bar candidate" style={{ width: `${Math.max(1.5, ((row.candidateMs ?? 0) / scale) * 100)}%` }} />
                      <small>{row.candidateMs !== undefined ? `${(row.candidateMs / 1000).toFixed(1)}s` : '—'}</small>
                    </div>
                  </div>
                  <span className={`duration-delta ${delta > 500 ? 'worse' : delta < -500 ? 'better' : ''}`}>
                    {delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${(delta / 1000).toFixed(1)}s`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {regression ? (
        <div className="regression-export" aria-label="regression export">
          <div className="field-diff-head">
            <h3><IconFlask size={13} /> regression test 후보</h3>
            <span>
              confidence {regression.confidence} · evidence {regression.evidence_span_ids.length}개
            </span>
          </div>
          <p className="regression-title">{regression.title}</p>
          <div className="regression-gwt">
            <p>
              <strong>given</strong> {regression.given}
            </p>
            <p>
              <strong>when</strong> {regression.when}
            </p>
            <ul>
              {regression.then.map((item) => (
                <li key={item}>
                  <strong>then</strong> {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="regression-actions">
            <button type="button" onClick={copyRegression}>
              {copyState === 'copied' ? '복사됨 ✓' : copyState === 'failed' ? '복사 실패' : 'JSON 복사'}
            </button>
            <button type="button" onClick={downloadRegression}>
              JSON 다운로드
            </button>
          </div>
          <details className="regression-json">
            <summary>JSON 미리보기</summary>
            <pre>{regressionJson}</pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
