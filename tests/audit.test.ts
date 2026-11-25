import { describe, expect, it } from 'vitest';
import wrongTimeJson from '../fixtures/calendar-failure-wrong-time.json';
import costSpikeJson from '../fixtures/cost-spike.json';
import evaluatorFalseNegativeJson from '../fixtures/evaluator-false-negative.json';
import repeatedLoopJson from '../fixtures/repeated-tool-loop.json';
import retrievalWithoutEvidenceJson from '../fixtures/retrieval-without-evidence.json';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import unverifiedExternalActionJson from '../fixtures/unverified-external-action.json';
import { auditVerdict, validateEvidenceReferences, validateFindingsEvidence } from '../lib/audit';
import { runDetectors } from '../lib/detectors';
import type { CanonicalTrace } from '../lib/types';

const successfulTrace = successfulCalendarJson as unknown as CanonicalTrace;
const repeatedLoopTrace = repeatedLoopJson as unknown as CanonicalTrace;
const evaluatorFalseNegativeTrace = evaluatorFalseNegativeJson as unknown as CanonicalTrace;
const costSpikeTrace = costSpikeJson as unknown as CanonicalTrace;
const wrongTimeTrace = wrongTimeJson as unknown as CanonicalTrace;
const unverifiedExternalActionTrace = unverifiedExternalActionJson as unknown as CanonicalTrace;
const retrievalWithoutEvidenceTrace = retrievalWithoutEvidenceJson as unknown as CanonicalTrace;

describe('auditVerdict', () => {
  it('정상 PASS 실행을 true_pass로 판정한다', () => {
    const findings = runDetectors(successfulTrace);
    const audit = auditVerdict(successfulTrace, findings);

    expect(audit.audited_verdict).toBe('true_pass');
    expect(audit.verdict_reliability).toBe('high');
    expect(audit.audit_confidence).toBe('high');
    expect(audit.evidence_span_ids).toContain('verify-calendar-1');
    expect(audit.evidence_validation.ok).toBe(true);
  });

  it('반복 루프 실패를 true_failure로 판정한다', () => {
    const findings = runDetectors(repeatedLoopTrace);
    const audit = auditVerdict(repeatedLoopTrace, findings);

    expect(audit.audited_verdict).toBe('true_failure');
    expect(audit.verdict_reliability).toBe('high');
    expect(audit.failure_category).toBe('cost_latency');
    expect(audit.recommended_tests.length).toBeGreaterThan(0);
    expect(audit.evidence_validation.ok).toBe(true);
  });

  it('성공 실행의 FAIL 판정을 evaluator false negative 의심으로 재분류한다', () => {
    const findings = runDetectors(evaluatorFalseNegativeTrace);
    const audit = auditVerdict(evaluatorFalseNegativeTrace, findings);

    expect(audit.original_verdict).toBe('fail');
    expect(audit.audited_verdict).toBe('evaluator_false_negative_suspected');
    expect(audit.verdict_reliability).toBe('low');
    expect(audit.audit_confidence).toBe('high');
    expect(audit.failure_category).toBe('evaluator_false_negative');
    expect(audit.evidence_span_ids).toContain('verify-file-1');
  });



  it('비용 급증만 있는 PASS는 false positive가 아니라 true_pass로 유지한다', () => {
    const findings = runDetectors(costSpikeTrace);
    const audit = auditVerdict(costSpikeTrace, findings);

    expect(findings.some((finding) => finding.detector_id === 'D06')).toBe(true);
    expect(audit.audited_verdict).toBe('true_pass');
    expect(audit.verdict_reliability).toBe('high');
  });

  it('검증 없는 외부 행동이 있는 PASS는 false positive 의심으로 재분류한다', () => {
    const findings = runDetectors(unverifiedExternalActionTrace);
    const audit = auditVerdict(unverifiedExternalActionTrace, findings);

    expect(audit.audited_verdict).toBe('evaluator_false_positive_suspected');
    expect(audit.failure_category).toBe('security_policy');
    expect(audit.verdict_reliability).toBe('low');
  });

  it('근거 없는 사실 주장이 있는 PASS는 false positive 의심으로 재분류한다', () => {
    const findings = runDetectors(retrievalWithoutEvidenceTrace);
    const audit = auditVerdict(retrievalWithoutEvidenceTrace, findings);

    expect(audit.audited_verdict).toBe('evaluator_false_positive_suspected');
    expect(audit.failure_category).toBe('data_retrieval');
    expect(audit.verdict_reliability).toBe('low');
  });

  it('잘못된 회의 시간 paired failure는 true_failure로 판정한다', () => {
    const findings = runDetectors(wrongTimeTrace);
    const audit = auditVerdict(wrongTimeTrace, findings);

    expect(audit.audited_verdict).toBe('true_failure');
    expect(audit.verdict_reliability).toBe('high');
    expect(audit.evidence_span_ids).toContain('verify-calendar-1');
  });

  it('evaluation이 없으면 insufficient_evidence를 반환한다', () => {
    const trace = JSON.parse(JSON.stringify(successfulTrace)) as CanonicalTrace;
    delete trace.evaluation;

    const audit = auditVerdict(trace, []);
    expect(audit.audited_verdict).toBe('insufficient_evidence');
    expect(audit.verdict_reliability).toBe('low');
    expect(audit.failure_category).toBe('insufficient_evidence');
  });
});

