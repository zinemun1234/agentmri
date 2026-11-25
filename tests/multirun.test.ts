import { describe, expect, it } from 'vitest';
import run01 from '../fixtures/multirun/calendar/run-01-pass.json';
import run02 from '../fixtures/multirun/calendar/run-02-pass.json';
import run03 from '../fixtures/multirun/calendar/run-03-wrong-time.json';
import run04 from '../fixtures/multirun/calendar/run-04-pass-no-verification.json';
import repeatedLoopJson from '../fixtures/repeated-tool-loop.json';
import costSpikeJson from '../fixtures/cost-spike.json';
import { taskFingerprint, groupRunsByTask, analyzeRunGroup, selectGolden, wilsonInterval } from '../lib/multirun';
import type { CanonicalTrace } from '../lib/types';

const runs = [run01, run02, run03, run04] as unknown as CanonicalTrace[];

describe('taskFingerprint', () => {
  it('같은 task의 run들은 동일한 fingerprint를 갖는다', () => {
    const hashes = runs.map((run) => taskFingerprint(run).hash);
    expect(new Set(hashes).size).toBe(1);
  });

  it('다른 task는 다른 fingerprint를 갖는다', () => {
    const calendarHash = taskFingerprint(runs[0]).hash;
    const loopHash = taskFingerprint(repeatedLoopJson as unknown as CanonicalTrace).hash;
    const costHash = taskFingerprint(costSpikeJson as unknown as CanonicalTrace).hash;
    expect(calendarHash).not.toBe(loopHash);
    expect(calendarHash).not.toBe(costHash);
    expect(loopHash).not.toBe(costHash);
  });

  it('metadata.task_group이 있으면 수동 그룹 키를 우선한다', () => {
    const clone = JSON.parse(JSON.stringify(run01)) as CanonicalTrace;
    clone.metadata = { ...clone.metadata, task_group: 'custom-group' };
    expect(taskFingerprint(clone).hash).toBe('task-manual-custom-group');
  });
});

describe('groupRunsByTask', () => {
  it('같은 task의 run을 한 그룹으로 묶고 다른 task는 분리한다', () => {
    const groups = groupRunsByTask([...runs, repeatedLoopJson as unknown as CanonicalTrace]);
    expect(groups.length).toBe(2);
    const calendarGroup = groups.find((group) => group.runs.length === 4);
    expect(calendarGroup).toBeDefined();
  });
});

describe('selectGolden', () => {
  it('정상 pass run을 golden으로 자동 선정하고 근거를 남긴다', () => {
    const [group] = groupRunsByTask(runs);
    const selection = selectGolden(group);
    expect(selection.source).toBe('auto');
    expect(selection.trace_id).toBeDefined();
    expect(['calendar-run-01', 'calendar-run-02']).toContain(selection.trace_id);
    expect(selection.trace_id).not.toBe('calendar-run-03');
    expect(selection.trace_id).not.toBe('calendar-run-04');
    expect(selection.rationale.length).toBeGreaterThan(1);
  });

  it('자격 있는 run이 없으면 none을 반환한다', () => {
    const failOnly = groupRunsByTask([runs[2]]);
    const selection = selectGolden(failOnly[0]);
    expect(selection.source).toBe('none');
    expect(selection.trace_id).toBeUndefined();
  });
});

describe('analyzeRunGroup', () => {
  it('calendar 그룹의 flakiness를 정확히 계산한다', () => {
    const [group] = groupRunsByTask(runs);
    const selection = selectGolden(group);
    group.golden_trace_id = selection.trace_id;
    const report = analyzeRunGroup(group);

    expect(report.run_count).toBe(4);
    expect(report.verdict_counts.pass).toBe(3);
    expect(report.verdict_counts.fail).toBe(1);
    expect(report.is_flaky).toBe(true);
    expect(report.pass_rate).toBeCloseTo(0.75);
    expect(report.flakiness_score).toBeCloseTo(0.5);
    expect(report.pass_rate_interval.low).toBeLessThan(0.75);
    expect(report.pass_rate_interval.high).toBeGreaterThan(0.75);
    expect(report.comparisons_vs_golden.length).toBe(3);
  });

  it('verification step의 presence_rate가 1 미만으로 잡힌다 (run-04 누락)', () => {
    const [group] = groupRunsByTask(runs);
    const selection = selectGolden(group);
    group.golden_trace_id = selection.trace_id;
    const report = analyzeRunGroup(group);

    const verificationStep = report.step_flakiness.find((step) => step.step_key.includes('verification'));
    expect(verificationStep).toBeDefined();
    expect(verificationStep!.presence_rate).toBeLessThan(1);
  });

  it('회의 시간 추출 step이 가장 divergence가 높은 step 중 하나다', () => {
    const [group] = groupRunsByTask(runs);
    const selection = selectGolden(group);
    group.golden_trace_id = selection.trace_id;
    const report = analyzeRunGroup(group);

    expect(report.most_divergent_step_key).toBeDefined();
    const extractStep = report.step_flakiness.find((step) => step.step_key.includes('회의 시간'));
    expect(extractStep).toBeDefined();
    expect(extractStep!.divergent_run_count).toBeGreaterThan(0);
  });

  it('일관된 그룹(pass만)은 flakiness 0이다', () => {
    const consistent = groupRunsByTask([runs[0], runs[1]]);
    const selection = selectGolden(consistent[0]);
    consistent[0].golden_trace_id = selection.trace_id;
    const report = analyzeRunGroup(consistent[0]);

    expect(report.is_flaky).toBe(false);
    expect(report.flakiness_score).toBe(0);
  });
});

describe('wilsonInterval', () => {
  it('소표본에서 넓은 구간을 반환한다', () => {
    const interval = wilsonInterval(3, 4);
    expect(interval.high - interval.low).toBeGreaterThan(0.3);
    expect(interval.low).toBeGreaterThanOrEqual(0);
    expect(interval.high).toBeLessThanOrEqual(1);
  });

  it('전부 성공이면 low가 1 미만이다 (플래키 아님 증명 불가)', () => {
    const interval = wilsonInterval(10, 10);
    expect(interval.low).toBeLessThan(1);
    expect(interval.high).toBe(1);
  });
});
