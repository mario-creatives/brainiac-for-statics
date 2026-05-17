'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'

interface Props {
  productName: string
  ads: ProductAdRow[]
}

interface AdLeafSlot {
  analysisId: string
  headline: string | null
  quadrant: string | null
  heatmapUrl: string | null
  confidence: number | null
}

// 5-level tree: TAM → Persona → Micro-persona → Concept → Angle → Ads.
// Grouping at every level uses DB-resolved labels (where available) or the
// normalised raw inference string, so duplicates collapse instead of showing
// one node per ad.
type AngleMap   = Map<string, AdLeafSlot[]>
type ConceptMap = Map<string, AngleMap>
type MicroMap   = Map<string, ConceptMap>
type PersonaMap = Map<string, MicroMap>
type TamMap     = Map<string, PersonaMap>

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function bestLabel(s: string | null | undefined, fallback: string): string {
  return s?.trim() || fallback
}

function dominantQuadrant(ads: AdLeafSlot[]): string | null {
  for (const q of ['winner', 'promising', 'investigate', 'loser']) {
    if (ads.some(a => a.quadrant === q)) return q
  }
  return null
}

function quadrantColor(q: string | null) {
  if (q === 'winner')      return 'text-yellow-400'
  if (q === 'promising')   return 'text-indigo-400'
  if (q === 'investigate') return 'text-amber-400'
  if (q === 'loser')       return 'text-[#ff2a2b]'
  return 'text-gray-600'
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

export function AudienceProfileMap({ productName, ads }: Props) {
  const tamTree: TamMap = new Map()

  // Display label maps (preserve original casing from first occurrence per key)
  const tamDisplay     = new Map<string, string>()
  const personaDisplay = new Map<string, string>()
  const microDisplay   = new Map<string, string>()
  const conceptDisplay = new Map<string, string>()
  const angleDisplay   = new Map<string, string>()

  for (const ad of ads) {
    const inf = ad.audience_inference

    const tamK     = norm(ad.tam_label)            || 'no_tam'
    const persK    = norm(ad.persona_label)        || 'no_persona'
    const microK   = norm(ad.micro_persona_label)  || 'unspecified'
    const conceptRaw = ad.stated_concept ?? inf?.inferred_concept ?? null
    const angleRaw   = ad.stated_angle   ?? inf?.inferred_angle   ?? null
    const conceptK = norm(conceptRaw) || 'no_concept'
    const angleK   = norm(angleRaw)   || 'no_angle'

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
      confidence: inf?.confidence ?? null,
    })
  }

  const [openTams,     setOpenTams]     = useState<Set<string>>(new Set(tamTree.keys()))
  const [openPersonas, setOpenPersonas] = useState<Set<string>>(new Set())
  const [openMicros,   setOpenMicros]   = useState<Set<string>>(new Set())
  const [openConcepts, setOpenConcepts] = useState<Set<string>>(new Set())
  const [openAngles,   setOpenAngles]   = useState<Set<string>>(new Set())

  function toggle(setFn: (updater: (prev: Set<string>) => Set<string>) => void, k: string) {
    setFn(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  const totalAds      = ads.length
  const withHierarchy = ads.filter(a => a.tam_label).length
  const pendingCount  = totalAds - withHierarchy

  if (totalAds === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-xs font-semibold text-white mb-1">Audience profile map</h3>
        <p className="text-[10px] text-gray-600 py-6 text-center">
          No ads have been analysed yet. Upload and analyse ads to build the audience map.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-white">Audience profile map</h3>
        <p className="text-[10px] text-gray-500 mt-0.5">
          {withHierarchy} of {totalAds} ad{totalAds !== 1 ? 's' : ''} mapped.
          {pendingCount > 0 && <span className="text-amber-500"> {pendingCount} need re-analysis to be placed.</span>}
          {' '}TAM → persona → micro-persona → concept → angle.
        </p>
      </div>

      <div className="relative pl-4 border-l border-gray-800">
        {/* Product root */}
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
          <span className="text-xs font-semibold text-indigo-300">{productName}</span>
        </div>

        {Array.from(tamTree.entries()).map(([tamK, persMap]) => {
          const tamLabel  = tamDisplay.get(tamK) ?? tamK
          const isTamOpen = openTams.has(tamK)
          const tamAds    = flattenAds(persMap)
          const tamQ      = dominantQuadrant(tamAds)
          const isPlaceholder = tamK === 'no_tam'

          return (
            <div key={tamK} className="relative pl-4 border-l border-gray-800 mb-2">
              <RowBtn
                open={isTamOpen}
                onToggle={() => toggle(setOpenTams, tamK)}
                label={tamLabel}
                count={tamAds.length}
                dotColor={isPlaceholder ? 'bg-gray-600' : 'bg-sky-500'}
                textColor={isPlaceholder ? 'text-gray-600 italic' : 'text-sky-300'}
                quadrant={tamQ}
              />

              {isTamOpen && Array.from(persMap.entries()).map(([persK, microMap]) => {
                const persLabel  = personaDisplay.get(persK) ?? persK
                const compPers   = `${tamK}::${persK}`
                const isPersOpen = openPersonas.has(compPers)
                const persAds    = flattenAds(microMap)
                const persQ      = dominantQuadrant(persAds)
                const isPlaceholderPers = persK === 'no_persona'

                return (
                  <div key={persK} className="relative pl-4 border-l border-gray-800 mb-1">
                    <RowBtn
                      open={isPersOpen}
                      onToggle={() => toggle(setOpenPersonas, compPers)}
                      label={persLabel}
                      count={persAds.length}
                      dotColor={isPlaceholderPers ? 'bg-gray-600' : 'bg-purple-500'}
                      textColor={isPlaceholderPers ? 'text-gray-600 italic' : 'text-purple-300'}
                      quadrant={persQ}
                    />

                    {isPersOpen && Array.from(microMap.entries()).map(([microK, conceptMap]) => {
                      const microLabel  = microDisplay.get(microK) ?? microK
                      const compMicro   = `${tamK}::${persK}::${microK}`
                      const isMicroOpen = openMicros.has(compMicro)
                      const microAds    = flattenAds(conceptMap)
                      const microQ      = dominantQuadrant(microAds)
                      const isPlaceholderMicro = microK === 'unspecified'

                      return (
                        <div key={microK} className="relative pl-4 border-l border-gray-800/60 ml-2 mb-1">
                          <RowBtn
                            open={isMicroOpen}
                            onToggle={() => toggle(setOpenMicros, compMicro)}
                            label={microLabel}
                            count={microAds.length}
                            dotColor={isPlaceholderMicro ? 'bg-gray-600' : 'bg-emerald-600'}
                            textColor={isPlaceholderMicro ? 'text-gray-600 italic' : 'text-emerald-400'}
                            quadrant={microQ}
                            size="sm"
                          />

                          {isMicroOpen && Array.from(conceptMap.entries()).map(([conceptK, angleMap]) => {
                            const conceptLabel  = conceptDisplay.get(conceptK) ?? conceptK
                            const compConcept   = `${compMicro}::${conceptK}`
                            const isConceptOpen = openConcepts.has(compConcept)
                            const conceptAds    = flattenAds(angleMap)
                            const conceptQ      = dominantQuadrant(conceptAds)
                            const isPlaceholderConcept = conceptK === 'no_concept'

                            return (
                              <div key={conceptK} className="relative pl-4 border-l border-gray-700/40 ml-2 mb-0.5">
                                <RowBtn
                                  open={isConceptOpen}
                                  onToggle={() => toggle(setOpenConcepts, compConcept)}
                                  label={conceptLabel}
                                  count={conceptAds.length}
                                  dotColor={isPlaceholderConcept ? 'bg-gray-700' : 'bg-yellow-600'}
                                  textColor={isPlaceholderConcept ? 'text-gray-700 italic' : 'text-yellow-300'}
                                  quadrant={conceptQ}
                                  size="xs"
                                  prefix="concept"
                                />

                                {isConceptOpen && Array.from(angleMap.entries()).map(([angleK, adSlots]) => {
                                  const angleLabel  = angleDisplay.get(angleK) ?? angleK
                                  const compAngle   = `${compConcept}::${angleK}`
                                  const isAngleOpen = openAngles.has(compAngle)
                                  const angleQ      = dominantQuadrant(adSlots)
                                  const isPlaceholderAngle = angleK === 'no_angle'

                                  return (
                                    <div key={angleK} className="relative pl-4 border-l border-gray-700/30 ml-2 mb-0.5">
                                      <RowBtn
                                        open={isAngleOpen}
                                        onToggle={() => toggle(setOpenAngles, compAngle)}
                                        label={angleLabel}
                                        count={adSlots.length}
                                        dotColor={isPlaceholderAngle ? 'bg-gray-700' : 'bg-rose-700'}
                                        textColor={isPlaceholderAngle ? 'text-gray-700 italic' : 'text-rose-300'}
                                        quadrant={angleQ}
                                        size="xs"
                                        prefix="angle"
                                      />

                                      {isAngleOpen && (
                                        <div className="pl-4 ml-2 space-y-1 py-0.5">
                                          {adSlots.map(slot => (
                                            <AdChip key={slot.analysisId} slot={slot} />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface RowBtnProps {
  open: boolean
  onToggle: () => void
  label: string
  count: number
  dotColor: string
  textColor: string
  quadrant: string | null
  size?: 'base' | 'sm' | 'xs'
  prefix?: string
}

function RowBtn({ open, onToggle, label, count, dotColor, textColor, quadrant, size = 'base', prefix }: RowBtnProps) {
  const textSize = size === 'xs' ? 'text-[9px]' : size === 'sm' ? 'text-[10px]' : 'text-[11px]'
  const dotSize  = size === 'xs' ? 'w-1 h-1'    : 'w-1.5 h-1.5'
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full text-left py-0.5 group"
    >
      <span className={`${dotSize} rounded-full shrink-0 ${dotColor}`} />
      {open
        ? <ChevronDown className="w-3 h-3 text-gray-600 shrink-0" />
        : <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
      {prefix && <span className={`${textSize} text-gray-600 shrink-0 font-mono uppercase tracking-wider`}>{prefix}</span>}
      <span className={`${textSize} font-medium group-hover:opacity-80 transition-opacity truncate ${textColor}`}>{label}</span>
      {quadrant && (
        <span className={`text-[8px] font-mono font-bold uppercase shrink-0 ${quadrantColor(quadrant)}`}>{quadrant}</span>
      )}
      <span className="text-[9px] text-gray-700 ml-auto shrink-0">{count}</span>
    </button>
  )
}

function AdChip({ slot }: { slot: AdLeafSlot }) {
  return (
    <div className="flex items-center gap-2 bg-gray-950/60 border border-gray-800/40 rounded px-2 py-1">
      {slot.heatmapUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.heatmapUrl} alt="" className="w-6 h-6 object-cover rounded shrink-0 border border-gray-800" />
      )}
      <p className="text-[9px] text-gray-400 truncate flex-1">{slot.headline ?? 'Untitled ad'}</p>
      {slot.quadrant && (
        <span className={`text-[8px] font-mono font-bold uppercase shrink-0 ${quadrantColor(slot.quadrant)}`}>{slot.quadrant}</span>
      )}
      {slot.confidence != null && (
        <span className="text-[8px] text-gray-600 shrink-0">{slot.confidence}/10</span>
      )}
    </div>
  )
}
