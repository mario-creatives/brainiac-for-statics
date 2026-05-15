'use client'

import { X } from 'lucide-react'
import { QuadrantBadge } from './QuadrantBadge'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'

interface Props {
  adA: ProductAdRow
  adB: ProductAdRow
  onClose: () => void
}

const QUADRANT_RANK: Record<string, number> = { winner: 4, promising: 3, investigate: 2, loser: 1 }
const GRADE_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 }

function delta(a: number | null, b: number | null, lowerBetter = false): 'better' | 'worse' | 'same' | 'unknown' {
  if (a == null || b == null) return 'unknown'
  if (a === b) return 'same'
  if (lowerBetter) return a < b ? 'better' : 'worse'
  return a > b ? 'better' : 'worse'
}

function generateVerdict(a: ProductAdRow, b: ProductAdRow): string {
  const parts: string[] = []

  const qA = a.effective_quadrant ?? 'unknown'
  const qB = b.effective_quadrant ?? 'unknown'
  if (qA !== qB) {
    const rankA = QUADRANT_RANK[qA] ?? 0
    const rankB = QUADRANT_RANK[qB] ?? 0
    const winner = rankA > rankB ? 'Ad A' : 'Ad B'
    parts.push(`${winner} has the stronger quadrant (${qA} vs ${qB})`)
  }

  if (a.cpa_usd != null && b.cpa_usd != null) {
    const diff = Math.abs(a.cpa_usd - b.cpa_usd)
    const pct = Math.round((diff / Math.max(a.cpa_usd, b.cpa_usd)) * 100)
    const better = a.cpa_usd < b.cpa_usd ? 'Ad A' : 'Ad B'
    if (pct > 5) parts.push(`${better} has ${pct}% lower CPA ($${Math.min(a.cpa_usd, b.cpa_usd).toFixed(2)} vs $${Math.max(a.cpa_usd, b.cpa_usd).toFixed(2)})`)
  } else if (a.spend_usd != null && b.spend_usd != null) {
    const better = a.spend_usd > b.spend_usd ? 'Ad A' : 'Ad B'
    if (a.spend_usd !== b.spend_usd) parts.push(`${better} scaled further ($${Math.max(a.spend_usd, b.spend_usd).toLocaleString()} vs $${Math.min(a.spend_usd, b.spend_usd).toLocaleString()})`)
  }

  if (a.framework_grade && b.framework_grade && a.framework_grade !== b.framework_grade) {
    const rankA = GRADE_RANK[a.framework_grade] ?? 0
    const rankB = GRADE_RANK[b.framework_grade] ?? 0
    const better = rankA > rankB ? 'Ad A' : 'Ad B'
    parts.push(`${better} scored higher on the copywriting framework (${a.framework_grade} vs ${b.framework_grade})`)
  }

  if (a.mean_top_roi_score != null && b.mean_top_roi_score != null) {
    const diff = Math.abs(a.mean_top_roi_score - b.mean_top_roi_score)
    if (diff > 0.02) {
      const better = a.mean_top_roi_score > b.mean_top_roi_score ? 'Ad A' : 'Ad B'
      parts.push(`${better} had higher neural engagement (${Math.max(a.mean_top_roi_score, b.mean_top_roi_score).toFixed(3)} vs ${Math.min(a.mean_top_roi_score, b.mean_top_roi_score).toFixed(3)})`)
    }
  }

  if (a.composition_tag && b.composition_tag && a.composition_tag !== b.composition_tag) {
    parts.push(`Different composition: ${a.composition_tag} (A) vs ${b.composition_tag} (B)`)
  }

  if (a.ad_format && b.ad_format && a.ad_format !== b.ad_format) {
    parts.push(`Different format: ${a.ad_format} (A) vs ${b.ad_format} (B)`)
  }

  if (parts.length === 0) return 'No statistically meaningful differences detected with the available data.'
  return parts.join('. ') + '.'
}

function MetricRow({ label, valA, valB, highlight }: { label: string; valA: string; valB: string; highlight?: 'a' | 'b' | null }) {
  return (
    <tr className="border-b border-gray-800/60">
      <td className="py-1.5 px-3 text-[10px] text-gray-500 font-medium">{label}</td>
      <td className={`py-1.5 px-3 text-[11px] tabular-nums text-right ${highlight === 'a' ? 'text-emerald-400 font-semibold' : 'text-gray-300'}`}>{valA}</td>
      <td className={`py-1.5 px-3 text-[11px] tabular-nums text-right ${highlight === 'b' ? 'text-emerald-400 font-semibold' : 'text-gray-300'}`}>{valB}</td>
    </tr>
  )
}

