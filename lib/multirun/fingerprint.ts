import { stableStringify } from '../compare/diff';
import type { CanonicalTrace, TaskSpec } from '../types';
import type { TaskFingerprint } from './types';

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeTaskSpec(task: TaskSpec): unknown {
  return {
    instruction: normalizeText(task.instruction),
    success_criteria: (task.success_criteria ?? []).map(normalizeText),
    forbidden_actions: (task.forbidden_actions ?? []).map(normalizeText),
    environment: task.environment ?? {}
  };
}

// FNV-1a 64bit — browser-safe, sync, dependency-free
export function fnv1a64hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index) & 0xff);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function taskFingerprint(trace: CanonicalTrace): TaskFingerprint {
  const manual = typeof trace.metadata?.task_group === 'string' ? (trace.metadata.task_group as string) : undefined;
  if (manual) {
    return { hash: `task-manual-${manual}`, instruction_preview: normalizeText(trace.task.instruction).slice(0, 80) };
  }
  const canonical = stableStringify(normalizeTaskSpec(trace.task));
  return {
    hash: `task-${fnv1a64hex(canonical).slice(0, 12)}`,
    instruction_preview: normalizeText(trace.task.instruction).slice(0, 80)
  };
}
