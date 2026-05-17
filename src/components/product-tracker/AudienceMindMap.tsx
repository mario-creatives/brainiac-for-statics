'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type ReactFlowInstance,
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

interface NodeData {
  label: string
  adCount: number
  quadrant: string | null
  nodeType: 'root' | 'tam' | 'persona' | 'micro' | 'concept' | 'angle'
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

// ─── Node style tokens ────────────────────────────────────────────────────────

const NODE_W = 244
const NODE_H = 64

interface LevelStyle {
  accent: string        // left stripe color
  label: string         // label text color
  count: string         // count text color
  pill: string          // quadrant pill bg
  pillText: string      // quadrant pill text
  ring: string          // border color
}

const LEVEL_STYLE: Record<NodeData['nodeType'], LevelStyle> = {
  root:    { accent: '#6366f1', label: '#a5b4fc', count: '#4f46e5', pill: '#312e81', pillText: '#a5b4fc', ring: '#312e81' },
  tam:     { accent: '#0ea5e9', label: '#7dd3fc', count: '#0369a1', pill: '#082f49', pillText: '#7dd3fc', ring: '#0c4a6e' },
  persona: { accent: '#a855f7', label: '#d8b4fe', count: '#7e22ce', pill: '#2e1065', pillText: '#d8b4fe', ring: '#3b0764' },
  micro:   { accent: '#10b981', label: '#6ee7b7', count: '#065f46', pill: '#022c22', pillText: '#6ee7b7', ring: '#064e3b' },
  concept: { accent: '#f59e0b', label: '#fcd34d', count: '#92400e', pill: '#1c1003', pillText: '#fcd34d', ring: '#713f12' },
  angle:   { accent: '#f43f5e', label: '#fda4af', count: '#9f1239', pill: '#1f0511', pillText: '#fda4af', ring: '#4c0519' },
}

function quadrantDot(q: string | null): string {
  if (q === 'winner')      return '#eab308'
  if (q === 'promising')   return '#818cf8'
  if (q === 'investigate') return '#f59e0b'
  if (q === 'loser')       return '#ff2a2b'
  return '#374151'
}

function quadrantPillCls(q: string | null): string {
  if (q === 'winner')      return 'bg-yellow-900/70 text-yellow-300'
  if (q === 'promising')   return 'bg-indigo-900/70 text-indigo-300'
  if (q === 'investigate') return 'bg-amber-900/70 text-amber-300'
  if (q === 'loser')       return 'bg-red-900/70 text-[#ff2a2b]'
  return ''
}

// ─── Dagre layout ─────────────────────────────────────────────────────────────

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 72, ranksep: 148 })
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id)
      return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
    }),
    edges,
  }
}

// ─── Custom node ──────────────────────────────────────────────────────────────

