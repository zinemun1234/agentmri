import type { CanonicalTrace, Finding } from '../types';
import { finalSpan, isEvidenceProducingSpan, orderedSpans, stringifyEvidence } from './utils';
import { makeFinding, type Detector } from './types';

const evidenceNeededPattern = /찾아|조회|검색|분석|요약|비교|근거|조사|확인/i;

export const retrievalWithoutEvidenceDetector: Detector = {
  id: 'D09',
  title: '근거 없는 사실 주장',
  description: '검색/조회 evidence 없이 사실형 답변을 생성했는지 탐지합니다.',
  run(trace: CanonicalTrace): Finding[] {
    if (!evidenceNeededPattern.test(trace.task.instruction)) return [];
    if (trace.spans.some(isEvidenceProducingSpan)) return [];

    const ordered = orderedSpans(trace);
    const final = finalSpan(trace);
    if (!final || final.type !== 'llm') return [];

    const outputText = stringifyEvidence(final.output).trim();
    if (outputText.length < 20) return [];

    const root = ordered.find((span) => !span.parent_span_id) ?? ordered[0];
    const evidenceIds = root && root.span_id !== final.span_id ? [final.span_id, root.span_id] : [final.span_id];

    return [
      makeFinding({
        detector_id: 'D09',
        category: 'data_retrieval',
        severity: 'high',
        confidence: 'medium',
        title: '검색/조회 evidence 없이 사실형 결과를 생성함',
        description:
          '작업 명세는 정보를 찾거나 분석해야 하는데 retrieval 또는 evidence-producing tool 호출이 없습니다. 최종 답변이 실제 자료가 아니라 모델 추측에 의존했을 수 있습니다.',
        evidence_span_ids: evidenceIds,
        evidence_quotes: [outputText.slice(0, 160)],
        recommended_test:
          '사실형 답변에는 최소 1개의 retrieval/search/read tool evidence가 연결되는지 regression test로 검사합니다.'
      })
    ];
  }
};
