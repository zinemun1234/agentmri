import json
from typing import Any

from .schemas import CanonicalTrace


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str)


def detect_repeated_tool_loop(trace: CanonicalTrace) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[Any]] = {}
    tool_spans = sorted(
        (span for span in trace.spans if span.type == 'tool'),
        key=lambda span: span.started_at,
    )
    for span in tool_spans:
        key = (span.name, stable_json(span.input))
        groups.setdefault(key, []).append(span)

    findings = []
    for (tool_name, input_json), spans in groups.items():
        if len(spans) < 3:
            continue
        evidence_ids = [span.span_id for span in spans]
        findings.append(
            {
                'finding_id': 'D01:' + '+'.join(evidence_ids),
                'detector_id': 'D01',
                'category': 'cost_latency',
                'severity': 'high' if len(spans) >= 4 else 'medium',
                'confidence': 'high',
                'title': f'{tool_name} 도구가 같은 입력으로 {len(spans)}회 반복 호출됨',
                'description': '동일한 도구 입력이 반복되면 루프 또는 불필요한 비용 증가일 수 있습니다.',
                'evidence_span_ids': evidence_ids,
                'evidence_quotes': [input_json[:140]],
                'recommended_test': '같은 입력이 2회 연속 실패하거나 동일 결과를 반환하면 다른 전략을 선택하는지 검증합니다.',
            }
        )
    return findings
