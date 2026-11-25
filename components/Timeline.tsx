import type { CSSProperties } from 'react';
import type { CanonicalTrace } from '@/lib/types';

interface TimelineProps {
  trace: CanonicalTrace;
  selectedSpanId?: string;
  onSelect(spanId: string): void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function Timeline({ trace, selectedSpanId, onSelect }: TimelineProps) {
  const spans = [...trace.spans].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  const start = Math.min(...spans.map((span) => Date.parse(span.started_at)));
  const end = Math.max(...spans.map((span) => Date.parse(span.ended_at ?? span.started_at)));
  const total = Math.max(1, end - start);

  return (
    <section className="panel timeline-panel" aria-label="Timeline">
      <div className="panel-header">
        <h2>Timeline</h2>
        <span>{formatDuration(total)}</span>
      </div>
      <div className="timeline-scroll">
        {spans.map((span) => {
          const spanStart = Date.parse(span.started_at);
          const spanEnd = Date.parse(span.ended_at ?? span.started_at);
          const left = ((spanStart - start) / total) * 100;
          const width = Math.max(1.5, ((Math.max(1, spanEnd - spanStart)) / total) * 100);
          const style = {
            '--left': `${left}%`,
            '--width': `${Math.min(width, 100 - left)}%`
          } as CSSProperties;

          return (
            <button
              key={span.span_id}
              type="button"
              className={`timeline-row ${selectedSpanId === span.span_id ? 'selected' : ''}`}
              onClick={() => onSelect(span.span_id)}
            >
              <span className="timeline-label" title={span.name}>
                {span.name}
              </span>
              <span className="timeline-track">
                <span className={`timeline-bar type-${span.type} status-${span.status ?? 'unknown'}`} style={style} />
              </span>
              <span className="timeline-duration">{formatDuration(spanEnd - spanStart)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
