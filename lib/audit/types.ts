import type { EvaluationVerdict, FailureCategory } from '../types';

export type AuditedVerdict =
  | 'true_pass'
  | 'true_failure'
  | 'evaluator_false_negative_suspected'
  | 'evaluator_false_positive_suspected'
  | 'insufficient_evidence';

export type Confidence = 'low' | 'medium' | 'high';

export interface EvidenceValidationResult {
  ok: boolean;
  evidence_count: number;
  valid_span_ids: string[];
  missing_span_ids: string[];
}

export interface VerdictAuditResult {
  original_verdict: EvaluationVerdict['verdict'];
  audited_verdict: AuditedVerdict;
  verdict_reliability: Confidence;
  audit_confidence: Confidence;
  failure_category?: FailureCategory;
  rationale: string;
  signals: string[];
  evidence_span_ids: string[];
  evidence_validation: EvidenceValidationResult;
  recommended_tests: string[];
}
