import type { TraceComparison } from '../compare';
import { semanticDifferences } from '../compare/diff';

export interface ComparisonFacts {
  available: boolean;
  semanticChangedRows: number;
  totalRows: number;
  hasMeaningfulDivergence: boolean;
  divergenceNoiseOnly: boolean;
  verificationRemovedCount: number;
  verificationAddedCount: number;
  uncertainAlignment: boolean;
  divergenceType?: string;
  divergenceConfidence?: string;
  candidateEvidenceSpanIds: string[];
  signalLines: string[];
}

export function extractComparisonFacts(comparison?: TraceComparison): ComparisonFacts {
  if (!comparison) {
    return {
      available: false,
      semanticChangedRows: 0,
      totalRows: 0,
      hasMeaningfulDivergence: false,
      divergenceNoiseOnly: false,
      verificationRemovedCount: 0,
      verificationAddedCount: 0,
      uncertainAlignment: false,
      candidateEvidenceSpanIds: [],
      signalLines: []
    };
  }

  const divergentRows = comparison.rows.filter((row) => row.status !== 'same');
  const divergence = comparison.first_divergence;
  const divergenceSemanticDiffs = divergence ? semanticDifferences(divergence.field_differences) : [];
  const uncertainAlignment = divergence?.type === 'uncertain_alignment';
  const hasMeaningfulDivergence = Boolean(
    divergence && divergenceSemanticDiffs.length > 0 && !uncertainAlignment && divergence.confidence !== 'low'
  );
  const divergenceNoiseOnly = !divergence || (divergentRows.length === 0 || divergenceSemanticDiffs.length === 0);

  const verificationRemovedCount = divergentRows.filter((row) => row.divergence_type === 'verification_removed').length;
  const verificationAddedCount = divergentRows.filter((row) => row.divergence_type === 'verification_added').length;

  const candidateEvidenceSpanIds = [
    divergence?.candidate_span_id,
    ...(comparison.propagation_chain?.nodes.map((node) => node.span_id) ?? [])
  ].filter((id): id is string => Boolean(id));

  const signalLines: string[] = [];
  signalLines.push(
    `compare: golden baseline 대비 semantic divergence ${divergentRows.length}개 step`
  );
  if (divergence) {
    signalLines.push(
      `compare: first divergence type=${divergence.type}, confidence=${divergence.confidence}`
    );
  } else {
    signalLines.push('compare: semantic divergence 없음 — golden과 실행이 사실상 동일');
  }
  if (verificationRemovedCount > 0) {
    signalLines.push(`compare: baseline에 있던 verification step ${verificationRemovedCount}개가 candidate에서 사라짐`);
  }
  if (verificationAddedCount > 0) {
    signalLines.push(`compare: candidate에 verification step ${verificationAddedCount}개 추가됨`);
  }
  if (uncertainAlignment) {
    signalLines.push('compare: alignment 불확실 — 비교 evidence의 신뢰도 제한');
  }

  return {
    available: true,
    semanticChangedRows: divergentRows.length,
    totalRows: comparison.rows.length,
    hasMeaningfulDivergence,
    divergenceNoiseOnly,
    verificationRemovedCount,
    verificationAddedCount,
    uncertainAlignment,
    divergenceType: divergence?.type,
    divergenceConfidence: divergence?.confidence,
    candidateEvidenceSpanIds: [...new Set(candidateEvidenceSpanIds)],
    signalLines
  };
}
