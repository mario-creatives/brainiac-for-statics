'use client'

import { useState } from 'react'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Download, FlaskConical, X, Check, Pencil, Trash2 } from 'lucide-react'
import type { ProductRecommendationReport, TestSpec } from '@/app/api/products/[id]/recommendations/route'
import type { ScoreAgainstPlanReport, CandidateVerdict } from '@/app/api/products/[id]/score-against-plan/route'
import { ImageBatchTab } from '@/components/ImageBatchTab'

function csvEscape(s: string): string {
  if (s == null) return ''
  const needs = /[",\n]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needs ? `"${escaped}"` : escaped
}

function exportActionPlanCsv(report: ProductRecommendationReport) {
  // Strategists asked for a flat row-per-ad export. The breakdown sections
  // ride along as preamble rows so the file is self-contained when emailed.
  const rows: string[] = []
  rows.push('section,key,value')
  rows.push(`meta,generated_at,${csvEscape(report.generated_at)}`)
  rows.push(`meta,ads_analyzed,${report.ads_analyzed}`)
  for (const a of report.summary_actions ?? []) {
    rows.push(`summary_action,,${csvEscape(a)}`)
  }
  const bd = report.breakdown
  if (bd) {
    rows.push(`breakdown,winning_formats,${csvEscape(bd.winning_formats?.finding ?? '')}`)
    rows.push(`breakdown,winning_age_ranges,${csvEscape(bd.winning_age_ranges?.finding ?? '')}`)
    rows.push(`breakdown,winning_angles_hooks,${csvEscape(bd.winning_angles_hooks?.finding ?? '')}`)
    rows.push(`breakdown,winning_visuals,${csvEscape(bd.winning_visuals?.finding ?? '')}`)
    rows.push(`breakdown,winning_headlines,${csvEscape(bd.winning_headlines?.finding ?? '')}`)
    rows.push(`breakdown,winning_subheadlines,${csvEscape(bd.winning_subheadlines?.finding ?? '')}`)
    rows.push(`breakdown,winning_body,${csvEscape(bd.winning_body?.finding ?? '')}`)
    rows.push(`breakdown,cta_verdict,${csvEscape(bd.cta_presence?.verdict ?? '')}`)
    rows.push(`breakdown,losing_patterns,${csvEscape(bd.losing_patterns?.finding ?? '')}`)
  }
  rows.push('')
  rows.push('analysis_id,quadrant,failure_reason,salvage_test,actions,iteration_ideas')
  for (const ad of report.per_ad_recommendations ?? []) {
    rows.push([
      csvEscape(ad.analysis_id),
      csvEscape(ad.quadrant),
      csvEscape(ad.failure_reason ?? ''),
      csvEscape(ad.salvage_test ?? ''),
      csvEscape((ad.actions ?? []).join(' | ')),
      csvEscape((ad.iteration_ideas ?? []).join(' | ')),
    ].join(','))
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `action-plan-${new Date(report.generated_at).toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface Props {
  token: string
  productId: string
  report: ProductRecommendationReport | null
  generatedAt: string | null
  onRegenerated: (r: ProductRecommendationReport) => void
  onCleared?: () => void
}

async function readJsonStream(res: Response): Promise<Record<string, unknown>> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: !done })
  }
  const last = text.split('\n').filter(l => l.trim()).pop() ?? '{}'
  return JSON.parse(last)
}

export function ActionPlanCard({ token, productId, report, generatedAt, onRegenerated, onCleared }: Props) {
  const [generating, setGenerating] = useState(false)
  const [scoringOpen, setScoringOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    if (generating) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${productId}/recommendations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Request failed (${res.status})`)
        onCleared?.()
        setGenerating(false)
        return
      }
      const data = await readJsonStream(res)
      if (data.insufficient_data) {
        setError('Not enough ads yet — add at least one with comprehensive analysis first.')
        onCleared?.()
      } else if (data.error) {
        // Server rejected an incomplete submission and deleted the stale
        // cached report. Clear the displayed report so the user sees the
        // empty "Generate action plan" state, not the previous broken one.
        setError(data.error as string)
        onCleared?.()
      } else {
        onRegenerated(data as unknown as ProductRecommendationReport)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setGenerating(false)
  }

  if (!report) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-3">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">Action plan</h3>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              Synthesize a no-fluff playbook from every ad in this product: what to scale, what to iterate, what's failing and why.
            </p>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {generating ? 'Generating action plan… (30–90s)' : 'Generate action plan'}
        </button>
        {error && <p className="text-xs text-[#ff2a2b]">{error}</p>}
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-white">Action plan</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Generated {generatedAt ? new Date(generatedAt).toLocaleString() : 'recently'}
              {report.ads_analyzed != null && report.ads_analyzed > 0 ? ` · ${report.ads_analyzed} ads` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => exportActionPlanCsv(report)}
            className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1"
            title="Download action plan as CSV"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1 disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-[#ff2a2b]">{error}</p>}

      {/* Summary actions — top-level direction */}
      {report.summary_actions?.length > 0 && (
        <div className="bg-indigo-950/30 border border-indigo-900/40 rounded-xl p-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-indigo-300 font-medium">Do this next</p>
          <ul className="space-y-1.5">
            {report.summary_actions.map((s, i) => (
              <li key={i} className="text-xs text-gray-200 leading-relaxed flex gap-2">
                <span className="text-indigo-400">→</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Breakdown sections */}
      <Section title="Winning formats">{report.breakdown?.winning_formats?.finding}</Section>
      <Section title="Winning age ranges">{report.breakdown?.winning_age_ranges?.finding}</Section>
      <Section title="Winning angles & hooks">{report.breakdown?.winning_angles_hooks?.finding}</Section>
      <Section title="Winning visuals">{report.breakdown?.winning_visuals?.finding}</Section>
      <Section title="Winning headlines">
        {report.breakdown?.winning_headlines?.finding}
        {report.breakdown?.winning_headlines?.structure && (
          <p className="text-[10px] text-gray-500 mt-1">Dominant structure: <span className="text-gray-300">{report.breakdown.winning_headlines.structure}</span> · words: <span className="text-gray-300">{report.breakdown.winning_headlines.word_count_range}</span></p>
        )}
      </Section>
      <Section title="Subheadlines">{report.breakdown?.winning_subheadlines?.finding}</Section>
      <Section title="Body copy">{report.breakdown?.winning_body?.finding}</Section>
      <Section title="CTA presence">
        <p className="text-xs text-gray-300 leading-relaxed">{report.breakdown?.cta_presence?.with_cta}</p>
        <p className="text-xs text-gray-300 leading-relaxed mt-1">{report.breakdown?.cta_presence?.without_cta}</p>
        <p className="text-[10px] text-indigo-300 mt-2 leading-relaxed">{report.breakdown?.cta_presence?.verdict}</p>
      </Section>
      <Section title="Winning combinations">
        {report.breakdown?.winning_combinations?.finding}
        {report.breakdown?.winning_combinations?.top_stacks?.length > 0 && (
          <ul className="mt-2 space-y-1">
            {report.breakdown.winning_combinations.top_stacks.map((s, i) => (
              <li key={i} className="text-[11px] text-gray-300 font-mono leading-relaxed">• {s}</li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Losing patterns">{report.breakdown?.losing_patterns?.finding}</Section>

      {/* Next test batch — rich per-spec briefs (with legacy angle_themes fallback) */}
      {report.next_test_batch && <NextTestBatchSection batch={report.next_test_batch} />}

      {/* Per-ad recommendations — only renders for legacy cached reports that
          still have this section. New action plans rely on the per-ad
          "What to test next" feature for ad-level guidance. */}
      {report.per_ad_recommendations && report.per_ad_recommendations.length > 0 && (
        <PerAdSection items={report.per_ad_recommendations} />
      )}

      {/* Test new candidates against this plan */}
      <div className="border-t border-gray-800 pt-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="max-w-md">
          <p className="text-xs text-white font-semibold">Test new candidates against this plan</p>
          <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">
            Upload up to 25 pre-launch ad concepts. Each gets graded ship / iterate / kill against the patterns above, plus a global read on gaps, redundancies, and what to add.
          </p>
        </div>
        <button
          onClick={() => setScoringOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 shrink-0"
        >
          <FlaskConical className="w-3.5 h-3.5" />
          Score candidates
        </button>
      </div>

      {scoringOpen && (
        <ScoreCandidatesModal
          token={token}
          productId={productId}
          onClose={() => setScoringOpen(false)}
        />
      )}
    </div>
  )
}

interface CandidateCard {
  id: string
  analysisId: string | null
  status: string
  hasComprehensive: boolean
}

function ScoreCandidatesModal({ token, productId, onClose }: { token: string; productId: string; onClose: () => void }) {
  const [cards, setCards] = useState<CandidateCard[]>([])
  const [scoring, setScoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ScoreAgainstPlanReport | null>(null)

  const ready = cards.filter(c => c.hasComprehensive && c.analysisId)
  const stillRunning = cards.filter(c => c.analysisId && !c.hasComprehensive && c.status !== 'failed')
  const failed = cards.filter(c => c.status === 'failed')

  async function handleScore() {
    if (scoring || ready.length === 0) return
    setScoring(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${productId}/score-against-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidate_ids: ready.map(c => c.analysisId).filter(Boolean) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Request failed (${res.status})`)
        setScoring(false)
        return
      }
      const data = await readJsonStream(res)
      if (data.error) {
        setError(data.error as string)
      } else {
        setReport(data as unknown as ScoreAgainstPlanReport)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setScoring(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-700 sm:rounded-2xl w-full max-w-5xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">Score candidates against action plan</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Upload pre-launch ads. Each gets analyzed, then graded against the plan&apos;s winning patterns.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {!report && (
            <ImageBatchTab
              token={token}
              productId={productId}
              forceMode="historical"
              onCardsUpdate={setCards}
            />
          )}

          {!report && (
            <div className="border-t border-gray-800 pt-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-gray-400">
                {cards.length === 0
                  ? 'Upload candidates above to get started.'
                  : `${ready.length} ready · ${stillRunning.length} analyzing · ${failed.length} failed`}
              </div>
              <button
                onClick={handleScore}
                disabled={scoring || ready.length === 0}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                {scoring ? 'Scoring…' : `Score ${ready.length} against plan`}
              </button>
            </div>
          )}

          {error && <p className="text-xs text-[#ff2a2b]">{error}</p>}

          {report && <ScoreReportView report={report} onClear={() => setReport(null)} />}
        </div>
      </div>
    </div>
  )
}

function ScoreReportView({ report, onClear }: { report: ScoreAgainstPlanReport; onClear: () => void }) {
  const shipCount     = report.per_candidate.filter(c => c.verdict === 'ship').length
  const iterateCount  = report.per_candidate.filter(c => c.verdict === 'iterate').length
  const killCount     = report.per_candidate.filter(c => c.verdict === 'kill').length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Verdict</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {report.candidates_scored} candidates · generated {new Date(report.generated_at).toLocaleString()}
          </p>
        </div>
        <button onClick={onClear} className="text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800">
          Score another batch
        </button>
      </div>

      <p className="text-xs text-gray-200 leading-relaxed bg-indigo-950/30 border border-indigo-900/40 rounded-xl px-4 py-3">
        {report.global_verdict}
      </p>

      <div className="grid grid-cols-3 gap-3">
        <Tally label="Ship"    n={shipCount}    accent="emerald" />
        <Tally label="Iterate" n={iterateCount} accent="amber" />
        <Tally label="Kill"    n={killCount}    accent="red" />
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Per candidate</p>
        <ul className="space-y-2">
          {report.per_candidate.map(c => <CandidateRow key={c.analysis_id} c={c} />)}
        </ul>
      </div>

      <ListBlock title="Gaps" hint="Winning patterns from the plan that NO candidate addresses" items={report.gaps}      accent="amber" />
      <ListBlock title="Redundancies" hint="Candidates that duplicate each other"                              items={report.redundancies} accent="gray" />
      <ListBlock title="Additions" hint="Angles the plan suggests but the batch is missing"                    items={report.additions} accent="emerald" />
    </div>
  )
}

function Tally({ label, n, accent }: { label: string; n: number; accent: 'emerald' | 'amber' | 'red' }) {
  const color =
    accent === 'emerald' ? 'text-emerald-400 border-emerald-900/50' :
    accent === 'amber'   ? 'text-amber-400 border-amber-900/50' :
                            'text-[#ff2a2b] border-red-900/50'
  return (
    <div className={`bg-gray-900 rounded-xl border ${color} px-4 py-3`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-0.5 ${color}`}>{n}</p>
    </div>
  )
}

function CandidateRow({ c }: { c: CandidateVerdict }) {
  const meta = c.verdict === 'ship'
    ? { color: 'border-emerald-900/50 bg-emerald-950/10', label: 'SHIP',    text: 'text-emerald-400', Icon: Check }
    : c.verdict === 'iterate'
    ? { color: 'border-amber-900/50 bg-amber-950/10',     label: 'ITERATE', text: 'text-amber-400',   Icon: Pencil }
    :                                                       { color: 'border-red-900/50 bg-red-950/10', label: 'KILL', text: 'text-[#ff2a2b]', Icon: Trash2 }
  const Icon = meta.Icon
  return (
    <li className={`rounded-lg border ${meta.color} px-3 py-2.5`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${meta.text} flex items-center gap-1`}>
            <Icon className="w-3 h-3" />
            {meta.label}
          </span>
          <span className="text-[10px] font-mono text-gray-500">{c.analysis_id.slice(0, 8)}</span>
        </div>
      </div>
      <p className="text-xs text-gray-200 leading-relaxed">{c.rationale}</p>
      <p className="text-[11px] text-gray-400 leading-relaxed mt-1">{c.plan_alignment}</p>
      {c.changes.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {c.changes.map((ch, i) => (
            <li key={i} className="text-[11px] text-gray-300 leading-snug">→ {ch}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

function ListBlock({ title, hint, items, accent }: { title: string; hint: string; items: string[]; accent: 'amber' | 'gray' | 'emerald' }) {
  if (!items?.length) return null
  const headColor =
    accent === 'amber'   ? 'text-amber-300' :
    accent === 'emerald' ? 'text-emerald-300' :
                           'text-gray-300'
  return (
    <div className="border-t border-gray-800 pt-4">
      <p className={`text-[10px] uppercase tracking-wider font-semibold ${headColor}`}>{title}</p>
      <p className="text-[10px] text-gray-600 mt-0.5">{hint}</p>
      <ul className="mt-2 space-y-1">
        {items.map((s, i) => (
          <li key={i} className="text-xs text-gray-300 leading-relaxed">• {s}</li>
        ))}
      </ul>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const isEmptyString = typeof children === 'string' && !children.trim()
  const isEmpty = !children || isEmptyString
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">{title}</p>
      {isEmpty
        ? <p className="text-xs text-gray-600 italic leading-relaxed">— no finding generated for this section. Click Regenerate.</p>
        : typeof children === 'string'
          ? <p className="text-xs text-gray-300 leading-relaxed">{children}</p>
          : children}
    </div>
  )
}

function NextTestBatchSection({ batch }: { batch: ProductRecommendationReport['next_test_batch'] }) {
  const specs = batch.specs ?? []
  const variations = batch.variations_per_spec ?? batch.variations_per_angle ?? 4
  const hasLegacyOnly = specs.length === 0 && (batch.angle_themes?.length ?? 0) > 0
  return (
    <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-medium">Next test batch</p>
        <span className="text-[10px] text-gray-400">{variations} variations × spec</span>
      </div>
      {batch.rationale && <p className="text-xs text-gray-300 leading-relaxed">{batch.rationale}</p>}

      {specs.length > 0 && (
        <ul className="space-y-3 mt-1">
          {specs.map((s, i) => <TestSpecCard key={i} index={i} spec={s} />)}
        </ul>
      )}

      {hasLegacyOnly && (
        <div className="flex flex-wrap gap-2 mt-1">
          {batch.angle_themes?.map((a, i) => (
            <span key={i} className="text-[10px] text-emerald-300 bg-gray-900 border border-emerald-900/60 rounded px-2 py-0.5">
              Angle: {a}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function TestSpecCard({ index, spec }: { index: number; spec: TestSpec }) {
  const [open, setOpen] = useState(index === 0)
  return (
    <li className="bg-gray-950 border border-gray-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-gray-900/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono font-bold text-emerald-400 tabular-nums shrink-0">#{index + 1}</span>
          <span className="text-xs text-white font-medium truncate">{spec.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-gray-500 font-mono">{spec.angle}</span>
          {open ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-800 pt-4">
          <div className="flex items-center justify-end">
            <CopyBriefButton spec={spec} />
          </div>

          {/* Sourcing brief — when the format requires a real person (testimonial/UGC),
              the model cannot fabricate the quote. It briefs you on what to find. */}
          {spec.sourcing_requirements && spec.sourcing_requirements.trim() && (
            <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-4">
              <p className="text-[9px] uppercase tracking-wider text-amber-300 font-semibold mb-1.5">Source this — don&apos;t fabricate</p>
              <p className="text-[12px] text-gray-200 leading-relaxed whitespace-pre-wrap">{spec.sourcing_requirements}</p>
              {spec.body_copy && (
                <div className="mt-3 pt-3 border-t border-amber-900/30">
                  <p className="text-[9px] uppercase tracking-wider text-amber-300/80 font-semibold mb-1">Quote pattern to elicit</p>
                  <p className="text-[12px] text-gray-300 italic leading-relaxed">{spec.body_copy}</p>
                </div>
              )}
            </div>
          )}

          {/* The Ad — final copy, designer-ready */}
          <SpecBlock title="The ad">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Headline</p>
                <CopyButton text={spec.headline} />
              </div>
              <p className="text-base text-white font-semibold leading-tight">{spec.headline}</p>

              {spec.subheadline_role !== 'absent' && spec.subheadline && (
                <>
                  <div className="border-t border-gray-800 pt-3 flex items-start justify-between gap-2">
                    <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Subheadline</p>
                    <CopyButton text={spec.subheadline} />
                  </div>
                  <p className="text-sm text-gray-200 leading-snug">{spec.subheadline}</p>
                </>
              )}

              {/* Body is hidden here when a sourcing brief is present — the body
                  is the quote pattern shown in the sourcing block above. */}
              {spec.body_role !== 'absent' && spec.body_copy && !spec.sourcing_requirements?.trim() && (
                <>
                  <div className="border-t border-gray-800 pt-3 flex items-start justify-between gap-2">
                    <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Body</p>
                    <CopyButton text={spec.body_copy} />
                  </div>
                  <p className="text-[13px] text-gray-200 leading-relaxed whitespace-pre-wrap">{spec.body_copy}</p>
                </>
              )}

              {spec.cta_framing !== 'none' && spec.cta && (
                <div className="border-t border-gray-800 pt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">CTA</p>
                    <span className="text-xs bg-indigo-600 text-white px-3 py-1 rounded font-medium">{spec.cta}</span>
                  </div>
                  <CopyButton text={spec.cta} />
                </div>
              )}
              {(spec.cta_framing === 'none' || !spec.cta) && (
                <div className="border-t border-gray-800 pt-3">
                  <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">CTA</p>
                  <p className="text-[11px] text-gray-500 italic">None — narrative carries the persuasion</p>
                </div>
              )}
            </div>

            {spec.brand_voice_notes && (
              <p className="text-[11px] text-gray-400 italic leading-relaxed mt-2">
                <span className="text-gray-500 not-italic font-mono uppercase text-[9px] tracking-wider">Voice — </span>
                {spec.brand_voice_notes}
              </p>
            )}
          </SpecBlock>

          <SpecBlock title="Audience">
            <Row k="TAM"            v={spec.tam} />
            <Row k="Persona"        v={spec.persona} />
            <Row k="Micro-persona"  v={spec.micro_persona} />
            <Row k="Desire / pain"  v={spec.desire} />
            <Row k="Awareness"      v={spec.awareness_level} />
            <Row k="Sophistication" v={spec.sophistication_level} />
          </SpecBlock>

          <SpecBlock title="Strategy">
            <Row k="Concept"     v={spec.concept} />
            <Row k="Angle"       v={spec.angle} />
            <Row k="Format"      v={spec.ad_format} />
            <Row k="Composition" v={spec.composition} />
            <Row k="Headline structure" v={spec.headline_structure} />
            {spec.subheadline_role && spec.subheadline_role !== 'absent' && <Row k="Subheadline role" v={spec.subheadline_role} />}
            {spec.body_role && spec.body_role !== 'absent' && <Row k="Body role" v={spec.body_role} />}
            <Row k="CTA framing" v={spec.cta_framing} />
          </SpecBlock>

          <SpecBlock title="Visual brief">
            <p className="text-[12px] text-gray-200 leading-relaxed">{spec.visual_direction}</p>
            {spec.production_notes && (
              <p className="text-[11px] text-gray-400 leading-relaxed mt-2">
                <span className="text-gray-500 font-mono uppercase text-[9px] tracking-wider">Production — </span>
                {spec.production_notes}
              </p>
            )}
          </SpecBlock>

          <SpecBlock title="Reinforcement">
            {spec.behavioral_economics.length > 0 && (
              <Row k="Behavioral econ" v={spec.behavioral_economics.join(', ')} />
            )}
            {spec.trust_signals.length > 0 && (
              <Row k="Trust signals" v={spec.trust_signals.join(', ')} />
            )}
          </SpecBlock>

          {spec.why_this_test && (
            <div className="border-t border-gray-800 pt-3">
              <p className="text-[9px] uppercase tracking-wider text-emerald-300 font-semibold mb-1">Why this test</p>
              <p className="text-[11px] text-gray-300 leading-relaxed">{spec.why_this_test}</p>
            </div>
          )}

          {spec.data_basis && <DataBasisBlock db={spec.data_basis} />}
        </div>
      )}
    </li>
  )
}

function DataBasisBlock({ db }: { db: NonNullable<TestSpec['data_basis']> }) {
  const totalCitations =
    (db.replicates_from?.length ?? 0) +
    (db.avoids_pattern_of?.length ?? 0) +
    (db.addresses_investigate_weakness?.length ?? 0) +
    (db.extends_promising_signal?.length ?? 0)
  if (totalCitations === 0 && (db.contrastive_findings_used?.length ?? 0) === 0) return null
  const short = (id: string) => id.slice(0, 8)
  return (
    <div className="border-t border-gray-800 pt-3">
      <p className="text-[9px] uppercase tracking-wider text-indigo-300 font-semibold mb-2">Derived from</p>
      <div className="space-y-1.5">
        {db.replicates_from?.length > 0 && (
          <p className="text-[11px] text-gray-300 leading-snug">
            <span className="text-emerald-400">Replicates pattern of:</span> {db.replicates_from.map(short).join(', ')}
          </p>
        )}
        {db.avoids_pattern_of?.length > 0 && (
          <p className="text-[11px] text-gray-300 leading-snug">
            <span className="text-[#ff2a2b]">Avoids pattern of:</span> {db.avoids_pattern_of.map(short).join(', ')}
          </p>
        )}
        {db.addresses_investigate_weakness?.length > 0 && (
          <p className="text-[11px] text-gray-300 leading-snug">
            <span className="text-amber-300">Fixes weakness of:</span> {db.addresses_investigate_weakness.map(short).join(', ')}
          </p>
        )}
        {db.extends_promising_signal?.length > 0 && (
          <p className="text-[11px] text-gray-300 leading-snug">
            <span className="text-indigo-300">Extends signal of:</span> {db.extends_promising_signal.map(short).join(', ')}
          </p>
        )}
        {db.contrastive_findings_used?.length > 0 && (
          <div className="text-[11px] text-gray-300 leading-snug">
            <p className="text-gray-400 mb-0.5">Contrastive findings used:</p>
            <ul className="space-y-0.5 ml-2">
              {db.contrastive_findings_used.map((f, i) => <li key={i} className="text-[11px] text-gray-300">· {f}</li>)}
            </ul>
          </div>
        )}
        {db.loss_modes_addressed?.length > 0 && (
          <p className="text-[11px] text-gray-300 leading-snug">
            <span className="text-gray-400">Avoids loss modes:</span> {db.loss_modes_addressed.join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}

function CopyBriefButton({ spec }: { spec: TestSpec }) {
  const [copied, setCopied] = useState(false)
  async function handle() {
    const brief = buildSpecBriefText(spec)
    try { await navigator.clipboard.writeText(brief); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <button
      onClick={handle}
      className="text-[10px] inline-flex items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-800"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Download className="w-3 h-3" />}
      {copied ? 'Copied brief' : 'Copy full brief'}
    </button>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function handle() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <button onClick={handle} className="text-[10px] inline-flex items-center gap-1 text-gray-500 hover:text-gray-200 transition-colors">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : null}
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

function buildSpecBriefText(s: TestSpec): string {
  const lines: string[] = []
  const isSourcing = !!s.sourcing_requirements?.trim()
  lines.push(`# ${s.name}`, '')
  lines.push('## Audience')
  lines.push(`TAM: ${s.tam}`)
  lines.push(`Persona: ${s.persona}`)
  lines.push(`Micro-persona: ${s.micro_persona}`)
  lines.push(`Desire / pain: ${s.desire}`)
  lines.push(`Awareness: ${s.awareness_level}  ·  Sophistication: ${s.sophistication_level}`, '')
  lines.push('## Strategy')
  lines.push(`Concept: ${s.concept}`)
  lines.push(`Angle: ${s.angle}`)
  lines.push(`Format: ${s.ad_format}  ·  Composition: ${s.composition}`, '')
  if (isSourcing) {
    lines.push('## Source this — don\'t fabricate')
    lines.push(s.sourcing_requirements!)
    if (s.body_copy) lines.push('', `Quote pattern to elicit: ${s.body_copy}`)
    lines.push('')
  }
  lines.push('## Copy')
  lines.push(`Headline (${s.headline_structure}):`)
  lines.push(`  ${s.headline}`)
  if (s.subheadline_role !== 'absent' && s.subheadline) {
    lines.push(`Subheadline (${s.subheadline_role}):`)
    lines.push(`  ${s.subheadline}`)
  }
  if (!isSourcing && s.body_role !== 'absent' && s.body_copy) {
    lines.push(`Body (${s.body_role}):`)
    lines.push(`  ${s.body_copy}`)
  }
  if (s.cta_framing === 'none' || !s.cta) {
    lines.push(`CTA: none (narrative carries the persuasion)`)
  } else {
    lines.push(`CTA (${s.cta_framing}): ${s.cta}`)
  }
  lines.push('')
  if (s.brand_voice_notes) lines.push(`Voice: ${s.brand_voice_notes}`, '')
  lines.push('## Visual')
  lines.push(s.visual_direction)
  if (s.production_notes) lines.push('', `Production: ${s.production_notes}`)
  lines.push('')
  if (s.behavioral_economics.length > 0) lines.push(`Behavioral economics: ${s.behavioral_economics.join(', ')}`)
  if (s.trust_signals.length > 0) lines.push(`Trust signals: ${s.trust_signals.join(', ')}`)
  if (s.why_this_test) lines.push('', `Why: ${s.why_this_test}`)
  const db = s.data_basis
  if (db) {
    const totalCitations =
      (db.replicates_from?.length ?? 0) +
      (db.avoids_pattern_of?.length ?? 0) +
      (db.addresses_investigate_weakness?.length ?? 0) +
      (db.extends_promising_signal?.length ?? 0)
    if (totalCitations > 0 || (db.contrastive_findings_used?.length ?? 0) > 0) {
      lines.push('', '## Derived from')
      if (db.replicates_from?.length > 0)              lines.push(`Replicates pattern of: ${db.replicates_from.map(id => id.slice(0, 8)).join(', ')}`)
      if (db.avoids_pattern_of?.length > 0)            lines.push(`Avoids pattern of: ${db.avoids_pattern_of.map(id => id.slice(0, 8)).join(', ')}`)
      if (db.addresses_investigate_weakness?.length > 0) lines.push(`Fixes weakness of: ${db.addresses_investigate_weakness.map(id => id.slice(0, 8)).join(', ')}`)
      if (db.extends_promising_signal?.length > 0)     lines.push(`Extends signal of: ${db.extends_promising_signal.map(id => id.slice(0, 8)).join(', ')}`)
      if (db.contrastive_findings_used?.length > 0) {
        lines.push('Contrastive findings used:')
        for (const f of db.contrastive_findings_used) lines.push(`  · ${f}`)
      }
      if (db.loss_modes_addressed?.length > 0) lines.push(`Avoids loss modes: ${db.loss_modes_addressed.join(', ')}`)
    }
  }
  return lines.join('\n')
}

function SpecBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null
  return (
    <div className="grid grid-cols-[80px_1fr] gap-x-2 text-[11px]">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-200">{v}</span>
    </div>
  )
}

function PerAdSection({ items }: { items: NonNullable<ProductRecommendationReport['per_ad_recommendations']> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-gray-800 pt-4">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300">
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Per-ad recommendations ({items.length})
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {items.map(item => (
            <div key={item.analysis_id} className="bg-gray-950/50 border border-gray-800 rounded-lg p-3">
              <p className="text-[10px] font-mono text-gray-500">{item.analysis_id.slice(0, 8)} · {item.quadrant}</p>
              {item.failure_reason && <p className="text-[10px] text-[#ff2a2b] mt-1">Why it failed: {item.failure_reason}</p>}
              {item.salvage_test && <p className="text-[10px] text-amber-300 mt-1">Salvage test: {item.salvage_test}</p>}
              <ul className="space-y-1 mt-2">
                {item.actions.map((a, i) => (
                  <li key={i} className="text-[11px] text-gray-300 leading-relaxed">→ {a}</li>
                ))}
              </ul>
              {item.iteration_ideas && item.iteration_ideas.length > 0 && (
                <div className="mt-2">
                  <p className="text-[9px] uppercase tracking-wider text-emerald-300 mb-1">Iteration ideas</p>
                  <ul className="space-y-1">
                    {item.iteration_ideas.map((idea, i) => (
                      <li key={i} className="text-[11px] text-gray-300 leading-relaxed">+ {idea}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
