import { compareTraces } from '../compare';
import { runDetectors } from '../detectors';
import type { RunGroup, RunRef } from './types';

export interface GoldenSelection {
  trace_id?: string;
  source: 'manual' | 'auto' | 'none';
  rationale: string[];
}

function semanticChangeCount(baseline: RunRef, candidate: RunRef): number {
  const comparison = compareTraces(baseline.trace, candidate.trace);
  return comparison.rows.filter((row) => row.status !== 'same').length;
}

export function selectGolden(group: RunGroup): GoldenSelection {
  if (group.golden_source === 'manual' && group.golden_trace_id) {
    return {
      trace_id: group.golden_trace_id,
      source: 'manual',
      rationale: ['수동으로 지정된 golden run입니다.']
    };
  }

  const eligible = group.runs.filter((run) => {
    const trace = run.trace;
    if (trace.status !== 'success') return false;
    if (trace.evaluation?.verdict !== 'pass') return false;
    if (!trace.spans.some((span) => span.type === 'verification')) return false;
    const severe = runDetectors(trace).filter((finding) => finding.severity === 'high' || finding.severity === 'critical');
    return severe.length === 0;
  });

  if (eligible.length === 0) {
    return {
      source: 'none',
      rationale: ['pass + verification 보유 + severe finding 없음 조건을 만족하는 run이 없어 golden을 자동 선정할 수 없습니다.']
    };
  }

  const rationale: string[] = [`자격 필터 통과 후보 ${eligible.length}개 (pass + verification + severe finding 0건).`];

  // medoid scoring: minimal total semantic divergence from other runs
  let best: { run: RunRef; score: number; totalDivergence: number } | undefined;
  for (const candidate of eligible) {
    let totalDivergence = 0;
    for (const other of group.runs) {
      if (other.trace.trace_id === candidate.trace.trace_id) continue;
      totalDivergence += semanticChangeCount(candidate, other);
    }
    const verificationCount = candidate.trace.spans.filter((span) => span.type === 'verification').length;
    const score = -totalDivergence + verificationCount * 0.5;
    if (!best || score > best.score) {
      best = { run: candidate, score, totalDivergence };
    } else if (score === best.score) {
      // deterministic tiebreak: earlier started_at, then trace_id lexicographic
      const currentKey = `${candidate.trace.started_at}|${candidate.trace.trace_id}`;
      const bestKey = `${best.run.trace.started_at}|${best.run.trace.trace_id}`;
      if (currentKey < bestKey) {
        best = { run: candidate, score, totalDivergence };
      }
    }
  }

  if (!best) {
    return { source: 'none', rationale: ['medoid 계산 실패'] };
  }

  rationale.push(`medoid: 다른 run들과의 semantic divergence 합 ${best.totalDivergence}로 최소.`);
  rationale.push(`verification span ${best.run.trace.spans.filter((span) => span.type === 'verification').length}개 보유.`);
  return { trace_id: best.run.trace.trace_id, source: 'auto', rationale };
}
