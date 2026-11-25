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
import { readFileSync, appendFileSync } from 'node:fs';
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

const candidatePath = arg('--candidate');
const baselinePath = arg('--baseline');
if (!candidatePath) {
  console.error('usage: npx tsx scripts/agentmri-audit.ts --candidate run.json [--baseline golden.json]');
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
