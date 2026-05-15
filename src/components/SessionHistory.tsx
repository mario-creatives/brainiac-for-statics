'use client'

import { useEffect, useState, useCallback } from 'react'
import { History, ChevronDown, ChevronUp, Trash2, RefreshCw } from 'lucide-react'
import type { RecentAnalysis } from '@/app/api/analyses/recent/route'

interface Props {
  token: string | null
  onSelect: (analysisId: string) => void
  onReanalyze?: (analysisId: string) => void
}

export function SessionHistory({ token, onSelect, onReanalyze }: Props) {
  const [analyses, setAnalyses] = useState<RecentAnalysis[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; currentId: string | null }>({ done: 0, total: 0, currentId: null })
  const [bulkErrors, setBulkErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/analyses/recent', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setAnalyses(data.analyses ?? [])
      } else {
        setLoadError(`Failed to load history (${res.status})`)
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Network error')
    }
    setLoading(false)
  }, [token])

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token) return
    const prev = analyses
    setAnalyses(curr => curr.filter(a => a.id !== id))
    try {
      const res = await fetch(`/api/analyze/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        // Restore and surface
        setAnalyses(prev)
        setLoadError(`Failed to delete (${res.status})`)
      }
    } catch (err) {
      setAnalyses(prev)
      setLoadError(err instanceof Error ? err.message : 'Network error')
    }
  }, [token, analyses])

  // Apply a re-analyzed result onto an existing row in the table (used during
  // bulk re-analyze). Mirrors the partial-update shape returned by /reanalyze.
  function mergeReanalyzed(id: string, data: Record<string, unknown>) {
    if (!data.comprehensive) return
    const ca = data.comprehensive as Record<string, unknown>
    const fwk = ca?.framework_score as Record<string, unknown> | undefined
    const copy = ca?.copy as Record<string, unknown> | undefined
    const headline = copy?.headline as Record<string, unknown> | undefined
    setAnalyses(curr => curr.map(a => a.id !== id ? a : {
      ...a,
      framework_grade: (fwk?.overall_framework_grade as string) ?? a.framework_grade,
      composition_tag: (ca?.composition_tag as string) ?? a.composition_tag,
      headline_text: (headline?.text as string) ?? a.headline_text,
    }))
  }

  const handleBulkReanalyze = useCallback(async () => {
    if (!token || bulkRunning || analyses.length === 0) return
    setBulkRunning(true)
    setBulkErrors({})
    setBulkProgress({ done: 0, total: analyses.length, currentId: null })

    // Snapshot the list at start so insertions/deletions during the run
    // don't shift indexes.
    const queue = [...analyses]

    for (const a of queue) {
      setBulkProgress(p => ({ ...p, currentId: a.id }))
      try {
        const res = await fetch('/api/analyze/reanalyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ analysis_id: a.id }),
        })
        if (!res.ok) {
          setBulkErrors(prev => ({ ...prev, [a.id]: `Re-analysis failed (${res.status})` }))
        } else {
          // Drain the keep-alive stream: real payload is the last non-empty line.
          const reader = res.body?.getReader()
          const decoder = new TextDecoder()
          let text = ''
          if (reader) {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              text += decoder.decode(value, { stream: !done })
            }
          }
          const last = text.split('\n').filter(l => l.trim()).pop() ?? '{}'
          try {
            const data = JSON.parse(last) as Record<string, unknown>
            if (data.error) {
              setBulkErrors(prev => ({ ...prev, [a.id]: data.error as string }))
            } else if (data.comprehensive) {
              mergeReanalyzed(a.id, data)
              onReanalyze?.(a.id)
            } else {
              setBulkErrors(prev => ({ ...prev, [a.id]: 'Re-analysis returned no data' }))
            }
          } catch (parseErr) {
            setBulkErrors(prev => ({ ...prev, [a.id]: `Parse error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}` }))
          }
        }
      } catch (err) {
        setBulkErrors(prev => ({ ...prev, [a.id]: err instanceof Error ? err.message : 'Network error' }))
      }
      setBulkProgress(p => ({ ...p, done: p.done + 1 }))
    }

    setBulkRunning(false)
    setBulkProgress(p => ({ ...p, currentId: null }))
  }, [token, bulkRunning, analyses, onReanalyze])

  useEffect(() => {
    if (expanded) load()
  }, [expanded, load])

  const errorCount = Object.keys(bulkErrors).length
  const currentRow = bulkProgress.currentId ? analyses.find(a => a.id === bulkProgress.currentId) : null
  const currentLabel = currentRow?.headline_text?.slice(0, 32) ?? bulkProgress.currentId?.slice(0, 8) ?? ''

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-sm">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-2.5">
          <History className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold text-white">Recent analyses</span>
          <span className="text-[10px] text-gray-500">— click any past analysis to reopen its full breakdown</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-800 px-6 py-4">
          {/* Bulk action bar */}
          {analyses.length > 0 && (
            <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkReanalyze}
                  disabled={bulkRunning}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                    bulkRunning
                      ? 'bg-gray-800 border-gray-700 text-gray-400 cursor-wait'
                      : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${bulkRunning ? 'animate-spin' : ''}`} />
                  {bulkRunning ? 'Re-analyzing…' : `Re-analyze all (${analyses.length})`}
                </button>
                {bulkRunning && (
                  <span className="text-[10px] text-gray-400">
                    {bulkProgress.done} of {bulkProgress.total}
                    {currentLabel && <span className="text-gray-500"> · now: {currentLabel}</span>}
                  </span>
                )}
                {!bulkRunning && errorCount > 0 && (
                  <span className="text-[10px] text-[#ff2a2b]">{errorCount} failed</span>
                )}
              </div>
              <p className="text-[10px] text-gray-600 max-w-md text-right">
                Sequential — one ad at a time so Claude isn&apos;t skimming. A failure on one ad does not stop the rest.
              </p>
            </div>
          )}

          {loading && <p className="text-xs text-gray-500 animate-pulse-soft">Loading…</p>}
          {loadError && <p className="text-xs text-[#ff2a2b]">{loadError}</p>}
          {!loading && analyses.length === 0 && (
            <p className="text-xs text-gray-500">No prior analyses yet.</p>
          )}
          {!loading && analyses.length > 0 && (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {analyses.map(a => {
                const isCurrent = bulkRunning && bulkProgress.currentId === a.id
                const err = bulkErrors[a.id]
                return (
                  <div
                    key={a.id}
                    className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isCurrent ? 'bg-indigo-950/40 border border-indigo-900/60' : 'hover:bg-gray-800'
                    }`}
                  >
                    <button
                      onClick={() => onSelect(a.id)}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                    {a.heatmap_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.heatmap_url} alt="" className="w-10 h-10 object-cover rounded shrink-0 border border-gray-800" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-800 rounded shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-200 truncate">
                        {a.headline_text ?? 'Untitled ad'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[9px] text-gray-500">
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                        {a.composition_tag && (
                          <span className="text-[9px] text-white font-mono bg-gray-950 border border-gray-800 rounded px-1.5 py-0.5">
                            {a.composition_tag}
                          </span>
                        )}
                        {a.framework_grade && (
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border bg-gray-900 ${
                            a.framework_grade === 'A' ? 'text-emerald-400 border-emerald-800/60' :
                            a.framework_grade === 'B' ? 'text-amber-400 border-amber-800/60' :
                            a.framework_grade === 'C' ? 'text-orange-400 border-orange-800/60' :
                            'text-[#ff2a2b] border-red-900/60'
                          }`}>{a.framework_score != null ? `${a.framework_grade} (${a.framework_score.toFixed(1)})` : a.framework_grade}</span>
                        )}
                        {a.mean_top_roi_score != null && (
                          <span className="text-[9px] font-mono text-indigo-300 border border-indigo-800/60 bg-gray-900 rounded px-1.5 py-0.5">
                            N {a.mean_top_roi_score.toFixed(2)}
                          </span>
                        )}
                        {a.spend_usd != null && (
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            a.is_winner ? 'text-yellow-400 border-yellow-800/60 bg-gray-900' : 'text-[#ff2a2b] border-red-900/60 bg-gray-900'
                          }`}>${a.spend_usd.toLocaleString()}</span>
                        )}
                        {isCurrent && (
                          <span className="text-[9px] text-indigo-300 animate-pulse">re-analyzing…</span>
                        )}
                        {err && (
                          <span className="text-[9px] text-red-400" title={err}>
                            re-analysis failed: {err.slice(0, 60)}
                          </span>
                        )}
                      </div>
                    </div>
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDelete(a.id, e)}
                      aria-label="Delete analysis"
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-500 hover:text-[#ff2a2b] hover:bg-gray-900 transition-all shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
