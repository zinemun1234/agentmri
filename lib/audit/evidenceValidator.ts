import type { CanonicalTrace, Finding } from '../types';
import type { EvidenceValidationResult } from './types';

export function uniqueSpanIds(spanIds: string[]): string[] {
  return [...new Set(spanIds)];
}

export function validateEvidenceReferences(trace: CanonicalTrace, evidenceSpanIds: string[]): EvidenceValidationResult {
  const existingIds = new Set(trace.spans.map((span) => span.span_id));
  const uniqueIds = uniqueSpanIds(evidenceSpanIds);
  const validSpanIds = uniqueIds.filter((spanId) => existingIds.has(spanId));
  const missingSpanIds = uniqueIds.filter((spanId) => !existingIds.has(spanId));

  return {
    ok: validSpanIds.length > 0 && missingSpanIds.length === 0,
    evidence_count: validSpanIds.length,
    valid_span_ids: validSpanIds,
    missing_span_ids: missingSpanIds
  };
}

export function validateFindingsEvidence(trace: CanonicalTrace, findings: Finding[]) {
  const results = findings.map((finding) => ({
    finding_id: finding.finding_id,
    ...validateEvidenceReferences(trace, finding.evidence_span_ids)
  }));

  return {
    ok: results.every((result) => result.ok),
    total_findings: findings.length,
    findings_with_valid_evidence: results.filter((result) => result.evidence_count > 0).length,
    missing_span_ids: uniqueSpanIds(results.flatMap((result) => result.missing_span_ids)),
    results
  };
}
