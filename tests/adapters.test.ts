import { describe, expect, it } from 'vitest';
import { adaptTrace, detectSourceFormat } from '../lib/adapters';
import { validateCanonicalTrace } from '../lib/validate';

const OTLP_SAMPLE = {
  resourceSpans: [{
    scopeSpans: [{
      spans: [
        {
          traceId: 'abc123', spanId: 's1', name: 'chat gpt-4o',
          startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000002000000000',
          attributes: [
            { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
            { key: 'gen_ai.usage.input_tokens', value: { intValue: '100' } },
            { key: 'gen_ai.usage.output_tokens', value: { intValue: '50' } },
            { key: 'gen_ai.system', value: { stringValue: 'openai' } }
          ],
          status: { code: 'STATUS_CODE_OK' }
        },
        {
          traceId: 'abc123', spanId: 's2', parentSpanId: 's1', name: 'execute_tool search',
          startTimeUnixNano: '1700000003000000000', endTimeUnixNano: '1700000005000000000',
          attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } }],
          status: { code: 'STATUS_CODE_ERROR', message: 'timeout' }
        }
      ]
    }]
  }]
};

const LANGSMITH_SAMPLE = {
  id: 'root-run', run_type: 'chain', name: 'calendar-agent',
  start_time: '2023-11-14T22:13:20Z', end_time: '2023-11-14T22:13:30Z',
  inputs: { input: '내일 회의 잡아줘' },
  outputs: { result: '완료' },
  child_runs: [
    {
      id: 'child-1', run_type: 'llm', name: 'gpt-4-call',
      start_time: '2023-11-14T22:13:21Z', end_time: '2023-11-14T22:13:23Z',
      inputs: { prompt: 'plan' }, outputs: { text: 'plan result' },
      prompt_tokens: 200, completion_tokens: 80
    },
    {
      id: 'child-2', run_type: 'tool', name: 'calendar.create',
      start_time: '2023-11-14T22:13:24Z', end_time: '2023-11-14T22:13:26Z',
      inputs: { title: '회의' }, error: 'connection failed'
    }
  ]
};

const LANGFUSE_SAMPLE = {
  id: 'lf-trace-1', name: 'agent-run', input: '보고서 작성해줘',
  observations: [
    {
      id: 'obs-1', type: 'GENERATION', name: 'gpt-4o generation',
      startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T10:00:03Z',
      input: { messages: [] }, output: { text: 'ok' },
      usageDetails: { input: 300, output: 120 }, costDetails: { total: 0.002 },
      model: 'gpt-4o'
    },
    {
      id: 'obs-2', type: 'SPAN', name: 'tool web_search', parentObservationId: 'obs-1',
      startTime: '2024-01-01T10:00:04Z', endTime: '2024-01-01T10:00:06Z',
      input: { query: 'x' }, output: { results: [] }, level: 'ERROR', statusMessage: 'failed'
    }
  ]
};

describe('detectSourceFormat', () => {
  it('포맷을 구별한다', () => {
    expect(detectSourceFormat({ trace_id: 'x', spans: [] })).toBe('canonical');
    expect(detectSourceFormat(OTLP_SAMPLE)).toBe('otlp');
    expect(detectSourceFormat(LANGSMITH_SAMPLE)).toBe('langsmith');
    expect(detectSourceFormat(LANGFUSE_SAMPLE)).toBe('langfuse');
    expect(detectSourceFormat({ random: true })).toBe('unknown');
  });
});

describe('OTLP adapter', () => {
  const result = adaptTrace(OTLP_SAMPLE);
  it('canonical trace로 변환되고 validation을 통과한다', () => {
    expect(result.format).toBe('otlp');
    expect(result.trace).toBeDefined();
    expect(validateCanonicalTrace(result.trace!).issues).toEqual([]);
  });
  it('gen_ai operation과 usage가 매핑된다', () => {
    const llm = result.trace!.spans.find((span) => span.span_id === 's1')!;
    expect(llm.type).toBe('llm');
    expect(llm.usage?.input_tokens).toBe(100);
    const tool = result.trace!.spans.find((span) => span.span_id === 's2')!;
    expect(tool.type).toBe('tool');
    expect(tool.status).toBe('error');
    expect(tool.parent_span_id).toBe('s1');
  });
  it('nanosecond 타임스탬프가 ISO로 변환된다', () => {
    expect(result.trace!.spans[0].started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('LangSmith adapter', () => {
  const result = adaptTrace(LANGSMITH_SAMPLE);
  it('중첩 child_runs를 flat span으로 변환하고 validation을 통과한다', () => {
    expect(result.format).toBe('langsmith');
    expect(result.trace!.spans).toHaveLength(3);
    expect(validateCanonicalTrace(result.trace!).issues).toEqual([]);
  });
  it('run_type과 토큰/비용이 매핑되고 에러가 보존된다', () => {
    const llm = result.trace!.spans.find((span) => span.name === 'gpt-4-call')!;
    expect(llm.type).toBe('llm');
    expect(llm.usage?.input_tokens).toBe(200);
    const tool = result.trace!.spans.find((span) => span.name === 'calendar.create')!;
    expect(tool.type).toBe('tool');
    expect(tool.status).toBe('error');
  });
  it('instruction을 root inputs에서 추정한다', () => {
    expect(result.trace!.task.instruction).toBe('내일 회의 잡아줘');
  });
});

describe('Langfuse adapter', () => {
  const result = adaptTrace(LANGFUSE_SAMPLE);
  it('observations를 span으로 변환하고 validation을 통과한다', () => {
    expect(result.format).toBe('langfuse');
    expect(result.trace!.spans).toHaveLength(2);
    expect(validateCanonicalTrace(result.trace!).issues).toEqual([]);
  });
  it('GENERATION→llm, usageDetails/costDetails가 매핑된다', () => {
    const gen = result.trace!.spans.find((span) => span.span_id === 'obs-1')!;
    expect(gen.type).toBe('llm');
    expect(gen.usage?.output_tokens).toBe(120);
    expect(gen.usage?.cost_usd).toBe(0.002);
  });
  it('ERROR level이 error 상태로 변환된다', () => {
    const tool = result.trace!.spans.find((span) => span.span_id === 'obs-2')!;
    expect(tool.type).toBe('tool');
    expect(tool.status).toBe('error');
  });
});

describe('unknown format', () => {
  it('trace 없이 경고를 반환한다', () => {
    const result = adaptTrace({ random: true });
    expect(result.trace).toBeUndefined();
    expect(result.report.warnings.length).toBeGreaterThan(0);
  });
});
