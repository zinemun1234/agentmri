import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import { validateCanonicalTrace } from '../lib/validate';

describe('validateCanonicalTrace', () => {
  it('유효한 canonical trace를 통과시킨다', () => {
    const result = validateCanonicalTrace(successfulCalendarJson);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.trace?.trace_id).toBe('sample-success-calendar');
  });


  it('프로젝트의 모든 JSON fixture가 canonical trace 검증을 통과한다', () => {
    const fixtureDir = join(process.cwd(), 'fixtures');
    const fixtureFiles = readdirSync(fixtureDir).filter((file) => file.endsWith('.json'));

    expect(fixtureFiles.length).toBeGreaterThanOrEqual(8);
    for (const file of fixtureFiles) {
      const input = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
      const result = validateCanonicalTrace(input);
      expect(result.ok, `${file}: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`).toBe(true);
    }
  });

  it('spans 배열이 없으면 실패한다', () => {
    const result = validateCanonicalTrace({
      trace_id: 'invalid',
      started_at: '2026-11-24T09:00:00.000Z',
      task: {
        instruction: '테스트',
        success_criteria: []
      }
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'spans')).toBe(true);
  });

  it('중복된 span_id를 탐지한다', () => {
    const input = JSON.parse(JSON.stringify(successfulCalendarJson)) as typeof successfulCalendarJson;
    input.spans[1].span_id = input.spans[0].span_id;

    const result = validateCanonicalTrace(input);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('중복된 span_id'))).toBe(true);
  });

  it('존재하지 않는 parent_span_id를 탐지한다', () => {
    const input = JSON.parse(JSON.stringify(successfulCalendarJson)) as typeof successfulCalendarJson;
    input.spans[1].parent_span_id = 'missing-parent';

    const result = validateCanonicalTrace(input);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('존재하지 않는 parent'))).toBe(true);
  });

  it('ended_at이 started_at보다 빠르면 실패한다', () => {
    const input = JSON.parse(JSON.stringify(successfulCalendarJson)) as typeof successfulCalendarJson;
    input.spans[1].ended_at = '2026-11-24T08:00:00.000Z';

    const result = validateCanonicalTrace(input);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('빨라서는 안'))).toBe(true);
  });
});
