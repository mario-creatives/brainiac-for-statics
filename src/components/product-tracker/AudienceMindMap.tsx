'use client'

import { useCallback, useEffect, useState } from 'react'
import ReactFlow, {
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { Settings2, X } from 'lucide-react'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'
import { ConceptAngleManager } from './ConceptAngleManager'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  productName: string
  ads: ProductAdRow[]
  productId?: string
  token?: string
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

// Per-node metadata stored in node.data
interface NodeData {
  label: string
  adCount: number
  quadrant: string | null
  nodeType: 'root' | 'tam' | 'persona' | 'micro' | 'concept' | 'angle'
  // For angle nodes — the leaf ads + breadcrumb
  adSlots?: AdLeafSlot[]
  breadcrumb?: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function bestLabel(s: string | null | undefined, fallback: string): string {
  return s?.trim() || fallback
}

const QUADRANT_RANK: Record<string, number> = { winner: 0, promising: 1, investigate: 2, loser: 3 }

function dominantQuadrant(ads: AdLeafSlot[]): string | null {
  for (const q of ['winner', 'promising', 'investigate', 'loser']) {
    if (ads.some(a => a.quadrant === q)) return q
  }
  return null
}

function sortByQuadrantPriority(ads: AdLeafSlot[]): AdLeafSlot[] {
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

function quadrantBg(q: string | null) {
  if (q === 'winner')      return 'bg-yellow-900/60 text-yellow-300'
  if (q === 'promising')   return 'bg-indigo-900/60 text-indigo-300'
  if (q === 'investigate') return 'bg-amber-900/60 text-amber-300'
  if (q === 'loser')       return 'bg-red-900/60 text-[#ff2a2b]'
  return ''
}

// ─── Dagre layout ─────────────────────────────────────────────────────────────

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 60 })
  nodes.forEach(n => g.setNode(n.id, { width: 180, height: 60 }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id)
      return { ...n, position: { x: pos.x - 90, y: pos.y - 30 } }
    }),
    edges,
  }
}

// ─── Node colors by type ──────────────────────────────────────────────────────

const NODE_STYLE: Record<NodeData['nodeType'], { bg: string; border: string; text: string; pill: string }> = {
  root:    { bg: 'bg-indigo-950', border: 'border-indigo-800', text: 'text-indigo-300', pill: 'bg-indigo-500' },
  tam:     { bg: 'bg-sky-950',    border: 'border-sky-800',    text: 'text-sky-300',    pill: 'bg-sky-500' },
  persona: { bg: 'bg-purple-950', border: 'border-purple-800', text: 'text-purple-300', pill: 'bg-purple-500' },
  micro:   { bg: 'bg-emerald-950',border: 'border-emerald-800',text: 'text-emerald-300',pill: 'bg-emerald-500' },
  concept: { bg: 'bg-yellow-950', border: 'border-yellow-800', text: 'text-yellow-300', pill: 'bg-yellow-500' },
  angle:   { bg: 'bg-rose-950',   border: 'border-rose-800',   text: 'text-rose-300',   pill: 'bg-rose-500' },
}

// ─── Custom React Flow node ───────────────────────────────────────────────────

function MindNode({ data }: { data: NodeData }) {
  const s = NODE_STYLE[data.nodeType]
  return (
    <div
      className={`flex items-center gap-0 border ${s.border} rounded-xl overflow-hidden cursor-pointer select-none`}
      style={{ width: 180 }}
    >
      {/* Left color pill */}
      <div className={`w-1 self-stretch shrink-0 ${s.pill}`} />
      {/* Content */}
      <div className={`flex-1 flex items-center justify-between px-2 py-1.5 gap-1 ${s.bg}`}>
        <span className={`text-xs font-medium truncate ${s.text}`} style={{ maxWidth: 110 }}>
          {data.label}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {data.quadrant && (
            <span className={`font-mono text-[8px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded ${quadrantBg(data.quadrant)}`}>
              {data.quadrant}
            </span>
          )}
          <span className="text-[9px] text-gray-600 font-mono">{data.adCount}</span>
        </div>
      </div>
    </div>
  )
}

const nodeTypes = { mindNode: MindNode }

// ─── Detail modal ─────────────────────────────────────────────────────────────

