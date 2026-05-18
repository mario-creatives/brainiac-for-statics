'use client'

import { useState } from 'react'
import { X, Copy, Check, FileText, Plus } from 'lucide-react'
import type { AnalysisResult } from '@/types'
import type { ComprehensiveAnalysis } from '@/app/api/analyze/comprehensive/route'
import type { AudienceTreePayload } from '@/app/api/products/[id]/audiences/route'
import { Tooltip } from '@/components/Tooltip'

function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* user can read it anyway */ }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`text-[10px] inline-flex items-center gap-1 text-gray-400 hover:text-white transition-colors ${className}`}
      aria-label={label}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

function ScoreBadge({ score, max = 10 }: { score: number; max?: number }) {
  const pct = score / max
  const color =
    pct >= 0.7 ? 'bg-gray-900 text-emerald-400 border-emerald-800/60' :
    pct >= 0.4 ? 'bg-gray-900 text-amber-400 border-amber-800/60' :
                 'bg-gray-900 text-[#ff2a2b] border-red-900/60'
  return (
    <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded border ${color}`}>
      {score}/{max}
    </span>
  )
}

function GradeBadge({ grade, score }: { grade: 'A' | 'B' | 'C' | 'D'; score?: number | null }) {
  const color =
    grade === 'A' ? 'text-emerald-400 border-emerald-800/60' :
    grade === 'B' ? 'text-amber-400 border-amber-800/60' :
    grade === 'C' ? 'text-orange-400 border-orange-800/60' :
                    'text-[#ff2a2b] border-red-900/60'
  // A7 from brutal-audit-v2: show numeric score alongside the letter so a 4.1
  // and a 5.9 don't both read as "C".
  const display = score != null && !isNaN(score) ? `${grade} (${score.toFixed(1)})` : grade
  return (
    <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded border bg-gray-900 ${color}`}>
      {display}
    </span>
  )
}

function PassFail({ pass, label }: { pass: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-bold uppercase ${pass ? 'text-emerald-400' : 'text-[#ff2a2b]'}`}>
        {pass ? '✓' : '✗'}
      </span>
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  )
}

function Badge({ on, label }: { on: boolean | undefined; label: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded border ${on ? 'text-emerald-400 border-emerald-900/50 bg-gray-900' : 'text-gray-600 border-gray-800 bg-gray-900'}`}>
      {on ? '✓ ' : '✗ '}{label}
    </span>
  )
}

const BE_LABELS: Record<string, string> = {
  scarcity: 'Scarcity',
  urgency: 'Urgency',
  social_proof: 'Social Proof',
  anchoring: 'Anchoring',
  loss_aversion: 'Loss Aversion',
  authority: 'Authority',
  reciprocity: 'Reciprocity',
}

const AWARENESS_LABELS: Record<string, string> = {
  unaware: 'Unaware',
  problem_aware: 'Problem-aware',
  solution_aware: 'Solution-aware',
  product_aware: 'Product-aware',
  most_aware: 'Most-aware',
}

const AWARENESS_DESCRIPTIONS: Record<string, string> = {
  unaware: "Doesn't know they have a problem",
  problem_aware: 'Knows the problem, not the solution type',
  solution_aware: 'Knows solutions exist, not this product',
  product_aware: 'Knows this product, not yet committed',
  most_aware: 'Ready — just needs an offer or trigger',
}

interface ModalCard {
  id: string
  fileName: string
  previewUrl: string
  result: AnalysisResult | null
  spend?: number
  isWinner?: boolean
  isLoser?: boolean
}

interface Props {
  card: ModalCard
  comprehensive?: ComprehensiveAnalysis
  loading?: boolean
  error?: string
  isHistorical?: boolean
  token: string
  productId?: string
  onClose: () => void
  onRetry?: () => void
}

