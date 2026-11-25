import { describe, expect, it } from 'vitest';
import wrongTimeJson from '../fixtures/calendar-failure-wrong-time.json';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import { compareTraces } from '../lib/compare';
import { diffValues } from '../lib/compare/diff';
import type { CanonicalTrace } from '../lib/types';

const successfulTrace = successfulCalendarJson as unknown as CanonicalTrace;
const wrongTimeTrace = wrongTimeJson as unknown as CanonicalTrace;

describe('compareTraces', () => {
  it('같은 trace를 비교하면 divergence가 없다', () => {
    const comparison = compareTraces(successfulTrace, successfulTrace);

    expect(comparison.first_divergence).toBeUndefined();
    expect(comparison.rows.length).toBe(successfulTrace.spans.length);
    expect(comparison.rows.every((row) => row.status === 'same')).toBe(true);
    expect(comparison.metric_deltas.cost_usd).toBe(0);
  });

  it('회의 시간 추출 step을 첫 divergence로 찾는다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);

    expect(comparison.first_divergence).toBeDefined();
    expect(comparison.first_divergence?.status).toBe('changed');
    expect(comparison.first_divergence?.type).toBe('step_output_changed');
    expect(comparison.first_divergence?.confidence).toBe('high');
    expect(comparison.first_divergence?.baseline_span_id).toBe('extract-time-1');
    expect(comparison.first_divergence?.candidate_span_id).toBe('extract-time-1');
    expect(comparison.first_divergence?.differences).toContain('output');
    expect(comparison.first_divergence?.summary).toContain('회의 시간 추출');
  });

  it('first divergence를 field-level diff로 설명한다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const differences = comparison.first_divergence?.field_differences ?? [];
    const startDiff = differences.find((difference) => difference.path === 'output.start');
    const confidenceDiff = differences.find((difference) => difference.path === 'output.confidence');

    expect(startDiff).toBeDefined();
    expect(startDiff?.baseline_value).toBe('2026-11-26T14:00:00+09:00');
    expect(startDiff?.candidate_value).toBe('2026-11-26T15:00:00+09:00');
    expect(startDiff?.semantic).toBe(true);
    expect(confidenceDiff?.baseline_value).toBe('high');
    expect(confidenceDiff?.candidate_value).toBe('medium');
  });

  it('후속 step에서 input/output/error 차이를 표시하고 랜덤 id는 noise로 분류한다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const createRow = comparison.rows.find((row) => row.candidate_span?.span_id === 'calendar-create-1');
    const verifyRow = comparison.rows.find((row) => row.candidate_span?.span_id === 'verify-calendar-1');
    const eventIdDiff = createRow?.field_differences.find((difference) => difference.path === 'output.event_id');

    expect(createRow?.status).toBe('changed');
    expect(createRow?.differences).toEqual(expect.arrayContaining(['input']));
    expect(eventIdDiff?.semantic).toBe(false);
    expect(eventIdDiff?.noise_reason).toContain('랜덤 식별자');
    expect(verifyRow?.status).toBe('changed');
    expect(verifyRow?.differences).toEqual(expect.arrayContaining(['input', 'output', 'status', 'error']));
  });

  it('first divergence 이후 propagation chain을 만든다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);
    const chain = comparison.propagation_chain;

    expect(chain).toBeDefined();
    expect(chain?.confidence).toBe('high');
    expect(chain?.nodes.map((node) => node.role)).toEqual(
      expect.arrayContaining(['origin', 'propagated', 'detected', 'outcome'])
    );
    expect(chain?.nodes.find((node) => node.role === 'propagated')?.span_id).toBe('calendar-create-1');
    expect(chain?.nodes.find((node) => node.role === 'detected')?.span_id).toBe('verify-calendar-1');
  });

  it('비교 metric delta를 계산한다', () => {
    const comparison = compareTraces(successfulTrace, wrongTimeTrace);

    expect(comparison.baseline_metrics.error_span_count).toBe(0);
    expect(comparison.candidate_metrics.error_span_count).toBe(1);
    expect(comparison.metric_deltas.error_span_count).toBe(1);
    expect(comparison.metric_deltas.verification_span_count).toBe(0);
    expect(comparison.metric_deltas.duration_ms).toBe(3000);
  });
});

describe('field-level diff', () => {
  it('usage 차이는 noise로 분류한다', () => {
    const differences = diffValues(
      { output: { text: 'same' }, usage: { input_tokens: 10, cost_usd: 0.1 } },
      { output: { text: 'same' }, usage: { input_tokens: 20, cost_usd: 0.2 } }
    );

    expect(differences.length).toBeGreaterThan(0);
    expect(differences.every((difference) => !difference.semantic)).toBe(true);
    expect(differences.every((difference) => difference.noise_reason?.includes('usage'))).toBe(true);
  });

  it('배열 추가/삭제를 field path로 표시한다', () => {
    const differences = diffValues({ items: [1, 2] }, { items: [1, 3, 4] }, 'output');

    expect(differences.some((difference) => difference.path === 'output.items[1]')).toBe(true);
    expect(differences.some((difference) => difference.path === 'output.items[2]' && difference.kind === 'array_item_added')).toBe(
      true
    );
  });
});
