'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, Settings2 } from 'lucide-react'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'
import { ConceptAngleManager } from './ConceptAngleManager'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  productName: string
  ads: ProductAdRow[]
  productId?: string
  token?: string
  onOpenAd?: (analysisId: string) => void
  /** Highlight an ad currently being re-analyzed. */
  currentReanalyzeId?: string | null
}

interface AdLeafSlot {
  analysisId: string
  headline: string | null
  quadrant: string | null
  heatmapUrl: string | null
  spendUsd: number | null
  cpaUsd: number | null
}

type AngleMap   = Map<string, AdLeafSlot[]>
type ConceptMap = Map<string, AngleMap>
type MicroMap   = Map<string, ConceptMap>
type PersonaMap = Map<string, MicroMap>
type TamMap     = Map<string, PersonaMap>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function bestLabel(s: string | null | undefined, fallback: string): string {
  return s?.trim() || fallback
}

const QUADRANT_RANK: Record<string, number> = { winner: 0, promising: 1, investigate: 2, loser: 3 }

function sortAdsByQuadrant(ads: AdLeafSlot[]): AdLeafSlot[] {
  return [...ads].sort((a, b) =>
    (a.quadrant ? QUADRANT_RANK[a.quadrant] ?? 4 : 4) -
    (b.quadrant ? QUADRANT_RANK[b.quadrant] ?? 4 : 4))
}

function flattenAds(node: unknown): AdLeafSlot[] {
  const out: AdLeafSlot[] = []
  if (node instanceof Map) {
    for (const v of (node as Map<string, unknown>).values()) out.push(...flattenAds(v))
  } else if (Array.isArray(node)) {
    out.push(...(node as AdLeafSlot[]))
  }
  return out
}

function countWinners(ads: AdLeafSlot[]): number {
  return ads.filter(a => a.quadrant === 'winner').length
}

/** Sort branch keys by (winners desc, total desc) so the strongest branches surface first. */
function rankBranches<T>(entries: Array<[string, T]>, getAds: (v: T) => AdLeafSlot[]): Array<[string, T]> {
  return [...entries].sort(([, a], [, b]) => {
    const aa = getAds(a)
    const bb = getAds(b)
    return countWinners(bb) - countWinners(aa) || bb.length - aa.length
  })
}

// ─── Visual atoms ────────────────────────────────────────────────────────────

const QUADRANT_DOT: Record<string, string> = {
  winner:     'bg-emerald-400',
  promising:  'bg-indigo-400',
  investigate:'bg-amber-400',
  loser:      'bg-[#ff2a2b]',
}

function QuadrantPill({ q }: { q: string | null }) {
  if (!q) return <span className="text-[9px] font-mono text-gray-600 uppercase">untagged</span>
  const colors: Record<string, string> = {
    winner:      'bg-emerald-500/15 text-emerald-300 border-emerald-700/40',
    promising:   'bg-indigo-500/15 text-indigo-300 border-indigo-700/40',
    investigate: 'bg-amber-500/15 text-amber-300 border-amber-700/40',
    loser:       'bg-[#ff2a2b]/10 text-[#ff2a2b] border-red-900/50',
  }
  return (
    <span className={`text-[9px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${colors[q] ?? 'bg-gray-900 text-gray-500 border-gray-800'}`}>
      {q}
    </span>
  )
}

function CountBadge({ total, winners }: { total: number; winners: number }) {
  return (
    <span className="text-[10px] font-mono text-gray-500 tabular-nums whitespace-nowrap">
      {total} {total === 1 ? 'ad' : 'ads'}
      {winners > 0 && (
        <span className="text-emerald-400"> · {winners} {winners === 1 ? 'winner' : 'winners'}</span>
      )}
    </span>
  )
}

// ─── Row primitives ──────────────────────────────────────────────────────────

interface RowProps {
  id: string
  expanded: Set<string>
  toggle: (id: string) => void
  level: 0 | 1 | 2 | 3 | 4   // 0=TAM, 1=Persona, 2=Micro, 3=Concept, 4=Angle
  label: string
  ads: AdLeafSlot[]
  children?: React.ReactNode
}