interface ModalProps {
  breadcrumb: string[]
  adSlots: AdLeafSlot[]
  onClose: () => void
}

function MindNodeDetailModal({ breadcrumb, adSlots, onClose }: ModalProps) {
  const sorted = sortByQuadrantPriority(adSlots)
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass bg-gray-950 border border-gray-700 rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-500 truncate">
              {breadcrumb.join(' ▸ ')}
            </p>
            <h3 className="text-sm font-semibold text-white mt-0.5 truncate">
              {breadcrumb[breadcrumb.length - 1]}
            </h3>
          </div>
          <button onClick={onClose} className="ml-3 text-gray-500 hover:text-gray-300 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Ad grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {sorted.length === 0 ? (
            <p className="text-[10px] text-gray-600 text-center py-6">No ads.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {sorted.map(slot => (
                <div
                  key={slot.analysisId}
                  className={`flex items-center gap-3 bg-gray-900 border rounded-xl px-3 py-2 ${
                    slot.quadrant === 'winner' ? 'border-yellow-400/40' : 'border-gray-800'
                  }`}
                >
                  {slot.heatmapUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={slot.heatmapUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="w-12 h-12 object-cover rounded-lg border border-gray-800 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg border border-gray-800 bg-gray-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">
                      {slot.headline ?? 'Untitled ad'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {slot.spendUsd != null && (
                        <span className="font-mono text-[9px] text-gray-600">
                          ${slot.spendUsd.toLocaleString()} spend
                        </span>
                      )}
                      {slot.cpaUsd != null && (
                        <span className="font-mono text-[9px] text-gray-600">
                          ${slot.cpaUsd.toFixed(2)} CPA
                        </span>
                      )}
                    </div>
                  </div>
                  {slot.quadrant && (
                    <span className={`font-mono text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${quadrantBg(slot.quadrant)}`}>
                      {slot.quadrant}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AudienceMindMap({ productName, ads, productId, token }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  // Set of parent node IDs whose children are currently visible
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['root']))
  const [modalData, setModalData] = useState<ModalProps | null>(null)
  const [showManager, setShowManager] = useState(false)

  // ── Build tree from ads ──────────────────────────────────────────────────
  const tamTree: TamMap = new Map()
  const tamDisplay     = new Map<string, string>()
  const personaDisplay = new Map<string, string>()
  const microDisplay   = new Map<string, string>()
  const conceptDisplay = new Map<string, string>()
  const angleDisplay   = new Map<string, string>()

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

  // ── Rebuild visible nodes/edges on every expand change ───────────────────
  const buildGraph = useCallback(() => {
    const newNodes: Node[] = []
    const newEdges: Edge[] = []

    const addNode = (id: string, data: NodeData) => {
      newNodes.push({
        id,
        type: 'mindNode',
        data,
        position: { x: 0, y: 0 },
      })
    }

    const addEdge = (source: string, target: string) => {
      newEdges.push({
        id: `${source}->${target}`,
        source,
        target,
        style: { stroke: '#374151', strokeWidth: 1 },
      })
    }

    // Root
    addNode('root', {
      label: productName,
      adCount: ads.length,
      quadrant: null,
      nodeType: 'root',
    })

    for (const [tamK, persMap] of tamTree.entries()) {
      const tamId = `tam::${tamK}`
      const tamLabel = tamDisplay.get(tamK) ?? tamK
      const tamAds = flattenAds(persMap)
      addNode(tamId, {
        label: tamLabel,
        adCount: tamAds.length,
        quadrant: dominantQuadrant(tamAds),
        nodeType: 'tam',
      })
      addEdge('root', tamId)

      if (!expanded.has(tamId)) continue

      for (const [persK, microMap] of persMap.entries()) {
        const persId = `persona::${tamK}::${persK}`
        const persLabel = personaDisplay.get(persK) ?? persK
        const persAds = flattenAds(microMap)
        addNode(persId, {
          label: persLabel,
          adCount: persAds.length,
          quadrant: dominantQuadrant(persAds),
          nodeType: 'persona',
        })
        addEdge(tamId, persId)

        if (!expanded.has(persId)) continue

        for (const [microK, conceptMap] of microMap.entries()) {
          const microId = `micro::${tamK}::${persK}::${microK}`
          const microLabel = microDisplay.get(microK) ?? microK
          const microAds = flattenAds(conceptMap)
          addNode(microId, {
            label: microLabel,
            adCount: microAds.length,
            quadrant: dominantQuadrant(microAds),
            nodeType: 'micro',
          })
          addEdge(persId, microId)

          if (!expanded.has(microId)) continue

          for (const [conceptK, angleMap] of conceptMap.entries()) {
            const conceptId = `concept::${tamK}::${persK}::${microK}::${conceptK}`
            const conceptLabel = conceptDisplay.get(conceptK) ?? conceptK
            const conceptAds = flattenAds(angleMap)
            addNode(conceptId, {
              label: conceptLabel,
              adCount: conceptAds.length,
              quadrant: dominantQuadrant(conceptAds),
              nodeType: 'concept',
            })
            addEdge(microId, conceptId)

            if (!expanded.has(conceptId)) continue

            for (const [angleK, adSlots] of angleMap.entries()) {
              const angleId = `angle::${tamK}::${persK}::${microK}::${conceptK}::${angleK}`
              const angleLabel = angleDisplay.get(angleK) ?? angleK
              addNode(angleId, {
                label: angleLabel,
                adCount: adSlots.length,
                quadrant: dominantQuadrant(adSlots),
                nodeType: 'angle',
                adSlots,
                breadcrumb: [
                  tamDisplay.get(tamK)    ?? tamK,
                  personaDisplay.get(persK)  ?? persK,
                  microDisplay.get(microK)   ?? microK,
                  conceptDisplay.get(conceptK) ?? conceptK,
                  angleLabel,
                ],
              })
              addEdge(conceptId, angleId)
            }
          }
        }
      }
    }

    const laid = layoutGraph(newNodes, newEdges)
    setNodes(laid.nodes)
    setEdges(laid.edges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, ads, productName])

  useEffect(() => {
    buildGraph()
  }, [buildGraph])

  // ── Node click handler ──────────────────────────────────────────────────
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const data = node.data as NodeData
    if (data.nodeType === 'angle') {
      setModalData({
        breadcrumb: data.breadcrumb ?? [data.label],
        adSlots: data.adSlots ?? [],
        onClose: () => setModalData(null),
      })
      return
    }
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(node.id) ? n.delete(node.id) : n.add(node.id)
      return n
    })
  }, [])

  const totalAds      = ads.length
  const withHierarchy = ads.filter(a => a.tam_label).length

  if (totalAds === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-xs font-semibold text-white mb-1">Audience mind map</h3>
        <p className="text-[10px] text-gray-600 py-6 text-center">
          No ads have been analysed yet. Upload and analyse ads to build the audience map.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div>
            <h3 className="text-xs font-semibold text-white">Audience mind map</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {withHierarchy} of {totalAds} ads mapped. Click nodes to expand.
            </p>
          </div>
          {productId && token && (
            <button
              onClick={() => setShowManager(true)}
              className="text-xs px-3 py-1.5 rounded-lg border bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300 flex items-center gap-1.5"
            >
              <Settings2 className="w-3 h-3" />
              Manage concepts &amp; angles
            </button>
          )}
        </div>

        {/* React Flow canvas */}
        <div className="h-[600px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            attributionPosition="bottom-right"
          >
            <Controls />
            <MiniMap
              nodeColor={n => {
                const t = (n.data as NodeData).nodeType
                return t === 'root'    ? '#312e81' :
                       t === 'tam'     ? '#0c4a6e' :
                       t === 'persona' ? '#3b0764' :
                       t === 'micro'   ? '#064e3b' :
                       t === 'concept' ? '#713f12' :
                                         '#4c0519'
              }}
              style={{ background: '#111827' }}
            />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#1f2937" />
          </ReactFlow>
        </div>
      </div>

      {/* Detail modal */}
      {modalData && <MindNodeDetailModal {...modalData} />}

      {/* Concept/angle manager modal */}
      {showManager && productId && token && (
        <ConceptAngleManager
          productId={productId}
          token={token}
          onClose={() => setShowManager(false)}
          onChanged={() => {
            setShowManager(false)
          }}
        />
      )}
    </>
  )
}
