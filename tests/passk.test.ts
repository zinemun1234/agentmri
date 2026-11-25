import { describe, expect, it } from 'vitest';
import { combinations, passAtK, passPowK, passKCurve } from '../lib/multirun/passk';
import { compileVitest } from '../lib/regression';
import wrongTimeJson from '../fixtures/calendar-failure-wrong-time.json';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import { compareTraces } from '../lib/compare';
import { buildRegressionCandidate } from '../lib/regression';
import type { CanonicalTrace } from '../lib/types';

describe('combinations', () => {
  it('기본 조합 값이 정확하다', () => {
    expect(combinations(4, 2)).toBe(6);
    expect(combinations(10, 3)).toBe(120);
    expect(combinations(5, 0)).toBe(1);
    expect(combinations(5, 5)).toBe(1);
    expect(combinations(3, 4)).toBe(0);
  });
});

describe('pass@k / pass^k 무편향 추정', () => {
  it('전부 성공이면 pass^k = 1', () => {
    expect(passPowK(10, 10, 3)).toBe(1);
  });
  it('전부 실패면 pass@k = 0', () => {
    expect(passAtK(10, 0, 3)).toBe(0);
  });
  it('naive plug-in보다 보수적이다 (무편향 검증)', () => {
    // n=4, c=3, k=2: unbiased pass^2 = C(3,2)/C(4,2) = 3/6 = 0.5
    // naive plug-in은 (3/4)^2 = 0.5625 — naive가 더 낙관적(위로 편향)
    expect(passPowK(4, 3, 2)).toBeCloseTo(0.5);
    expect(passPowK(4, 3, 2)!).toBeLessThan((3 / 4) ** 2);
  });
  it('pass@k는 실패만 k번 뽑힐 확률의 여사건이다', () => {
    // n=4, c=2, k=2: pass@2 = 1 - C(2,2)/C(4,2) = 1 - 1/6 = 5/6
    expect(passAtK(4, 2, 2)).toBeCloseTo(5 / 6);
  });
  it('k > total이면 undefined', () => {
    expect(passAtK(3, 2, 5)).toBeUndefined();
    expect(passPowK(3, 2, 5)).toBeUndefined();
  });
  it('곡선은 k=1부터 단조 증가/감소한다', () => {
    const curve = passKCurve(10, 6, 5);
    expect(curve.length).toBe(5);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].pass_at_k).toBeGreaterThanOrEqual(curve[i - 1].pass_at_k);
      expect(curve[i].pass_pow_k).toBeLessThanOrEqual(curve[i - 1].pass_pow_k);
    }
  });
});

describe('compileVitest', () => {
  const success = successfulCalendarJson as unknown as CanonicalTrace;
  const wrongTime = wrongTimeJson as unknown as CanonicalTrace;
  const candidate = buildRegressionCandidate(compareTraces(success, wrongTime), success, wrongTime)!;
  const code = compileVitest(candidate);

  it('유효한 vitest 구조를 생성한다', () => {
    expect(code).toContain("import { describe, expect, it } from 'vitest'");
    expect(code).toContain('const CANDIDATE =');
    expect(code).toContain('function evaluate(assertion, trace)');
    expect(code).toContain('expect(failures).toEqual([])');
  });
  it('assertion type 6종을 모두 처리한다', () => {
    for (const kind of ['json_path_equals', 'json_path_not_equals', 'span_exists', 'span_not_exists', 'verification_must_pass', 'tool_call_count_at_most']) {
      expect(code).toContain(kind);
    }
  });
  it('candidate JSON이 임베드된다', () => {
    expect(code).toContain(candidate.candidate_id);
  });
});
