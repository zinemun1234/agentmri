import type { CanonicalTrace, Finding } from '../types';

export interface Detector {
  id: string;
  title: string;
  description: string;
  run(trace: CanonicalTrace): Finding[];
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function makeFinding(input: Omit<Finding, 'finding_id'>): Finding {
  return {
    ...input,
    finding_id: `${input.detector_id}:${input.evidence_span_ids.join('+')}`
  };
}
