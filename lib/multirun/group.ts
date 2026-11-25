import type { CanonicalTrace } from '../types';
import { taskFingerprint } from './fingerprint';
import type { RunGroup, RunRef } from './types';

export function groupRunsByTask(runs: Array<CanonicalTrace | RunRef>): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const input of runs) {
    const ref: RunRef = 'trace' in input ? (input as RunRef) : { trace: input as CanonicalTrace };
    const fingerprint = taskFingerprint(ref.trace);
    let group = groups.get(fingerprint.hash);
    if (!group) {
      group = { fingerprint, runs: [], golden_source: 'none' };
      groups.set(fingerprint.hash, group);
    }
    group.runs.push(ref);
    if (ref.trace.metadata?.golden === true) {
      group.golden_trace_id = ref.trace.trace_id;
      group.golden_source = 'manual';
    }
  }
  return [...groups.values()].sort((a, b) => b.runs.length - a.runs.length);
}
