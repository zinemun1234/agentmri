import { describe, expect, it } from 'vitest';
import wrongTimeJson from '../fixtures/calendar-failure-wrong-time.json';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import { compareTraces } from '../lib/compare';
import { buildRegressionCandidate, validateRegressionCandidateEvidence } from '../lib/regression';
import type { CanonicalTrace } from '../lib/types';

const successfulTrace = successfulCalendarJson as unknown as CanonicalTrace;
const wrongTimeTrace = wrongTimeJson as unknown as CanonicalTrace;

describe('buildRegressionCandidate', () => {
  it('wrong-time divergence에서 regression candidate를 생성한다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const regression = buildRegressionCandidate(comparison, successfulTrace, wrongTimeTrace);

    expect(regression).toBeDefined();
    expect(regression?.confidence).toBe('high');
    expect(regression?.source.first_divergence_span_id).toBe('extract-time-1');
    expect(regression?.source.field_path).toBe('output.start');
    expect(regression?.evidence_span_ids).toEqual(expect.arrayContaining(['extract-time-1', 'calendar-create-1', 'verify-calendar-1']));
  });

  it('json path assertion과 verification assertion을 포함한다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const regression = buildRegressionCandidate(comparison, successfulTrace, wrongTimeTrace);

    expect(regression?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'json_path_equals',
          span_name: '회의 시간 추출',
          path: 'output.start',
          expected: '2026-11-26T14:00:00+09:00'
        }),
        expect.objectContaining({
          type: 'verification_must_pass',
          span_name: '생성된 일정 확인'
        })
      ])
    );
    expect(regression?.then.some((line) => line.includes('output.start'))).toBe(true);
  });

  it('candidate evidence reference를 baseline/candidate union 기준으로 검증한다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const regression = buildRegressionCandidate(comparison, successfulTrace, wrongTimeTrace);
    expect(regression).toBeDefined();

    const validation = validateRegressionCandidateEvidence(successfulTrace, wrongTimeTrace, regression!);
    expect(validation.ok).toBe(true);
    expect(validation.missing_span_ids).toEqual([]);
    expect(validation.evidence_count).toBeGreaterThanOrEqual(3);
  });

  it('divergence가 없으면 candidate를 생성하지 않는다', () => {
    const comparison = compareTraces(successfulTrace, successfulTrace);
    expect(buildRegressionCandidate(comparison, successfulTrace, successfulTrace)).toBeUndefined();
  });
});
