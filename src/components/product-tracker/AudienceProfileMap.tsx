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
  concept: string | null
  angle: string | null
  confidence: number | null
  quadrant: string | null
  heatmapUrl: string | null
}

// Group by DB-resolved labels (tam_label → persona_label → micro_persona_label).
// Since autoPopulateFromInference uses ilike find-or-create, the same logical
// entity always resolves to the same DB row — grouping by resolved labels
// naturally deduplicates across all ads.
export function AudienceProfileMap({ productName, ads }: Props) {
  const tree = new Map<string, Map<string, Map<string, AdSlot[]>>>()

  for (const ad of ads) {
    const tamKey   = ad.tam_label   ?? '(no TAM yet)'
    const persKey  = ad.persona_label ?? '(no persona yet)'
    const microKey = ad.micro_persona_label ?? '(unspecified)'

    if (!tree.has(tamKey)) tree.set(tamKey, new Map())
    const persMap = tree.get(tamKey)!
    if (!persMap.has(persKey)) persMap.set(persKey, new Map())
    const microMap = persMap.get(persKey)!
    if (!microMap.has(microKey)) microMap.set(microKey, [])

    const inf = ad.audience_inference
    microMap.get(microKey)!.push({
      analysisId: ad.analysis_id,
      headline: ad.headline_text,
      concept: ad.stated_concept ?? inf?.inferred_concept ?? null,
      angle: ad.stated_angle ?? inf?.inferred_angle ?? null,
      confidence: inf?.confidence ?? null,
      quadrant: ad.effective_quadrant,
      heatmapUrl: ad.heatmap_url,
    })
  }

  const [expandedTams, setExpandedTams]         = useState<Set<string>>(new Set(tree.keys()))
  const [expandedPersonas, setExpandedPersonas] = useState<Set<string>>(new Set())
  const [expandedMicros, setExpandedMicros]     = useState<Set<string>>(new Set())

  function toggleTam(k: string) {
    setExpandedTams(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }
  function togglePersona(k: string) {
    setExpandedPersonas(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }
  function toggleMicro(k: string) {
    setExpandedMicros(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  const totalAds    = ads.length
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
          {' '}Grouped by TAM → persona → micro-persona.
        </p>
      </div>

      {/* Root: product */}
      <div className="relative pl-4 border-l border-gray-800">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
          <span className="text-xs font-semibold text-indigo-300">{productName}</span>
        </div>

        {Array.from(tree.entries()).map(([tamKey, persMap]) => {
          const isTamOpen = expandedTams.has(tamKey)
          const tamTotal  = Array.from(persMap.values()).reduce(
            (s, mm) => s + Array.from(mm.values()).reduce((a, arr) => a + arr.length, 0), 0
          )
          const isPlaceholderTam = tamKey === '(no TAM yet)'

          return (
            <div key={tamKey} className="relative pl-4 border-l border-gray-800 mb-2">
              <button
                onClick={() => toggleTam(tamKey)}
                className="flex items-center gap-2 w-full text-left py-1 group"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlaceholderTam ? 'bg-gray-600' : 'bg-sky-500'}`} />
                {isTamOpen
                  ? <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />}
                <span className={`text-[11px] font-semibold group-hover:opacity-80 transition-opacity ${isPlaceholderTam ? 'text-gray-600 italic' : 'text-sky-300'}`}>{tamKey}</span>
                <span className="text-[9px] text-gray-600 ml-auto">{tamTotal} ad{tamTotal !== 1 ? 's' : ''}</span>
              </button>

              {isTamOpen && Array.from(persMap.entries()).map(([persKey, microMap]) => {
                const compositePersona = `${tamKey}::${persKey}`
                const isPersonaOpen = expandedPersonas.has(compositePersona)
                const persTotal = Array.from(microMap.values()).reduce((s, arr) => s + arr.length, 0)
                const isPlaceholderPers = persKey === '(no persona yet)'

                return (
                  <div key={persKey} className="relative pl-4 border-l border-gray-800 mb-1">
                    <button
                      onClick={() => togglePersona(compositePersona)}
                      className="flex items-center gap-2 w-full text-left py-0.5 group"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlaceholderPers ? 'bg-gray-600' : 'bg-purple-500'}`} />
                      {isPersonaOpen
                        ? <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
                        : <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />}
                      <span className={`text-[11px] font-semibold group-hover:opacity-80 transition-opacity ${isPlaceholderPers ? 'text-gray-600 italic' : 'text-purple-300'}`}>{persKey}</span>
                      <span className="text-[9px] text-gray-600 ml-auto">{persTotal} ad{persTotal !== 1 ? 's' : ''}</span>
                    </button>

                    {isPersonaOpen && Array.from(microMap.entries()).map(([microKey, adSlots]) => {
                      const compositeMicro = `${tamKey}::${persKey}::${microKey}`
                      const isMicroOpen = expandedMicros.has(compositeMicro)
                      const isPlaceholderMicro = microKey === '(unspecified)'

                      return (
                        <div key={microKey} className="relative pl-4 border-l border-gray-800/60 ml-2 mb-1">
                          <button
                            onClick={() => toggleMicro(compositeMicro)}
                            className="flex items-center gap-2 w-full text-left py-0.5 group"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlaceholderMicro ? 'bg-gray-600' : 'bg-emerald-600'}`} />
                            {isMicroOpen
                              ? <ChevronDown className="w-3 h-3 text-gray-600 shrink-0" />
                              : <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                            <span className={`text-[10px] font-medium group-hover:opacity-80 transition-opacity ${isPlaceholderMicro ? 'text-gray-600 italic' : 'text-emerald-400'}`}>{microKey}</span>
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
          )
        })}
      </div>
    </div>
  )
}

function quadrantColor(q: string | null) {
  if (q === 'winner')      return 'text-yellow-400'
  if (q === 'promising')   return 'text-indigo-400'
  if (q === 'investigate') return 'text-amber-400'
  if (q === 'loser')       return 'text-[#ff2a2b]'
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
        {slot.concept && (
          <p className="text-[9px] text-gray-500 leading-snug truncate"><span className="text-gray-600">concept</span> {slot.concept}</p>
        )}
        {slot.angle && (
          <p className="text-[9px] text-gray-500 leading-snug truncate"><span className="text-gray-600">angle</span> {slot.angle}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        {slot.quadrant && (
          <span className={`text-[8px] font-mono font-bold uppercase ${quadrantColor(slot.quadrant)}`}>{slot.quadrant}</span>
        )}
        {slot.confidence != null && (
          <span className="text-[8px] text-gray-600">{slot.confidence}/10</span>
        )}
      </div>
    </div>
  )
}
