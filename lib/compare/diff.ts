export type FieldDifferenceKind =
  | 'value_changed'
  | 'field_added'
  | 'field_removed'
  | 'array_item_added'
  | 'array_item_removed'
  | 'array_item_changed';

export interface FieldDifference {
  path: string;
  kind: FieldDifferenceKind;
  baseline_value?: unknown;
  candidate_value?: unknown;
  semantic: boolean;
  noise_reason?: string;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(basePath: string, key: string | number): string {
  if (typeof key === 'number') return `${basePath}[${key}]`;
  return basePath ? `${basePath}.${key}` : key;
}

function noiseReason(path: string): string | undefined {
  const normalized = path.toLowerCase();
  if (/(^|\.)(trace_id|span_id|parent_span_id|started_at|ended_at)$/.test(normalized)) {
    return '실행 식별자/시간 메타데이터는 semantic diff에서 제외합니다.';
  }
  if (/(^|\.)usage(\.|$)/.test(normalized)) {
    return 'token/cost usage는 실행마다 자연스럽게 변할 수 있는 noise로 분류합니다.';
  }
  if (/(^|\.)(event_id|request_id|run_id|session_id|message_id)$/.test(normalized)) {
    return '랜덤 식별자는 semantic diff에서 제외합니다.';
  }
  return undefined;
}

function difference(
  path: string,
  kind: FieldDifferenceKind,
  baselineValue: unknown,
  candidateValue: unknown
): FieldDifference {
  const reason = noiseReason(path);
  return {
    path,
    kind,
    baseline_value: baselineValue,
    candidate_value: candidateValue,
    semantic: !reason,
    noise_reason: reason
  };
}

export function diffValues(baseline: unknown, candidate: unknown, basePath = ''): FieldDifference[] {
  if (stableStringify(baseline) === stableStringify(candidate)) return [];

  if (Array.isArray(baseline) && Array.isArray(candidate)) {
    const differences: FieldDifference[] = [];
    const sharedLength = Math.min(baseline.length, candidate.length);
    for (let index = 0; index < sharedLength; index += 1) {
      differences.push(...diffValues(baseline[index], candidate[index], joinPath(basePath, index)));
    }
    for (let index = sharedLength; index < baseline.length; index += 1) {
      differences.push(difference(joinPath(basePath, index), 'array_item_removed', baseline[index], undefined));
    }
    for (let index = sharedLength; index < candidate.length; index += 1) {
      differences.push(difference(joinPath(basePath, index), 'array_item_added', undefined, candidate[index]));
    }
    return differences;
  }

  if (isPlainObject(baseline) && isPlainObject(candidate)) {
    const differences: FieldDifference[] = [];
    const keys = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();
    for (const key of keys) {
      const path = joinPath(basePath, key);
      const hasBaseline = Object.prototype.hasOwnProperty.call(baseline, key);
      const hasCandidate = Object.prototype.hasOwnProperty.call(candidate, key);
      if (hasBaseline && !hasCandidate) {
        differences.push(difference(path, 'field_removed', baseline[key], undefined));
      } else if (!hasBaseline && hasCandidate) {
        differences.push(difference(path, 'field_added', undefined, candidate[key]));
      } else {
        differences.push(...diffValues(baseline[key], candidate[key], path));
      }
    }
    return differences;
  }

  return [difference(basePath || 'value', 'value_changed', baseline, candidate)];
}

export function semanticDifferences(differences: FieldDifference[]): FieldDifference[] {
  return differences.filter((item) => item.semantic);
}

export function findValueOccurrences(value: unknown, target: unknown, basePath = ''): string[] {
  if (value === undefined || value === null || typeof value === 'object') return [];
  if (stableStringify(value) === stableStringify(target)) return [basePath || 'value'];
  if (Array.isArray(target)) {
    return target.flatMap((item, index) => findValueOccurrences(value, item, joinPath(basePath, index)));
  }
  if (isPlainObject(target)) {
    return Object.keys(target).flatMap((key) => findValueOccurrences(value, target[key], joinPath(basePath, key)));
  }
  return [];
}