export function AdCompareModal({ adA, adB, onClose }: Props) {
  const verdict = generateVerdict(adA, adB)

  const cpaHighlight = adA.cpa_usd != null && adB.cpa_usd != null
    ? adA.cpa_usd < adB.cpa_usd ? 'a' : adB.cpa_usd < adA.cpa_usd ? 'b' : null
    : null
  const spendHighlight = adA.spend_usd != null && adB.spend_usd != null
    ? adA.spend_usd > adB.spend_usd ? 'a' : adB.spend_usd > adA.spend_usd ? 'b' : null
    : null
  const ctrHighlight = adA.ctr_pct != null && adB.ctr_pct != null
    ? adA.ctr_pct > adB.ctr_pct ? 'a' : adB.ctr_pct > adA.ctr_pct ? 'b' : null
    : null
  const neuralHighlight = adA.mean_top_roi_score != null && adB.mean_top_roi_score != null
    ? adA.mean_top_roi_score > adB.mean_top_roi_score ? 'a' : adB.mean_top_roi_score > adA.mean_top_roi_score ? 'b' : null
    : null
  const gradeHighlight = adA.framework_grade && adB.framework_grade && adA.framework_grade !== adB.framework_grade
    ? (GRADE_RANK[adA.framework_grade] ?? 0) > (GRADE_RANK[adB.framework_grade] ?? 0) ? 'a' : 'b'
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <p className="text-sm font-semibold text-white">A/B Comparison</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Green = better value for that metric</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-5 space-y-5">
          {/* Ad previews */}
          <div className="grid grid-cols-2 gap-4">
            {[adA, adB].map((ad, i) => (
              <div key={ad.analysis_id} className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Ad {i === 0 ? 'A' : 'B'}</p>
                {ad.heatmap_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.heatmap_url} alt="" className="w-full aspect-video object-cover rounded-lg border border-gray-800" />
                ) : (
                  <div className="w-full aspect-video bg-gray-800 rounded-lg" />
                )}
                <p className="text-xs text-gray-200 leading-snug line-clamp-2">{ad.headline_text ?? 'Untitled ad'}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <QuadrantBadge quadrant={ad.effective_quadrant} override={ad.quadrant_override != null} />
                  {ad.framework_grade && (
                    <span className={`text-[10px] font-mono font-bold ${
                      ad.framework_grade === 'A' ? 'text-emerald-400' :
                      ad.framework_grade === 'B' ? 'text-amber-400' :
                      ad.framework_grade === 'C' ? 'text-orange-400' : 'text-[#ff2a2b]'
                    }`}>{ad.framework_grade}</span>
                  )}
                  {ad.composition_tag && (
                    <span className="text-[9px] font-mono text-gray-400 bg-gray-950 border border-gray-800 rounded px-1.5 py-0.5 truncate max-w-full">
                      {ad.composition_tag}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Metrics comparison table */}
          <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
            <div className="grid grid-cols-3 border-b border-gray-800 bg-gray-900">
              <div className="py-2 px-3 text-[10px] uppercase tracking-wider text-gray-600 font-medium">Metric</div>
              <div className="py-2 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-medium text-right">Ad A</div>
              <div className="py-2 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-medium text-right">Ad B</div>
            </div>
            <table className="w-full">
              <tbody>
                <MetricRow
                  label="Quadrant"
                  valA={adA.effective_quadrant ?? '—'}
                  valB={adB.effective_quadrant ?? '—'}
                  highlight={
                    adA.effective_quadrant && adB.effective_quadrant
                      ? (QUADRANT_RANK[adA.effective_quadrant] ?? 0) > (QUADRANT_RANK[adB.effective_quadrant] ?? 0) ? 'a'
                      : (QUADRANT_RANK[adB.effective_quadrant] ?? 0) > (QUADRANT_RANK[adA.effective_quadrant] ?? 0) ? 'b'
                      : null
                      : null
                  }
                />
                <MetricRow
                  label="Spend"
                  valA={adA.spend_usd != null ? `$${adA.spend_usd.toLocaleString()}` : '—'}
                  valB={adB.spend_usd != null ? `$${adB.spend_usd.toLocaleString()}` : '—'}
                  highlight={spendHighlight}
                />
                <MetricRow
                  label="CPA"
                  valA={adA.cpa_usd != null ? `$${adA.cpa_usd.toFixed(2)}` : '—'}
                  valB={adB.cpa_usd != null ? `$${adB.cpa_usd.toFixed(2)}` : '—'}
                  highlight={cpaHighlight}
                />
                <MetricRow
                  label="CTR"
                  valA={adA.ctr_pct != null ? `${adA.ctr_pct.toFixed(2)}%` : '—'}
                  valB={adB.ctr_pct != null ? `${adB.ctr_pct.toFixed(2)}%` : '—'}
                  highlight={ctrHighlight}
                />
                <MetricRow
                  label="Neural engagement"
                  valA={adA.mean_top_roi_score != null ? adA.mean_top_roi_score.toFixed(3) : '—'}
                  valB={adB.mean_top_roi_score != null ? adB.mean_top_roi_score.toFixed(3) : '—'}
                  highlight={neuralHighlight}
                />
                <MetricRow
                  label="Framework grade"
                  valA={adA.framework_grade ?? '—'}
                  valB={adB.framework_grade ?? '—'}
                  highlight={gradeHighlight}
                />
                <MetricRow
                  label="Composition"
                  valA={adA.composition_tag ?? '—'}
                  valB={adB.composition_tag ?? '—'}
                />
                <MetricRow
                  label="Format"
                  valA={adA.ad_format ?? '—'}
                  valB={adB.ad_format ?? '—'}
                />
                <MetricRow
                  label="Age range"
                  valA={adA.age_range ?? '—'}
                  valB={adB.age_range ?? '—'}
                />
              </tbody>
            </table>
          </div>

          {/* Verdict */}
          <div className="bg-gray-950 border border-indigo-900/40 rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400 mb-1.5">What flipped the outcome</p>
            <p className="text-xs text-gray-300 leading-relaxed">{verdict}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
