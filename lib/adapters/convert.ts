import type { CanonicalSpan, CanonicalTrace, SpanType } from '../types';
import type { AdaptResult, MappingReport, SourceFormat } from './types';

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return typeof value === 'object' && value !== null ? (value as AnyRecord) : {};
}

// ---------- format detection ----------

export function detectSourceFormat(data: unknown): SourceFormat {
  const root = asRecord(data);
  if (typeof root.trace_id === 'string' && Array.isArray(root.spans)) return 'canonical';
  if (Array.isArray(root.resourceSpans)) return 'otlp';
  if (typeof root.run_type === 'string' || Array.isArray(root.child_runs) || typeof root.dotted_order === 'string') return 'langsmith';
  if (Array.isArray(root.observations)) return 'langfuse';
  return 'unknown';
}

// ---------- shared helpers ----------

function nanoToIso(nano: unknown): string | undefined {
  const value = Number(nano);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value / 1e6).toISOString();
}

function msToIso(ms: unknown): string | undefined {
  const value = typeof ms === 'string' ? Date.parse(ms) : Number(ms);
  if (!Number.isFinite(value)) return undefined;
  return new Date(value).toISOString();
}

function normalizeIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function attrValue(attribute: AnyRecord): unknown {
  const value = asRecord(attribute.value);
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('boolValue' in value) return value.boolValue;
  return undefined;
}

// ---------- OTLP ----------

function otlpSpanType(attributes: Map<string, unknown>, name: string): SpanType {
  const operation = String(attributes.get('gen_ai.operation.name') ?? '').toLowerCase();
  if (operation.includes('execute_tool') || operation.includes('tool')) return 'tool';
  if (operation.includes('chat') || operation.includes('completion') || operation.includes('text_completion')) return 'llm';
  if (operation.includes('retrieve') || operation.includes('embedding') || operation.includes('search')) return 'retrieval';
  if (operation.includes('agent') || operation.includes('workflow') || operation.includes('invoke')) return 'agent';
  if (operation.includes('verify') || operation.includes('evaluat')) return 'verification';
  if (/tool|function|search|get_|create_|write_|send_/.test(name.toLowerCase())) return 'tool';
  return attributes.has('gen_ai.request.model') || attributes.has('gen_ai.system') ? 'llm' : 'system';
}

function convertOtlp(root: AnyRecord, report: MappingReport): CanonicalTrace | undefined {
  const resourceSpans = root.resourceSpans as AnyRecord[];
  const rawSpans: AnyRecord[] = [];
  for (const resource of resourceSpans ?? []) {
    for (const scope of (resource.scopeSpans as AnyRecord[]) ?? []) {
      for (const span of (scope.spans as AnyRecord[]) ?? []) rawSpans.push(span);
    }
  }
  if (rawSpans.length === 0) {
    report.warnings.push('resourceSpans 안에 span이 없습니다');
    return undefined;
  }

  const spans: CanonicalSpan[] = rawSpans.map((raw) => {
    const attributes = new Map<string, unknown>();
    for (const attribute of (raw.attributes as AnyRecord[]) ?? []) {
      attributes.set(String(attribute.key), attrValue(attribute));
    }
    const name = String(raw.name ?? 'unnamed');
    const type = otlpSpanType(attributes, name);
    const usage: CanonicalSpan['usage'] = {};
    const inputTokens = attributes.get('gen_ai.usage.input_tokens');
    const outputTokens = attributes.get('gen_ai.usage.output_tokens');
    if (typeof inputTokens === 'number') usage.input_tokens = inputTokens;
    if (typeof outputTokens === 'number') usage.output_tokens = outputTokens;
    const statusObj = asRecord(raw.status);
    const isError = String(statusObj.code ?? '').includes('ERROR');
    report.mapped_fields.push(`span ${name}: gen_ai.operation/usage 매핑`);
    return {
      span_id: String(raw.spanId ?? `span-${Math.random().toString(36).slice(2, 8)}`),
      parent_span_id: raw.parentSpanId ? String(raw.parentSpanId) : undefined,
      type,
      name,
      started_at: nanoToIso(raw.startTimeUnixNano) ?? new Date(0).toISOString(),
      ended_at: nanoToIso(raw.endTimeUnixNano),
      status: isError ? 'error' : 'ok',
      input: attributes.get('gen_ai.prompt') ?? attributes.get('input.value'),
      output: attributes.get('gen_ai.completion') ?? attributes.get('output.value'),
      usage: Object.keys(usage).length > 0 ? usage : undefined,
      attributes: Object.fromEntries(attributes)
    };
  });

  const started = spans.map((span) => Date.parse(span.started_at)).filter(Number.isFinite);
  const startMs = Math.min(...started);
  const endMs = Math.max(...spans.map((span) => Date.parse(span.ended_at ?? span.started_at)));
  const hasError = spans.some((span) => span.status === 'error');
  report.assumed_fields.push('task.instruction — OTLP에는 task 정보가 없어 trace 이름으로 대체');
  report.ignored_fields.push('resource attributes', 'scope 정보', 'span events/links');

  return {
    trace_id: String((rawSpans[0] as AnyRecord).traceId ?? `otlp-${Date.now()}`),
    started_at: new Date(startMs).toISOString(),
    ended_at: new Date(endMs).toISOString(),
    status: hasError ? 'failure' : 'success',
    task: { instruction: String(root.name ?? 'OTLP import — instruction unknown'), success_criteria: [] },
    spans,
    metadata: { source_format: 'otlp', otel_scope: true }
  };
}

