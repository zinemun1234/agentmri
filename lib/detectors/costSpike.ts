import type { CanonicalTrace, Finding } from '../types';
import { makeFinding, type Detector } from './types';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export const costSpikeDetector: Detector = {
  id: 'D06',
  title: '비용 급증',
  description: '다른 span보다 비정상적으로 높은 비용을 사용한 LLM/tool span을 탐지합니다.',
  run(trace: CanonicalTrace): Finding[] {
    const costedSpans = trace.spans.filter((span) => (span.usage?.cost_usd ?? 0) > 0);
    if (costedSpans.length < 3) return [];

    const costs = costedSpans.map((span) => span.usage?.cost_usd ?? 0);
    const baseline = median(costs);
    if (baseline <= 0) return [];

    return costedSpans.flatMap((span) => {
      const cost = span.usage?.cost_usd ?? 0;
      const ratio = cost / baseline;
      if (cost < 0.005 || ratio < 4) return [];

      return [
        makeFinding({
          detector_id: 'D06',
          category: 'cost_latency',
          severity: cost >= 0.05 ? 'high' : 'medium',
          confidence: 'medium',
          title: `${span.name} span 비용이 baseline 대비 ${ratio.toFixed(1)}배 증가함`,
          description: `이 span의 비용은 $${cost.toFixed(4)}로 median baseline $${baseline.toFixed(4)}보다 높습니다. 긴 컨텍스트, 반복 재시도, 또는 비효율적인 모델 사용일 수 있습니다.`,
          evidence_span_ids: [span.span_id],
          evidence_quotes: [`cost_usd=${cost.toFixed(4)}, median=${baseline.toFixed(4)}, ratio=${ratio.toFixed(1)}`],
          recommended_test:
            '같은 task에서 개별 span 비용이 baseline의 4배를 넘지 않는지 regression test로 검사합니다.'
        })
      ];
    });
  }
};
