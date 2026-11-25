import type { CanonicalSpan } from '@/lib/types';

interface SpanDetailProps {
  span?: CanonicalSpan;
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <div className="json-block">
      <h3>{title}</h3>
      <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function formatKstTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '-';
  const kstTimestamp = timestamp + 9 * 60 * 60 * 1000;
  return `${new Date(kstTimestamp).toISOString().slice(11, 19)} KST`;
}

export default function SpanDetail({ span }: SpanDetailProps) {
  if (!span) {
    return (
      <section className="panel detail-panel">
        <div className="panel-header">
          <h2>Span Detail</h2>
        </div>
        <p className="empty-state">span을 선택하면 input, output, error, 비용 정보가 표시됩니다.</p>
      </section>
    );
  }

  return (
    <section className="panel detail-panel" aria-label="Span detail">
      <div className="panel-header">
        <h2>Span Detail</h2>
        <span className={`status-pill status-${span.status ?? 'unknown'}`}>{span.status ?? 'unknown'}</span>
      </div>
      <div className="detail-scroll">
        <div className="detail-title">
          <strong>{span.name}</strong>
          <code>{span.span_id}</code>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>type</dt>
            <dd>{span.type}</dd>
          </div>
          <div>
            <dt>started</dt>
            <dd>{formatKstTime(span.started_at)}</dd>
          </div>
          <div>
            <dt>ended</dt>
            <dd>{span.ended_at ? formatKstTime(span.ended_at) : '-'}</dd>
          </div>
          <div>
            <dt>cost</dt>
            <dd>{span.usage?.cost_usd !== undefined ? `$${span.usage.cost_usd.toFixed(4)}` : '-'}</dd>
          </div>
        </dl>
        {span.error ? (
          <div className="error-box">
            <strong>{span.error.type ?? 'error'}</strong>
            <span>{span.error.message ?? '오류 메시지 없음'}</span>
          </div>
        ) : null}
        <JsonBlock title="input" value={span.input} />
        <JsonBlock title="output" value={span.output} />
        <JsonBlock title="attributes" value={span.attributes} />
      </div>
    </section>
  );
}
