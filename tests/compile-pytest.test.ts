import { describe, expect, it } from 'vitest';
import wrongTimeJson from '../fixtures/calendar-failure-wrong-time.json';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import { compareTraces } from '../lib/compare';
import { buildRegressionCandidate, compilePytest } from '../lib/regression';
import type { CanonicalTrace } from '../lib/types';

const success = successfulCalendarJson as unknown as CanonicalTrace;
const wrongTime = wrongTimeJson as unknown as CanonicalTrace;

describe('compilePytest', () => {
  const comparison = compareTraces(success, wrongTime);
  const candidate = buildRegressionCandidate(comparison, success, wrongTime)!;
  const code = compilePytest(candidate);

  it('유효한 pytest 구조를 생성한다', () => {
    expect(code).toContain('def test_');
    expect(code).toContain('CANDIDATE = json.loads');
    expect(code).toContain('def evaluate(assertion, trace):');
    expect(code).toContain('def load_trace():');
  });

  it('candidate JSON이 임베드된다', () => {
    expect(code).toContain(candidate.candidate_id);
    expect(code).toContain('json_path_equals');
    expect(code).toContain('verification_must_pass');
  });

  it('assertion type 6종 evaluator를 모두 포함한다', () => {
    for (const kind of ['json_path_equals', 'json_path_not_equals', 'span_exists', 'span_not_exists', 'verification_must_pass', 'tool_call_count_at_most']) {
      expect(code).toContain(kind);
    }
  });

  it('표준 라이브러리만 사용한다', () => {
    const imports = code.match(/^import .+$/gm) ?? [];
    for (const line of imports) {
      expect(line).toMatch(/^import (json|os|sys|re)$/);
    }
  });
});
