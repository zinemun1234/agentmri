import { describe, expect, it } from 'vitest';
import costSpikeJson from '../fixtures/cost-spike.json';
import evaluatorFalseNegativeJson from '../fixtures/evaluator-false-negative.json';
import ignoredToolErrorJson from '../fixtures/ignored-tool-error.json';
import repeatedLoopJson from '../fixtures/repeated-tool-loop.json';
import retrievalWithoutEvidenceJson from '../fixtures/retrieval-without-evidence.json';
import successfulCalendarJson from '../fixtures/successful-calendar.json';
import unverifiedExternalActionJson from '../fixtures/unverified-external-action.json';
import { runDetectors } from '../lib/detectors';
import { ignoredToolErrorDetector } from '../lib/detectors/ignoredToolError';
import type { CanonicalTrace } from '../lib/types';

const successfulTrace = successfulCalendarJson as unknown as CanonicalTrace;
const repeatedLoopTrace = repeatedLoopJson as unknown as CanonicalTrace;
const evaluatorFalseNegativeTrace = evaluatorFalseNegativeJson as unknown as CanonicalTrace;
const costSpikeTrace = costSpikeJson as unknown as CanonicalTrace;
const unverifiedExternalActionTrace = unverifiedExternalActionJson as unknown as CanonicalTrace;
const retrievalWithoutEvidenceTrace = retrievalWithoutEvidenceJson as unknown as CanonicalTrace;
const ignoredToolErrorTrace = ignoredToolErrorJson as unknown as CanonicalTrace;

describe('runDetectors', () => {
  it('정상 trace에서는 finding을 만들지 않는다', () => {
    expect(runDetectors(successfulTrace)).toEqual([]);
  });

  it('반복 도구 호출 루프를 탐지한다', () => {
    const findings = runDetectors(repeatedLoopTrace);
    const repeated = findings.find((finding) => finding.detector_id === 'D01');

    expect(repeated).toBeDefined();
    expect(repeated?.severity).toBe('high');
    expect(repeated?.evidence_span_ids).toEqual([
      'sheet-read-1',
      'sheet-read-2',
      'sheet-read-3',
      'sheet-read-4',
      'sheet-read-5'
    ]);
  });

  it('verification이 없는 trace에서 최종 검증 누락을 탐지한다', () => {
    const findings = runDetectors(repeatedLoopTrace);
    expect(findings.some((finding) => finding.detector_id === 'D04')).toBe(true);
  });

  it('evaluator false negative fixture는 detector finding이 없다', () => {
    expect(runDetectors(evaluatorFalseNegativeTrace)).toEqual([]);
  });
});

describe('ignoredToolErrorDetector', () => {
  it('도구 오류 후 복구 없이 진행하면 finding을 만든다', () => {
    const trace: CanonicalTrace = {
      trace_id: 'inline-error',
      started_at: '2026-11-24T12:00:00.000Z',
      ended_at: '2026-11-24T12:00:12.000Z',
      status: 'failure',
      task: {
        instruction: '파일을 생성한다',
        success_criteria: ['파일이 생성된다']
      },
      spans: [
        {
          span_id: 'root',
          type: 'agent',
          name: 'agent',
          started_at: '2026-11-24T12:00:00.000Z',
          ended_at: '2026-11-24T12:00:12.000Z',
          status: 'error'
        },
        {
          span_id: 'write-1',
          parent_span_id: 'root',
          type: 'tool',
          name: 'files.write',
          started_at: '2026-11-24T12:00:01.000Z',
          ended_at: '2026-11-24T12:00:04.000Z',
          status: 'error',
          error: { type: 'PermissionDenied', message: 'permission denied' }
        },
        {
          span_id: 'final-1',
          parent_span_id: 'root',
          type: 'llm',
          name: '최종 응답 생성',
          started_at: '2026-11-24T12:00:05.000Z',
          ended_at: '2026-11-24T12:00:12.000Z',
          status: 'ok',
          output: '완료하지 못했습니다.'
        }
      ]
    };

    const findings = ignoredToolErrorDetector.run(trace);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence_span_ids).toEqual(['write-1', 'final-1']);
  });
});


describe('expanded detectors', () => {
  it('D06이 baseline보다 비용이 급증한 span을 탐지한다', () => {
    const findings = runDetectors(costSpikeTrace);
    const costFinding = findings.find((finding) => finding.detector_id === 'D06');

    expect(costFinding).toBeDefined();
    expect(costFinding?.category).toBe('cost_latency');
    expect(costFinding?.evidence_span_ids).toEqual(['analysis-1']);
    expect(costFinding?.description).toContain('$0.0280');
  });

  it('D05가 외부 행동 후 verification이 없는 사례를 탐지한다', () => {
    const findings = runDetectors(unverifiedExternalActionTrace);
    const externalFinding = findings.find((finding) => finding.detector_id === 'D05');

    expect(externalFinding).toBeDefined();
    expect(externalFinding?.category).toBe('security_policy');
    expect(externalFinding?.severity).toBe('high');
    expect(externalFinding?.confidence).toBe('high');
    expect(externalFinding?.evidence_span_ids).toEqual(['submit-approval-1', 'final-1']);
  });

  it('D09가 조회 evidence 없는 사실형 답변을 탐지한다', () => {
    const findings = runDetectors(retrievalWithoutEvidenceTrace);
    const retrievalFinding = findings.find((finding) => finding.detector_id === 'D09');

    expect(retrievalFinding).toBeDefined();
    expect(retrievalFinding?.category).toBe('data_retrieval');
    expect(retrievalFinding?.evidence_span_ids).toEqual(['final-1', 'root']);
  });

  it('D03이 도구 오류 무시 fixture를 탐지한다', () => {
    const findings = runDetectors(ignoredToolErrorTrace);
    const ignoredError = findings.find((finding) => finding.detector_id === 'D03');

    expect(ignoredError).toBeDefined();
    expect(ignoredError?.category).toBe('verification_feedback');
    expect(ignoredError?.evidence_span_ids).toEqual(['write-1', 'final-1']);
  });

  it('기존 정상/false-negative fixture에는 새 detector의 오탐이 없다', () => {
    expect(runDetectors(successfulTrace)).toEqual([]);
    expect(runDetectors(evaluatorFalseNegativeTrace)).toEqual([]);
  });
});