// ---------- LangSmith ----------

function langsmithSpanType(runType: string): SpanType {
  switch (runType) {
    case 'llm':
      return 'llm';
    case 'tool':
      return 'tool';
    case 'retriever':
      return 'retrieval';
    case 'chain':
    case 'agent':
      return 'agent';
    default:
      return 'system';
  }
}

function flattenLangsmithRuns(run: AnyRecord, parentId?: string): Array<{ run: AnyRecord; parentId?: string }> {
  const out: Array<{ run: AnyRecord; parentId?: string }> = [{ run, parentId }];
  for (const child of (run.child_runs as AnyRecord[]) ?? []) {
    out.push(...flattenLangsmithRuns(child, String(run.id ?? run.run_id ?? '')));
  }
  return out;
}

function convertLangsmith(root: AnyRecord, report: MappingReport): CanonicalTrace | undefined {
  const flat = flattenLangsmithRuns(root);
  if (flat.length === 0) return undefined;

  const spans: CanonicalSpan[] = flat.map(({ run, parentId }, index) => {
    const id = String(run.id ?? run.run_id ?? `run-${index}`);
    const usage: CanonicalSpan['usage'] = {};
    if (typeof run.prompt_tokens === 'number') usage.input_tokens = run.prompt_tokens as number;
    if (typeof run.completion_tokens === 'number') usage.output_tokens = run.completion_tokens as number;
    if (typeof run.total_cost === 'number') usage.cost_usd = run.total_cost as number;
    return {
      span_id: id,
      parent_span_id: parentId || undefined,
      type: langsmithSpanType(String(run.run_type ?? '')),
      name: String(run.name ?? 'unnamed'),
      started_at: normalizeIso(run.start_time) ?? new Date(0).toISOString(),
      ended_at: normalizeIso(run.end_time),
      input: run.inputs,
      output: run.error ? undefined : run.outputs,
      status: run.error ? 'error' : 'ok',
      error: run.error ? { type: 'langsmith_error', message: String(run.error) } : undefined,
      usage: Object.keys(usage).length > 0 ? usage : undefined
    };
  });

  report.mapped_fields.push('run_type → span type', 'inputs/outputs', 'prompt/completion tokens');
  report.ignored_fields.push('dotted_order', 'feedback', 'tags');
  report.assumed_fields.push('task.instruction — root run inputs 기반 추정');

  const startMs = Math.min(...spans.map((span) => Date.parse(span.started_at)));
  const endMs = Math.max(...spans.map((span) => Date.parse(span.ended_at ?? span.started_at)));
  const rootInputs = asRecord(root.inputs);
  const instruction =
    typeof rootInputs.input === 'string'
      ? rootInputs.input
      : typeof rootInputs.instruction === 'string'
        ? (rootInputs.instruction as string)
        : String(root.name ?? 'LangSmith import');

  return {
    trace_id: String(root.id ?? root.run_id ?? `langsmith-${Date.now()}`),
    started_at: new Date(startMs).toISOString(),
    ended_at: new Date(endMs).toISOString(),
    status: spans.some((span) => span.status === 'error') ? 'failure' : 'success',
    task: { instruction, success_criteria: [] },
    spans,
    metadata: { source_format: 'langsmith' }
  };
}

