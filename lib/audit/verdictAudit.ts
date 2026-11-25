import type { CanonicalTrace, FailureCategory, Finding } from '../types';
import { uniqueSpanIds, validateEvidenceReferences } from './evidenceValidator';
import type { AuditedVerdict, Confidence, VerdictAuditResult } from './types';

function isSerious(finding: Finding): boolean {
  return finding.severity === 'high' || finding.severity === 'critical';
}

function orderedSpans(trace: CanonicalTrace) {
  return [...trace.spans].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

function selectEvidence(trace: CanonicalTrace, findings: Finding[]): string[] {
  const ordered = orderedSpans(trace);
  const evidence: string[] = [];
  const add = (spanId?: string) => {
    if (spanId) evidence.push(spanId);
  };

  for (const span of ordered.filter((item) => item.type === 'verification').slice(0, 2)) {
    add(span.span_id);
  }
  for (const span of ordered.filter((item) => item.status === 'error').slice(0, 2)) {
    add(span.span_id);
  }
  for (const spanId of findings.filter(isSerious).flatMap((finding) => finding.evidence_span_ids).slice(0, 4)) {
    add(spanId);
  }

  add(ordered[ordered.length - 1]?.span_id);
  add(ordered.find((span) => !span.parent_span_id)?.span_id ?? ordered[0]?.span_id);

  return uniqueSpanIds(evidence).slice(0, 8);
}

function baseSignals(trace: CanonicalTrace, findings: Finding[]): string[] {
  const verificationCount = trace.spans.filter((span) => span.type === 'verification').length;
  const errorCount = trace.spans.filter((span) => span.status === 'error').length;
  const seriousCount = findings.filter(isSerious).length;

  return [
    `trace status: ${trace.status ?? 'unknown'}`,
    `original verdict: ${trace.evaluation?.verdict ?? 'unknown'}`,
    `verification spans: ${verificationCount}`,
    `error spans: ${errorCount}`,
    `serious findings: ${seriousCount}`
  ];
}

function buildResult(
  trace: CanonicalTrace,
  findings: Finding[],
  input: {
    audited_verdict: AuditedVerdict;
    verdict_reliability: Confidence;
    audit_confidence: Confidence;
    failure_category?: FailureCategory;
    rationale: string;
    extra_signals?: string[];
    recommended_tests?: string[];
  }
): VerdictAuditResult {
  const candidateEvidence = selectEvidence(trace, findings);
  const evidenceValidation = validateEvidenceReferences(trace, candidateEvidence);
  const evidenceSpanIds = evidenceValidation.valid_span_ids;
  const missingEvidenceNote =
    evidenceValidation.missing_span_ids.length > 0
      ? ` 일부 evidence id가 trace에 없습니다: ${evidenceValidation.missing_span_ids.join(', ')}.`
      : '';
  const noEvidenceNote =
    evidenceSpanIds.length === 0 ? ' 판단에 사용할 수 있는 유효한 evidence span이 없습니다.' : '';

  return {
    original_verdict: trace.evaluation?.verdict ?? 'unknown',
    audited_verdict: evidenceSpanIds.length === 0 ? 'insufficient_evidence' : input.audited_verdict,
    verdict_reliability: evidenceSpanIds.length === 0 ? 'low' : input.verdict_reliability,
    audit_confidence: evidenceSpanIds.length === 0 ? 'low' : input.audit_confidence,
    failure_category: input.failure_category,
    rationale: input.rationale + missingEvidenceNote + noEvidenceNote,
    signals: [...baseSignals(trace, findings), ...(input.extra_signals ?? [])],
    evidence_span_ids: evidenceSpanIds,
    evidence_validation: evidenceValidation,
    recommended_tests: input.recommended_tests ?? []
  };
}

export function auditVerdict(trace: CanonicalTrace, findings: Finding[]): VerdictAuditResult {
  const originalVerdict = trace.evaluation?.verdict ?? 'unknown';
  const verificationCount = trace.spans.filter((span) => span.type === 'verification').length;
  const errorCount = trace.spans.filter((span) => span.status === 'error').length;
  const seriousFindings = findings.filter(isSerious);
  const firstSeriousCategory = seriousFindings[0]?.category;

  if (!trace.evaluation || originalVerdict === 'unknown') {
    return buildResult(trace, findings, {
      audited_verdict: 'insufficient_evidence',
      verdict_reliability: 'low',
      audit_confidence: 'high',
      failure_category: 'insufficient_evidence',
      rationale:
        '원래 evaluation verdict가 없거나 unknown이라 판정 신뢰도를 비교할 수 없습니다. trace만으로 결론을 내리지 않고 추가 평가 정보가 필요합니다.',
      recommended_tests: ['평가기가 verdict, score, evaluator_comment를 남기도록 evaluation 출력을 고정합니다.']
    });
  }

  if (originalVerdict === 'pass') {
    if (trace.status === 'failure' || seriousFindings.length > 0 || errorCount > 0) {
      return buildResult(trace, findings, {
        audited_verdict: 'evaluator_false_positive_suspected',
        verdict_reliability: 'low',
        audit_confidence: seriousFindings.length > 0 ? 'high' : 'medium',
        failure_category: firstSeriousCategory ?? 'verification_feedback',
        rationale:
          '원래 평가는 PASS지만 trace 상태나 detector evidence는 실패 위험을 가리킵니다. PASS 판정이 실제 품질 문제를 놓쳤을 가능성이 있습니다.',
        recommended_tests: [
          'PASS로 판정된 사례에 대해서도 high/critical detector finding이 없는지 CI에서 검사합니다.',
          '외부 상태 변경 후 verification span이 존재하는지 regression test에 포함합니다.'
        ]
      });
    }

    return buildResult(trace, findings, {
      audited_verdict: 'true_pass',
      verdict_reliability: verificationCount > 0 ? 'high' : 'medium',
      audit_confidence: verificationCount > 0 ? 'high' : 'medium',
      rationale:
        verificationCount > 0
          ? '원래 PASS 판정, 성공 상태, verification evidence가 서로 일치합니다. 현재 evidence 기준으로는 PASS를 신뢰할 수 있습니다.'
          : '원래 PASS 판정과 성공 상태는 일치하지만 verification span이 없어 완전히 높은 신뢰도로 보기는 어렵습니다.',
      recommended_tests:
        verificationCount > 0
          ? ['현재 성공 사례를 golden trace로 유지하고 프롬프트/모델 변경 시 회귀 비교합니다.']
          : ['성공 조건을 확인하는 verification step을 추가해 PASS evidence를 강화합니다.']
    });
  }

  if (trace.status === 'success' && findings.length === 0 && errorCount === 0) {
    return buildResult(trace, findings, {
      audited_verdict: 'evaluator_false_negative_suspected',
      verdict_reliability: 'low',
      audit_confidence: verificationCount > 0 ? 'high' : 'medium',
      failure_category: 'evaluator_false_negative',
      rationale:
        '원래 평가는 FAIL이지만 trace는 성공으로 끝났고 detector도 위험 신호를 찾지 못했습니다. 평가기가 요구하는 표면적 조건과 실제 성공 상태가 다를 가능성이 있습니다.',
      extra_signals: ['verdict/status mismatch: fail vs success'],
      recommended_tests: [
        'evaluator가 특정 selector나 문자열에만 의존하지 않고 최종 상태를 검사하는지 확인합니다.',
        '이 사례를 evaluator regression set에 추가해 false negative가 다시 발생하는지 추적합니다.'
      ]
    });
  }

  if (trace.status === 'failure' || seriousFindings.length > 0 || errorCount > 0) {
    return buildResult(trace, findings, {
      audited_verdict: 'true_failure',
      verdict_reliability: seriousFindings.length > 0 || errorCount > 0 ? 'high' : 'medium',
      audit_confidence: seriousFindings.length > 0 || errorCount > 0 ? 'high' : 'medium',
      failure_category: firstSeriousCategory ?? findings[0]?.category ?? 'verification_feedback',
      rationale:
        '원래 FAIL 판정과 trace evidence가 대체로 일치합니다. 실패 원인은 finding evidence와 오류 span을 중심으로 확인해야 합니다.',
      recommended_tests: [
        '가장 먼저 발생한 high severity finding을 최소 재현 테스트로 변환합니다.',
        '같은 실패가 수정 후 사라졌는지 성공/실패 trace 비교로 확인합니다.'
      ]
    });
  }

  return buildResult(trace, findings, {
    audited_verdict: 'insufficient_evidence',
    verdict_reliability: 'low',
    audit_confidence: 'medium',
    failure_category: 'insufficient_evidence',
    rationale:
      'FAIL 판정과 trace 상태가 엇갈리지만 detector evidence만으로 어느 쪽이 맞는지 확정하기 어렵습니다. 사람 검토 또는 추가 trace가 필요합니다.',
    recommended_tests: ['동일 task를 여러 번 실행해 flaky failure인지 evaluator 문제인지 구분합니다.']
  });
}
