export type SpanType =
  | 'agent'
  | 'llm'
  | 'tool'
  | 'retrieval'
  | 'verification'
  | 'human'
  | 'system';

export type SpanStatus = 'ok' | 'error' | 'cancelled' | 'unknown';

export interface TaskSpec {
  instruction: string;
  success_criteria: string[];
  forbidden_actions?: string[];
  environment?: Record<string, unknown>;
}

export interface SpanError {
  type?: string;
  message?: string;
}

export interface SpanUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
}

export interface CanonicalSpan {
  span_id: string;
  parent_span_id?: string;
  type: SpanType;
  name: string;
  started_at: string;
  ended_at?: string;
  input?: unknown;
  output?: unknown;
  status?: SpanStatus;
  error?: SpanError;
  usage?: SpanUsage;
  attributes?: Record<string, unknown>;
}

export interface EvaluationVerdict {
  verdict: 'pass' | 'fail' | 'unknown';
  score?: number;
  evaluator_comment?: string;
}

export interface CanonicalTrace {
  trace_id: string;
  project_id?: string;
  agent_name?: string;
  started_at: string;
  ended_at?: string;
  status?: 'success' | 'failure' | 'unknown';
  task: TaskSpec;
  spans: CanonicalSpan[];
  evaluation?: EvaluationVerdict;
  metadata?: Record<string, unknown>;
}

export type FailureCategory =
  | 'planning_specification'
  | 'execution_grounding'
  | 'verification_feedback'
  | 'environment_integration'
  | 'data_retrieval'
  | 'security_policy'
  | 'cost_latency'
  | 'evaluator_false_negative'
  | 'broken_task'
  | 'insufficient_evidence';

export interface Finding {
  finding_id: string;
  detector_id: string;
  category: FailureCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  evidence_span_ids: string[];
  evidence_quotes?: string[];
  recommended_test?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  trace?: CanonicalTrace;
}
