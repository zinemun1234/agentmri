import type { EvidenceValidationResult } from '../audit/types';
import type { TraceComparison } from '../compare';
import type { CanonicalSpan, CanonicalTrace } from '../types';
import type { RegressionAssertion, RegressionCandidate } from './types';

function stepName(label?: string, fallback?: string): string {
  if (!label) return fallback ?? 'unknown step';
  const separator = label.indexOf(':');
  return separator >= 0 ? label.slice(separator + 1) : label;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countToolCalls(trace: CanonicalTrace, toolName: string): number {
  return trace.spans.filter((span) => span.type === 'tool' && span.name === toolName).length;
}


function fieldPriority(path: string): number {
  const normalized = path.toLowerCase();
  let score = 0;
  if (normalized.startsWith('output')) score += 3;
  if (/(start|end|time|date|actual|expected|result|answer|status)/.test(normalized)) score += 5;
  if (/confidence/.test(normalized)) score -= 3;
  return score;
}

function unique(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function spanDisplayName(span?: CanonicalSpan): string | undefined {
  if (!span) return undefined;
  return span.name;
}

export function validateRegressionCandidateEvidence(
  baseline: CanonicalTrace,
  candidate: CanonicalTrace,
  regression: RegressionCandidate
): EvidenceValidationResult {
  const existingIds = new Set([...baseline.spans, ...candidate.spans].map((span) => span.span_id));
  const uniqueIds = unique(regression.evidence_span_ids);
  const validSpanIds = uniqueIds.filter((spanId) => existingIds.has(spanId));
  const missingSpanIds = uniqueIds.filter((spanId) => !existingIds.has(spanId));

  return {
    ok: validSpanIds.length > 0 && missingSpanIds.length === 0,
    evidence_count: validSpanIds.length,
    valid_span_ids: validSpanIds,
    missing_span_ids: missingSpanIds
  };
}

export function buildRegressionCandidate(
  comparison: TraceComparison,
  baseline: CanonicalTrace,
  candidate: CanonicalTrace
): RegressionCandidate | undefined {
  const divergence = comparison.first_divergence;
  if (!divergence) return undefined;

  const originSpan = candidate.spans.find((span) => span.span_id === divergence.candidate_span_id);
  const originName = stepName(divergence.candidate_label ?? divergence.baseline_label, divergence.candidate_span_id);
  const semanticDiffs = divergence.field_differences.filter((difference) => difference.semantic);
  const primaryDiff =
    semanticDiffs
      .filter((difference) => difference.baseline_value !== undefined && difference.candidate_value !== undefined)
      .sort((a, b) => fieldPriority(b.path) - fieldPriority(a.path))[0] ??
    semanticDiffs.find((difference) => difference.baseline_value !== undefined);
  const assertions: RegressionAssertion[] = [];
  const then: string[] = [];

  if (primaryDiff) {
    assertions.push({
      type: 'json_path_equals',
      span_name: originName,
      path: primaryDiff.path,
      expected: primaryDiff.baseline_value
    });
    then.push(`${originName}의 ${primaryDiff.path} 값은 baseline evidence와 일치해야 한다`);
  }

  if (divergence.type === 'verification_removed' || divergence.type === 'step_removed') {
    assertions.push({
      type: 'span_exists',
      span_name: stepName(divergence.baseline_label, divergence.baseline_span_id)
    });
    then.push(`${stepName(divergence.baseline_label, divergence.baseline_span_id)} step이 실행에서 제거되면 안 된다`);
  }

  if (divergence.type === 'step_added' || divergence.type === 'verification_added') {
    assertions.push({
      type: 'span_not_exists',
      span_name: stepName(divergence.candidate_label, divergence.candidate_span_id)
    });
    then.push(`${stepName(divergence.candidate_label, divergence.candidate_span_id)} step이 다시 추가되지 않아야 한다`);
  }

  if (divergence.type === 'tool_call_count_changed') {
    const toolName = originSpan?.name ?? baseline.spans.find((span) => span.span_id === divergence.baseline_span_id)?.name;
    if (toolName) {
      const baselineCount = countToolCalls(baseline, toolName);
      assertions.push({
        type: 'tool_call_count_at_most',
        tool_name: toolName,
        max_count: Math.max(1, baselineCount)
      });
      then.push(`${toolName} 호출 횟수는 baseline 수준(${Math.max(1, baselineCount)}회)을 넘지 않아야 한다`);
    }
  }

  const detectedNodes = comparison.propagation_chain?.nodes.filter((node) => node.role === 'detected') ?? [];
  for (const node of detectedNodes.slice(0, 2)) {
    const span = candidate.spans.find((item) => item.span_id === node.span_id);
    assertions.push({
      type: 'verification_must_pass',
      span_name: spanDisplayName(span) ?? node.step_label
    });
    then.push(`${spanDisplayName(span) ?? node.step_label} verification은 성공 조건을 통과해야 한다`);
  }

  if (assertions.length === 0) {
    assertions.push({
      type: 'json_path_not_equals',
      span_name: originName,
      path: primaryDiff?.path ?? 'output',
      expected: primaryDiff?.candidate_value
    });
    then.push(`${originName}의 ${primaryDiff?.path ?? 'output'} 값은 실패 실행에서 관측된 값과 달라야 한다`);
  }

  const evidenceSpanIds = unique([
    ...divergence.evidence_span_ids,
    ...(comparison.propagation_chain?.nodes.map((node) => node.span_id) ?? [])
  ]);
  const confidence =
    divergence.confidence === 'high' && comparison.propagation_chain?.confidence === 'high'
      ? 'high'
      : divergence.confidence === 'low'
        ? 'low'
        : 'medium';

  return {
    candidate_id: `regression-${baseline.trace_id}-${candidate.trace_id}-${divergence.row_id}`,
    title: `${originName} divergence가 downstream 실패로 전파되지 않아야 한다`,
    given: candidate.task.instruction,
    when: '같은 task를 다시 실행하고 baseline과 candidate의 divergence가 재현되는지 검사한다',
    then,
    assertions,
    confidence,
    evidence_span_ids: evidenceSpanIds,
    source: {
      baseline_trace_id: baseline.trace_id,
      candidate_trace_id: candidate.trace_id,
      first_divergence_span_id: divergence.candidate_span_id,
      divergence_id: divergence.row_id,
      field_path: primaryDiff?.path
    }
  };
}
