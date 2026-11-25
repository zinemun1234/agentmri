import type { AuditedVerdict, VerdictAuditResult } from '@/lib/audit';
import { IconShield } from './icons';
import type { FailureCategory } from '@/lib/types';

interface AuditReportProps {
  audit: VerdictAuditResult;
  onSelectSpan(spanId: string): void;
}

const auditedVerdictLabels: Record<AuditedVerdict, string> = {
  true_pass: 'PASS 신뢰 가능',
  true_failure: 'FAIL 신뢰 가능',
  evaluator_false_negative_suspected: '채점기 오인 실패 의심',
  evaluator_false_positive_suspected: '채점기 오인 성공 의심',
  insufficient_evidence: '증거 부족'
};

const categoryLabels: Record<FailureCategory, string> = {
  planning_specification: '계획/명세 오류',
  execution_grounding: '실행/근거 오류',
  verification_feedback: '검증/피드백 오류',
  environment_integration: '환경/연동 오류',
  data_retrieval: '데이터/검색 오류',
  security_policy: '안전/정책 오류',
  cost_latency: '비용/지연 오류',
  evaluator_false_negative: '채점기 오인 실패',
  broken_task: '깨진 작업',
  insufficient_evidence: '증거 부족'
};

function verdictTone(auditedVerdict: AuditedVerdict): string {
  if (auditedVerdict === 'true_pass') return 'good';
  if (auditedVerdict === 'true_failure') return 'bad';
  if (auditedVerdict === 'insufficient_evidence') return 'neutral';
  return 'warning';
}

export default function AuditReport({ audit, onSelectSpan }: AuditReportProps) {
  const tone = verdictTone(audit.audited_verdict);

  return (
    <section className={`panel audit-report tone-${tone}`} aria-label="Verdict audit report">
      <div className="panel-header">
        <h2><IconShield size={15} /> Verdict Audit</h2>
        <span>evidence {audit.evidence_validation.evidence_count}개 확인</span>
      </div>

      <div className="audit-summary">
        <div className="audit-main-verdict">
          <span>감사 결과</span>
          <strong>{auditedVerdictLabels[audit.audited_verdict]}</strong>
          <code>{audit.audited_verdict}</code>
        </div>
        <div className="audit-metric">
          <span>원래 판정</span>
          <strong>{audit.original_verdict}</strong>
        </div>
        <div className="audit-metric">
          <span>원래 판정 신뢰도</span>
          <strong>{audit.verdict_reliability}</strong>
        </div>
        <div className="audit-metric">
          <span>감사 confidence</span>
          <strong>{audit.audit_confidence}</strong>
        </div>
        {audit.failure_category ? (
          <div className="audit-metric">
            <span>실패 분류</span>
            <strong>{categoryLabels[audit.failure_category]}</strong>
          </div>
        ) : null}
      </div>

      <div className="audit-body">
        <div className="audit-rationale">
          <h3>판단 근거</h3>
          <p>{audit.rationale}</p>
        </div>

        <details className="audit-signals">
          <summary>감사에 사용한 신호 보기</summary>
          <ul>
            {audit.signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </details>

        {audit.recommended_tests.length > 0 ? (
          <div className="audit-tests">
            <h3>추천 회귀 테스트</h3>
            <ol>
              {audit.recommended_tests.map((test) => (
                <li key={test}>{test}</li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="audit-evidence">
          <h3>Evidence</h3>
          {audit.evidence_span_ids.length === 0 ? (
            <p className="empty-state-inline">유효한 evidence span이 없습니다.</p>
          ) : (
            <div className="evidence-links">
              {audit.evidence_span_ids.map((spanId) => (
                <button key={spanId} type="button" onClick={() => onSelectSpan(spanId)}>
                  evidence: {spanId}
                </button>
              ))}
            </div>
          )}
          {audit.evidence_validation.missing_span_ids.length > 0 ? (
            <p className="missing-evidence">
              trace에 없는 evidence id: {audit.evidence_validation.missing_span_ids.join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
