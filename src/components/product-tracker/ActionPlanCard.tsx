'use client'

import { useState } from 'react'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import type { ProductRecommendationReport } from '@/app/api/products/[id]/recommendations/route'

interface Props {
  token: string
  productId: string
  report: ProductRecommendationReport | null
  generatedAt: string | null
  onRegenerated: (r: ProductRecommendationReport) => void
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

export function ActionPlanCard({ token, productId, report, generatedAt, onRegenerated }: Props) {
  const [generating, setGenerating] = useState(false)
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
        setGenerating(false)
        return
      }
      const data = await readJsonStream(res)
      if (data.insufficient_data) {
        setError('Not enough ads yet — add at least one with comprehensive analysis first.')
      } else if (data.error) {
        setError(data.error as string)
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
              Generated {generatedAt ? new Date(generatedAt).toLocaleString() : 'recently'} · {report.ads_analyzed} ads
            </p>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1 disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Regenerating…' : 'Regenerate'}
        </button>
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

      {/* Next test batch */}
      {report.next_test_batch && (
        <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-medium">Next test batch</p>
          <p className="text-xs text-gray-300 leading-relaxed">{report.next_test_batch.rationale}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {report.next_test_batch.angle_themes?.map((a, i) => (
              <span key={i} className="text-[10px] text-emerald-300 bg-gray-900 border border-emerald-900/60 rounded px-2 py-0.5">
                Angle: {a}
              </span>
            ))}
            <span className="text-[10px] text-gray-400 bg-gray-900 border border-gray-800 rounded px-2 py-0.5">
              {report.next_test_batch.variations_per_angle} variations × angle
            </span>
          </div>
        </div>
      )}

      {/* Per-ad recommendations (collapsed) */}
      {report.per_ad_recommendations?.length > 0 && (
        <PerAdSection items={report.per_ad_recommendations} />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children || (typeof children === 'string' && !children.trim())) return null
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">{title}</p>
      {typeof children === 'string'
        ? <p className="text-xs text-gray-300 leading-relaxed">{children}</p>
        : children}
    </div>
  )
}

function PerAdSection({ items }: { items: ProductRecommendationReport['per_ad_recommendations'] }) {
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
