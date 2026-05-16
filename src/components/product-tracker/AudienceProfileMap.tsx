'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'

interface Props {
  productName: string
  ads: ProductAdRow[]
}

interface AdSlot {
  analysisId: string
  headline: string | null
  concept: string
  angle: string
  confidence: number
  quadrant: string | null
  heatmapUrl: string | null
}

interface MicroGroup {
  label: string
  ads: AdSlot[]
  expanded: boolean
}

interface PersonaGroup {
  label: string
  micros: Map<string, MicroGroup>
  expanded: boolean
}

function normalise(s: string): string {
  return s.trim().toLowerCase()
}

export function AudienceProfileMap({ productName, ads }: Props) {
  // Build persona → micro-persona → ads tree from audience_inference
  const analysed = ads.filter(a => a.audience_inference != null)

  const rawTree = new Map<string, Map<string, AdSlot[]>>()
  for (const ad of analysed) {
    const inf = ad.audience_inference!
    const personaKey = normalise(inf.inferred_persona) || 'Unknown persona'
    const microKey = normalise(inf.inferred_micro_persona) || 'Unspecified'
    if (!rawTree.has(personaKey)) rawTree.set(personaKey, new Map())
    const microMap = rawTree.get(personaKey)!
    if (!microMap.has(microKey)) microMap.set(microKey, [])
    microMap.get(microKey)!.push({
      analysisId: ad.analysis_id,
      headline: ad.headline_text,
      concept: inf.inferred_concept,
      angle: inf.inferred_angle,
      confidence: inf.confidence,
      quadrant: ad.effective_quadrant,
      heatmapUrl: ad.heatmap_url,
    })
  }

  // Use display labels from the first ad in each group (preserve original casing)
  const personaDisplayLabels = new Map<string, string>()
  const microDisplayLabels = new Map<string, Map<string, string>>()
  for (const ad of analysed) {
    const inf = ad.audience_inference!
    const pk = normalise(inf.inferred_persona) || 'Unknown persona'
    if (!personaDisplayLabels.has(pk)) personaDisplayLabels.set(pk, inf.inferred_persona.trim() || 'Unknown persona')
    if (!microDisplayLabels.has(pk)) microDisplayLabels.set(pk, new Map())
    const mk = normalise(inf.inferred_micro_persona) || 'Unspecified'
    if (!microDisplayLabels.get(pk)!.has(mk)) microDisplayLabels.get(pk)!.set(mk, inf.inferred_micro_persona.trim() || 'Unspecified')
  }

  const [expandedPersonas, setExpandedPersonas] = useState<Set<string>>(new Set(rawTree.keys()))
  const [expandedMicros, setExpandedMicros] = useState<Set<string>>(new Set())

  function togglePersona(key: string) {
    setExpandedPersonas(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleMicro(key: string) {
    setExpandedMicros(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (analysed.length === 0) {
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
          Built by Claude from {analysed.length} analysed ad{analysed.length !== 1 ? 's' : ''}. Grouped by inferred persona → micro-persona.
        </p>
      </div>

      {/* Root: product */}
      <div className="relative pl-4 border-l border-gray-800">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
          <span className="text-xs font-semibold text-indigo-300">{productName}</span>
        </div>

        {Array.from(rawTree.entries()).map(([personaKey, microMap]) => {
          const personaLabel = personaDisplayLabels.get(personaKey) ?? personaKey
          const isPersonaOpen = expandedPersonas.has(personaKey)
          const totalAds = Array.from(microMap.values()).reduce((s, arr) => s + arr.length, 0)

          return (
            <div key={personaKey} className="relative pl-4 border-l border-gray-800 mb-2">
              {/* Persona row */}
              <button
                onClick={() => togglePersona(personaKey)}
                className="flex items-center gap-2 w-full text-left py-1 group"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                {isPersonaOpen
                  ? <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />}
                <span className="text-[11px] font-semibold text-purple-300 group-hover:text-purple-200 transition-colors">{personaLabel}</span>
                <span className="text-[9px] text-gray-600 ml-auto">{totalAds} ad{totalAds !== 1 ? 's' : ''}</span>
              </button>

              {isPersonaOpen && Array.from(microMap.entries()).map(([microKey, adSlots]) => {
                const microLabel = microDisplayLabels.get(personaKey)?.get(microKey) ?? microKey
                const compositeKey = `${personaKey}::${microKey}`
                const isMicroOpen = expandedMicros.has(compositeKey)

                return (
                  <div key={microKey} className="relative pl-4 border-l border-gray-800/60 ml-2 mb-1">
                    {/* Micro-persona row */}
                    <button
                      onClick={() => toggleMicro(compositeKey)}
                      className="flex items-center gap-2 w-full text-left py-0.5 group"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                      {isMicroOpen
                        ? <ChevronDown className="w-3 h-3 text-gray-600 shrink-0" />
                        : <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                      <span className="text-[10px] font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">{microLabel}</span>
                      <span className="text-[9px] text-gray-600 ml-auto">{adSlots.length} ad{adSlots.length !== 1 ? 's' : ''}</span>
                    </button>

                    {isMicroOpen && (
                      <div className="pl-4 ml-2 space-y-1.5 py-1">
                        {adSlots.map(slot => (
                          <AdLeaf key={slot.analysisId} slot={slot} />
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
    </div>
  )
}

function quadrantColor(q: string | null) {
  if (q === 'winner') return 'text-yellow-400'
  if (q === 'promising') return 'text-indigo-400'
  if (q === 'investigate') return 'text-amber-400'
  if (q === 'loser') return 'text-[#ff2a2b]'
  return 'text-gray-600'
}

function AdLeaf({ slot }: { slot: AdSlot }) {
  return (
    <div className="flex items-start gap-2 bg-gray-950/60 border border-gray-800/60 rounded-lg px-2.5 py-2">
      {slot.heatmapUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.heatmapUrl} alt="" className="w-8 h-8 object-cover rounded shrink-0 border border-gray-800" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[10px] text-gray-200 leading-snug truncate">{slot.headline ?? 'Untitled ad'}</p>
        <p className="text-[9px] text-gray-500 leading-snug truncate"><span className="text-gray-600">concept</span> {slot.concept}</p>
        <p className="text-[9px] text-gray-500 leading-snug truncate"><span className="text-gray-600">angle</span> {slot.angle}</p>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        {slot.quadrant && (
          <span className={`text-[8px] font-mono font-bold uppercase ${quadrantColor(slot.quadrant)}`}>{slot.quadrant}</span>
        )}
        <span className="text-[8px] text-gray-600">{slot.confidence}/10</span>
      </div>
    </div>
  )
}
