import type { RegressionCandidate } from './types';

// Generates a self-contained pytest file embedding the regression candidate.
// The generated file uses only the Python standard library and evaluates
// assertions against a trace JSON supplied via TRACE_JSON env var or argv.
export function compilePytest(candidate: RegressionCandidate): string {
  const embedded = JSON.stringify(candidate, null, 2);
  const testName = candidate.candidate_id.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

  return `"""
AgentMRI regression test — generated from candidate '${candidate.candidate_id}'
${candidate.title}

usage:
  TRACE_JSON=path/to/trace.json pytest ${testName}.py
  pytest ${testName}.py path/to/trace.json

self-contained: standard library only.
"""
import json
import os
import sys

CANDIDATE = json.loads(r'''${embedded.replace(/'''/g, "\\'\\'\\'")}''')


def load_trace():
    path = os.environ.get('TRACE_JSON') or (sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].endswith('.json') else None)
    if not path:
        raise RuntimeError('trace JSON 경로를 TRACE_JSON 환경변수나 인자로 제공하세요')
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def span_matches(span, name):
    if span.get('name') == name:
        return True
    if f"{span.get('type')}:{span.get('name')}" == name:
        return True
    return span.get('name', '').endswith(name) or name.endswith(span.get('name', ''))


def find_span(trace, name):
    for span in trace.get('spans', []):
        if span.get('name') == name:
            return span
    for span in trace.get('spans', []):
        if span_matches(span, name):
            return span
    return None


def get_by_path(root, path):
    import re
    segments = [seg for seg in re.sub(r'\\[(\\d+)\\]', r'.\\1', path).split('.') if seg]
    current = root
    for segment in segments:
        if current is None:
            return None
        if isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return None
        elif isinstance(current, dict):
            current = current.get(segment)
        else:
            return None
    return current


def verification_passed(span):
    output = span.get('output')
    if output is True:
        return True
    if isinstance(output, dict):
        for key in ('matches_success_criteria', 'passed', 'ok', 'success'):
            if isinstance(output.get(key), bool):
                return output[key]
    return span.get('status') == 'ok'


def evaluate(assertion, trace):
    kind = assertion['type']
    if kind == 'json_path_equals':
        span = find_span(trace, assertion.get('span_name', ''))
        if not span:
            return False, f"span '{assertion.get('span_name')}' not found"
        actual = get_by_path(span, assertion.get('path', ''))
        expected = assertion.get('expected')
        return actual == expected, f"{assertion.get('path')}: expected {expected!r}, got {actual!r}"
    if kind == 'json_path_not_equals':
        span = find_span(trace, assertion.get('span_name', ''))
        if not span:
            return True, 'span absent — trivially not equal'
        actual = get_by_path(span, assertion.get('path', ''))
        return actual != assertion.get('expected'), f"{assertion.get('path')} equals forbidden value {assertion.get('expected')!r}"
    if kind == 'span_exists':
        found = find_span(trace, assertion.get('span_name', '')) is not None
        return found, f"span '{assertion.get('span_name')}' {'exists' if found else 'missing'}"
    if kind == 'span_not_exists':
        found = find_span(trace, assertion.get('span_name', '')) is not None
        return not found, f"forbidden span '{assertion.get('span_name')}' {'present' if found else 'absent'}"
    if kind == 'verification_must_pass':
        verifications = [
            span for span in trace.get('spans', [])
            if span.get('type') == 'verification'
            and (not assertion.get('span_name') or span_matches(span, assertion['span_name']))
        ]
        if not verifications:
            return False, 'no verification span found'
        failed = [span.get('name') for span in verifications if not verification_passed(span)]
        return not failed, f"verification failed: {', '.join(failed)}" if failed else 'all verification passed'
    if kind == 'tool_call_count_at_most':
        calls = [
            span for span in trace.get('spans', [])
            if span.get('type') == 'tool'
            and (not assertion.get('tool_name') or span_matches(span, assertion['tool_name']))
        ]
        maximum = assertion.get('max_count', 0)
        return len(calls) <= maximum, f"tool calls {len(calls)} vs max {maximum}"
    return False, f"unsupported assertion type: {kind}"


def test_${testName}():
    trace = load_trace()
    failures = []
    for assertion in CANDIDATE['assertions']:
        passed, message = evaluate(assertion, trace)
        if not passed:
            failures.append(f"[{assertion['type']}] {message}")
    assert not failures, '\\n'.join(failures)
`;
}
