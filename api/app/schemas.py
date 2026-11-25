from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


SpanType = Literal['agent', 'llm', 'tool', 'retrieval', 'verification', 'human', 'system']
SpanStatus = Literal['ok', 'error', 'cancelled', 'unknown']


class TaskSpec(BaseModel):
    instruction: str = Field(min_length=1)
    success_criteria: list[str]
    forbidden_actions: Optional[list[str]] = None
    environment: Optional[dict[str, Any]] = None


class SpanError(BaseModel):
    type: Optional[str] = None
    message: Optional[str] = None


class SpanUsage(BaseModel):
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost_usd: Optional[float] = None


class CanonicalSpan(BaseModel):
    model_config = ConfigDict(extra='allow')

    span_id: str = Field(min_length=1)
    parent_span_id: Optional[str] = None
    type: SpanType
    name: str = Field(min_length=1)
    started_at: str
    ended_at: Optional[str] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    status: Optional[SpanStatus] = None
    error: Optional[SpanError] = None
    usage: Optional[SpanUsage] = None
    attributes: Optional[dict[str, Any]] = None


class EvaluationVerdict(BaseModel):
    verdict: Literal['pass', 'fail', 'unknown']
    score: Optional[float] = None
    evaluator_comment: Optional[str] = None


class CanonicalTrace(BaseModel):
    model_config = ConfigDict(extra='allow')

    trace_id: str = Field(min_length=1)
    project_id: Optional[str] = None
    agent_name: Optional[str] = None
    started_at: str
    ended_at: Optional[str] = None
    status: Optional[Literal['success', 'failure', 'unknown']] = None
    task: TaskSpec
    spans: list[CanonicalSpan]
    evaluation: Optional[EvaluationVerdict] = None
    metadata: Optional[dict[str, Any]] = None

    @model_validator(mode='after')
    def validate_span_references(self):
        ids = [span.span_id for span in self.spans]
        if len(ids) != len(set(ids)):
            raise ValueError('중복된 span_id가 있습니다.')
        id_set = set(ids)
        for span in self.spans:
            if span.parent_span_id and span.parent_span_id not in id_set:
                raise ValueError(f'존재하지 않는 parent_span_id입니다: {span.parent_span_id}')
            if span.parent_span_id == span.span_id:
                raise ValueError('span은 자기 자신을 parent로 가질 수 없습니다.')
        return self