const LEVEL_STYLE: Record<number, { pad: string; labelTone: string; bg: string; hover: string }> = {
  0: { pad: 'pl-3',  labelTone: 'text-white font-semibold text-sm',     bg: 'bg-gray-900',  hover: 'hover:bg-gray-800/60' },
  1: { pad: 'pl-7',  labelTone: 'text-indigo-200 font-medium text-xs',  bg: 'bg-gray-925',  hover: 'hover:bg-gray-800/40' },
  2: { pad: 'pl-12', labelTone: 'text-gray-200 text-xs',                bg: 'bg-gray-950',  hover: 'hover:bg-gray-900/60' },
  3: { pad: 'pl-16', labelTone: 'text-gray-300 text-[11px]',            bg: 'bg-gray-950',  hover: 'hover:bg-gray-900/60' },
  4: { pad: 'pl-20', labelTone: 'text-gray-400 text-[11px] italic',     bg: 'bg-gray-950',  hover: 'hover:bg-gray-900/60' },
}

function NodeRow({ id, expanded, toggle, level, label, ads, children }: RowProps) {
  const isOpen = expanded.has(id)
  const hasChildren = !!children
  const winners = countWinners(ads)
  const style = LEVEL_STYLE[level]
  return (
    <div>
      <button
        onClick={() => hasChildren && toggle(id)}
        className={`w-full flex items-center justify-between gap-3 py-2 pr-3 border-b border-gray-800/60 transition-colors text-left ${style.pad} ${style.bg} ${hasChildren ? style.hover + ' cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasChildren ? (
            isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {winners > 0 && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${QUADRANT_DOT.winner}`} />}
          <span className={`truncate ${style.labelTone}`}>{label}</span>
        </div>
        <CountBadge total={ads.length} winners={winners} />
      </button>
      {isOpen && children && (
        <div className="bg-gray-950/60">
          {children}
        </div>
      )}
    </div>
  )
}

