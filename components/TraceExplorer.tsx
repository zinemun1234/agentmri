'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import wrongTimeJson from '@/fixtures/calendar-failure-wrong-time.json';
import costSpikeJson from '@/fixtures/cost-spike.json';
import evaluatorFalseNegativeJson from '@/fixtures/evaluator-false-negative.json';
import ignoredToolErrorJson from '@/fixtures/ignored-tool-error.json';
import repeatedLoopJson from '@/fixtures/repeated-tool-loop.json';
import retrievalWithoutEvidenceJson from '@/fixtures/retrieval-without-evidence.json';
import successfulCalendarJson from '@/fixtures/successful-calendar.json';
import multiRun01 from '@/fixtures/multirun/calendar/run-01-pass.json';
import multiRun02 from '@/fixtures/multirun/calendar/run-02-pass.json';
import multiRun03 from '@/fixtures/multirun/calendar/run-03-wrong-time.json';
import multiRun04 from '@/fixtures/multirun/calendar/run-04-pass-no-verification.json';
import unverifiedExternalActionJson from '@/fixtures/unverified-external-action.json';
import { auditVerdict } from '@/lib/audit';
import { compareTraces } from '@/lib/compare';
import { runDetectors } from '@/lib/detectors';
import type { CanonicalTrace, ValidationIssue } from '@/lib/types';
import { parseAndValidateTrace } from '@/lib/validate';
import { adaptTrace } from '@/lib/adapters';
import AuditReport from './AuditReport';
import MultiRunPanel from './MultiRunPanel';
import { IconAlert, IconClock, IconCoin, IconLayers, IconPulse, IconWrench } from './icons';
import FindingsPanel from './FindingsPanel';
import SpanDetail from './SpanDetail';
import SpanTree from './SpanTree';
import Timeline from './Timeline';
import TraceCompare from './TraceCompare';

const samples = [
  {
    key: 'success',
    label: '성공 실행',
    description: '검증까지 완료한 정상 trace',
    trace: successfulCalendarJson as unknown as CanonicalTrace
  },
  {
    key: 'wrong-time',
    label: '잘못된 회의 시간',
    description: '회의 시간을 잘못 추출해 verification이 실패한 paired trace',
    trace: wrongTimeJson as unknown as CanonicalTrace
  },
  {
    key: 'loop',
    label: '반복 루프 실패',
    description: '같은 도구 호출이 반복되는 실패 trace',
    trace: repeatedLoopJson as unknown as CanonicalTrace
  },
  {
    key: 'false-negative',
    label: '채점 오류 의심',
    description: '실행은 성공인데 evaluator가 FAIL로 판정한 trace',
    trace: evaluatorFalseNegativeJson as unknown as CanonicalTrace
  },
  {
    key: 'cost-spike',
    label: '비용 급증',
    description: '한 분석 span이 baseline보다 훨씬 높은 비용을 사용한 trace',
    trace: costSpikeJson as unknown as CanonicalTrace
  },
  {
    key: 'unverified-external',
    label: '외부 행동 미검증',
    description: '외부 시스템 제출 후 verification이 없는 trace',
    trace: unverifiedExternalActionJson as unknown as CanonicalTrace
  },
  {
    key: 'no-retrieval',
    label: '근거 없는 주장',
    description: '조회 evidence 없이 사실형 답변을 생성한 trace',
    trace: retrievalWithoutEvidenceJson as unknown as CanonicalTrace
  },
  {
    key: 'ignored-error',
    label: '도구 오류 무시',
    description: '파일 쓰기 오류 후 복구 없이 종료한 trace',
    trace: ignoredToolErrorJson as unknown as CanonicalTrace
  }
];

const multiRunFixtures = [
  multiRun01,
  multiRun02,
  multiRun03,
  multiRun04
] as unknown as CanonicalTrace[];

