import type { CanonicalSpan, CanonicalTrace } from './types';
import {
  diffValues,
  findValueOccurrences,
  semanticDifferences,
  stableStringify,
  type FieldDifference
} from './compare/diff';

export type { FieldDifference } from './compare/diff';

export type ComparisonRowStatus = 'same' | 'changed' | 'added' | 'removed';

export type DivergenceType =
  | 'step_output_changed'
  | 'step_input_changed'
  | 'step_status_changed'
  | 'step_error_changed'
  | 'step_added'
  | 'step_removed'
  | 'step_order_changed'
  | 'verification_added'
  | 'verification_removed'
  | 'tool_call_count_changed'
  | 'uncertain_alignment';

export type Confidence = 'low' | 'medium' | 'high';

export interface ComparisonRow {
  row_id: string;
  baseline_index?: number;
  candidate_index?: number;
  baseline_span?: CanonicalSpan;
  candidate_span?: CanonicalSpan;
  baseline_step_key?: string;
  candidate_step_key?: string;
  status: ComparisonRowStatus;
  divergence_type?: DivergenceType;
  confidence?: Confidence;
  differences: string[];
  field_differences: FieldDifference[];
}

export interface TraceMetrics {
  duration_ms?: number;
  cost_usd: number;
  span_count: number;
  tool_call_count: number;
  error_span_count: number;
  verification_span_count: number;
}

export interface FirstDivergence {
  row_id: string;
  status: ComparisonRowStatus;
  type: DivergenceType;
  confidence: Confidence;
  baseline_span_id?: string;
  candidate_span_id?: string;
  baseline_label?: string;
  candidate_label?: string;
  differences: string[];
  field_differences: FieldDifference[];
  evidence_span_ids: string[];
  summary: string;
}

export interface PropagationNode {
  span_id: string;
  step_label: string;
  role: 'origin' | 'propagated' | 'detected' | 'outcome';
  confidence: Confidence;
  evidence: string;
  field_paths: string[];
}

export interface PropagationChain {
  origin_divergence_id: string;
  nodes: PropagationNode[];
  confidence: Confidence;
  summary: string;
}

export interface TraceComparison {
  baseline_trace_id: string;
  candidate_trace_id: string;
  rows: ComparisonRow[];
  first_divergence?: FirstDivergence;
  propagation_chain?: PropagationChain;
  baseline_metrics: TraceMetrics;
  candidate_metrics: TraceMetrics;
  metric_deltas: {
    duration_ms?: number;
    cost_usd: number;
    span_count: number;
    tool_call_count: number;
    error_span_count: number;
    verification_span_count: number;
  };
}

interface AlignmentPair {
  baselineIndex?: number;
  candidateIndex?: number;
}

function orderedSpans(trace: CanonicalTrace): CanonicalSpan[] {
  return [...trace.spans].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

function baseStepKey(span: CanonicalSpan): string {
  return `${span.type}:${span.name}`;
}

function occurrenceStepKeys(spans: CanonicalSpan[]): string[] {
  const counts = new Map<string, number>();
  return spans.map((span) => {
    const baseKey = baseStepKey(span);
    const occurrence = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, occurrence);
    return `${baseKey}#${occurrence}`;
  });
}

