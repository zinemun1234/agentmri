'use client';

import { useMemo, type CSSProperties } from 'react';
import type { CanonicalTrace } from '@/lib/types';
import type { TraceComparison } from '@/lib/compare';
import { analyzeRunGroup, groupRunsByTask, selectGolden } from '@/lib/multirun';

interface MultiRunPanelProps {
  runs: CanonicalTrace[];
  title?: string;
}

function baseKey(stepKey?: string): string {
  return (stepKey ?? '').split('#')[0];
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function traceDurationMs(trace: CanonicalTrace): number | undefined {
  if (!trace.ended_at) return undefined;
  return Date.parse(trace.ended_at) - Date.parse(trace.started_at);
}

type CellStatus = 'golden' | 'same' | 'changed' | 'added' | 'removed' | 'missing';

const cellGlyphs: Record<CellStatus, string> = {
  golden: '◆',
  same: '✓',
  changed: '▲',
  added: '+',
  removed: '✗',
  missing: '—'
};

const cellTitles: Record<CellStatus, string> = {
  golden: 'golden 기준 run',
  same: 'golden과 동일',
  changed: 'golden과 값이 다름',
  added: 'golden에 없는 step',
  removed: 'candidate에서 사라짐',
  missing: '비교 불가'
};

export default function MultiRunPanel({ runs, title }: MultiRunPanelProps) {
  const analysis = useMemo(() => {
    const groups = groupRunsByTask(runs);
    const group = groups[0];
    if (!group) return undefined;
    const selection = selectGolden(group);
    group.golden_trace_id = selection.trace_id;
    if (selection.source !== 'none') {
      group.golden_source = selection.source === 'manual' ? 'manual' : 'auto';
    }
    group.golden_rationale = selection.rationale;
    const report = analyzeRunGroup(group);
    return { group, selection, report };
  }, [runs]);

  const matrix = useMemo(() => {
    if (!analysis) return undefined;
    const { report } = analysis;
    const comparisonByCandidate = new Map<string, TraceComparison>();
    report.comparisons_vs_golden.forEach((comparison, index) => {
      const candidateId = report.evidence.compared_pairs[index]?.candidate;
      if (candidateId) comparisonByCandidate.set(candidateId, comparison);
    });

    // step columns: golden baseline order first, then candidate-only steps
    const stepColumns: string[] = [];
    const seen = new Set<string>();
    for (const comparison of report.comparisons_vs_golden) {
      for (const row of comparison.rows) {
        const key = baseKey(row.baseline_step_key ?? row.candidate_step_key);
        if (key && !seen.has(key)) {
          seen.add(key);
          stepColumns.push(key);
        }
      }
    }

    const sortedRuns = [...analysis.group.runs].sort(
      (a, b) => Date.parse(a.trace.started_at) - Date.parse(b.trace.started_at)
    );

    const rows = sortedRuns.map((run) => {
      const isGolden = run.trace.trace_id === analysis.group.golden_trace_id;
      const comparison = comparisonByCandidate.get(run.trace.trace_id);
      const cells = new Map<string, CellStatus>();
      if (isGolden) {
        for (const column of stepColumns) cells.set(column, 'golden');
      } else if (comparison) {
        for (const column of stepColumns) {
          const row = comparison.rows.find((candidateRow) => baseKey(candidateRow.baseline_step_key ?? candidateRow.candidate_step_key) === column);
          if (!row) {
            cells.set(column, 'missing');
          } else if (!row.candidate_span) {
            cells.set(column, 'removed');
          } else if (!row.baseline_span) {
            cells.set(column, 'added');
          } else {
            cells.set(column, row.status === 'same' ? 'same' : 'changed');
          }
        }
      }
      return { run, isGolden, cells };
    });

    return { stepColumns, rows };
  }, [analysis]);

  if (!analysis || !matrix) return null;
  const { report, selection } = analysis;
  const intervalText = `${pct(report.pass_rate_interval.low)}~${pct(report.pass_rate_interval.high)}`;
  const flakyLabel = report.is_flaky ? 'flaky 감지' : report.verdict_counts.fail === 0 ? '일관됨' : '일관된 실패';
  const flakyTone = report.is_flaky ? 'flaky' : report.verdict_counts.fail === 0 ? 'stable' : 'failing';

  return (
    <section className="panel multirun-panel" aria-label="multi-run flakiness">
      <div className="panel-header">
        <h2>{title ?? 'Multi-run Flakiness'}</h2>
        <span>
          {report.run_count} runs · {report.fingerprint.hash}
        </span>
      </div>

      <div className="multirun-summary">
        <div className="multirun-stat">
          <span>pass rate</span>
          <strong>{pct(report.pass_rate)}</strong>
          <small>95% 구간 {intervalText}</small>
        </div>
        <div className={`multirun-stat tone-${flakyTone}`}>
          <span>flakiness</span>
          <strong>{report.flakiness_score.toFixed(2)}</strong>
          <small>{flakyLabel} · data confidence {report.data_confidence.toFixed(2)}</small>
        </div>
        <div className="multirun-stat">
          <span>pass^k (일관성)</span>
          <strong>{report.pass_k_curve.length > 0 ? pct(report.pass_k_curve[report.pass_k_curve.length - 1].pass_pow_k) : '—'}</strong>
          <small>
            {report.pass_k_curve.length > 0
              ? `k=${report.pass_k_curve[report.pass_k_curve.length - 1].k}회 연속 모두 성공할 확률 (무편향 추정)`
              : '실행 수 부족'}
          </small>
        </div>
        <div className="multirun-stat">
          <span>flip rate</span>
          <strong>{pct(report.flip_rate)}</strong>
          <small>연속 실행 간 verdict 전환율</small>
        </div>
        <div className="multirun-stat">
          <span>duration</span>
          <strong>{report.duration_stats ? formatMs(report.duration_stats.mean) : '-'}</strong>
          <small>
            {report.duration_stats
              ? `${formatMs(report.duration_stats.min)}~${formatMs(report.duration_stats.max)} · σ ${formatMs(report.duration_stats.stddev)}`
              : '측정 불가'}
          </small>
        </div>
        <div className="multirun-stat">
          <span>verdict 분포</span>
          <strong>
            {report.verdict_counts.pass}P / {report.verdict_counts.fail}F
            {report.verdict_counts.unknown > 0 ? ` / ${report.verdict_counts.unknown}?` : ''}
          </strong>
          <small>{report.verdict_status_mismatch_count > 0 ? `mismatch ${report.verdict_status_mismatch_count}건` : 'verdict-status 일치'}</small>
        </div>
      </div>

      <div className="flaky-matrix-wrap">
        <div className="flaky-matrix" role="table" aria-label="flaky step matrix" style={{ '--cols': matrix.stepColumns.length } as CSSProperties}>
          <div className="flaky-row flaky-head" role="row">
            <span className="flaky-run-label">run</span>
            {matrix.stepColumns.map((column) => {
              const stepStat = report.step_flakiness.find((step) => step.step_key === column);
              const hot = (stepStat?.divergence_rate ?? 0) > 0;
              return (
                <span key={column} className={`flaky-col-label ${hot ? 'hot' : ''}`} title={column}>
                  {column.replace(/^[^:]+:/, '')}
                </span>
              );
            })}
            <span className="flaky-verdict-label">verdict</span>
          </div>
          {matrix.rows.map(({ run, isGolden, cells }, rowIndex) => {
            const verdict = run.trace.evaluation?.verdict ?? 'unknown';
            const duration = traceDurationMs(run.trace);
            return (
              <div key={run.trace.trace_id} className={`flaky-row ${isGolden ? 'golden-row' : ''}`} role="row">
                <span className="flaky-run-label" title={run.trace.trace_id}>
                  {isGolden ? '◆ golden' : `run-${String(rowIndex + 1).padStart(2, '0')}`}
                  {duration !== undefined ? <small>{formatMs(duration)}</small> : null}
                </span>
                {matrix.stepColumns.map((column) => {
                  const status = cells.get(column) ?? 'missing';
                  return (
                    <span key={column} className={`flaky-cell ${status}`} title={`${column} — ${cellTitles[status]}`}>
                      {cellGlyphs[status]}
                    </span>
                  );
                })}
                <span className={`flaky-verdict ${verdict}`}>{verdict}</span>
              </div>
            );
          })}
          <div className="flaky-row flaky-instability" role="row">
            <span className="flaky-run-label">불안정율</span>
            {matrix.stepColumns.map((column) => {
              const stepStat = report.step_flakiness.find((step) => step.step_key === column);
              const rate = stepStat?.divergence_rate ?? 0;
              return (
                <span key={column} className={`flaky-cell rate ${rate >= 0.5 ? 'high' : rate > 0 ? 'mid' : ''}`}>
                  {rate > 0 ? pct(rate) : '·'}
                </span>
              );
            })}
            <span className="flaky-verdict" />
          </div>
        </div>
      </div>

      {report.most_divergent_step_key ? (
        <p className="multirun-finding">
          가장 자주 갈라지는 step: <code>{report.most_divergent_step_key}</code>
          {report.step_flakiness[0]?.top_divergence_types[0]
            ? ` · 주요 유형 ${report.step_flakiness[0].top_divergence_types[0].type}`
            : ''}
        </p>
      ) : (
        <p className="multirun-finding stable">모든 run이 golden과 semantic하게 동일합니다.</p>
      )}

      <details className="golden-rationale">
        <summary>
          golden: {analysis.group.golden_trace_id ?? '없음'} ({selection.source === 'auto' ? '자동 선정' : selection.source === 'manual' ? '수동 지정' : '선정 불가'})
        </summary>
        <ul>
          {selection.rationale.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