// ---------- Langfuse ----------

function langfuseSpanType(observation: AnyRecord): SpanType {
  const type = String(observation.type ?? '').toUpperCase();
  if (type === 'GENERATION') return 'llm';
  if (type === 'EVENT') return 'system';
  const name = String(observation.name ?? '').toLowerCase();
  if (/tool|search|get_|create_|write_|send_|fetch/.test(name)) return 'tool';
  if (/retriev|embed|vector/.test(name)) return 'retrieval';
  if (/verif|eval|check/.test(name)) return 'verification';
  return 'system';
}

function convertLangfuse(root: AnyRecord, report: MappingReport): CanonicalTrace | undefined {
  const observations = root.observations as AnyRecord[];
  if (!observations || observations.length === 0) return undefined;

  const spans: CanonicalSpan[] = observations.map((observation, index) => {
    const usageDetails = asRecord(observation.usageDetails);
    const costDetails = asRecord(observation.costDetails);
    const usage: CanonicalSpan['usage'] = {};
    if (typeof usageDetails.input === 'number') usage.input_tokens = usageDetails.input as number;
    if (typeof usageDetails.output === 'number') usage.output_tokens = usageDetails.output as number;
    if (typeof costDetails.total === 'number') usage.cost_usd = costDetails.total as number;
    const isError = String(observation.level ?? '').toUpperCase() === 'ERROR';
    return {
      span_id: String(observation.id ?? `obs-${index}`),
      parent_span_id: observation.parentObservationId ? String(observation.parentObservationId) : undefined,
      type: langfuseSpanType(observation),
      name: String(observation.name ?? 'unnamed'),
      started_at: normalizeIso(observation.startTime) ?? new Date(0).toISOString(),
      ended_at: normalizeIso(observation.endTime),
      input: observation.input,
      output: observation.output,
      status: isError ? 'error' : 'ok',
      error: isError ? { type: 'langfuse_error', message: String(observation.statusMessage ?? 'error level') } : undefined,
      usage: Object.keys(usage).length > 0 ? usage : undefined,
      attributes: observation.model ? { model: observation.model } : undefined
    };
  });

  report.mapped_fields.push('observation type → span type', 'usageDetails/costDetails', 'input/output');
  report.ignored_fields.push('scores', 'session metadata');
  report.assumed_fields.push('task.instruction — trace input 기반 추정');

  const startMs = Math.min(...spans.map((span) => Date.parse(span.started_at)));
  const endMs = Math.max(...spans.map((span) => Date.parse(span.ended_at ?? span.started_at)));
  const traceInput = typeof root.input === 'string' ? root.input : String(root.name ?? 'Langfuse import');

  return {
    trace_id: String(root.id ?? `langfuse-${Date.now()}`),
    started_at: new Date(startMs).toISOString(),
    ended_at: new Date(endMs).toISOString(),
    status: spans.some((span) => span.status === 'error') ? 'failure' : 'success',
    task: { instruction: traceInput, success_criteria: [] },
    spans,
    metadata: { source_format: 'langfuse' }
  };
}

// ---------- entry point ----------

export function adaptTrace(data: unknown): AdaptResult {
  const format = detectSourceFormat(data);
  const report: MappingReport = { format, mapped_fields: [], assumed_fields: [], ignored_fields: [], warnings: [] };

  if (format === 'canonical') {
    return { trace: data as CanonicalTrace, format, report };
  }
  const root = asRecord(data);
  let trace: CanonicalTrace | undefined;
  if (format === 'otlp') trace = convertOtlp(root, report);
  else if (format === 'langsmith') trace = convertLangsmith(root, report);
  else if (format === 'langfuse') trace = convertLangfuse(root, report);
  else report.warnings.push('알 수 없는 포맷 — canonical/OTLP/LangSmith/Langfuse 중 하나여야 합니다');

  return { trace, format, report };
}
