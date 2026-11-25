import type {
  CanonicalSpan,
  CanonicalTrace,
  SpanStatus,
  SpanType,
  ValidationIssue,
  ValidationResult
} from './types';

const spanTypes: SpanType[] = ['agent', 'llm', 'tool', 'retrieval', 'verification', 'human', 'system'];
const spanStatuses: SpanStatus[] = ['ok', 'error', 'cancelled', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function validateSpan(span: unknown, index: number, issues: ValidationIssue[]): CanonicalSpan | null {
  const path = `spans[${index}]`;
  if (!isRecord(span)) {
    issues.push(issue(path, 'span은 객체여야 합니다.'));
    return null;
  }

  if (typeof span.span_id !== 'string' || span.span_id.length === 0) {
    issues.push(issue(`${path}.span_id`, 'span_id는 비어 있지 않은 문자열이어야 합니다.'));
  }
  if (span.parent_span_id !== undefined && typeof span.parent_span_id !== 'string') {
    issues.push(issue(`${path}.parent_span_id`, 'parent_span_id는 문자열이어야 합니다.'));
  }
  if (!spanTypes.includes(span.type as SpanType)) {
    issues.push(issue(`${path}.type`, `type은 ${spanTypes.join(', ')} 중 하나여야 합니다.`));
  }
  if (typeof span.name !== 'string' || span.name.length === 0) {
    issues.push(issue(`${path}.name`, 'name은 비어 있지 않은 문자열이어야 합니다.'));
  }
  if (!isValidDate(span.started_at)) {
    issues.push(issue(`${path}.started_at`, 'started_at은 유효한 ISO 날짜 문자열이어야 합니다.'));
  }
  if (span.ended_at !== undefined && !isValidDate(span.ended_at)) {
    issues.push(issue(`${path}.ended_at`, 'ended_at은 유효한 ISO 날짜 문자열이어야 합니다.'));
  }
  if (
    isValidDate(span.started_at) &&
    isValidDate(span.ended_at) &&
    Date.parse(span.ended_at) < Date.parse(span.started_at)
  ) {
    issues.push(issue(`${path}.ended_at`, 'ended_at은 started_at보다 빨라서는 안 됩니다.'));
  }
  if (span.status !== undefined && !spanStatuses.includes(span.status as SpanStatus)) {
    issues.push(issue(`${path}.status`, `status는 ${spanStatuses.join(', ')} 중 하나여야 합니다.`));
  }
  if (span.error !== undefined && !isRecord(span.error)) {
    issues.push(issue(`${path}.error`, 'error는 객체여야 합니다.'));
  }
  if (span.usage !== undefined && !isRecord(span.usage)) {
    issues.push(issue(`${path}.usage`, 'usage는 객체여야 합니다.'));
  }

  return span as unknown as CanonicalSpan;
}

function validateParentReferences(spans: CanonicalSpan[], issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  for (const span of spans) {
    if (ids.has(span.span_id)) {
      issues.push(issue(`spans.${span.span_id}`, `중복된 span_id입니다: ${span.span_id}`));
    }
    ids.add(span.span_id);
  }

  for (const span of spans) {
    if (span.parent_span_id && !ids.has(span.parent_span_id)) {
      issues.push(
        issue(`spans.${span.span_id}.parent_span_id`, `존재하지 않는 parent span입니다: ${span.parent_span_id}`)
      );
    }
    if (span.parent_span_id === span.span_id) {
      issues.push(issue(`spans.${span.span_id}.parent_span_id`, 'span은 자기 자신을 parent로 가질 수 없습니다.'));
    }
  }

  const parentById = new Map(spans.map((span) => [span.span_id, span.parent_span_id]));
  for (const span of spans) {
    const seen = new Set<string>();
    let current = span.parent_span_id;
    while (current) {
      if (seen.has(current)) {
        issues.push(issue(`spans.${span.span_id}.parent_span_id`, 'parent 관계에 순환이 있습니다.'));
        break;
      }
      seen.add(current);
      current = parentById.get(current);
    }
  }
}

export function validateCanonicalTrace(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [issue('$', 'trace는 객체여야 합니다.')] };
  }

  if (typeof input.trace_id !== 'string' || input.trace_id.length === 0) {
    issues.push(issue('trace_id', 'trace_id는 비어 있지 않은 문자열이어야 합니다.'));
  }
  if (!isValidDate(input.started_at)) {
    issues.push(issue('started_at', 'started_at은 유효한 ISO 날짜 문자열이어야 합니다.'));
  }
  if (input.ended_at !== undefined && !isValidDate(input.ended_at)) {
    issues.push(issue('ended_at', 'ended_at은 유효한 ISO 날짜 문자열이어야 합니다.'));
  }
  if (!isRecord(input.task)) {
    issues.push(issue('task', 'task는 객체여야 합니다.'));
  } else {
    if (typeof input.task.instruction !== 'string' || input.task.instruction.length === 0) {
      issues.push(issue('task.instruction', 'instruction은 비어 있지 않은 문자열이어야 합니다.'));
    }
    if (!Array.isArray(input.task.success_criteria)) {
      issues.push(issue('task.success_criteria', 'success_criteria는 배열이어야 합니다.'));
    } else if (input.task.success_criteria.some((criterion) => typeof criterion !== 'string')) {
      issues.push(issue('task.success_criteria', 'success_criteria의 각 항목은 문자열이어야 합니다.'));
    }
  }
  if (!Array.isArray(input.spans)) {
    issues.push(issue('spans', 'spans는 배열이어야 합니다.'));
    return { ok: false, issues };
  }

  const spans = input.spans
    .map((span, index) => validateSpan(span, index, issues))
    .filter((span): span is CanonicalSpan => span !== null);

  validateParentReferences(spans, issues);

  if (input.evaluation !== undefined) {
    if (!isRecord(input.evaluation)) {
      issues.push(issue('evaluation', 'evaluation은 객체여야 합니다.'));
    } else if (!['pass', 'fail', 'unknown'].includes(String(input.evaluation.verdict))) {
      issues.push(issue('evaluation.verdict', 'verdict는 pass, fail, unknown 중 하나여야 합니다.'));
    }
  }

  const trace = input as unknown as CanonicalTrace;
  return { ok: issues.length === 0, issues, trace: issues.length === 0 ? trace : undefined };
}

export function parseAndValidateTrace(jsonText: string): ValidationResult {
  try {
    return validateCanonicalTrace(JSON.parse(jsonText));
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          message: error instanceof Error ? `JSON 파싱 실패: ${error.message}` : 'JSON 파싱 실패'
        }
      ]
    };
  }
}