export function AdAnalysisModal({ card, comprehensive, loading, error, isHistorical, token, productId, onClose, onRetry }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-700 sm:rounded-2xl w-full max-w-2xl shadow-xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative bg-gray-800 shrink-0 max-h-[25vh] sm:max-h-[35vh] overflow-hidden sm:rounded-t-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.previewUrl} alt={card.fileName} className="w-full h-full max-h-[25vh] sm:max-h-[35vh] object-contain" />
          {card.result?.heatmap_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.result.heatmap_url}
              alt="Brain activation heatmap"
              className="absolute inset-0 w-full h-full max-h-[25vh] sm:max-h-[35vh] object-contain opacity-70"
            />
          )}
          {card.isWinner && (
            <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider bg-yellow-500 text-yellow-950 px-2 py-1 rounded">
              ★ Winner
            </span>
          )}
          {card.isLoser && (
            <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider bg-red-900 text-red-300 px-2 py-1 rounded border border-red-800">
              ✗ Loser
            </span>
          )}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-[#fff] transition-all backdrop-blur-sm"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6 overflow-y-auto flex-1 min-h-0">
          <div>
            <p className="text-sm font-medium text-white truncate">{card.fileName}</p>
            {card.spend !== undefined && card.spend > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">Spend: ${card.spend.toLocaleString()}</p>
            )}
          </div>

          {/* Brain Activation — BERG (bars + heatmap legend + narrative) */}
          {card.result?.roi_data && (
            <Section title="Brain Activation — BERG">
              <p className="text-[10px] text-gray-500 leading-snug">
                <Tooltip text="BERG (fmri-nsd-fwrf) is a publicly-released brain encoding model trained on real fMRI data from human viewers. It predicts how each visual-cortex region would respond to this image — not what objects are present, but how the visual signal lights up specific neural circuitry." width="lg">
                  BERG
                </Tooltip>{' '}
                models predicted neural response across 6 visual-cortex regions.
              </p>
              {card.result.mean_top_roi_score != null && (
                <div className="bg-gray-950 border border-indigo-900/40 rounded-lg px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-indigo-400 font-semibold">
                      <Tooltip text="Mean activation across the top-scoring brain regions for this ad. Higher = stronger overall predicted neural response. Useful as a single summary number when comparing ads." width="lg">
                        Neural Engagement Score
                      </Tooltip>
                    </span>
                    <span className="text-lg text-white font-mono font-semibold">{card.result.mean_top_roi_score.toFixed(2)}</span>
                    <span className="text-[10px] text-gray-500 font-mono">/ 1.00</span>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-snug mt-0.5">Mean activation across the top-scoring brain regions. Higher = stronger overall neural response to the ad.</p>
                </div>
              )}
              {card.result.heatmap_url && (
                <div className="space-y-1 pb-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 w-24 rounded-full shrink-0"
                      style={{ background: 'linear-gradient(to right, #440154, #31688E, #35B779, #FDE725)' }}
                    />
                    <div className="flex justify-between w-24 shrink-0">
                      <span className="text-[9px] text-gray-600">low</span>
                      <span className="text-[9px] text-gray-600">high</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-600">Heatmap overlay colors: purple = minimal neural activation, yellow = peak. Brighter regions indicate stronger brain processing of that visual area.</p>
                </div>
              )}
              <div className="space-y-2">
                {card.result.roi_data.map(roi => (
                  <div key={roi.region_key} className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300">{roi.label}</span>
                      <span className="text-xs font-mono text-gray-400">{roi.activation.toFixed(3)}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${roi.activation * 100}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-600">{roi.description}</p>
                  </div>
                ))}
              </div>
              {comprehensive?.berg_recommendations && comprehensive.berg_recommendations.length > 0 && (
                <div className="text-xs text-gray-300 leading-relaxed space-y-1.5 border-t border-gray-800 pt-3">
                  {comprehensive.berg_recommendations.map((line, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-indigo-400 shrink-0">—</span>
                      <span><RichLine text={line} /></span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {loading && !comprehensive && (
            <div className="flex items-center gap-2 text-xs text-gray-500 border-t border-gray-800 pt-4">
              <div className="w-3 h-3 rounded-full border border-indigo-500 border-t-transparent animate-spin" />
              Running comprehensive ad analysis…
            </div>
          )}

          {!loading && error && !comprehensive && (
            <div className="border-t border-gray-800 pt-4 space-y-2">
              <p className="text-xs text-[#ff2a2b]">{error}</p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="text-xs text-gray-400 hover:text-gray-200 underline transition-colors"
                >
                  Retry analysis
                </button>
              )}
            </div>
          )}

          {comprehensive && <ComprehensiveSections data={comprehensive} isHistorical={isHistorical} isLoser={isHistorical && card.isWinner === false} token={token} productId={productId} />}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-800 pt-4 space-y-3">
      <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">{title}</p>
      {children}
    </div>
  )
}

type RewriteLike = {
  proposed_text?: string | null
  proposed_action?: string | null
  proposed_change?: string | null
  proposed_disruptor?: string | null
  proposed_offer_text?: string | null
  proposed_benefits?: string[] | null
  proposed_signals?: string[] | null
  rationale: string
  expected_lift: string
  dna_changes?: Record<string, unknown> | null
} | null | undefined

function RewriteCard({ rewrite, label = 'Proposed Rewrite' }: { rewrite: RewriteLike; label?: string }) {
  if (!rewrite) return null
  const proposedDisplay =
    rewrite.proposed_text ||
    rewrite.proposed_change ||
    rewrite.proposed_disruptor ||
    rewrite.proposed_offer_text ||
    (rewrite.proposed_benefits ? rewrite.proposed_benefits.join(' • ') : null) ||
    (rewrite.proposed_signals ? rewrite.proposed_signals.join(' • ') : null) ||
    rewrite.proposed_action ||
    null
  return (
    <div className="bg-gray-950 border border-amber-900/50 rounded-lg px-3 py-2.5 space-y-1.5 mt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">{label}</p>
        {proposedDisplay && <CopyButton text={proposedDisplay} />}
      </div>
      {proposedDisplay && <p className="text-xs text-white font-medium leading-snug">{proposedDisplay}</p>}
      {rewrite.rationale && <p className="text-[11px] text-gray-300 leading-snug">{rewrite.rationale}</p>}
      {rewrite.expected_lift && (
        <p className="text-[11px] text-amber-300/90 leading-snug">Expected lift: {rewrite.expected_lift}</p>
      )}
    </div>
  )
}

/** Collects every rewrite block in the comprehensive analysis into a single
 *  pasteable strategist brief. The order is deliberate: highest-leverage
 *  copy fixes first, then structural changes, then offer / hook / congruence. */
function buildFullBrief(data: ComprehensiveAnalysis, headlineText?: string): string {
  const lines: string[] = []
  const push = (h: string, body: string) => { lines.push(`## ${h}`, body, '') }

  if (headlineText) lines.push(`# Brief for: "${headlineText}"`, '')

  if (data.overall) {
    if (data.overall.verdict) push('Verdict', data.overall.verdict)
    if (data.overall.priority_fix) push('Priority fix', data.overall.priority_fix)
  }
  if (data.promise_clarity?.one_line) push('Promise (one line)', data.promise_clarity.one_line)

  const r = (label: string, rw: RewriteLike) => {
    if (!rw) return
    const text =
      rw.proposed_text || rw.proposed_change || rw.proposed_disruptor ||
      rw.proposed_offer_text || (rw.proposed_benefits?.join(' • ')) ||
      (rw.proposed_signals?.join(' • ')) || rw.proposed_action || ''
    if (text) push(label, `${text}\n— ${rw.rationale ?? ''}\nExpected lift: ${rw.expected_lift ?? '—'}`)
  }
  r('Headline rewrite',     data.copy?.headline?.rewrite)
  r('Subheadline rewrite',  data.copy?.subheadline?.rewrite)
  r('Benefits rewrite',     data.copy?.benefits_features?.rewrite)
  r('Trust signals',        data.copy?.trust_signals?.rewrite)
  r('Proof signals',        data.copy?.proof_signals?.rewrite)
  r('CTA rewrite',          data.copy?.cta?.rewrite)
  r('Attention rewrite',    data.hook_analysis?.rewrite)
  r('Offer rewrite',        data.offer_architecture?.rewrite)
  r('Congruence fix',       data.congruence?.rewrite)
  r('Cognitive subtraction', data.cognitive_load?.rewrite)

  return lines.join('\n')
}

/** Extracts up to 3 highest-leverage rewrites to surface in the TL;DR card.
 *  Picks the ones with the lowest source score first (most room to grow). */
function pickTopThreeRewrites(data: ComprehensiveAnalysis): {
  label: string
  proposed: string
  rationale: string
  score: number
}[] {
  const candidates: { label: string; proposed: string | null; rationale: string; score: number }[] = [
    { label: 'Headline',     proposed: extractProposed(data.copy?.headline?.rewrite),     rationale: data.copy?.headline?.rewrite?.rationale ?? '',        score: data.copy?.headline?.clarity ?? 10 },
    { label: 'Subheadline',  proposed: extractProposed(data.copy?.subheadline?.rewrite),  rationale: data.copy?.subheadline?.rewrite?.rationale ?? '',     score: data.copy?.subheadline?.clarity ?? 10 },
    { label: 'Benefits',     proposed: extractProposed(data.copy?.benefits_features?.rewrite), rationale: data.copy?.benefits_features?.rewrite?.rationale ?? '', score: data.copy?.benefits_features?.clarity ?? 10 },
    { label: 'Trust',        proposed: extractProposed(data.copy?.trust_signals?.rewrite), rationale: data.copy?.trust_signals?.rewrite?.rationale ?? '',   score: data.copy?.trust_signals?.strength ?? 10 },
    { label: 'Proof',        proposed: extractProposed(data.copy?.proof_signals?.rewrite), rationale: data.copy?.proof_signals?.rewrite?.rationale ?? '',  score: data.copy?.proof_signals?.strength ?? 10 },
    { label: 'CTA',          proposed: extractProposed(data.copy?.cta?.rewrite),          rationale: data.copy?.cta?.rewrite?.rationale ?? '',             score: data.copy?.cta?.clarity ?? 10 },
    { label: 'Attention',    proposed: extractProposed(data.hook_analysis?.rewrite),      rationale: data.hook_analysis?.rewrite?.rationale ?? '',         score: (data.hook_analysis?.attention_score ?? (data.hook_analysis as Record<string,unknown> | undefined)?.scroll_stop_score as number | undefined) ?? 10 },
    { label: 'Offer',        proposed: extractProposed(data.offer_architecture?.rewrite), rationale: data.offer_architecture?.rewrite?.rationale ?? '',    score: data.offer_architecture?.offer_clarity_score ?? 10 },
    { label: 'Congruence',   proposed: extractProposed(data.congruence?.rewrite),         rationale: data.congruence?.rewrite?.rationale ?? '',            score: data.congruence?.overall_score ?? 10 },
  ]
  return candidates
    .filter((c): c is { label: string; proposed: string; rationale: string; score: number } => !!c.proposed)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
}

function extractProposed(rw: RewriteLike): string | null {
  if (!rw) return null
  return (
    rw.proposed_text || rw.proposed_change || rw.proposed_disruptor ||
    rw.proposed_offer_text || (rw.proposed_benefits ? rw.proposed_benefits.join(' • ') : null) ||
    (rw.proposed_signals ? rw.proposed_signals.join(' • ') : null) || rw.proposed_action || null
  )
}

type AlignmentLike = {
  winner_matches?: string[]
  loser_matches?: string[]
  verdict?: 'aligned_with_winners' | 'aligned_with_losers' | 'mixed' | 'no_analog'
  winning_dna_dimensions?: string[]
  losing_dna_dimensions?: string[]
} | null | undefined

function LibraryAlignmentChips({ alignment }: { alignment: AlignmentLike }) {
  if (!alignment) return null
  const winners = alignment.winner_matches ?? []
  const losers = alignment.loser_matches ?? []
  const winningDims = alignment.winning_dna_dimensions ?? []
  const losingDims = alignment.losing_dna_dimensions ?? []
  if (winners.length === 0 && losers.length === 0 && winningDims.length === 0 && losingDims.length === 0) return null
  const winningTooltip = winningDims.length > 0 ? `Winning DNA: ${winningDims.join(', ')}` : ''
  const losingTooltip = losingDims.length > 0 ? `Losing DNA: ${losingDims.join(', ')}` : ''
  return (
    <div className="flex items-center gap-1 flex-wrap text-[10px]">
      {winners.length > 0 && (
        <>
          <span className="text-gray-500">Winner matches:</span>
          {winners.map((w, i) => (
            <span
              key={`w-${i}`}
              title={winningTooltip}
              className="text-emerald-400 font-mono bg-gray-900 px-1.5 py-0.5 rounded border border-emerald-900/40 cursor-help"
            >{w}</span>
          ))}
        </>
      )}
      {losers.length > 0 && (
        <>
          <span className="text-gray-500 ml-2">Loser matches:</span>
          {losers.map((l, i) => (
            <span
              key={`l-${i}`}
              title={losingTooltip}
              className="text-[#ff2a2b] font-mono bg-gray-900 px-1.5 py-0.5 rounded border border-red-900/40 cursor-help"
            >{l}</span>
          ))}
        </>
      )}
    </div>
  )
}

function TargetingFitSection({ data, token, productId }: { data: ComprehensiveAnalysis; token?: string; productId?: string }) {
  const inf = data.audience_inference
  const m = data.audience_match
  const hasUserInput = m?.has_user_input ?? false
  const canAdd = !!(token && productId)

  const [audienceTree, setAudienceTree] = useState<AudienceTreePayload | null>(null)
  const [addingFor, setAddingFor] = useState<'persona' | 'micro_persona' | null>(null)
  const [addLabel, setAddLabel] = useState('')
  const [addTamId, setAddTamId] = useState('')
  const [addPersonaId, setAddPersonaId] = useState('')
  const [addStatus, setAddStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [addError, setAddError] = useState('')

  async function openAdd(level: 'persona' | 'micro_persona', defaultLabel: string) {
    setAddingFor(level)
    setAddLabel(defaultLabel)
    setAddTamId('')
    setAddPersonaId('')
    setAddStatus('idle')
    setAddError('')
    if (!audienceTree && token && productId) {
      const res = await fetch(`/api/products/${productId}/audiences`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setAudienceTree(await res.json())
    }
  }

  async function handleAddConfirm() {
    if (!token || !productId || addStatus === 'saving') return
    setAddStatus('saving')
    setAddError('')
    try {
      const level = addingFor!
      const parentId = level === 'persona' ? addTamId : addPersonaId
      if (!parentId || !addLabel.trim()) {
        setAddError('Select a parent and provide a label.')
        setAddStatus('idle')
        return
      }
      const res = await fetch(`/api/products/${productId}/audiences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ level, parent_id: parentId, label: addLabel.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as Record<string, unknown>
        setAddError((d.error as string) ?? 'Failed to add')
        setAddStatus('error')
      } else {
        setAddStatus('ok')
        setAddingFor(null)
        // refresh tree
        const r2 = await fetch(`/api/products/${productId}/audiences`, { headers: { Authorization: `Bearer ${token}` } })
        if (r2.ok) setAudienceTree(await r2.json())
      }
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Network error')
      setAddStatus('error')
    }
  }

  const chip = (() => {
    if (!hasUserInput) return { color: 'text-gray-500 border-gray-700 bg-gray-900', label: 'no stated audience' }
    if (m?.match_quality === 'aligned') return { color: 'text-emerald-400 border-emerald-800/60 bg-emerald-950/30', label: '✓ aligned' }
    if (m?.match_quality === 'partial_mismatch') return { color: 'text-amber-400 border-amber-800/60 bg-amber-950/30', label: '~ partial mismatch' }
    if (m?.match_quality === 'major_mismatch') return { color: 'text-[#ff2a2b] border-red-900/60 bg-red-950/30', label: '✗ major mismatch' }
    return { color: 'text-gray-500 border-gray-700 bg-gray-900', label: '—' }
  })()

  const tams = audienceTree?.tams ?? []
  const selectedTam = tams.find(t => t.id === addTamId)
  const personas = selectedTam?.personas ?? []

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
      {m?.match_quality === 'major_mismatch' && (
        <div className="border border-[#ff2a2b]/40 bg-[#ff2a2b]/10 rounded-xl px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-[#ff2a2b]">Audience mismatch</p>
          <p className="text-[11px] text-gray-300 leading-snug">
            This ad reads as targeting <strong className="text-white">{inf?.inferred_persona ?? 'a different audience'}</strong>.{' '}
            If the creative doesn&apos;t signal the audience, Meta&apos;s algorithm won&apos;t reach them either.
          </p>
          {m.mismatches.length > 0 && (
            <ul className="space-y-0.5">
              {m.mismatches.map((s, i) => (
                <li key={i} className="text-[10px] text-gray-400">· {s}</li>
              ))}
            </ul>
          )}
          {m.recommendation && (
            <p className="text-[10px] text-gray-500 italic">{m.recommendation}</p>
          )}
        </div>
      )}
      {m?.match_quality === 'partial_mismatch' && (
        <div className="border border-amber-700/40 bg-amber-950/20 rounded-xl px-4 py-2.5">
          <p className="text-xs font-semibold text-amber-400">Partial audience mismatch</p>
          {m.recommendation && (
            <p className="text-[10px] text-gray-400 mt-1">{m.recommendation}</p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white">Targeting fit</h3>
          <p className="text-[10px] text-gray-500 mt-0.5 max-w-md leading-snug">
            What Claude reads from the ad alone vs what you told us the ad is for. If they don't match, Meta's algorithm can't target this audience either — the creative is the targeting signal.
          </p>
        </div>
        <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded border ${chip.color}`}>{chip.label}</span>
      </div>

      {inf && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-indigo-400 font-semibold">Ad reads as targeting</p>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Persona</span>
                {canAdd && inf.inferred_persona && (
                  <button
                    onClick={() => openAdd('persona', inf.inferred_persona)}
                    className="flex items-center gap-0.5 text-[9px] text-indigo-400 hover:text-indigo-300 border border-indigo-800/50 rounded px-1 py-0.5 transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />Add
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-200 leading-snug">{inf.inferred_persona || '—'}</p>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Micro-persona</span>
                {canAdd && inf.inferred_micro_persona && (
                  <button
                    onClick={() => openAdd('micro_persona', inf.inferred_micro_persona)}
                    className="flex items-center gap-0.5 text-[9px] text-indigo-400 hover:text-indigo-300 border border-indigo-800/50 rounded px-1 py-0.5 transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />Add
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-200 leading-snug">{inf.inferred_micro_persona || '—'}</p>
            </div>
            <Row label="Concept" value={inf.inferred_concept} />
            <Row label="Angle" value={inf.inferred_angle} />
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-gray-500">TAM signal:</span>
              <span className="text-[10px] font-mono text-gray-300">{inf.inferred_tam_signal}</span>
              <span className="text-[10px] text-gray-500">· confidence {inf.confidence}/10</span>
            </div>
            {inf.reasoning && <p className="text-[10px] text-gray-500 italic leading-snug pt-1">{inf.reasoning}</p>}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{hasUserInput ? 'You said' : 'No stated audience'}</p>
            {hasUserInput ? (
              <>
                {m && m.mismatches && m.mismatches.length > 0 ? (
                  <ul className="space-y-1">
                    {m.mismatches.map((mm, i) => (
                      <li key={i} className="text-[11px] text-amber-300 leading-snug">• {mm}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-emerald-300 leading-snug">No mismatches detected. The ad communicates the audience you intended.</p>
                )}
                {m?.recommendation && (
                  <div className="pt-2 mt-2 border-t border-gray-800">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Recommendation</p>
                    <p className="text-[11px] text-gray-300 leading-snug">{m.recommendation}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[10px] text-gray-500 leading-snug">
                Select a TAM / persona / micro-persona for this ad in the metrics editor (and define the audience hierarchy in Product Settings first if you haven't) to enable the targeting-fit check.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Inline add-to-hierarchy panel */}
      {addingFor && (
        <div className="border-t border-gray-800 pt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-indigo-400 font-semibold">
            Add inferred {addingFor === 'persona' ? 'persona' : 'micro-persona'} to product hierarchy
          </p>
          <input
            type="text"
            value={addLabel}
            onChange={e => setAddLabel(e.target.value)}
            className="input !py-1 !text-xs"
            placeholder="Label"
          />
          {addingFor === 'persona' ? (
            <select
              value={addTamId}
              onChange={e => setAddTamId(e.target.value)}
              className="input !py-1 !text-xs"
            >
              <option value="">— select TAM —</option>
              {tams.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          ) : (
            <>
              <select
                value={addTamId}
                onChange={e => { setAddTamId(e.target.value); setAddPersonaId('') }}
                className="input !py-1 !text-xs"
              >
                <option value="">— select TAM —</option>
                {tams.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <select
                value={addPersonaId}
                onChange={e => setAddPersonaId(e.target.value)}
                disabled={!addTamId}
                className="input !py-1 !text-xs disabled:opacity-50"
              >
                <option value="">— select persona —</option>
                {personas.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </>
          )}
          {addError && <p className="text-[10px] text-[#ff2a2b]">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAddConfirm}
              disabled={addStatus === 'saving'}
              className="text-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1 rounded transition-colors"
            >
              {addStatus === 'saving' ? 'Saving…' : 'Confirm'}
            </button>
            <button onClick={() => setAddingFor(null)} className="text-[10px] text-gray-400 hover:text-white px-2 py-1">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MatchChip({ matched }: { matched: boolean }) {
  return matched
    ? <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border text-emerald-400 border-emerald-800/60 bg-emerald-950/30">✓ match</span>
    : <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border text-amber-400 border-amber-800/60 bg-amber-950/30">~ mismatch</span>
}

function AlignmentRow({ label, matched, score, feedback, extra }: {
  label: string
  matched?: boolean
  score?: number
  feedback?: string
  extra?: string
}) {
  return (
    <div className="border-t border-gray-800 pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-white">{label}</span>
        {typeof matched === 'boolean' && <MatchChip matched={matched} />}
        {typeof score === 'number' && <ScoreBadge score={score} />}
      </div>
      {extra && <p className="text-[10px] text-gray-500 mt-0.5">{extra}</p>}
      {feedback && <p className="text-[11px] text-gray-300 leading-snug mt-1">{feedback}</p>}
    </div>
  )
}

function AdAudienceAlignmentSection({ data }: { data: ComprehensiveAnalysis }) {
  const a = data.angle_quality
  const r = data.register_fit
  const c = data.cognitive_load_fit
  const p = data.placement_fit
  const f = data.format_choice_fit
  const t = data.audience_targeting_fit

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">Ad–audience alignment</h3>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Six lenses: did the angle, register, cognitive load, placement, format, and segment fit the audience's posture and capacity?
        </p>
      </div>
      <div className="space-y-2.5">
        {a && (
          <AlignmentRow
            label="Angle quality"
            matched={a.interpretation_true && a.tension_resonated}
            score={a.score}
            extra={`interpretation true: ${a.interpretation_true ? 'yes' : 'no'} · tension resonated: ${a.tension_resonated ? 'yes' : 'no'}`}
            feedback={a.feedback}
          />
        )}
        {r && (
          <AlignmentRow
            label="Register fit"
            matched={r.matched}
            score={r.score}
            extra={`used: ${r.register_used} · needed: ${r.register_needed}`}
            feedback={r.feedback}
          />
        )}
        {c && (
          <AlignmentRow
            label="Cognitive load fit"
            matched={c.matched}
            score={c.score}
            extra={`format demanded: ${c.load_demanded} · audience capacity: ${c.capacity_available}`}
            feedback={c.feedback}
          />
        )}
        {p && (
          <AlignmentRow
            label="Placement fit"
            matched={p.matched}
            score={p.score}
            extra={`likely state: ${p.likely_state_at_contact} · format assumes: ${p.format_assumes_state}`}
            feedback={p.feedback}
          />
        )}
        {f && (
          <AlignmentRow
            label="Format choice fit"
            matched={f.carries_angle_psychology && f.carries_cognitive_load}
            score={f.score}
            extra={`carries angle psychology: ${f.carries_angle_psychology ? 'yes' : 'no'} · carries cognitive load: ${f.carries_cognitive_load ? 'yes' : 'no'}`}
            feedback={f.feedback}
          />
        )}
        {t && (
          <AlignmentRow
            label="Audience targeting fit"
            matched={t.is_right_segment}
            score={t.score}
            extra={t.segment_critique}
            feedback={t.feedback}
          />
        )}
      </div>
    </div>
  )
}

const FAILURE_MODE_LABELS: Record<string, string> = {
  comprehension_collapse: 'Comprehension collapse',
  resistance_spike:       'Resistance spike',
  abandonment:            'Abandonment',
  trust_erosion:          'Trust erosion',
}

function FormatFailureModeBanner({ data }: { data: NonNullable<ComprehensiveAnalysis['format_failure_mode']> }) {
  const label = FAILURE_MODE_LABELS[data.mode] ?? data.mode
  return (
    <div className="bg-red-950/30 border border-red-900/60 rounded-2xl p-5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#ff2a2b] bg-red-950/60 border border-red-900/60 rounded px-1.5 py-0.5">
          Format failure
        </span>
        <h3 className="text-sm font-semibold text-red-200">{label}</h3>
      </div>
      <p className="text-[11px] text-red-200/80 leading-snug">{data.reasoning}</p>
      <div className="border-t border-red-900/40 pt-2 mt-1">
        <p className="text-[10px] uppercase tracking-wide text-red-400 font-semibold mb-1">Fix</p>
        <p className="text-[11px] text-red-100 leading-snug">{data.fix}</p>
      </div>
    </div>
  )
}

function ConceptClarityPanel({ data }: { data: NonNullable<ComprehensiveAnalysis['concept_clarity']> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
          data.has_single_concept
            ? 'text-emerald-400 border-emerald-800/60 bg-emerald-950/30'
            : 'text-amber-400 border-amber-800/60 bg-amber-950/30'
        }`}>
          {data.has_single_concept ? '✓ Single concept' : '✗ Competing concepts'}
        </span>
        <span className="text-[10px] font-mono text-gray-400">{data.score}/10</span>
      </div>
      {data.concept_summary && (
        <p className="text-xs text-white leading-relaxed">"{data.concept_summary}"</p>
      )}
      {!data.has_single_concept && data.competing_concepts.length > 0 && (
        <div className="pt-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Competing promises in this ad</p>
          <ul className="space-y-0.5">
            {data.competing_concepts.map((c, i) => (
              <li key={i} className="text-[11px] text-amber-300">• {c}</li>
            ))}
          </ul>
          <p className="text-[10px] text-gray-500 mt-2 leading-snug">
            An ad arguing two things at once dilutes both. Pick the one with the strongest pull for the intended audience.
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</p>
      <p className="text-[11px] text-gray-200 leading-snug">{value || '—'}</p>
    </div>
  )
}

function TLDRCard({ data, isHistorical }: { data: ComprehensiveAnalysis; isHistorical?: boolean }) {
  const topRewrites = isHistorical ? [] : pickTopThreeRewrites(data)
  const headlineText = data.copy?.headline?.text
  const verdict = data.overall?.verdict
  const priorityFix = data.overall?.priority_fix
  const oneLine = data.promise_clarity?.one_line
  const fullBrief = buildFullBrief(data, headlineText)
  if (!verdict && !priorityFix && topRewrites.length === 0) return null
  return (
    <div className="border border-indigo-900/50 bg-indigo-950/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold">TL;DR</p>
        <CopyButton text={fullBrief} label="Copy full brief" />
      </div>
      {oneLine && (
        <div className="bg-gray-950 border border-gray-800 rounded-md px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-0.5">Promise (one line)</p>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-gray-100 leading-snug italic">&ldquo;{oneLine}&rdquo;</p>
            <CopyButton text={oneLine} label="" className="shrink-0 mt-0.5" />
          </div>
        </div>
      )}
      {verdict && <p className="text-xs text-gray-200 leading-relaxed">{verdict}</p>}
      {priorityFix && !isHistorical && (
        <div className="bg-gray-950 border border-amber-900/40 rounded-md px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold mb-0.5">Priority fix</p>
          <p className="text-xs text-gray-100 leading-snug">{priorityFix}</p>
        </div>
      )}
      {topRewrites.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-indigo-300 font-semibold">Top {topRewrites.length} actions</p>
          {topRewrites.map((rw, i) => (
            <div key={i} className="bg-gray-950 border border-gray-800 rounded-md px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{rw.label} <span className="text-gray-600">· score {rw.score}/10</span></span>
                <CopyButton text={rw.proposed} label="" />
              </div>
              <p className="text-xs text-white leading-snug">{rw.proposed}</p>
              {rw.rationale && <p className="text-[10px] text-gray-400 leading-snug">{rw.rationale}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ComprehensiveSections({ data, isHistorical, isLoser, token, productId }: { data: ComprehensiveAnalysis; isHistorical?: boolean; isLoser?: boolean; token?: string; productId?: string }) {
  return (
    <>
      {/* TL;DR — verdict + top 3 rewrites + copy-full-brief. First read of the modal. */}
      <TLDRCard data={data} isHistorical={isHistorical} />

      {/* Targeting fit — the Meta algorithm test. Right under the TL;DR so
          targeting failures don't get buried under copy analysis. */}
      {(data.audience_inference || data.audience_match) && (
        <TargetingFitSection data={data} token={token} productId={productId} />
      )}

      {/* Ad–audience alignment — six lenses (angle, register, cognitive load,
          placement, format choice, audience targeting). */}
      {(data.angle_quality || data.register_fit || data.cognitive_load_fit ||
        data.placement_fit || data.format_choice_fit || data.audience_targeting_fit) && (
        <AdAudienceAlignmentSection data={data} />
      )}

      {/* Format failure mode banner — only renders when a failure mode actually fired. */}
      {data.format_failure_mode && data.format_failure_mode.mode !== 'none' && (
        <FormatFailureModeBanner data={data.format_failure_mode} />
      )}

      {/* Concept clarity — A8 from brutal-audit-v2. Catches the "two competing
          promises in one ad" failure mode. */}
      {data.concept_clarity && (
        <Section title="Concept Clarity">
          <ConceptClarityPanel data={data.concept_clarity} />
        </Section>
      )}

      {/* Market Context */}
      {data.market_context && (
        <Section title="Market Context">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-0.5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Awareness</p>
              <p className="text-xs font-semibold text-white">
                {AWARENESS_LABELS[data.market_context.awareness_level] ?? data.market_context.awareness_level}
              </p>
              <p className="text-[10px] text-gray-500">
                {AWARENESS_DESCRIPTIONS[data.market_context.awareness_level]}
              </p>
              {data.market_context.awareness_reasoning && (
                <p className="text-[11px] text-gray-400 leading-snug pt-0.5">{data.market_context.awareness_reasoning}</p>
              )}
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Sophistication</p>
              <p className="text-xs font-semibold text-white">Level {data.market_context.sophistication_level} / 5</p>
              {data.market_context.sophistication_reasoning && (
                <p className="text-[11px] text-gray-400 leading-snug pt-0.5">{data.market_context.sophistication_reasoning}</p>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Ad Format */}
      {data.ad_format && (
        <Section title="Ad Format">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono bg-gray-950 border border-gray-800 px-2 py-0.5 rounded text-gray-300">
              {data.ad_format.type?.replace(/_/g, ' ')}
            </span>
            {data.ad_format.composition && Object.entries(data.ad_format.composition)
              .filter(([, v]) => v === true)
              .map(([k]) => (
                <span key={k} className="text-[10px] text-emerald-400 border border-emerald-900/50 px-1.5 py-0.5 rounded">
                  {k.replace(/has_|is_/g, '').replace(/_/g, ' ')}
                </span>
              ))}
          </div>
          {data.ad_format.format_assessment && (
            <p className="text-[11px] text-gray-400 leading-snug">{data.ad_format.format_assessment}</p>
          )}
        </Section>
      )}

      {/* Attention Capture */}
      {data.hook_analysis && (() => {
        const h = data.hook_analysis as Record<string, unknown>
        const attentionScore = (h.attention_score ?? h.scroll_stop_score) as number | undefined
        const disruptor = (h.attention_disruptor ?? h.pattern_interrupt) as string | undefined
        const firstGlance = (h.first_glance ?? h.first_half_second) as string | undefined
        const feedback = (h.attention_feedback ?? h.hook_feedback) as string | undefined
        return (
          <Section title="Attention Capture">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Attention score</p>
                <ScoreBadge score={attentionScore ?? 0} />
              </div>
            </div>
            {disruptor && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Attention disruptor</p>
                <p className="text-xs text-gray-300">{disruptor}</p>
              </div>
            )}
            {firstGlance && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">First glance</p>
                <p className="text-xs text-gray-300">{firstGlance}</p>
              </div>
            )}
            {feedback && (
              <p className="text-[11px] text-gray-400 leading-snug border-t border-gray-800 pt-2">
                {feedback}
              </p>
            )}
            <LibraryAlignmentChips alignment={data.hook_analysis.library_alignment} />
            <RewriteCard rewrite={data.hook_analysis.rewrite} label="Proposed Attention Rewrite" />
          </Section>
        )
      })()}

      {/* Copy Analysis */}
      <Section title="Copy Analysis">
        <CopyRow
          label="Headline"
          text={data.copy?.headline?.text}
          feedback={data.copy?.headline?.feedback}
          dnaChips={headlineChips(data.copy?.headline?.dna)}
          alignment={data.copy?.headline?.library_alignment}
          rewrite={data.copy?.headline?.rewrite}
        >
          <ScoreBadge score={data.copy?.headline?.clarity ?? 0} />
        </CopyRow>
        <CopyRow
          label="Subheadline"
          text={data.copy?.subheadline?.text}
          feedback={data.copy?.subheadline?.feedback}
          dnaChips={subheadlineChips(data.copy?.subheadline?.dna)}
          alignment={data.copy?.subheadline?.library_alignment}
          rewrite={data.copy?.subheadline?.rewrite}
        >
          <ScoreBadge score={data.copy?.subheadline?.clarity ?? 0} />
        </CopyRow>
        {data.body_dna && bodyChips(data.body_dna).length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">Body Copy</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {bodyChips(data.body_dna).map((chip, i) => (
                <span key={i} className="text-[9px] text-gray-400 bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 font-mono">{chip}</span>
              ))}
            </div>
          </div>
        )}
        <CopyList
          label="Benefits / Features"
          items={data.copy?.benefits_features?.identified ?? []}
          feedback={data.copy?.benefits_features?.feedback}
          score={data.copy?.benefits_features?.clarity ?? 0}
          dnaChips={benefitsChips(data.copy?.benefits_features?.dna)}
          alignment={data.copy?.benefits_features?.library_alignment}
          rewrite={data.copy?.benefits_features?.rewrite}
        />
        <CopyList
          label="Trust Signals"
          items={data.copy?.trust_signals?.identified ?? []}
          feedback={data.copy?.trust_signals?.feedback}
          score={data.copy?.trust_signals?.strength ?? 0}
          dnaChips={trustChips(data.copy?.trust_signals?.dna)}
          alignment={data.copy?.trust_signals?.library_alignment}
          rewrite={data.copy?.trust_signals?.rewrite}
        />
        <CopyList
          label="Safety Signals"
          items={data.copy?.safety_signals?.identified ?? []}
          feedback={data.copy?.safety_signals?.feedback}
          score={data.copy?.safety_signals?.strength ?? 0}
          alignment={data.copy?.safety_signals?.library_alignment}
          rewrite={data.copy?.safety_signals?.rewrite}
        />
        <CopyList
          label="Proof Signals"
          items={data.copy?.proof_signals?.identified ?? []}
          feedback={data.copy?.proof_signals?.feedback}
          score={data.copy?.proof_signals?.strength ?? 0}
          alignment={data.copy?.proof_signals?.library_alignment}
          rewrite={data.copy?.proof_signals?.rewrite}
        />
        <CopyRow
          label="CTA"
          text={data.copy?.cta?.text}
          feedback={data.copy?.cta?.feedback}
          dnaChips={ctaChips(data.copy?.cta?.dna)}
          alignment={data.copy?.cta?.library_alignment}
          rewrite={data.copy?.cta?.rewrite}
        >
          <ScoreBadge score={data.copy?.cta?.clarity ?? 0} />
        </CopyRow>
      </Section>

      {/* Behavioral Economics — grid stays compact; rewrites render below as a list to avoid uneven cell heights */}
      <Section title="Behavioral Economics">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(BE_LABELS).map(([key, label]) => {
            const be = (data.behavioral_economics as unknown as Record<string, { present: boolean; strength: number; note: string; rewrite?: RewriteLike }>)?.[key]
            if (!be) return null
            return (
              <div
                key={key}
                className={`rounded-lg px-2.5 py-2 border ${
                  be.present ? 'bg-gray-900 border-emerald-800/50' : 'bg-gray-900 border-gray-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[11px] font-medium ${be.present ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {label}
                  </span>
                  {be.present && <ScoreBadge score={be.strength} />}
                </div>
                <p className="text-[10px] text-gray-400 leading-snug">{be.note || (be.present ? '' : 'Not present')}</p>
              </div>
            )
          })}
        </div>
        {/* BE rewrites stacked full-width below the grid so cells stay uniform */}
        {Object.entries(BE_LABELS).some(([key]) => {
          const be = (data.behavioral_economics as unknown as Record<string, { rewrite?: RewriteLike }>)?.[key]
          return !!be?.rewrite
        }) && (
          <div className="space-y-2 pt-1">
            {Object.entries(BE_LABELS).map(([key, label]) => {
              const be = (data.behavioral_economics as unknown as Record<string, { rewrite?: RewriteLike }>)?.[key]
              if (!be?.rewrite) return null
              return <RewriteCard key={`rw-${key}`} rewrite={be.rewrite} label={`Strengthen ${label}`} />
            })}
          </div>
        )}
        {data.behavioral_economics?.overall_feedback && (
          <p className="text-[11px] text-gray-400 leading-snug mt-1">{data.behavioral_economics.overall_feedback}</p>
        )}
      </Section>

      {/* Offer Architecture */}
      {data.offer_architecture && (
        <Section title="Offer Architecture">
          {data.offer_architecture.offer_present ? (
            <>
              {data.offer_architecture.offer_text && (
                <p className="text-xs text-gray-200 italic">&ldquo;{data.offer_architecture.offer_text}&rdquo;</p>
              )}
              <div className="flex flex-wrap gap-2">
                {[
                  ['Price anchor', data.offer_architecture.has_price_anchor],
                  ['Guarantee', data.offer_architecture.has_guarantee],
                  ['Urgency', data.offer_architecture.has_urgency_mechanism],
                  ['Trial / free', data.offer_architecture.has_trial_or_free],
                ].map(([label, present]) => (
                  <span
                    key={label as string}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      present
                        ? 'text-emerald-400 border-emerald-900/50'
                        : 'text-gray-600 border-gray-800'
                    }`}
                  >
                    {label as string}
                  </span>
                ))}
              </div>
              <div className="flex gap-4">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Perceived value</p>
                  <ScoreBadge score={data.offer_architecture.perceived_value_score} />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Offer clarity</p>
                  <ScoreBadge score={data.offer_architecture.offer_clarity_score} />
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-500 italic">No offer present in this ad.</p>
          )}
          {data.offer_architecture.offer_feedback && (
            <p className="text-[11px] text-gray-400 leading-snug border-t border-gray-800 pt-2">
              {data.offer_architecture.offer_feedback}
            </p>
          )}
          <LibraryAlignmentChips alignment={data.offer_architecture.library_alignment} />
          <RewriteCard rewrite={data.offer_architecture.rewrite} label="Proposed Offer Rewrite" />
        </Section>
      )}

      {/* Promise Clarity (M2 audit) — the literal sentence the reader's brain receives. */}
      {data.promise_clarity && (data.promise_clarity.one_line || data.promise_clarity.score) ? (
        <Section title="Promise Clarity">
          <div className="flex items-center gap-3">
            <ScoreBadge score={data.promise_clarity.score ?? 0} />
            <span className="text-[10px] text-gray-500">
              <Tooltip text="Halbert's WIIFM in 3 seconds: in one sentence, what does the reader's brain understand they get? If a sentence can't be written, the ad has failed promise clarity.">
                WIIFM in 3 seconds
              </Tooltip>
            </span>
          </div>
          {data.promise_clarity.one_line && (
            <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
              <p className="text-xs text-gray-100 italic leading-snug">&ldquo;{data.promise_clarity.one_line}&rdquo;</p>
              <CopyButton text={data.promise_clarity.one_line} label="" className="shrink-0 mt-0.5" />
            </div>
          )}
          {data.promise_clarity.feedback && (
            <p className="text-[11px] text-gray-400 leading-snug">{data.promise_clarity.feedback}</p>
          )}
        </Section>
      ) : null}

      {/* Objection Preempt (M5 audit) — Schwartz: name the objection before the reader does. */}
      {data.objection_preempt && (data.objection_preempt.objections_addressed?.length || data.objection_preempt.objections_unaddressed?.length) ? (
        <Section title="Objection Preempt">
          <div className="flex items-center gap-3">
            <ScoreBadge score={data.objection_preempt.score ?? 0} />
            <span className="text-[10px] text-gray-500">
              <Tooltip text="Schwartz: an ad that names the objection before the reader does converts higher than one that ignores it. Aim to address the top 2–3 objections for this audience.">
                preempt &gt; ignore
              </Tooltip>
            </span>
          </div>
          {(data.objection_preempt.objections_addressed ?? []).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Addressed</p>
              <div className="flex flex-wrap gap-1">
                {data.objection_preempt.objections_addressed.map((o, i) => (
                  <span key={`a-${i}`} className="text-[10px] text-emerald-400 bg-gray-900 border border-emerald-900/40 rounded px-1.5 py-0.5">{o}</span>
                ))}
              </div>
            </div>
          )}
          {(data.objection_preempt.objections_unaddressed ?? []).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Left unanswered</p>
              <div className="flex flex-wrap gap-1">
                {data.objection_preempt.objections_unaddressed.map((o, i) => (
                  <span key={`u-${i}`} className="text-[10px] text-[#ff2a2b] bg-gray-900 border border-red-900/40 rounded px-1.5 py-0.5">{o}</span>
                ))}
              </div>
            </div>
          )}
          {data.objection_preempt.feedback && (
            <p className="text-[11px] text-gray-400 leading-snug">{data.objection_preempt.feedback}</p>
          )}
        </Section>
      ) : null}

      {/* Proof Specificity (M3 audit) — Ogilvy: '9 of 10 dermatologists', not 'doctors'. */}
      {data.proof_specificity && (
        <Section title="Proof Specificity">
          <div className="flex items-center gap-3">
            <ScoreBadge score={data.proof_specificity.score ?? 0} />
            <span className="text-[10px] text-gray-500">
              <Tooltip text="Ogilvy's named-source rule: '9 of 10 dermatologists' converts where 'doctors recommend' does not. Score lifts when proof is named, numbered, and third-party-attributed.">
                named, numbered, attributed
              </Tooltip>
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <Badge on={data.proof_specificity.has_named_source} label="Named source" />
            <Badge on={data.proof_specificity.has_specific_number} label="Specific number" />
            <Badge on={data.proof_specificity.has_third_party_attribution} label="Third-party attribution" />
          </div>
          {data.proof_specificity.feedback && (
            <p className="text-[11px] text-gray-400 leading-snug">{data.proof_specificity.feedback}</p>
          )}
        </Section>
      )}

      {/* Risk Reversal (M6 audit) — refines offer_architecture.has_guarantee. */}
      {data.risk_reversal && (data.risk_reversal.has_guarantee || data.risk_reversal.score) ? (
        <Section title="Risk Reversal">
          <div className="flex items-center gap-3">
            <ScoreBadge score={data.risk_reversal.score ?? 0} />
            <span className="text-[10px] text-gray-500">
              <Tooltip text="A 365-day no-questions-asked guarantee is not the same boolean as 'we promise quality'. Days, return condition, and contingency all carry conversion weight.">
                guarantee specificity matters
              </Tooltip>
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <Badge on={data.risk_reversal.has_guarantee} label="Guarantee present" />
            {data.risk_reversal.guarantee_days != null && (
              <span className="text-emerald-400 border border-emerald-900/50 bg-gray-900 px-1.5 py-0.5 rounded">
                {data.risk_reversal.guarantee_days} days
              </span>
            )}
            {data.risk_reversal.return_condition && data.risk_reversal.return_condition !== 'absent' && (
              <span className="text-gray-300 border border-gray-800 bg-gray-900 px-1.5 py-0.5 rounded">
                {data.risk_reversal.return_condition.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          {data.risk_reversal.refund_contingency && (
            <p className="text-[11px] text-gray-300 leading-snug italic">&ldquo;{data.risk_reversal.refund_contingency}&rdquo;</p>
          )}
          {data.risk_reversal.feedback && (
            <p className="text-[11px] text-gray-400 leading-snug">{data.risk_reversal.feedback}</p>
          )}
        </Section>
      ) : null}

      {/* Cognitive Simplicity — internally stored as cognitive_load.score where
          low=effortless; we display the inverted form so the convention
          matches every other score (higher = better). */}
      {data.cognitive_load && (
        <Section title="Cognitive Simplicity">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Simplicity</p>
              <ScoreBadge score={Math.max(1, Math.min(10, 11 - (data.cognitive_load.score || 0)))} />
              <p className="text-[10px] text-gray-600 mt-0.5">higher = lighter to process</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Density</p>
              <span className={`text-xs font-medium ${
                data.cognitive_load.density === 'minimal' ? 'text-emerald-400' :
                data.cognitive_load.density === 'moderate' ? 'text-amber-400' : 'text-[#ff2a2b]'
              }`}>
                {data.cognitive_load.density}
              </span>
            </div>
          </div>
          {data.cognitive_load.overload_risk && data.cognitive_load.overload_risk !== 'none' && (
            <p className="text-[11px] text-gray-400 leading-snug">{data.cognitive_load.overload_risk}</p>
          )}
          {data.cognitive_load.simplification && (
            <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-0.5">Simplification</p>
              <p className="text-xs text-gray-300 leading-snug">{data.cognitive_load.simplification}</p>
            </div>
          )}
          <RewriteCard rewrite={data.cognitive_load.rewrite} label="Proposed Subtraction" />
        </Section>
      )}

      {/* Neuroscience */}
      {data.neuroscience && (
        <Section title="Neuroscience">
          <NeuroRow label="Attention" text={data.neuroscience.attention_prediction} />
          <NeuroRow label="Emotional Encoding" text={data.neuroscience.emotional_encoding} />
          <NeuroRow label="Memory Encoding" text={data.neuroscience.memory_encoding} />
          {data.neuroscience.feedback && (
            <p className="text-[11px] text-gray-400 leading-snug pt-1">{data.neuroscience.feedback}</p>
          )}
        </Section>
      )}

      {/* Visual Dimensions */}
      {data.visual_dimensions && (
        <Section title="Ad Dimensions — Sonnet">
          {(
            [
              ['CTA Strength', data.visual_dimensions.cta_strength],
              ['Emotional Appeal', data.visual_dimensions.emotional_appeal],
              ['Brand Clarity', data.visual_dimensions.brand_clarity],
              ['Visual Hierarchy', data.visual_dimensions.visual_hierarchy],
            ] as [string, { score: number; feedback: string; rewrite?: RewriteLike }][]
          ).map(([label, dim]) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-300 font-medium">{label}</span>
                <ScoreBadge score={dim?.score ?? 0} />
              </div>
              <p className="text-[11px] text-gray-400 leading-snug">{dim?.feedback}</p>
              <RewriteCard rewrite={dim?.rewrite} label={`Proposed ${label} Change`} />
            </div>
          ))}
        </Section>
      )}

      {/* Pattern Matches — winners satisfy rules (P-prefixed); losers embody anti-patterns (A-prefixed) */}
      {data.pattern_matches && data.pattern_matches.length > 0 && (
        <Section title={isLoser ? 'Anti-Pattern Matches' : 'Winning Pattern Matches'}>
          <ul className="space-y-1.5">
            {data.pattern_matches.map((p, i) => {
              const isAnti = p.trim().startsWith('[A')
              return (
                <li key={i} className="flex gap-2 text-[11px] text-gray-300">
                  <span className={`shrink-0 ${isAnti ? 'text-[#ff2a2b]' : 'text-yellow-500'}`}>{isAnti ? '✗' : '★'}</span>
                  <span>{p}</span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* Framework Score */}
      {data.framework_score && (
        <Section title="Framework Score">
          <p className="text-[10px] text-gray-500 leading-snug">
            <Tooltip text="The minimum-viable-copy framework: every element (headline, subheadline, benefits, trust, CTA) must be justified by the previous one leaving something unresolved. Grade A = every element justified; D = elements present but not earning their place." width="lg">
              Framework grade
            </Tooltip>{' '}
            audits whether each element earns its place.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <GradeBadge grade={data.framework_score.overall_framework_grade} score={data.framework_score.overall_framework_score} />
            <span className={`text-xs font-medium ${
              data.framework_score.passes_minimum_viable_test ? 'text-emerald-400' : 'text-[#ff2a2b]'
            }`}>
              Minimum viable test: {data.framework_score.minimum_viable_test_score?.toFixed?.(1) ?? '—'}/10
              {data.framework_score.passes_minimum_viable_test ? ' ✓' : ' ✗'}
            </span>
          </div>
          <div className="space-y-1.5 pt-1">
            <PassFail pass={!data.framework_score.headline_leaves_gap} label="Headline is complete (no unresolved gap)" />
            <PassFail pass={data.framework_score.subheadline_justified} label="Subheadline is justified" />
            <PassFail pass={data.framework_score.benefits_justified} label="Benefits are justified" />
            <PassFail pass={data.framework_score.trust_signal_justified} label="Trust signal is justified" />
            <PassFail pass={data.framework_score.cta_justified} label="CTA is justified" />
          </div>
          {data.framework_score.framework_feedback && (
            <p className="text-[11px] text-gray-400 leading-snug border-t border-gray-800 pt-2">
              {data.framework_score.framework_feedback}
            </p>
          )}
        </Section>
      )}

      {/* Element Congruence */}
      {data.congruence && (
        <Section title="Element Congruence">
          <div className="flex items-center gap-2">
            <ScoreBadge score={data.congruence.overall_score} />
            <span className="text-[11px] text-gray-500">overall congruence</span>
          </div>
          <div className="space-y-2 pt-1">
            {([
              ['headline_to_visual', 'Headline ↔ Visual'],
              ['headline_to_subheadline', 'Headline ↔ Subheadline'],
              ['body_to_headline', 'Body ↔ Headline'],
              ['benefits_to_headline', 'Benefits ↔ Headline'],
              ['cta_to_offer', 'CTA ↔ Offer'],
              ['trust_signals_to_claim', 'Trust signals ↔ Claim'],
            ] as [keyof typeof data.congruence, string][]).map(([key, label]) => {
              const entry = data.congruence![key] as { aligned: boolean; note: string }
              return (
                <div key={key} className="space-y-0.5">
                  <PassFail pass={entry.aligned} label={label} />
                  {entry.note && <p className="text-[10px] text-gray-500 pl-5 leading-snug">{entry.note}</p>}
                </div>
              )
            })}
          </div>
          {data.congruence.incoherence_summary && data.congruence.incoherence_summary !== 'No incoherence detected' && (
            <p className={`text-[11px] leading-snug border-t border-gray-800 pt-2 ${data.congruence.overall_score < 7 ? 'text-amber-300' : 'text-gray-400'}`}>
              {data.congruence.incoherence_summary}
            </p>
          )}
          {data.congruence.fix && (
            <p className={`text-[11px] leading-snug ${data.congruence.overall_score < 7 ? 'text-[#ff2a2b]' : 'text-gray-400'}`}>
              {isHistorical ? 'Insight' : 'Fix'}: {data.congruence.fix}
            </p>
          )}
          <LibraryAlignmentChips alignment={data.congruence.library_alignment} />
          <RewriteCard rewrite={data.congruence.rewrite} label="Proposed Congruence Fix" />
        </Section>
      )}

      {/* Combination Analysis — frames everything in the structural light of "should this ad have these elements together?" */}
      {data.combination_analysis && data.combination_analysis.current_combination && (
        <Section title="Combination Analysis">
          <div className="bg-gray-950 border border-indigo-900/40 rounded-lg px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wide text-indigo-400 font-semibold">
                <Tooltip text="A composition_tag is a canonical short-hand for the elements present in the ad — e.g. 'headline+benefits+cta' or 'headline_only'. The pattern library groups winners and losers by this tag so the system can spot which stacks reliably convert in your segment." width="lg">
                  Current Combination
                </Tooltip>
              </span>
              <span className="text-xs text-white font-mono bg-gray-900 border border-gray-800 rounded px-2 py-0.5">
                {data.combination_analysis.current_combination}
              </span>
            </div>
            {data.combination_analysis.combination_assessment && (
              <p className="text-xs text-gray-300 leading-snug">
                {data.combination_analysis.combination_assessment}
              </p>
            )}
          </div>

          {data.combination_analysis.historical_match && (
            <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Historical Match (this segment)</p>
              <div className="flex items-center gap-3 flex-wrap text-[11px]">
                <span className="text-emerald-400">
                  Winners: {data.combination_analysis.historical_match.winners_with_same_combo_in_segment}
                </span>
                <span className="text-[#ff2a2b]">
                  Losers: {data.combination_analysis.historical_match.losers_with_same_combo_in_segment}
                </span>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                  data.combination_analysis.historical_match.verdict === 'strong_winner_pattern'
                    ? 'text-emerald-400 border-emerald-800/60'
                    : data.combination_analysis.historical_match.verdict === 'mostly_loser_pattern'
                      ? 'text-[#ff2a2b] border-red-900/60'
                      : data.combination_analysis.historical_match.verdict === 'mixed_record'
                        ? 'text-amber-400 border-amber-800/60'
                        : 'text-gray-400 border-gray-700'
                }`}>
                  {data.combination_analysis.historical_match.verdict.replace(/_/g, ' ')}
                </span>
              </div>
              {data.combination_analysis.historical_match.winner_examples?.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-gray-500">Winners:</span>
                  {data.combination_analysis.historical_match.winner_examples.map((w, i) => (
                    <span key={i} className="text-[10px] text-emerald-400 font-mono bg-gray-900 px-1.5 py-0.5 rounded border border-emerald-900/40">{w}</span>
                  ))}
                </div>
              )}
              {data.combination_analysis.historical_match.loser_examples?.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-gray-500">Losers:</span>
                  {data.combination_analysis.historical_match.loser_examples.map((l, i) => (
                    <span key={i} className="text-[10px] text-[#ff2a2b] font-mono bg-gray-900 px-1.5 py-0.5 rounded border border-red-900/40">{l}</span>
                  ))}
                </div>
              )}
              {data.combination_analysis.historical_match.verdict_reasoning && (
                <p className="text-[11px] text-gray-400 leading-snug">{data.combination_analysis.historical_match.verdict_reasoning}</p>
              )}
            </div>
          )}

          {data.combination_analysis.alternative_combination && (
            <div className="bg-gray-950 border border-amber-900/50 rounded-lg px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">
                  {data.combination_analysis.alternative_combination.intent === 'replacement'
                    ? 'Recommended Replacement'
                    : data.combination_analysis.alternative_combination.intent === 'test_variant'
                      ? 'Recommended Test Variant'
                      : 'Alternative'}
                </span>
                {data.combination_analysis.alternative_combination.recommended && (
                  <span className="text-xs text-white font-mono bg-gray-900 border border-amber-900/40 rounded px-2 py-0.5">
                    {data.combination_analysis.alternative_combination.recommended}
                  </span>
                )}
              </div>
              {data.combination_analysis.alternative_combination.rationale && (
                <p className="text-xs text-gray-300 leading-snug">{data.combination_analysis.alternative_combination.rationale}</p>
              )}
              {data.combination_analysis.alternative_combination.element_changes && (
                <div className="space-y-1 pt-1 border-t border-gray-800">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Element Changes</p>
                  {Object.entries(data.combination_analysis.alternative_combination.element_changes).map(([key, value]) => {
                    const display = Array.isArray(value) ? value.join(' • ') : value
                    if (!display || display === 'unchanged') return null
                    const isRemove = display === 'remove' || display === 'remove_or_replace'
                    return (
                      <div key={key} className="flex items-start gap-2 text-[11px]">
                        <span className="text-gray-500 uppercase font-mono w-20 shrink-0">{key}:</span>
                        <span className={isRemove ? 'text-[#ff2a2b] font-semibold' : 'text-gray-200'}>
                          {display}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {data.combination_analysis.alternative_combination.predicted_impact && (
                <p className="text-[11px] text-amber-300/90 leading-snug pt-1 border-t border-gray-800">
                  Impact: {data.combination_analysis.alternative_combination.predicted_impact}
                </p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* Overall Verdict */}
      {data.overall && (
        <Section title="Overall Verdict">
          {data.overall.verdict && (
            <p className="text-xs text-gray-300 leading-relaxed">{data.overall.verdict}</p>
          )}
          {data.overall.top_strength && (
            <div className="bg-gray-950 border border-emerald-900/40 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold mb-0.5">Top Strength</p>
              <p className="text-xs text-gray-200 leading-snug">{data.overall.top_strength}</p>
            </div>
          )}
          {data.overall.critical_weakness && (
            <div className="bg-gray-950 border border-red-900/40 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[#ff2a2b] font-semibold mb-0.5">
                {isHistorical ? 'Structural Absence' : 'Critical Weakness'}
              </p>
              <p className="text-xs text-gray-200 leading-snug">{data.overall.critical_weakness}</p>
            </div>
          )}
          {data.overall.priority_fix && (
            <div className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-0.5">
                {isHistorical ? 'Key Learning' : 'Priority Fix'}
              </p>
              <p className="text-xs text-gray-200 leading-snug">{data.overall.priority_fix}</p>
            </div>
          )}
        </Section>
      )}
    </>
  )
}

function CopyRow({
  label, text, feedback, children, dnaChips, alignment, rewrite,
}: {
  label: string
  text?: string
  feedback?: string
  children?: React.ReactNode
  dnaChips?: string[]
  alignment?: AlignmentLike
  rewrite?: RewriteLike
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{label}</span>
        {children}
      </div>
      {text && <p className="text-xs text-gray-200 italic">&ldquo;{text}&rdquo;</p>}
      {dnaChips && dnaChips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dnaChips.map((chip, i) => (
            <span key={i} className="text-[9px] text-gray-400 bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 font-mono">{chip}</span>
          ))}
        </div>
      )}
      {feedback && <p className="text-[11px] text-gray-400 leading-snug">{feedback}</p>}
      <LibraryAlignmentChips alignment={alignment} />
      <RewriteCard rewrite={rewrite} />
    </div>
  )
}

function CopyList({
  label, items, feedback, score, dnaChips, alignment, rewrite,
}: {
  label: string
  items: string[]
  feedback?: string
  score: number
  dnaChips?: string[]
  alignment?: AlignmentLike
  rewrite?: RewriteLike
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{label}</span>
        <ScoreBadge score={score} />
      </div>
      {items.length > 0 ? (
        <p className="text-xs text-gray-300">{items.join(' · ')}</p>
      ) : (
        <p className="text-xs text-gray-600 italic">None identified</p>
      )}
      {dnaChips && dnaChips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dnaChips.map((chip, i) => (
            <span key={i} className="text-[9px] text-gray-400 bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 font-mono">{chip}</span>
          ))}
        </div>
      )}
      {feedback && <p className="text-[11px] text-gray-400 leading-snug">{feedback}</p>}
      <LibraryAlignmentChips alignment={alignment} />
      <RewriteCard rewrite={rewrite} />
    </div>
  )
}

function headlineChips(dna: ComprehensiveAnalysis['copy']['headline']['dna']): string[] {
  if (!dna) return []
  const chips: string[] = []
  if (dna.word_count != null) chips.push(`${dna.word_count}w`)
  if (dna.char_count != null) chips.push(`${dna.char_count}c`)
  if (dna.structure_type) chips.push(`structure: ${dna.structure_type}`)
  if (dna.voice) chips.push(`voice: ${dna.voice}`)
  if (dna.emotional_register) chips.push(`reg: ${dna.emotional_register}`)
  if (dna.specificity_level) chips.push(`spec: ${dna.specificity_level}`)
  if (dna.time_bound) chips.push('time-bound')
  if (dna.uses_negation) chips.push('negation')
  if (dna.uses_contrast) chips.push('contrast')
  return chips
}

function subheadlineChips(dna: ComprehensiveAnalysis['copy']['subheadline']['dna']): string[] {
  if (!dna || dna.role === 'absent') return []
  const chips: string[] = []
  if (dna.role) chips.push(`role: ${dna.role}`)
  if (dna.length_relative_to_headline) chips.push(`length: ${dna.length_relative_to_headline}`)
  if (dna.tonal_shift && dna.tonal_shift !== 'absent') chips.push(`tonal: ${dna.tonal_shift}`)
  return chips
}

function benefitsChips(dna: ComprehensiveAnalysis['copy']['benefits_features']['dna']): string[] {
  if (!dna || !dna.count) return []
  const chips: string[] = [`count: ${dna.count}`]
  if (dna.pattern_uniformity) chips.push(dna.pattern_uniformity)
  if (dna.outcome_vs_feature_split) chips.push(dna.outcome_vs_feature_split.replace('mostly_', ''))
  if (dna.specificity) chips.push(`spec: ${dna.specificity}`)
  return chips
}

function trustChips(dna: ComprehensiveAnalysis['copy']['trust_signals']['dna']): string[] {
  if (!dna || !dna.count) return []
  const chips: string[] = [`count: ${dna.count}`]
  if (dna.types_present?.length) chips.push(`types: ${dna.types_present.join(', ')}`)
  if (dna.has_specific_quantifiers === true) chips.push('quantified')
  if (dna.source_attribution && dna.source_attribution !== 'absent') chips.push(dna.source_attribution)
  return chips
}

function ctaChips(dna: ComprehensiveAnalysis['copy']['cta']['dna']): string[] {
  if (!dna) return []
  const chips: string[] = []
  if (dna.verb) chips.push(`verb: ${dna.verb}`)
  if (dna.framing && dna.framing !== 'absent') chips.push(dna.framing)
  if (dna.friction_level && dna.friction_level !== 'absent') chips.push(`friction: ${dna.friction_level}`)
  if (dna.has_value_anchor) chips.push('value-anchor')
  if (dna.has_urgency_signal) chips.push('urgency')
  return chips
}

function bodyChips(dna: ComprehensiveAnalysis['body_dna']): string[] {
  if (!dna) return []
  const chips: string[] = []
  if (dna.word_count != null) chips.push(`${dna.word_count}w`)
  if (dna.paragraph_count != null) chips.push(`${dna.paragraph_count}p`)
  if (dna.sentence_count != null) chips.push(`${dna.sentence_count}s`)
  if (dna.avg_sentence_length != null) chips.push(`avg ${dna.avg_sentence_length}w/s`)
  if (dna.frame && dna.frame !== 'absent') chips.push(`frame: ${dna.frame}`)
  if (dna.personal_pronoun_density && dna.personal_pronoun_density !== 'absent') chips.push(`pronouns: ${dna.personal_pronoun_density}`)
  return chips
}

function NeuroRow({ label, text }: { label: string; text?: string }) {
  if (!text) return null
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</p>
      <p className="text-[11px] text-gray-300 leading-snug">{text}</p>
    </div>
  )
}
