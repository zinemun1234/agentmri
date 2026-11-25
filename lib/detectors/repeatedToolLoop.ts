import type { CanonicalTrace, Finding } from '../types';
import { makeFinding, stableStringify, type Detector } from './types';

function summarizeInput(input: unknown): string {
  const text = stableStringify(input);
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

export const repeatedToolLoopDetector: Detector = {
  id: 'D01',
  title: '반복 도구 호출 루프',
  description: '같은 도구를 같은 입력으로 반복 호출하는지 탐지합니다.',
  run(trace: CanonicalTrace): Finding[] {
    const toolSpans = trace.spans
      .filter((span) => span.type === 'tool')
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));

    const groups = new Map<string, typeof toolSpans>();
    for (const span of toolSpans) {
      const key = `${span.name}\n${stableStringify(span.input)}`;
      const group = groups.get(key) ?? [];
      group.push(span);
      groups.set(key, group);
    }

    const findings: Finding[] = [];
    for (const spans of groups.values()) {
      if (spans.length < 3) continue;
      const first = spans[0];
      findings.push(
        makeFinding({
          detector_id: 'D01',
          category: 'cost_latency',
          severity: spans.length >= 4 ? 'high' : 'medium',
          confidence: 'high',
          title: `${first.name} 도구가 같은 입력으로 ${spans.length}회 반복 호출됨`,
          description:
            '동일한 도구 입력이 반복되면 진행이 멈춘 루프이거나 불필요한 비용 증가일 수 있습니다. 재시도 조건과 종료 조건을 확인해야 합니다.',
          evidence_span_ids: spans.map((span) => span.span_id),
          evidence_quotes: [summarizeInput(first.input)],
          recommended_test:
            '같은 도구 입력이 2회 연속 실패하거나 동일 결과를 반환하면 에이전트가 중단하고 다른 전략을 선택하는지 검증합니다.'
        })
      );
    }

    return findings;
  }
};
