import { describe, expect, it } from 'vitest';
import wrongTimeJson from '../fixtures/calendar-failure-wrong-time.json';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import repeatedLoopJson from '../fixtures/repeated-tool-loop.json';
import { compareTraces } from '../lib/compare';
import { buildRegressionCandidate } from '../lib/regression';
import { evaluateRegression, getByPath, findSpanByName } from '../lib/regression/evaluate';
import type { CanonicalTrace } from '../lib/types';

const success = successfulCalendarJson as unknown as CanonicalTrace;
const wrongTime = wrongTimeJson as unknown as CanonicalTrace;

describe('getByPath / findSpanByName', () => {
  it('중첩 경로와 배열 인덱스를 탐색한다', () => {
    const obj = { output: { items: [{ name: 'a' }, { name: 'b' }], count: 2 } };
    expect(getByPath(obj, 'output.count')).toBe(2);
    expect(getByPath(obj, 'output.items[1].name')).toBe('b');
    expect(getByPath(obj, 'output.missing.deep')).toBeUndefined();
  });

  it('span을 이름으로 찾는다', () => {
    const span = findSpanByName(success, '회의 시간 추출');
    expect(span).toBeDefined();
    expect(span!.type).toBe('llm');
  });
});

describe('evaluateRegression — wrong-time regression candidate', () => {
  const comparison = compareTraces(success, wrongTime);
  const candidate = buildRegressionCandidate(comparison, success, wrongTime)!;

  it('candidate가 생성된다', () => {
    expect(candidate).toBeDefined();
    expect(candidate.assertions.length).toBeGreaterThan(0);
  });

  it('golden(정상) trace에서는 regression test가 통과한다', () => {
    const evaluation = evaluateRegression(candidate, success);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.fail_count).toBe(0);
  });

  it('regression(잘못된 시간) trace에서는 실패한다', () => {
    const evaluation = evaluateRegression(candidate, wrongTime);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.fail_count).toBeGreaterThan(0);
    const failedMessages = evaluation.results.filter((r) => !r.passed).map((r) => r.message);
    expect(failedMessages.some((m) => m.includes('output.start') || m.includes('expected'))).toBe(true);
  });

  it('verification_must_pass assertion이 wrong-time에서 실패를 잡는다', () => {
    const verificationAssertion = candidate.assertions.find((a) => a.type === 'verification_must_pass');
    if (verificationAssertion) {
      const evaluation = evaluateRegression(
        { ...candidate, assertions: [verificationAssertion] },
        wrongTime
      );
      expect(evaluation.passed).toBe(false);
    }
  });
});

describe('evaluateRegression — tool loop 상한', () => {
  it('tool_call_count_at_most가 루프를 잡는다', () => {
    const loop = repeatedLoopJson as unknown as CanonicalTrace;
    const evaluation = evaluateRegression(
      {
        candidate_id: 'test-loop',
        title: 'loop guard',
        given: '',
        when: '',
        then: [],
        assertions: [{ type: 'tool_call_count_at_most', tool_name: 'spreadsheet.get_range', max_count: 2 }],
        confidence: 'high',
        evidence_span_ids: [],
        source: { baseline_trace_id: '', candidate_trace_id: '' }
      },
      loop
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.results[0].actual).toBeGreaterThan(2);
  });
});
