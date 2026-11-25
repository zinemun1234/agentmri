import type { Finding } from '@/lib/types';

interface FindingsPanelProps {
  findings: Finding[];
  onSelectSpan(spanId: string): void;
}

export default function FindingsPanel({ findings, onSelectSpan }: FindingsPanelProps) {
  return (
    <section className="panel findings-panel" aria-label="Findings">
      <div className="panel-header">
        <h2>Findings</h2>
        <span>{findings.length}건</span>
      </div>
      <div className="findings-scroll">
        {findings.length === 0 ? (
          <p className="empty-state">현재 detector가 발견한 위험 신호가 없습니다.</p>
        ) : (
          findings.map((finding) => (
            <article key={finding.finding_id} className={`finding-card severity-${finding.severity}`}>
              <div className="finding-topline">
                <span className="severity-pill">{finding.severity}</span>
                <span className="confidence-pill">confidence {finding.confidence}</span>
              </div>
              <h3>{finding.title}</h3>
              <p>{finding.description}</p>
              {finding.recommended_test ? (
                <div className="recommended-test">
                  <strong>추천 테스트</strong>
                  <span>{finding.recommended_test}</span>
                </div>
              ) : null}
              <div className="evidence-links">
                {finding.evidence_span_ids.map((spanId) => (
                  <button key={spanId} type="button" onClick={() => onSelectSpan(spanId)}>
                    evidence: {spanId}
                  </button>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
