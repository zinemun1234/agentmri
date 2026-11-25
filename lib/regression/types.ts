export interface RegressionAssertion {
  type:
    | 'json_path_equals'
    | 'json_path_not_equals'
    | 'span_exists'
    | 'span_not_exists'
    | 'verification_must_pass'
    | 'tool_call_count_at_most';
  span_name?: string;
  tool_name?: string;
  path?: string;
  expected?: unknown;
  max_count?: number;
}

export interface RegressionCandidate {
  candidate_id: string;
  title: string;
  given: string;
  when: string;
  then: string[];
  assertions: RegressionAssertion[];
  confidence: 'low' | 'medium' | 'high';
  evidence_span_ids: string[];
  source: {
    baseline_trace_id: string;
    candidate_trace_id: string;
    first_divergence_span_id?: string;
    divergence_id?: string;
    field_path?: string;
  };
}
