import type { CanonicalTrace, Finding } from '../types';
import { makeFinding, type Detector } from './types';

const recoveryPattern = /retry|recover|error|오류|재시도|복구|확인/i;

export const ignoredToolErrorDetector: Detector = {
  id: 'D03',
  title: '도구 오류 무시',
  description: '도구 오류 후 복구나 검증 없이 실행이 계속되는지 탐지합니다.',
  run(trace: CanonicalTrace): Finding[] {
    const ordered = [...trace.spans].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    const findings: Finding[] = [];

    for (let index = 0; index < ordered.length; index += 1) {
      const span = ordered[index];
      if (span.type !== 'tool' || span.status !== 'error') continue;

      const next = ordered[index + 1];
      const recovered = next && (next.type === 'verification' || recoveryPattern.test(next.name));
      if (recovered) continue;

      const evidenceIds = next ? [span.span_id, next.span_id] : [span.span_id];
      findings.push(
        makeFinding({
          detector_id: 'D03',
          category: 'verification_feedback',
          severity: 'high',
          confidence: next ? 'medium' : 'low',
          title: `${span.name} 오류 후 명확한 복구/검증 step이 없음`,
          description:
            '도구가 오류를 반환한 뒤 재시도, 원인 분석, 또는 상태 검증 없이 실행이 이어진 것으로 보입니다. 오류를 무시하면 이후 단계가 잘못된 상태를 기반으로 진행될 수 있습니다.',
          evidence_span_ids: evidenceIds,
          evidence_quotes: span.error?.message ? [span.error.message] : undefined,
          recommended_test:
            '도구가 오류를 반환할 때 에이전트가 재시도, 대안 도구 선택, 또는 사용자 확인 중 하나를 수행하는지 검증합니다.'
        })
      );
    }

    return findings;
  }
};
