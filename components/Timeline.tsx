import type { CSSProperties } from 'react';
import type { CanonicalSpan, CanonicalTrace } from '@/lib/types';

interface TimelineProps {
  trace: CanonicalTrace;
  selectedSpanId?: string;
  evidenceSpanIds?: string[];
  onSelect(spanId: string): void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTick(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

interface WaterfallRow {
  span: CanonicalSpan;
  depth: number;
}

function buildRows(trace: CanonicalTrace): WaterfallRow[] {
  const byParent = new Map<string | undefined, CanonicalSpan[]>();
  for (const span of trace.spans) {
    const list = byParent.get(span.parent_span_id) ?? [];
    list.push(span);
    byParent.set(span.parent_span_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  }

  const rows: WaterfallRow[] = [];
  const seen = new Set<string>();
  const visit = (span: CanonicalSpan, depth: number) => {
    if (seen.has(span.span_id)) return;
    seen.add(span.span_id);
    rows.push({ span, depth });
    for (const child of byParent.get(span.span_id) ?? []) {
      visit(child, depth + 1);
    }
  };

  const roots = byParent.get(undefined) ?? [];
  const rootIds = new Set(roots.map((span) => span.span_id));
  for (const root of roots) visit(root, 0);

  // orphan spans (parent referenced but missing) — attach at depth 0, start-time order
  const orphans = trace.spans
    .filter((span) => !seen.has(span.span_id) && !rootIds.has(span.span_id))
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  for (const orphan of orphans) visit(orphan, 0);

  return rows;
}

const TICK_COUNT = 4;

export default function Timeline({ trace, selectedSpanId, evidenceSpanIds, onSelect }: TimelineProps) {
  const rows = buildRows(trace);

  if (rows.length === 0) {
    return (
      <section className="panel timeline-panel" aria-label="Timeline">
        <div className="panel-header">
          <h2>Timeline</h2>
        </div>
        <div className="timeline-empty">span 데이터가 없습니다</div>
      </section>
    );
  }

  const spans = rows.map((row) => row.span);
  const start = Math.min(...spans.map((span) => Date.parse(span.started_at)));
  const end = Math.max(...spans.map((span) => Date.parse(span.ended_at ?? span.started_at)));
  const total = Math.max(1, end - start);
  const evidenceSet = new Set(evidenceSpanIds ?? []);

  const xOf = (ms: number) => ((ms - start) / total) * 100;

  // cost burnup: stepwise cumulative cost at each span end
  const costEvents = spans
    .filter((span) => span.usage?.cost_usd && span.ended_at)
    .map((span) => ({ x: xOf(Date.parse(span.ended_at!)), cost: span.usage!.cost_usd! }))
    .sort((a, b) => a.x - b.x);
  const totalCost = costEvents.reduce((sum, event) => sum + event.cost, 0);
  let cumulative = 0;
  const burnupPoints: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (const event of costEvents) {
    burnupPoints.push({ x: event.x, y: cumulative });
    cumulative += event.cost;
    burnupPoints.push({ x: event.x, y: cumulative });
  }
  burnupPoints.push({ x: 100, y: cumulative });
  const burnupPath = burnupPoints
    .map((point, index) => {
      const y = totalCost > 0 ? 34 - (point.y / totalCost) * 30 : 34;
      return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, index) => ({
    ratio: index / TICK_COUNT,
    label: formatTick((total / TICK_COUNT) * index)
  }));

  return (
    <section className="panel timeline-panel" aria-label="Timeline">
      <div className="panel-header">
        <h2>Timeline</h2>
        <span>{formatDuration(total)}{totalCost > 0 ? ` · $${totalCost.toFixed(4)}` : ''}</span>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-ruler" aria-hidden="true">
          <span className="timeline-label" />
          <span className="timeline-track ruler-track">
            {ticks.map((tick) => (
              <span
                key={tick.ratio}
                className={`ruler-tick ${tick.ratio === 0 ? 'first' : tick.ratio === 1 ? 'last' : ''}`}
                style={{ left: `${tick.ratio * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
          </span>
          <span className="timeline-duration" />
        </div>
        {rows.map(({ span, depth }) => {
          const spanStart = Date.parse(span.started_at);
          const spanEnd = Date.parse(span.ended_at ?? span.started_at);
          const left = xOf(spanStart);
          const width = Math.max(1.5, ((Math.max(1, spanEnd - spanStart)) / total) * 100);
          const style = {
            '--left': `${left}%`,
            '--width': `${Math.min(width, 100 - left)}%`
          } as CSSProperties;
          const isVerification = span.type === 'verification';
          const isError = span.status === 'error' || Boolean(span.error);
          const isEvidence = evidenceSet.has(span.span_id);

          return (
            <button
              key={span.span_id}
              type="button"
              className={`timeline-row ${selectedSpanId === span.span_id ? 'selected' : ''}`}
              onClick={() => onSelect(span.span_id)}
            >
              <span className="timeline-label" title={span.name} style={{ paddingLeft: `${depth * 14 + 8}px` }}>
                {isVerification ? <i className="wf-marker verify" aria-label="verification">⚑</i> : null}
                {isError ? <i className="wf-marker error" aria-label="error">✗</i> : null}
                {span.name}
                {isEvidence ? <i className="wf-evidence-dot" title="evidence span" /> : null}
              </span>
              <span className="timeline-track">
                <span
                  className={`timeline-bar type-${span.type} status-${span.status ?? 'unknown'} ${isError ? 'hatch' : ''}`}
                  style={style}
                />
              </span>
              <span className="timeline-duration">{formatDuration(spanEnd - spanStart)}</span>
            </button>
          );
        })}
        {totalCost > 0 ? (
          <div className="timeline-burnup" aria-label="누적 비용">
            <span className="timeline-label burnup-label">누적 비용</span>
            <span className="timeline-track burnup-track">
              <svg viewBox="0 0 100 38" preserveAspectRatio="none" className="burnup-svg">
                <path d={burnupPath} className="burnup-line" />
                <path d={`${burnupPath} L100,38 L0,38 Z`} className="burnup-fill" />
              </svg>
            </span>
            <span className="timeline-duration">${totalCost.toFixed(4)}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
