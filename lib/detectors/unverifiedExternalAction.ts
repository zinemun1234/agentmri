import type { CanonicalTrace, Finding } from '../types';
import { finalSpan, isExternalActionSpan, orderedSpans } from './utils';
import { makeFinding, type Detector } from './types';

export const unverifiedExternalActionDetector: Detector = {
  id: 'D05',
  title: '검증 없는 외부 행동',
  description: '외부 상태를 바꾸는 tool 호출 후 verification step이 있는지 탐지합니다.',
  run(trace: CanonicalTrace): Finding[] {
    const ordered = orderedSpans(trace);
    const lastSpan = finalSpan(trace);
    const findings: Finding[] = [];

    for (const action of ordered) {
      if (!isExternalActionSpan(action)) continue;
      if (action.status === 'error' || action.status === 'cancelled') continue;

      const actionEnd = Date.parse(action.ended_at ?? action.started_at);
      const hasVerificationAfter = ordered.some(
        (span) => span.type === 'verification' && Date.parse(span.started_at) >= actionEnd
      );
      if (hasVerificationAfter) continue;

      const explicitExternalAction =
        action.attributes?.side_effect === 'external' || action.attributes?.external_action === true;
      const evidenceIds = lastSpan && lastSpan.span_id !== action.span_id ? [action.span_id, lastSpan.span_id] : [action.span_id];

      findings.push(
        makeFinding({
          detector_id: 'D05',
          category: 'security_policy',
          severity: 'high',
          confidence: explicitExternalAction ? 'high' : 'medium',
          title: `${action.name} 외부 행동 후 검증 step이 없음`,
          description:
            '외부 상태를 변경하거나 외부로 정보를 보내는 tool 호출 뒤에 결과 확인 또는 승인 검증이 없습니다. 잘못된 전송/제출/수정이 있어도 발견하지 못할 수 있습니다.',
          evidence_span_ids: evidenceIds,
          recommended_test:
            '외부 행동 tool 실행 후에는 상태 조회, 승인 확인, 또는 verification span이 존재하는지 regression test로 검사합니다.'
        })
      );
    }

    return findings;
  }
};