function alignSequences(baselineKeys: string[], candidateKeys: string[]): AlignmentPair[] {
  const rows = baselineKeys.length;
  const columns = candidateKeys.length;
  const dp = Array.from({ length: rows + 1 }, () => Array<number>(columns + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      dp[i][j] =
        baselineKeys[i] === candidateKeys[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs: AlignmentPair[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (baselineKeys[i] === candidateKeys[j]) {
      pairs.push({ baselineIndex: i, candidateIndex: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pairs.push({ baselineIndex: i });
      i += 1;
    } else {
      pairs.push({ candidateIndex: j });
      j += 1;
    }
  }
  while (i < rows) {
    pairs.push({ baselineIndex: i });
    i += 1;
  }
  while (j < columns) {
    pairs.push({ candidateIndex: j });
    j += 1;
  }

  return pairs;
}

function primitiveStatusDifference(baseline: CanonicalSpan, candidate: CanonicalSpan): FieldDifference[] {
  if ((baseline.status ?? 'unknown') === (candidate.status ?? 'unknown')) return [];
  return [
    {
      path: 'status',
      kind: 'value_changed',
      baseline_value: baseline.status ?? 'unknown',
      candidate_value: candidate.status ?? 'unknown',
      semantic: true
    }
  ];
}

function spanFieldDifferences(baseline: CanonicalSpan, candidate: CanonicalSpan): FieldDifference[] {
  return [
    ...primitiveStatusDifference(baseline, candidate),
    ...diffValues(baseline.input, candidate.input, 'input'),
    ...diffValues(baseline.output, candidate.output, 'output'),
    ...diffValues(baseline.error, candidate.error, 'error')
  ];
}

function topLevelDifferenceKinds(fieldDifferences: FieldDifference[]): string[] {
  const kinds = new Set<string>();
  for (const difference of semanticDifferences(fieldDifferences)) {
    const root = difference.path.split(/[.[]/, 1)[0];
    if (root) kinds.add(root);
  }
  return [...kinds];
}

function countByStepName(spans: CanonicalSpan[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const span of spans) {
    const key = baseStepKey(span);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function classifyDivergenceType(
  status: ComparisonRowStatus,
  differences: string[],
  baselineSpan: CanonicalSpan | undefined,
  candidateSpan: CanonicalSpan | undefined,
  baselineCounts: Map<string, number>,
  candidateCounts: Map<string, number>
): DivergenceType | undefined {
  const span = candidateSpan ?? baselineSpan;
  if (!span) return undefined;

  if (status === 'added') {
    if (span.type === 'verification') return 'verification_added';
    if (span.type === 'tool') {
      const key = baseStepKey(span);
      if ((candidateCounts.get(key) ?? 0) !== (baselineCounts.get(key) ?? 0)) return 'tool_call_count_changed';
    }
    return 'step_added';
  }
  if (status === 'removed') {
    if (span.type === 'verification') return 'verification_removed';
    if (span.type === 'tool') {
      const key = baseStepKey(span);
      if ((candidateCounts.get(key) ?? 0) !== (baselineCounts.get(key) ?? 0)) return 'tool_call_count_changed';
    }
    return 'step_removed';
  }
  if (status !== 'changed') return undefined;

  if (differences.includes('output')) return 'step_output_changed';
  if (differences.includes('input')) return 'step_input_changed';
  if (differences.includes('status')) return 'step_status_changed';
  if (differences.includes('error')) return 'step_error_changed';
  return 'uncertain_alignment';
}

function divergenceConfidence(rowStatus: ComparisonRowStatus, baselineSpan?: CanonicalSpan, candidateSpan?: CanonicalSpan): Confidence {
  if (rowStatus === 'changed' && baselineSpan?.span_id && baselineSpan.span_id === candidateSpan?.span_id) return 'high';
  if (rowStatus === 'changed') return 'medium';
  return 'medium';
}

export function traceMetrics(trace: CanonicalTrace): TraceMetrics {
  const durationMs = trace.ended_at ? Date.parse(trace.ended_at) - Date.parse(trace.started_at) : undefined;
  return {
    duration_ms: durationMs,
    cost_usd: trace.spans.reduce((sum, span) => sum + (span.usage?.cost_usd ?? 0), 0),
    span_count: trace.spans.length,
    tool_call_count: trace.spans.filter((span) => span.type === 'tool').length,
    error_span_count: trace.spans.filter((span) => span.status === 'error').length,
    verification_span_count: trace.spans.filter((span) => span.type === 'verification').length
  };
}

function labelFor(span?: CanonicalSpan): string | undefined {
  if (!span) return undefined;
  return `${span.type}:${span.name}`;
}

function divergenceSummary(row: ComparisonRow): string {
  const baselineLabel = row.baseline_span ? labelFor(row.baseline_span) : '없음';
  const candidateLabel = row.candidate_span ? labelFor(row.candidate_span) : '없음';

  if (row.status === 'changed') {
    const paths = semanticDifferences(row.field_differences)
      .map((difference) => difference.path)
      .slice(0, 3)
      .join(', ');
    return `같은 step(${baselineLabel})에서 ${paths || row.differences.join(', ')} 값이 갈라졌습니다.`;
  }
  if (row.status === 'added') {
    return `candidate 실행에만 step(${candidateLabel})이 추가됐습니다.`;
  }
  return `baseline 실행에만 step(${baselineLabel})이 있고 candidate에서는 사라졌습니다.`;
}

function scalarPropagationValues(row: ComparisonRow): unknown[] {
  return semanticDifferences(row.field_differences)
    .filter((difference) => difference.path.startsWith('output'))
    .map((difference) => difference.candidate_value)
    .filter((value) => {
      if (typeof value === 'number' || typeof value === 'boolean') return true;
      return typeof value === 'string' && value.length >= 4;
    })
    .sort((a, b) => String(b).length - String(a).length)
    .slice(0, 3);
}

function verificationFailed(span: CanonicalSpan): boolean {
  if (span.type !== 'verification') return false;
  if (span.status === 'error') return true;
  if (typeof span.output === 'object' && span.output !== null && !Array.isArray(span.output)) {
    const output = span.output as Record<string, unknown>;
    return output.matches_success_criteria === false || output.ok === false || output.passed === false;
  }
  return false;
}

function buildPropagationChain(
  rows: ComparisonRow[],
  firstDivergence: FirstDivergence,
  candidateTrace: CanonicalTrace
): PropagationChain | undefined {
  const firstIndex = rows.findIndex((row) => row.row_id === firstDivergence.row_id);
  const firstRow = rows[firstIndex];
  const originSpan = firstRow?.candidate_span ?? firstRow?.baseline_span;
  if (!originSpan) return undefined;

  const nodes: PropagationNode[] = [
    {
      span_id: originSpan.span_id,
      step_label: labelFor(originSpan) ?? originSpan.name,
      role: 'origin',
      confidence: firstDivergence.confidence,
      evidence: firstDivergence.summary,
      field_paths: semanticDifferences(firstDivergence.field_differences).map((difference) => difference.path)
    }
  ];

  const propagationValues = scalarPropagationValues(firstRow);
  let directPropagation = false;
  let detected = false;

  for (const row of rows.slice(firstIndex + 1)) {
    const span = row.candidate_span;
    if (!span) continue;

    const matchedPaths = propagationValues.flatMap((value) => [
      ...findValueOccurrences(value, span.input, 'input'),
      ...findValueOccurrences(value, span.output, 'output'),
      ...findValueOccurrences(value, span.error, 'error')
    ]);

    if (verificationFailed(span)) {
      directPropagation = directPropagation || matchedPaths.length > 0;
      detected = true;
      nodes.push({
        span_id: span.span_id,
        step_label: labelFor(span) ?? span.name,
        role: 'detected',
        confidence: matchedPaths.length > 0 || directPropagation ? 'high' : 'medium',
        evidence:
          matchedPaths.length > 0
            ? 'verification span이 전파된 값과 성공 조건의 불일치를 보고했습니다.'
            : 'verification span이 성공 조건 불일치 또는 오류를 보고했습니다.',
        field_paths: [...new Set([...matchedPaths, 'status', 'output.matches_success_criteria'])].slice(0, 8)
      });
      continue;
    }

    if (matchedPaths.length > 0) {
      directPropagation = true;
      nodes.push({
        span_id: span.span_id,
        step_label: labelFor(span) ?? span.name,
        role: 'propagated',
        confidence: 'high',
        evidence: 'first divergence의 candidate 값이 downstream span에서 다시 나타납니다.',
        field_paths: [...new Set(matchedPaths)].slice(0, 6)
      });
    }
  }

  const lastSpan = rows[rows.length - 1]?.candidate_span;
  if (lastSpan && (candidateTrace.status === 'failure' || candidateTrace.evaluation?.verdict === 'fail')) {
    nodes.push({
      span_id: lastSpan.span_id,
      step_label: labelFor(lastSpan) ?? lastSpan.name,
      role: 'outcome',
      confidence: 'medium',
      evidence: `candidate 실행은 status=${candidateTrace.status ?? 'unknown'}, verdict=${candidateTrace.evaluation?.verdict ?? 'unknown'}입니다.`,
      field_paths: []
    });
  }

  if (nodes.length === 1) return undefined;
  const confidence: Confidence = directPropagation ? 'high' : detected ? 'medium' : 'low';
  return {
    origin_divergence_id: firstDivergence.row_id,
    nodes,
    confidence,
    summary: directPropagation
      ? 'first divergence 값이 downstream step으로 전파되고 verification/final outcome까지 이어지는 경로가 관찰됩니다.'
      : 'direct value propagation은 확인되지 않지만 downstream 변경 또는 verification 신호가 있습니다.'
  };
}

export function compareTraces(baseline: CanonicalTrace, candidate: CanonicalTrace): TraceComparison {
  const baselineSpans = orderedSpans(baseline);
  const candidateSpans = orderedSpans(candidate);
  const alignments = alignSequences(occurrenceStepKeys(baselineSpans), occurrenceStepKeys(candidateSpans));
  const baselineCounts = countByStepName(baselineSpans);
  const candidateCounts = countByStepName(candidateSpans);

  const rows: ComparisonRow[] = alignments.map((pair, index) => {
    const baselineSpan = pair.baselineIndex === undefined ? undefined : baselineSpans[pair.baselineIndex];
    const candidateSpan = pair.candidateIndex === undefined ? undefined : candidateSpans[pair.candidateIndex];
    const allFieldDifferences = baselineSpan && candidateSpan ? spanFieldDifferences(baselineSpan, candidateSpan) : [];
    const semanticFieldDifferences = semanticDifferences(allFieldDifferences);
    const differences = baselineSpan && candidateSpan ? topLevelDifferenceKinds(allFieldDifferences) : [];
    const status: ComparisonRowStatus = !baselineSpan
      ? 'added'
      : !candidateSpan
        ? 'removed'
        : semanticFieldDifferences.length > 0
          ? 'changed'
          : 'same';
    const divergenceType = classifyDivergenceType(
      status,
      differences,
      baselineSpan,
      candidateSpan,
      baselineCounts,
      candidateCounts
    );

    return {
      row_id: `row-${index + 1}`,
      baseline_index: pair.baselineIndex,
      candidate_index: pair.candidateIndex,
      baseline_span: baselineSpan,
      candidate_span: candidateSpan,
      baseline_step_key: baselineSpan ? baseStepKey(baselineSpan) : undefined,
      candidate_step_key: candidateSpan ? baseStepKey(candidateSpan) : undefined,
      status,
      divergence_type: divergenceType,
      confidence: status === 'same' ? undefined : divergenceConfidence(status, baselineSpan, candidateSpan),
      differences,
      field_differences: allFieldDifferences
    };
  });

  const firstDivergenceRow = rows.find((row) => row.status !== 'same');
  const firstDivergence: FirstDivergence | undefined = firstDivergenceRow
    ? {
        row_id: firstDivergenceRow.row_id,
        status: firstDivergenceRow.status,
        type: firstDivergenceRow.divergence_type ?? 'uncertain_alignment',
        confidence: firstDivergenceRow.confidence ?? 'low',
        baseline_span_id: firstDivergenceRow.baseline_span?.span_id,
        candidate_span_id: firstDivergenceRow.candidate_span?.span_id,
        baseline_label: labelFor(firstDivergenceRow.baseline_span),
        candidate_label: labelFor(firstDivergenceRow.candidate_span),
        differences: firstDivergenceRow.differences,
        field_differences: firstDivergenceRow.field_differences,
        evidence_span_ids: [firstDivergenceRow.baseline_span?.span_id, firstDivergenceRow.candidate_span?.span_id].filter(
          (spanId): spanId is string => Boolean(spanId)
        ),
        summary: divergenceSummary(firstDivergenceRow)
      }
    : undefined;

  const baselineMetrics = traceMetrics(baseline);
  const candidateMetrics = traceMetrics(candidate);
  const propagationChain = firstDivergence ? buildPropagationChain(rows, firstDivergence, candidate) : undefined;

  return {
    baseline_trace_id: baseline.trace_id,
    candidate_trace_id: candidate.trace_id,
    rows,
    first_divergence: firstDivergence,
    propagation_chain: propagationChain,
    baseline_metrics: baselineMetrics,
    candidate_metrics: candidateMetrics,
    metric_deltas: {
      duration_ms:
        baselineMetrics.duration_ms !== undefined && candidateMetrics.duration_ms !== undefined
          ? candidateMetrics.duration_ms - baselineMetrics.duration_ms
          : undefined,
      cost_usd: candidateMetrics.cost_usd - baselineMetrics.cost_usd,
      span_count: candidateMetrics.span_count - baselineMetrics.span_count,
      tool_call_count: candidateMetrics.tool_call_count - baselineMetrics.tool_call_count,
      error_span_count: candidateMetrics.error_span_count - baselineMetrics.error_span_count,
      verification_span_count: candidateMetrics.verification_span_count - baselineMetrics.verification_span_count
    }
  };
}
