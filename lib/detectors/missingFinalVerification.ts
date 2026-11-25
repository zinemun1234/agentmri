import type { CanonicalTrace, Finding } from '../types';
import { makeFinding, type Detector } from './types';

export const missingFinalVerificationDetector: Detector = {
  id: 'D04',
  title: '최종 검증 누락',
  description: '최종 답변 전에 상태나 결과를 확인한 verification span이 있는지 탐지합니다.',
  run(trace: CanonicalTrace): Finding[] {
    const hasVerification = trace.spans.some((span) => span.type === 'verification');
    if (hasVerification) return [];

    const ordered = [...trace.spans].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    const lastSpan = ordered[ordered.length - 1];
    if (!lastSpan) return [];

    return [
      makeFinding({
        detector_id: 'D04',
        category: 'verification_feedback',
        severity: 'medium',
        confidence: 'medium',
        title: '최종 결과를 확인한 verification span이 없음',
        description:
          '실행 기록에 최종 상태 확인 또는 결과 검증 단계가 없습니다. 산출물이 맞아도 검증 없이 완료됐다면 운영 환경에서는 품질 위험이 있습니다.',
        evidence_span_ids: [lastSpan.span_id],
        recommended_test:
          '외부 상태를 바꾸는 작업에서는 완료 전에 상태 조회 또는 결과 검증 step이 존재하는지 검증합니다.'
      })
    ];
  }
};