describe('evidence validation', () => {
  it('존재하는 evidence span을 유효하다고 판정한다', () => {
    const result = validateEvidenceReferences(successfulTrace, ['root', 'verify-calendar-1']);
    expect(result.ok).toBe(true);
    expect(result.valid_span_ids).toEqual(['root', 'verify-calendar-1']);
    expect(result.missing_span_ids).toEqual([]);
  });

  it('존재하지 않는 evidence span을 탐지한다', () => {
    const result = validateEvidenceReferences(successfulTrace, ['root', 'missing-span']);
    expect(result.ok).toBe(false);
    expect(result.valid_span_ids).toEqual(['root']);
    expect(result.missing_span_ids).toEqual(['missing-span']);
  });

  it('detector finding의 evidence reference를 검증한다', () => {
    const findings = runDetectors(repeatedLoopTrace);
    const result = validateFindingsEvidence(repeatedLoopTrace, findings);

    expect(result.ok).toBe(true);
    expect(result.total_findings).toBe(findings.length);
    expect(result.findings_with_valid_evidence).toBe(findings.length);
    expect(result.missing_span_ids).toEqual([]);
  });
});

describe('compare-aware audit (Phase D)', () => {
  it('wrong-time true failure는 비교 divergence 확인으로 confidence high가 된다', async () => {
    const { compareTraces } = await import('../lib/compare');
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const findings = runDetectors(wrongTimeTrace);
    const audit = auditVerdict(wrongTimeTrace, findings, { comparison });

    expect(audit.audited_verdict).toBe('true_failure');
    expect(audit.audit_confidence).toBe('high');
    expect(audit.rationale).toContain('semantic divergence');
    expect(audit.signals.some((signal) => signal.startsWith('compare:'))).toBe(true);
    expect(audit.evidence_validation.ok).toBe(true);
  });

  it('FAIL인데 golden과 divergence가 없으면 false negative confidence가 high가 된다', async () => {
    const { compareTraces } = await import('../lib/compare');
    const clone = JSON.parse(JSON.stringify(successfulCalendarJson)) as CanonicalTrace;
    clone.trace_id = 'clone-fail-verdict';
    clone.evaluation = { ...clone.evaluation, verdict: 'fail' } as CanonicalTrace['evaluation'];
    const comparison = compareTraces(successfulTrace, clone);
    const findings = runDetectors(clone);
    const audit = auditVerdict(clone, findings, { comparison });

    expect(comparison.rows.every((row) => row.status === 'same')).toBe(true);
    expect(audit.audited_verdict).toBe('evaluator_false_negative_suspected');
    expect(audit.audit_confidence).toBe('high');
    expect(audit.rationale).toContain('golden');
  });

  it('PASS인데 baseline verification이 사라졌으면 false positive로 재분류한다', async () => {
    const { compareTraces } = await import('../lib/compare');
    const clone = JSON.parse(JSON.stringify(successfulCalendarJson)) as CanonicalTrace;
    clone.trace_id = 'clone-no-verification';
    clone.spans = clone.spans.filter((span) => span.type !== 'verification');
    const comparison = compareTraces(successfulTrace, clone);
    const findings = runDetectors(clone);
    const audit = auditVerdict(clone, findings, { comparison });

    expect(audit.original_verdict).toBe('pass');
    expect(audit.audited_verdict).toBe('evaluator_false_positive_suspected');
    expect(audit.signals.some((signal) => signal.includes('verification step') && signal.includes('사라짐'))).toBe(true);
    expect(audit.evidence_validation.ok).toBe(true);
  });

  it('comparison이 없으면 기존 동작이 유지된다', () => {
    const findings = runDetectors(successfulTrace);
    const audit = auditVerdict(successfulTrace, findings);

    expect(audit.audited_verdict).toBe('true_pass');
    expect(audit.signals.some((signal) => signal.startsWith('compare:'))).toBe(false);
  });

  it('comparison evidence가 실제 span id만 참조한다', async () => {
    const { compareTraces } = await import('../lib/compare');
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const findings = runDetectors(wrongTimeTrace);
    const audit = auditVerdict(wrongTimeTrace, findings, { comparison });

    expect(audit.evidence_validation.missing_span_ids).toEqual([]);
  });
});
