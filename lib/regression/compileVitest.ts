import type { RegressionCandidate } from './types';

// Generates a self-contained vitest file embedding the regression candidate.
// The generated file needs only vitest + node stdlib in the target project and
// evaluates assertions against a trace JSON supplied via TRACE_JSON env var.
export function compileVitest(candidate: RegressionCandidate): string {
  const embedded = JSON.stringify(candidate, null, 2);
  const testName = candidate.candidate_id.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

  return `/**
 * AgentMRI regression test — generated from candidate '${candidate.candidate_id}'
 * ${candidate.title}
 *
 * usage:
 *   TRACE_JSON=path/to/trace.json npx vitest run ${testName}.test.ts
 *
 * self-contained: vitest + node stdlib only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CANDIDATE = ${embedded};

function loadTrace() {
  const path = process.env.TRACE_JSON;
  if (!path) throw new Error('trace JSON 경로를 TRACE_JSON 환경변수로 제공하세요');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function spanMatches(span, name) {
  if (span.name === name) return true;
  if (span.type + ':' + span.name === name) return true;
  return (span.name ?? '').endsWith(name) || name.endsWith(span.name ?? '');
}

function findSpan(trace, name) {
  const spans = trace.spans ?? [];
  return spans.find((span) => span.name === name) ?? spans.find((span) => spanMatches(span, name));
}

function getByPath(root, path) {
  const segments = String(path).replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index >= current.length) return undefined;
      current = current[index];
    } else if (typeof current === 'object') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function verificationPassed(span) {
  const output = span.output;
  if (output === true) return true;
  if (typeof output === 'object' && output !== null) {
    for (const key of ['matches_success_criteria', 'passed', 'ok', 'success']) {
      if (typeof output[key] === 'boolean') return output[key];
    }
  }
  return span.status === 'ok';
}

function evaluate(assertion, trace) {
  const kind = assertion.type;
  if (kind === 'json_path_equals') {
    const span = findSpan(trace, assertion.span_name ?? '');
    if (!span) return [false, 'span not found: ' + assertion.span_name];
    const actual = getByPath(span, assertion.path ?? '');
    const pass = JSON.stringify(actual) === JSON.stringify(assertion.expected);
    return [pass, assertion.path + ': expected ' + JSON.stringify(assertion.expected) + ', got ' + JSON.stringify(actual)];
  }
  if (kind === 'json_path_not_equals') {
    const span = findSpan(trace, assertion.span_name ?? '');
    if (!span) return [true, 'span absent — trivially not equal'];
    const actual = getByPath(span, assertion.path ?? '');
    const pass = JSON.stringify(actual) !== JSON.stringify(assertion.expected);
    return [pass, assertion.path + ' equals forbidden value ' + JSON.stringify(assertion.expected)];
  }
  if (kind === 'span_exists') {
    const found = findSpan(trace, assertion.span_name ?? '') !== undefined;
    return [found, 'span ' + assertion.span_name + (found ? ' exists' : ' missing')];
  }
  if (kind === 'span_not_exists') {
    const found = findSpan(trace, assertion.span_name ?? '') !== undefined;
    return [!found, 'forbidden span ' + assertion.span_name + (found ? ' present' : ' absent')];
  }
  if (kind === 'verification_must_pass') {
    const verifications = (trace.spans ?? []).filter(
      (span) => span.type === 'verification' && (!assertion.span_name || spanMatches(span, assertion.span_name))
    );
    if (verifications.length === 0) return [false, 'no verification span found'];
    const failed = verifications.filter((span) => !verificationPassed(span)).map((span) => span.name);
    return [failed.length === 0, failed.length > 0 ? 'verification failed: ' + failed.join(', ') : 'all verification passed'];
  }
  if (kind === 'tool_call_count_at_most') {
    const calls = (trace.spans ?? []).filter(
      (span) => span.type === 'tool' && (!assertion.tool_name || spanMatches(span, assertion.tool_name))
    );
    const maximum = assertion.max_count ?? 0;
    return [calls.length <= maximum, 'tool calls ' + calls.length + ' vs max ' + maximum];
  }
  return [false, 'unsupported assertion type: ' + kind];
}

describe('${candidate.title.replace(/'/g, "\\'")}', () => {
  it('regression assertions hold', () => {
    const trace = loadTrace();
    const failures = [];
    for (const assertion of CANDIDATE.assertions) {
      const [passed, message] = evaluate(assertion, trace);
      if (!passed) failures.push('[' + assertion.type + '] ' + message);
    }
    expect(failures).toEqual([]);
  });
});
`;
}