function formatDuration(startedAt: string, endedAt?: string): string {
  if (!endedAt) return '-';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(trace: CanonicalTrace): string {
  const cost = trace.spans.reduce((sum, span) => sum + (span.usage?.cost_usd ?? 0), 0);
  return `$${cost.toFixed(4)}`;
}

type SampleTone = 'good' | 'bad' | 'warning' | 'neutral';

function sampleTone(trace: CanonicalTrace): SampleTone {
  const verdict = trace.evaluation?.verdict;
  const status = trace.status;
  const hasFindings = runDetectors(trace).length > 0;
  if (status === 'success' && verdict === 'pass') return hasFindings ? 'warning' : 'good';
  if (status === 'success' && verdict === 'fail') return 'warning';
  if (status === 'failure' && verdict === 'pass') return 'warning';
  if (verdict === 'fail' || status === 'failure') return 'bad';
  return hasFindings ? 'warning' : 'neutral';
}

export default function TraceExplorer() {
  const [trace, setTrace] = useState<CanonicalTrace>(samples[0].trace);
  const [selectedSpanId, setSelectedSpanId] = useState<string>('root');
  const [jsonText, setJsonText] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [sourceLabel, setSourceLabel] = useState(samples[0].label);

  const findings = useMemo(() => runDetectors(trace), [trace]);
  const goldenTrace = samples[0].trace;
  const auditComparison = useMemo(() => {
    if (trace.trace_id === goldenTrace.trace_id) return undefined;
    const normalize = (value?: string) => (value ?? '').replace(/\s+/g, ' ').trim();
    if (normalize(trace.task?.instruction) !== normalize(goldenTrace.task?.instruction)) return undefined;
    return compareTraces(goldenTrace, trace);
  }, [trace, goldenTrace]);
  const verdictAudit = useMemo(() => auditVerdict(trace, findings, { comparison: auditComparison }), [trace, findings, auditComparison]);
  const spanById = useMemo(() => new Map(trace.spans.map((span) => [span.span_id, span])), [trace]);
  const selectedSpan = selectedSpanId ? spanById.get(selectedSpanId) : undefined;
  const toolCount = trace.spans.filter((span) => span.type === 'tool').length;
  const errorCount = trace.spans.filter((span) => span.status === 'error').length;

  function loadSample(key: string) {
    const sample = samples.find((item) => item.key === key);
    if (!sample) return;
    setTrace(sample.trace);
    setSelectedSpanId(sample.trace.spans[0]?.span_id ?? '');
    setJsonText(JSON.stringify(sample.trace, null, 2));
    setIssues([]);
    setSourceLabel(sample.label);
  }

  function applyJson(text: string, label: string) {
    let source = text;
    let adaptedFormat = '';
    try {
      const adaptation = adaptTrace(JSON.parse(text));
      if (adaptation.trace && adaptation.format !== 'canonical') {
        source = JSON.stringify(adaptation.trace);
        adaptedFormat = adaptation.format;
      }
    } catch {
      // JSON 파싱 실패는 parseAndValidateTrace가 보고한다
    }
    const result = parseAndValidateTrace(source);
    setIssues(result.issues);
    if (result.ok && result.trace) {
      setTrace(result.trace);
      setSelectedSpanId(result.trace.spans[0]?.span_id ?? '');
      setSourceLabel(adaptedFormat ? `${label} (${adaptedFormat} 변환)` : label);
    }
  }

  function inspectComparedSpan(comparedTrace: CanonicalTrace, label: string, spanId: string) {
    setTrace(comparedTrace);
    setSelectedSpanId(spanId);
    setJsonText(JSON.stringify(comparedTrace, null, 2));
    setIssues([]);
    setSourceLabel(label);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJsonText(text);
    applyJson(text, file.name);
  }

  const verdictNeedsReview = verdictAudit.audited_verdict === 'evaluator_false_negative_suspected';

  return (
    <div className="app-layout">
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/brand-mark.svg" alt="" className="brand-mark-img" width={28} height={28} />
        <div>
          <strong>AgentMRI</strong>
          <small>trace audit MVP</small>
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="trace library">
        <span className="sidebar-section-label">trace library</span>
        {samples.map((sample) => (
          <button
            key={sample.key}
            type="button"
            className={`sidebar-item tone-${sampleTone(sample.trace)}${sourceLabel === sample.label ? ' active' : ''}`}
            onClick={() => loadSample(sample.key)}
            title={sample.description}
          >
            <span className="tone-dot" aria-hidden="true" />
            <span className="sidebar-item-text">
              <span>{sample.label}</span>
              <small>{sample.trace.spans.length} spans · {sample.trace.evaluation?.verdict ?? 'no eval'}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="sidebar-import">
        <span className="sidebar-section-label">import</span>
        <label className="file-picker">
          JSON 파일 업로드
          <input type="file" accept="application/json,.json" onChange={handleFileChange} />
        </label>
        <details className="paste-box">
          <summary>JSON 붙여넣기</summary>
          <textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            placeholder="canonical trace JSON을 붙여넣으세요"
            spellCheck={false}
          />
          <button type="button" onClick={() => applyJson(jsonText, '붙여넣은 trace')}>
            검증하고 불러오기
          </button>
        </details>
      </div>
    </aside>
    <main className="app-shell">
      <header className="hero">
        <div>
          <h1>에이전트 실행과 평가를 감사하는 Trace Explorer</h1>
          <p className="hero-copy">
            실행 로그를 구조화하고, 규칙 기반 detector로 위험 신호를 찾고, PASS/FAIL 판정이 evidence와 맞는지
            확인합니다.
          </p>
        </div>
        <div className="hero-card">
          <span>현재 trace</span>
          <strong>{trace.trace_id}</strong>
          <small>{sourceLabel}</small>
        </div>
      </header>

      {issues.length > 0 ? (
        <section className="import-panel panel">
          <div className="validation-errors">
            <strong>검증 오류 {issues.length}건</strong>
            <ul>
              {issues.slice(0, 5).map((validationIssue) => (
                <li key={`${validationIssue.path}:${validationIssue.message}`}>
                  <code>{validationIssue.path}</code> {validationIssue.message}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="summary-grid" aria-label="Trace summary">
        <div className="summary-card">
          <span><IconPulse size={13} /> status</span>
          <strong>{trace.status ?? 'unknown'}</strong>
        </div>
        <div className="summary-card">
          <span><IconLayers size={13} /> spans</span>
          <strong>{trace.spans.length}</strong>
        </div>
        <div className="summary-card">
          <span><IconWrench size={13} /> tool calls</span>
          <strong>{toolCount}</strong>
        </div>
        <div className="summary-card">
          <span><IconAlert size={13} /> errors</span>
          <strong>{errorCount}</strong>
        </div>
        <div className="summary-card">
          <span><IconClock size={13} /> duration</span>
          <strong>{formatDuration(trace.started_at, trace.ended_at)}</strong>
        </div>
        <div className="summary-card">
          <span><IconCoin size={13} /> cost</span>
          <strong>{formatCost(trace)}</strong>
        </div>
      </section>

      {trace.evaluation ? (
        <section className={`verdict-panel ${verdictNeedsReview ? 'needs-review' : ''}`}>
          <div>
            <span>원래 평가</span>
            <strong>{trace.evaluation.verdict}</strong>
            {trace.evaluation.score !== undefined ? <em>score {trace.evaluation.score}</em> : null}
          </div>
          <p>{trace.evaluation.evaluator_comment}</p>
          {verdictNeedsReview ? (
            <strong className="review-label">실행 상태는 성공이고 detector finding이 없어 verdict 재감사 후보입니다.</strong>
          ) : null}
        </section>
      ) : null}

      <AuditReport audit={verdictAudit} onSelectSpan={setSelectedSpanId} />

      <TraceCompare
        sources={samples}
        defaultBaselineKey="success"
        defaultCandidateKey="wrong-time"
        onInspectSpan={inspectComparedSpan}
      />

      <MultiRunPanel runs={multiRunFixtures} title="Multi-run Flakiness — calendar task" />

      <div className="explorer-grid">
        <SpanTree trace={trace} selectedSpanId={selectedSpanId} findings={findings} onSelect={setSelectedSpanId} />
        <div className="center-column">
          <Timeline
            trace={trace}
            selectedSpanId={selectedSpanId}
            evidenceSpanIds={findings.flatMap((finding) => finding.evidence_span_ids)}
            onSelect={setSelectedSpanId}
          />
          <FindingsPanel findings={findings} onSelectSpan={setSelectedSpanId} />
        </div>
        <SpanDetail span={selectedSpan} />
      </div>
    </main>
    </div>
  );
}
