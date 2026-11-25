import type { CanonicalSpan, CanonicalTrace } from '../types';

export function orderedSpans(trace: CanonicalTrace): CanonicalSpan[] {
  return [...trace.spans].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

export function finalSpan(trace: CanonicalTrace): CanonicalSpan | undefined {
  return orderedSpans(trace).at(-1);
}

export function stringifyEvidence(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isEvidenceProducingSpan(span: CanonicalSpan): boolean {
  if (span.type === 'retrieval') return true;
  if (span.type !== 'tool') return false;
  return /search|read|get|query|fetch|lookup|retrieve|find|조회|검색/i.test(span.name);
}

export function isExternalActionSpan(span: CanonicalSpan): boolean {
  if (span.type !== 'tool') return false;
  if (span.attributes?.side_effect === 'external' || span.attributes?.external_action === true) return true;
  return /send|submit|publish|upload|post|delete|update|create/i.test(span.name);
}
