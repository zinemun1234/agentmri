/**
 * AgentMRI CI audit gate.
 *
 * usage:
 *   npx tsx scripts/agentmri-audit.ts --baseline golden.json --candidate run.json
 *   npx tsx scripts/agentmri-audit.ts --candidate run.json   (audit only, no comparison)
 *
 * exit code 1 when:
 *   - candidate has high/critical detector findings
 *   - verdict audit reclassifies as evaluator false positive/negative suspected
 *   - comparison shows verification steps removed vs baseline
 *
 * writes a markdown report to $GITHUB_STEP_SUMMARY when running in GitHub Actions.
 */
import { readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { groupRunsByTask, analyzeRunGroup } from '../lib/multirun';
import { auditVerdict } from '../lib/audit';
import { compareTraces } from '../lib/compare';
import { runDetectors } from '../lib/detectors';
import { parseAndValidateTrace } from '../lib/validate';
import type { CanonicalTrace } from '../lib/types';

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadTrace(path: string): CanonicalTrace {
  const raw = readFileSync(path, 'utf-8');
  const { trace, issues } = parseAndValidateTrace(raw);
  if (!trace) {
    console.error(`✗ ${path}: 유효한 canonical trace가 아닙니다`);
    for (const issue of issues) console.error(`  - ${issue.path}: ${issue.message}`);
    process.exit(2);
  }
  return trace;
}

const runsDir = arg('--runs');

if (runsDir) {
  // multi-run flakiness gate — 디렉터리의 trace들을 task별로 묶어 불안정성을 판정한다
  const minPassRate = Number(arg('--min-pass-rate') ?? '0.8');
  const maxFlakiness = Number(arg('--max-flakiness') ?? '0.3');
  const minPassPowK = Number(arg('--min-pass-pow-k') ?? '0.4');
  const files = readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) {
    console.error(`✗ ${runsDir}: trace JSON 파일이 없습니다`);
    process.exit(2);
  }
  const traces = files.map((name) => ({ path: join(runsDir, name), trace: loadTrace(join(runsDir, name)) }));
  const groups = groupRunsByTask(traces.map(({ trace }) => trace));
  const lines: string[] = [`## AgentMRI Multi-run Audit — ${files.length} runs, ${groups.length} task group(s)`, ''];
  let failed = false;

  for (const group of groups) {
    const report = analyzeRunGroup(group);
    // k는 배포 파라미터(연속 실행 횟수) — 샘플 크기와 무관하게 기본 3회 기준으로 평가한다
    const kEval = Math.min(3, report.run_count);
    const curvePoint = report.pass_k_curve.find((point) => point.k === kEval);
    const passPowK = curvePoint ? curvePoint.pass_pow_k : 1;
    const k = kEval;
    const violations: string[] = [];
    if (report.pass_rate < minPassRate) violations.push(`pass rate ${(report.pass_rate * 100).toFixed(0)}% < ${minPassRate * 100}%`);
    if (report.flakiness_score > maxFlakiness) violations.push(`flakiness ${report.flakiness_score.toFixed(2)} > ${maxFlakiness}`);
    if (passPowK < minPassPowK) violations.push(`pass^${k} ${(passPowK * 100).toFixed(0)}% < ${minPassPowK * 100}%`);
    if (violations.length > 0) failed = true;

    lines.push(`### task ${report.fingerprint.hash.slice(0, 12)} — ${report.run_count} runs`);
    lines.push(`- pass rate: ${(report.pass_rate * 100).toFixed(0)}% (95% 구간 ${(report.pass_rate_interval.low * 100).toFixed(0)}~${(report.pass_rate_interval.high * 100).toFixed(0)}%)`);
    lines.push(`- flakiness: ${report.flakiness_score.toFixed(2)} · flip rate ${(report.flip_rate * 100).toFixed(0)}% · pass^${k} ${(passPowK * 100).toFixed(0)}%`);
    if (report.most_divergent_step_key) lines.push(`- 가장 자주 갈라지는 step: \`${report.most_divergent_step_key}\``);
    if (report.evidence.golden_trace_id) lines.push(`- golden: \`${report.evidence.golden_trace_id}\``);
    lines.push(violations.length > 0 ? `- ✗ gate 위반: ${violations.join(', ')}` : '- ✓ 임계값 통과');
    lines.push('');
  }

  const reportText = lines.join('\n');
  console.log(reportText);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${reportText}\n\n`);
  if (failed) {
    console.error('\n✗ multi-run audit gate FAILED — flakiness/pass rate 임계값 위반');
    process.exit(1);
  }
  console.log('\n✓ multi-run audit gate passed');
  process.exit(0);
}

const candidatePath = arg('--candidate');
const baselinePath = arg('--baseline');
if (!candidatePath) {
  console.error('usage: npx tsx scripts/agentmri-audit.ts --candidate run.json [--baseline golden.json]\n       npx tsx scripts/agentmri-audit.ts --runs <dir> [--min-pass-rate 0.8] [--max-flakiness 0.3] [--min-pass-pow-k 0.4]');
  process.exit(2);
}

const candidate = loadTrace(candidatePath);
const findings = runDetectors(candidate);
const comparison = baselinePath ? compareTraces(loadTrace(baselinePath), candidate) : undefined;
const audit = auditVerdict(candidate, findings, comparison ? { comparison } : undefined);

const severe = findings.filter((finding) => finding.severity === 'high' || finding.severity === 'critical');
const verdictFlags =
  audit.audited_verdict === 'evaluator_false_positive_suspected' || audit.audited_verdict === 'evaluator_false_negative_suspected';
const verificationRemoved = comparison?.rows.some(
  (row) => row.divergence_type === 'verification_removed' || (row.baseline_span?.type === 'verification' && !row.candidate_span)
);

const lines: string[] = [];
lines.push(`## AgentMRI Audit — ${candidate.trace_id}`);
lines.push('');
lines.push(`- verdict: \`${audit.original_verdict}\` → audit: **${audit.audited_verdict}** (reliability ${audit.verdict_reliability}, confidence ${audit.audit_confidence})`);
lines.push(`- detector findings: ${findings.length}건 (high/critical ${severe.length}건)`);
for (const finding of findings.slice(0, 5)) {
  lines.push(`  - [${finding.severity}] ${finding.title} — evidence: ${finding.evidence_span_ids.join(', ')}`);
}
if (comparison) {
  const divergent = comparison.rows.filter((row) => row.status !== 'same').length;
  lines.push(`- comparison: divergent steps ${divergent}개`);
  if (comparison.first_divergence) {
    lines.push(`  - first divergence: \`${comparison.first_divergence.type}\` — ${comparison.first_divergence.summary}`);
  }
  if (verificationRemoved) lines.push(`  - ⚠ baseline의 verification step이 candidate에서 사라짐`);
}
lines.push(`- rationale: ${audit.rationale}`);

const report = lines.join('\n');
console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n\n`);
}

// true_failure도 게이트 차단 대상 — audit이 확인한 실제 실패를 CI가 통과시키면 안 된다
const trueFailure = audit.audited_verdict === 'true_failure';
const failed = severe.length > 0 || verdictFlags || Boolean(verificationRemoved) || trueFailure;
if (failed) {
  console.error(`\n✗ audit gate FAILED — severe findings ${severe.length}, verdict 재분류 ${verdictFlags}, verification 소실 ${Boolean(verificationRemoved)}, true failure ${trueFailure}`);
  process.exit(1);
}
console.log('\n✓ audit gate passed');