function MindNode({ data }: { data: NodeData }) {
  const s = LEVEL_STYLE[data.nodeType]
  const isLeaf = data.nodeType === 'angle'
  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        borderRadius: 14,
        border: `1px solid ${s.ring}`,
        background: '#0a0a0f',
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none',
        boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
        transition: 'box-shadow 0.18s ease, transform 0.18s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.boxShadow = `0 4px 24px rgba(0,0,0,0.8), 0 0 0 1px ${s.accent}55`
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.boxShadow = '0 2px 12px rgba(0,0,0,0.6)'
        el.style.transform = 'translateY(0)'
      }}
    >
      {/* Left accent stripe */}
      <div style={{ width: 3, flexShrink: 0, background: s.accent, borderRadius: '14px 0 0 14px' }} />

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 12px', gap: 4, minWidth: 0 }}>
        <span
          style={{
            color: s.label,
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-geist-sans, ui-sans-serif)',
          }}
        >
          {data.label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: s.count, fontSize: 10, fontFamily: 'monospace', fontWeight: 500 }}>
            {data.adCount} ad{data.adCount !== 1 ? 's' : ''}
          </span>
          {data.quadrant && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: quadrantDot(data.quadrant),
                  flexShrink: 0,
                  boxShadow: `0 0 4px ${quadrantDot(data.quadrant)}99`,
                }}
              />
              <span style={{ color: quadrantDot(data.quadrant), fontSize: 9, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {data.quadrant}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Right edge — subtle indicator */}
      {!isLeaf && (
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 10 }}>
          <svg width="6" height="10" viewBox="0 0 6 10" fill="none">
            <path d="M1 1l4 4-4 4" stroke={s.accent} strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
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
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass bg-gray-950 border border-gray-700 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[82vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest truncate">
              {breadcrumb.slice(0, -1).join(' · ')}
            </p>
            <h3 className="text-sm font-semibold text-white mt-0.5 truncate">
              {breadcrumb[breadcrumb.length - 1]}
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">{adSlots.length} ad{adSlots.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 w-7 h-7 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Ad list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0 space-y-2">
          {sorted.length === 0 ? (
            <p className="text-[10px] text-gray-600 text-center py-8">No ads under this angle.</p>
          ) : sorted.map(slot => (
            <div
              key={slot.analysisId}
              className={`flex items-center gap-3 bg-gray-900 border rounded-xl px-3 py-2.5 transition-colors ${
                slot.quadrant === 'winner' ? 'border-yellow-400/30' : 'border-gray-800'
              }`}
            >
              {slot.heatmapUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slot.heatmapUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="w-11 h-11 object-cover rounded-lg border border-gray-800 shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg border border-gray-800 bg-gray-800 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-200 truncate">
                  {slot.headline ?? 'Untitled ad'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {slot.spendUsd != null && (
                    <span className="font-mono text-[9px] text-gray-500">
                      ${slot.spendUsd.toLocaleString()} spend
                    </span>
                  )}
                  {slot.cpaUsd != null && (
                    <span className="font-mono text-[9px] text-gray-500">
                      ${slot.cpaUsd.toFixed(2)} CPA
                    </span>
                  )}
                </div>
              </div>
              {slot.quadrant && (
                <span className={`font-mono text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full shrink-0 ${quadrantPillCls(slot.quadrant)}`}>
                  {slot.quadrant}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AudienceMindMap({ productName, ads, productId, token }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const rfInstance = useRef<ReactFlowInstance | null>(null)
  const [modalData, setModalData] = useState<ModalProps | null>(null)
  const [showManager, setShowManager] = useState(false)

  // ── Build 5-level tree from ads (memoised) ───────────────────────────────
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

  // ── Initial expanded: root + all TAMs visible ─────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>(['root'])
    return s
  })

  // Auto-expand all TAMs on first mount once tree is ready
  useEffect(() => {
    setExpanded(prev => {
      const s = new Set(prev)
      for (const tamK of tree.tamTree.keys()) s.add(`tam::${tamK}`)
      return s
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally once on mount

  // ── Build react-flow graph ────────────────────────────────────────────────
  const buildGraph = useCallback(() => {
    const { tamTree, tamDisplay, personaDisplay, microDisplay, conceptDisplay, angleDisplay } = tree
    const newNodes: Node[] = []
    const newEdges: Edge[] = []

    const addNode = (id: string, data: NodeData) => {
      newNodes.push({ id, type: 'mindNode', data, position: { x: 0, y: 0 } })
    }

    const addEdge = (source: string, target: string) => {
      newEdges.push({
        id: `${source}->${target}`,
        source,
        target,
        type: 'smoothstep',
        style: { stroke: '#1f2937', strokeWidth: 1.5 },
      })
    }

    addNode('root', {
      label: productName,
      adCount: ads.length,
      quadrant: null,
      nodeType: 'root',
    })

    for (const [tamK, persMap] of tamTree.entries()) {
      const tamId = `tam::${tamK}`
      const tamAds = flattenAds(persMap)
      addNode(tamId, {
        label: tamDisplay.get(tamK) ?? tamK,
        adCount: tamAds.length,
        quadrant: dominantQuadrant(tamAds),
        nodeType: 'tam',
      })
      addEdge('root', tamId)

      if (!expanded.has(tamId)) continue

      for (const [persK, microMap] of persMap.entries()) {
        const persId = `persona::${tamK}::${persK}`
        const persAds = flattenAds(microMap)
        addNode(persId, {
          label: personaDisplay.get(persK) ?? persK,
          adCount: persAds.length,
          quadrant: dominantQuadrant(persAds),
          nodeType: 'persona',
        })
        addEdge(tamId, persId)

        if (!expanded.has(persId)) continue

        for (const [microK, conceptMap] of microMap.entries()) {
          const microId = `micro::${tamK}::${persK}::${microK}`
          const microAds = flattenAds(conceptMap)
          addNode(microId, {
            label: microDisplay.get(microK) ?? microK,
            adCount: microAds.length,
            quadrant: dominantQuadrant(microAds),
            nodeType: 'micro',
          })
          addEdge(persId, microId)

          if (!expanded.has(microId)) continue

          for (const [conceptK, angleMap] of conceptMap.entries()) {
            const conceptId = `concept::${tamK}::${persK}::${microK}::${conceptK}`
            const conceptAds = flattenAds(angleMap)
            addNode(conceptId, {
              label: conceptDisplay.get(conceptK) ?? conceptK,
              adCount: conceptAds.length,
              quadrant: dominantQuadrant(conceptAds),
              nodeType: 'concept',
            })
            addEdge(microId, conceptId)

            if (!expanded.has(conceptId)) continue

            for (const [angleK, adSlots] of angleMap.entries()) {
              const angleId = `angle::${tamK}::${persK}::${microK}::${conceptK}::${angleK}`
              addNode(angleId, {
                label: angleDisplay.get(angleK) ?? angleK,
                adCount: adSlots.length,
                quadrant: dominantQuadrant(adSlots),
                nodeType: 'angle',
                adSlots,
                breadcrumb: [
                  tamDisplay.get(tamK)       ?? tamK,
                  personaDisplay.get(persK)  ?? persK,
                  microDisplay.get(microK)   ?? microK,
                  conceptDisplay.get(conceptK) ?? conceptK,
                  angleDisplay.get(angleK)   ?? angleK,
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

    // Smooth fit after React renders the new layout
    setTimeout(() => {
      rfInstance.current?.fitView({ duration: 600, padding: 0.14 })
    }, 60)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, tree, productName, ads.length])

  useEffect(() => {
    buildGraph()
  }, [buildGraph])

  // ── Node click ────────────────────────────────────────────────────────────
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
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h3 className="text-xs font-semibold text-white mb-1">Audience mind map</h3>
        <p className="text-[10px] text-gray-600 py-8 text-center">
          No ads have been analysed yet. Upload and analyse ads to build the audience map.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800/70">
          <div>
            <h3 className="text-xs font-semibold text-white tracking-tight">Audience mind map</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {withHierarchy} of {totalAds} ad{totalAds !== 1 ? 's' : ''} mapped · click nodes to expand
            </p>
          </div>
          {productId && token && (
            <button
              onClick={() => setShowManager(true)}
              className="text-[11px] px-3 py-1.5 rounded-lg border bg-gray-950 hover:bg-gray-800 border-gray-800 text-gray-400 hover:text-gray-200 flex items-center gap-1.5 transition-colors"
            >
              <Settings2 className="w-3 h-3" />
              Concepts &amp; angles
            </button>
          )}
        </div>

        {/* Canvas */}
        <div style={{ height: 680, background: '#050508' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            onInit={instance => { rfInstance.current = instance }}
            fitView
            fitViewOptions={{ padding: 0.14, duration: 600 }}
            minZoom={0.15}
            maxZoom={2}
            attributionPosition="bottom-right"
            proOptions={{ hideAttribution: false }}
          >
            <Controls
              style={{ background: '#0d0d12', border: '1px solid #1f2937', borderRadius: 10 }}
              showInteractive={false}
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="#141418"
            />
          </ReactFlow>
        </div>
      </div>

      {modalData && <MindNodeDetailModal {...modalData} />}

      {showManager && productId && token && (
        <ConceptAngleManager
          productId={productId}
          token={token}
          onClose={() => setShowManager(false)}
          onChanged={() => setShowManager(false)}
        />
      )}
    </>
  )
}
