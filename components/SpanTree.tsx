import type { CanonicalSpan, CanonicalTrace, Finding } from '@/lib/types';

interface SpanTreeProps {
  trace: CanonicalTrace;
  selectedSpanId?: string;
  findings: Finding[];
  onSelect(spanId: string): void;
}

function sortSpans(spans: CanonicalSpan[]): CanonicalSpan[] {
  return [...spans].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

export default function SpanTree({ trace, selectedSpanId, findings, onSelect }: SpanTreeProps) {
  const childrenByParent = new Map<string, CanonicalSpan[]>();
  const spanIds = new Set(trace.spans.map((span) => span.span_id));

  for (const span of trace.spans) {
    const parent = span.parent_span_id && spanIds.has(span.parent_span_id) ? span.parent_span_id : '__root__';
    const children = childrenByParent.get(parent) ?? [];
    children.push(span);
    childrenByParent.set(parent, children);
  }

  const findingCountBySpan = new Map<string, number>();
  for (const finding of findings) {
    for (const spanId of finding.evidence_span_ids) {
      findingCountBySpan.set(spanId, (findingCountBySpan.get(spanId) ?? 0) + 1);
    }
  }

  function renderNode(span: CanonicalSpan, depth: number) {
    const children = sortSpans(childrenByParent.get(span.span_id) ?? []);
    const findingCount = findingCountBySpan.get(span.span_id) ?? 0;
    const isSelected = selectedSpanId === span.span_id;

    return (
      <div key={span.span_id}>
        <button
          className={`span-node ${isSelected ? 'selected' : ''} status-${span.status ?? 'unknown'}`}
          style={{ paddingLeft: `${10 + depth * 18}px` }}
          onClick={() => onSelect(span.span_id)}
          type="button"
        >
          <span className={`type-dot type-${span.type}`} />
          <span className="span-name">{span.name}</span>
          {findingCount > 0 ? <span className="finding-badge">{findingCount}</span> : null}
        </button>
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = sortSpans(childrenByParent.get('__root__') ?? []);

  return (
    <section className="panel tree-panel" aria-label="Span tree">
      <div className="panel-header">
        <h2>Span Tree</h2>
        <span>{trace.spans.length} spans</span>
      </div>
      <div className="tree-scroll">{roots.map((span) => renderNode(span, 0))}</div>
    </section>
  );
}
