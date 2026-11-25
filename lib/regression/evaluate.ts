import type { CanonicalSpan, CanonicalTrace } from '../types';
import type { RegressionAssertion, RegressionCandidate } from './types';

export interface AssertionResult {
  assertion: RegressionAssertion;
  passed: boolean;
  actual?: unknown;
  message: string;
}

export interface RegressionEvaluation {
  candidate_id: string;
  passed: boolean;
  results: AssertionResult[];
  pass_count: number;
  fail_count: number;
}

function spanMatchesName(span: CanonicalSpan, name: string): boolean {
  return span.name === name || `${span.type}:${span.name}` === name || span.name.endsWith(name) || name.endsWith(span.name);
}

export function findSpanByName(trace: CanonicalTrace, name: string): CanonicalSpan | undefined {
  return trace.spans.find((span) => span.name === name) ?? trace.spans.find((span) => spanMatchesName(span, name));
}

// path like "output.start" or "output.items[1]" — navigate nested objects/arrays
export function getByPath(root: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isNaN(index)) return undefined;
      current = current[index];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function verificationPassed(span: CanonicalSpan): boolean {
  const output = span.output;
  if (output === true) return true;
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>;
    for (const key of ['matches_success_criteria', 'passed', 'ok', 'success']) {
      if (typeof record[key] === 'boolean') return record[key] as boolean;
    }
  }
  return span.status === 'ok';
}

function evaluateAssertion(assertion: RegressionAssertion, trace: CanonicalTrace): AssertionResult {
  switch (assertion.type) {
    case 'json_path_equals': {
      const span = assertion.span_name ? findSpanByName(trace, assertion.span_name) : undefined;
      if (!span) {
        return { assertion, passed: false, message: `span '${assertion.span_name}'을 찾을 수 없습니다` };
      }
      const actual = getByPath(span, assertion.path ?? '');
      const passed = deepEquals(actual, assertion.expected);
      return {
        assertion,
        passed,
        actual,
        message: passed
          ? `${assertion.path} = ${JSON.stringify(assertion.expected)}`
          : `${assertion.path}: expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actual)}`
      };
    }
    case 'json_path_not_equals': {
      const span = assertion.span_name ? findSpanByName(trace, assertion.span_name) : undefined;
      if (!span) {
        return { assertion, passed: true, message: `span '${assertion.span_name}' 없음 — 값이 다를 수밖에 없으므로 통과` };
      }
      const actual = getByPath(span, assertion.path ?? '');
      const passed = !deepEquals(actual, assertion.expected);
      return {
        assertion,
        passed,
        actual,
        message: passed
          ? `${assertion.path} ≠ ${JSON.stringify(assertion.expected)}`
          : `${assertion.path}가 금지된 값 ${JSON.stringify(assertion.expected)}와 동일합니다`
      };
    }
    case 'span_exists': {
      const span = assertion.span_name ? findSpanByName(trace, assertion.span_name) : undefined;
      return {
        assertion,
        passed: Boolean(span),
        message: span ? `span '${assertion.span_name}' 존재` : `span '${assertion.span_name}'이 trace에 없습니다`
      };
    }
    case 'span_not_exists': {
      const span = assertion.span_name ? findSpanByName(trace, assertion.span_name) : undefined;
      return {
        assertion,
        passed: !span,
        message: span ? `금지된 span '${assertion.span_name}'이 존재합니다` : `span '${assertion.span_name}' 없음`
      };
    }
    case 'verification_must_pass': {
      const verifications = trace.spans.filter(
        (span) => span.type === 'verification' && (!assertion.span_name || spanMatchesName(span, assertion.span_name!))
      );
      if (verifications.length === 0) {
        return { assertion, passed: false, message: `verification span이 없습니다` };
      }
      const failed = verifications.filter((span) => !verificationPassed(span));
      return {
        assertion,
        passed: failed.length === 0,
        message:
          failed.length === 0
            ? `verification ${verifications.length}개 모두 통과`
            : `verification ${failed.map((span) => span.name).join(', ')} 실패`
      };
    }
    case 'tool_call_count_at_most': {
      const toolCalls = trace.spans.filter(
        (span) => span.type === 'tool' && (!assertion.tool_name || spanMatchesName(span, assertion.tool_name!))
      );
      const max = assertion.max_count ?? 0;
      return {
        assertion,
        passed: toolCalls.length <= max,
        actual: toolCalls.length,
        message:
          toolCalls.length <= max
            ? `tool call ${toolCalls.length}회 ≤ ${max}`
            : `tool call ${toolCalls.length}회가 상한 ${max}를 초과`
      };
    }
    default:
      return { assertion, passed: false, message: `지원하지 않는 assertion type: ${(assertion as RegressionAssertion).type}` };
  }
}

export function evaluateRegression(candidate: RegressionCandidate, trace: CanonicalTrace): RegressionEvaluation {
  const results = candidate.assertions.map((assertion) => evaluateAssertion(assertion, trace));
  const failCount = results.filter((result) => !result.passed).length;
  return {
    candidate_id: candidate.candidate_id,
    passed: failCount === 0,
    results,
    pass_count: results.length - failCount,
    fail_count: failCount
  };
}