function AdRow({
  ad,
  onOpenAd,
  current,
}: {
  ad: AdLeafSlot
  onOpenAd?: (id: string) => void
  current: boolean
}) {
  const headline = ad.headline ?? '(no headline)'
  const cpa = ad.cpaUsd != null ? `$${ad.cpaUsd.toFixed(0)} CPA` : null
  const spend = ad.spendUsd != null ? `$${ad.spendUsd.toFixed(0)} spend` : null
  return (
    <button
      onClick={() => onOpenAd?.(ad.analysisId)}
      disabled={!onOpenAd}
      className={`w-full flex items-center gap-3 pl-24 pr-3 py-2 border-b border-gray-800/40 hover:bg-gray-900/80 transition-colors text-left ${onOpenAd ? 'cursor-pointer' : 'cursor-default'} ${current ? 'bg-indigo-950/30 animate-pulse' : ''}`}
    >
      {ad.heatmapUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.heatmapUrl} alt="" className="w-9 h-9 rounded object-cover border border-gray-800 shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded bg-gray-900 border border-gray-800 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-200 truncate">{headline}</p>
        <p className="text-[10px] text-gray-500 truncate">
          {[spend, cpa].filter(Boolean).join(' · ') || 'no spend data'}
        </p>
      </div>
      <QuadrantPill q={ad.quadrant} />
    </button>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AudienceDropdown({ productName, ads, productId, token, onOpenAd, currentReanalyzeId }: Props) {
  // Build 5-level tree from ads (same logic as the previous mind map).
  const tree = useMemo(() => {
    const tamTree: TamMap     = new Map()
    const tamDisplay          = new Map<string, string>()
    const personaDisplay      = new Map<string, string>()
    const microDisplay        = new Map<string, string>()
    const conceptDisplay      = new Map<string, string>()
    const angleDisplay        = new Map<string, string>()

    for (const ad of ads) {
      const inf = ad.audience_inference
      const tamK      = norm(ad.tam_label)           || 'no_tam'
      const persK     = norm(ad.persona_label)       || 'no_persona'
      const microK    = norm(ad.micro_persona_label) || 'unspecified'
      const conceptRaw = ad.concept_label ?? ad.stated_concept ?? inf?.inferred_concept ?? null
      const angleRaw   = ad.angle_label   ?? ad.stated_angle   ?? inf?.inferred_angle   ?? null
      const conceptK  = norm(conceptRaw) || 'no_concept'
      const angleK    = norm(angleRaw)   || 'no_angle'

      if (!tamDisplay.has(tamK))         tamDisplay.set(tamK,         bestLabel(ad.tam_label, '(no TAM yet)'))
      if (!personaDisplay.has(persK))    personaDisplay.set(persK,    bestLabel(ad.persona_label, '(no persona yet)'))
      if (!microDisplay.has(microK))     microDisplay.set(microK,     bestLabel(ad.micro_persona_label, '(unspecified)'))
      if (!conceptDisplay.has(conceptK)) conceptDisplay.set(conceptK, bestLabel(conceptRaw, '(no concept)'))
      if (!angleDisplay.has(angleK))     angleDisplay.set(angleK,     bestLabel(angleRaw, '(no angle)'))

      if (!tamTree.has(tamK)) tamTree.set(tamK, new Map())
      const persMap = tamTree.get(tamK)!
      if (!persMap.has(persK)) persMap.set(persK, new Map())
      const microMap = persMap.get(persK)!
      if (!microMap.has(microK)) microMap.set(microK, new Map())
      const conceptMap = microMap.get(microK)!
      if (!conceptMap.has(conceptK)) conceptMap.set(conceptK, new Map())
      const angleMap = conceptMap.get(conceptK)!
      if (!angleMap.has(angleK)) angleMap.set(angleK, [])
      angleMap.get(angleK)!.push({
        analysisId: ad.analysis_id,
        headline:   ad.headline_text,
        quadrant:   ad.effective_quadrant,
        heatmapUrl: ad.heatmap_url,
        spendUsd:   ad.spend_usd,
        cpaUsd:     ad.cpa_usd,
      })
    }

    return { tamTree, tamDisplay, personaDisplay, microDisplay, conceptDisplay, angleDisplay }
  }, [ads])

  // Persistent expansion state, keyed by stable IDs so data refreshes don't collapse open branches.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setExpanded(prev => {
    const s = new Set(prev)
    if (s.has(id)) s.delete(id); else s.add(id)
    return s
  })

  const expandAll = () => {
    const s = new Set<string>()
    for (const [tamK, persMap] of tree.tamTree) {
      s.add(`tam::${tamK}`)
      for (const [persK, microMap] of persMap) {
        s.add(`persona::${tamK}::${persK}`)
        for (const [microK, conceptMap] of microMap) {
          s.add(`micro::${tamK}::${persK}::${microK}`)
          for (const conceptK of conceptMap.keys()) {
            s.add(`concept::${tamK}::${persK}::${microK}::${conceptK}`)
          }
        }
      }
    }
    setExpanded(s)
  }
  const collapseAll = () => setExpanded(new Set())

  const [showManager, setShowManager] = useState(false)
  const totalAds = ads.length

  // Rank top-level TAMs by winner density.
  const tamEntries = rankBranches(
    Array.from(tree.tamTree.entries()),
    (persMap) => flattenAds(persMap),
  )

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden glass card-lift">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-800 bg-gray-950/50 backdrop-blur-md">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">Audience map · {productName}</h3>
          <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">
            TAM → persona → micro-persona → concept → angle → ads. Auto-updates after every re-analyze and new upload.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={expandAll}
            className="text-[10px] font-mono uppercase tracking-wide text-gray-400 hover:text-white border border-gray-800 hover:border-gray-700 px-2 py-1 rounded transition-colors"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="text-[10px] font-mono uppercase tracking-wide text-gray-400 hover:text-white border border-gray-800 hover:border-gray-700 px-2 py-1 rounded transition-colors"
          >
            Collapse
          </button>
          {productId && token && (
            <button
              onClick={() => setShowManager(true)}
              title="Merge / rename concepts and angles"
              className="text-gray-500 hover:text-white p-1.5 rounded hover:bg-gray-800 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      {totalAds === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs text-gray-500">No ads yet — upload some to see the audience map populate.</p>
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto">
          {tamEntries.map(([tamK, persMap]) => {
            const tamId = `tam::${tamK}`
            const tamAds = flattenAds(persMap)
            const tamLabel = tree.tamDisplay.get(tamK) ?? '(no TAM)'
            return (
              <NodeRow key={tamId} id={tamId} expanded={expanded} toggle={toggle} level={0} label={tamLabel} ads={tamAds}>
                {rankBranches(Array.from(persMap.entries()), (microMap) => flattenAds(microMap)).map(([persK, microMap]) => {
                  const persId = `persona::${tamK}::${persK}`
                  const persAds = flattenAds(microMap)
                  const persLabel = tree.personaDisplay.get(persK) ?? '(no persona)'
                  return (
                    <NodeRow key={persId} id={persId} expanded={expanded} toggle={toggle} level={1} label={persLabel} ads={persAds}>
                      {rankBranches(Array.from(microMap.entries()), (conceptMap) => flattenAds(conceptMap)).map(([microK, conceptMap]) => {
                        const microId = `micro::${tamK}::${persK}::${microK}`
                        const microAds = flattenAds(conceptMap)
                        const microLabel = tree.microDisplay.get(microK) ?? '(unspecified)'
                        return (
                          <NodeRow key={microId} id={microId} expanded={expanded} toggle={toggle} level={2} label={microLabel} ads={microAds}>
                            {rankBranches(Array.from(conceptMap.entries()), (angleMap) => flattenAds(angleMap)).map(([conceptK, angleMap]) => {
                              const conceptId = `concept::${tamK}::${persK}::${microK}::${conceptK}`
                              const conceptAds = flattenAds(angleMap)
                              const conceptLabel = tree.conceptDisplay.get(conceptK) ?? '(no concept)'
                              return (
                                <NodeRow key={conceptId} id={conceptId} expanded={expanded} toggle={toggle} level={3} label={conceptLabel} ads={conceptAds}>
                                  {rankBranches(Array.from(angleMap.entries()), (adList) => adList).map(([angleK, adList]) => {
                                    const angleId = `angle::${tamK}::${persK}::${microK}::${conceptK}::${angleK}`
                                    const angleLabel = tree.angleDisplay.get(angleK) ?? '(no angle)'
                                    const sorted = sortAdsByQuadrant(adList)
                                    return (
                                      <NodeRow key={angleId} id={angleId} expanded={expanded} toggle={toggle} level={4} label={angleLabel} ads={adList}>
                                        {sorted.map(ad => (
                                          <AdRow
                                            key={ad.analysisId}
                                            ad={ad}
                                            onOpenAd={onOpenAd}
                                            current={currentReanalyzeId === ad.analysisId}
                                          />
                                        ))}
                                      </NodeRow>
                                    )
                                  })}
                                </NodeRow>
                              )
                            })}
                          </NodeRow>
                        )
                      })}
                    </NodeRow>
                  )
                })}
              </NodeRow>
            )
          })}
        </div>
      )}

      {/* Footer summary */}
      <div className="px-5 py-2.5 border-t border-gray-800 bg-gray-950/40 flex items-center justify-between text-[10px] text-gray-500 font-mono">
        <span>{tamEntries.length} {tamEntries.length === 1 ? 'TAM' : 'TAMs'} · {totalAds} {totalAds === 1 ? 'ad' : 'ads'}</span>
        <span className="text-gray-600">Ranked by winner density at every level</span>
      </div>

      {showManager && productId && token && (
        <ConceptAngleManager
          productId={productId}
          token={token}
          onClose={() => setShowManager(false)}
          onChanged={() => { /* parent dashboard refetches on close */ }}
        />
      )}
    </div>
  )
}
