'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Trash2, Check } from 'lucide-react'

interface Props {
  productId: string
  token: string
  onClose: () => void
  onChanged: () => void
}

interface ManagedRow {
  id: string
  label: string
  ad_count: number
  dominant_quadrant: string | null
}

interface MergeConfirmState {
  sourceRows: ManagedRow[]
  target: ManagedRow
}

function quadrantBadge(q: string | null) {
  if (!q) return null
  const cls =
    q === 'winner'      ? 'bg-yellow-900/60 text-yellow-300' :
    q === 'promising'   ? 'bg-indigo-900/60 text-indigo-300' :
    q === 'investigate' ? 'bg-amber-900/60 text-amber-300' :
    q === 'loser'       ? 'bg-red-900/60 text-[#ff2a2b]' : ''
  return (
    <span className={`font-mono text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>
      {q}
    </span>
  )
}

type Tab = 'concepts' | 'angles'

export function ConceptAngleManager({ productId, token, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('concepts')
  const [rows, setRows] = useState<ManagedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState<string>('')
  const [mergeConfirm, setMergeConfirm] = useState<MergeConfirmState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  const endpoint = tab === 'concepts'
    ? `/api/products/${productId}/concepts`
    : `/api/products/${productId}/angles`

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(endpoint, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Failed to load (${res.status})`)
      const data = await res.json()
      setRows(tab === 'concepts' ? (data.concepts ?? []) : (data.angles ?? []))
      setSelected(new Set())
      setMergeTargetId('')
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [endpoint, tab, token])

  useEffect(() => { fetchRows() }, [fetchRows])

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus()
  }, [editingId])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
    setMergeTargetId('')
  }

  function startEdit(row: ManagedRow) {
    setEditingId(row.id)
    setEditValue(row.label)
    setActionError(null)
  }

  async function commitRename(id: string) {
    const trimmed = editValue.trim()
    if (!trimmed) { setEditingId(null); return }
    setActionError(null)
    const itemEndpoint = tab === 'concepts'
      ? `/api/products/${productId}/concepts/${id}`
      : `/api/products/${productId}/angles/${id}`
    try {
      const res = await fetch(itemEndpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: trimmed }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `Failed (${res.status})`)
      }
      setEditingId(null)
      await fetchRows()
      onChanged()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  async function handleDelete(id: string) {
    const msg = tab === 'concepts'
      ? 'Delete this concept? Ads using it will lose the tag.'
      : 'Delete this angle? Ads using it will lose the tag.'
    if (!confirm(msg)) return
    setActionError(null)
    const itemEndpoint = tab === 'concepts'
      ? `/api/products/${productId}/concepts/${id}`
      : `/api/products/${productId}/angles/${id}`
    try {
      const res = await fetch(itemEndpoint, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `Failed (${res.status})`)
      }
      await fetchRows()
      onChanged()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  function openMergeConfirm() {
    if (selected.size < 2 || !mergeTargetId) return
    const target = rows.find(r => r.id === mergeTargetId)
    if (!target) return
    const sourceRows = rows.filter(r => selected.has(r.id) && r.id !== mergeTargetId)
    if (sourceRows.length === 0) return
    setMergeConfirm({ sourceRows, target })
    setActionError(null)
  }

  async function executeMerge() {
    if (!mergeConfirm) return
    const { sourceRows, target } = mergeConfirm
    const mergeEndpoint = tab === 'concepts'
      ? `/api/products/${productId}/concepts/merge`
      : `/api/products/${productId}/angles/merge`
    try {
      const res = await fetch(mergeEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ source_ids: sourceRows.map(r => r.id), target_id: target.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `Failed (${res.status})`)
      }
      setMergeConfirm(null)
      setSelected(new Set())
      setMergeTargetId('')
      await fetchRows()
      onChanged()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Merge failed')
      setMergeConfirm(null)
    }
  }

  const selectedRows = rows.filter(r => selected.has(r.id))
  const nonSelectedRows = rows.filter(r => !selected.has(r.id))
  const totalAffected = selectedRows.reduce((sum, r) => sum + r.ad_count, 0)

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div className="glass bg-gray-950 border border-gray-700 rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
            <h2 className="text-sm font-semibold text-white">Manage concepts &amp; angles</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-5 pt-3 shrink-0">
            {(['concepts', 'angles'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelected(new Set()); setMergeTargetId(''); setActionError(null) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  tab === t
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
            {loading && (
              <p className="text-[10px] text-gray-500 animate-pulse py-6 text-center">Loading...</p>
            )}
            {fetchError && (
              <p className="text-[10px] text-red-400 py-4 text-center">{fetchError}</p>
            )}
            {!loading && !fetchError && rows.length === 0 && (
              <p className="text-[10px] text-gray-600 py-6 text-center">
                No {tab} found for this product.
              </p>
            )}
            {!loading && !fetchError && rows.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="w-6 pb-2" />
                    <th className="text-left pb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Label
                    </th>
                    <th className="text-right pb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-gray-500 pr-4">
                      Ads
                    </th>
                    <th className="text-left pb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Top quadrant
                    </th>
                    <th className="w-8 pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="w-3 h-3 accent-indigo-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-2 pr-3 max-w-[240px]">
                        {editingId === row.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              ref={editRef}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => commitRename(row.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitRename(row.id)
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                            <button
                              onMouseDown={() => commitRename(row.id)}
                              className="text-indigo-400 hover:text-indigo-300"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(row)}
                            className="text-gray-300 hover:text-white transition-colors text-left truncate max-w-full block"
                          >
                            {row.label}
                          </button>
                        )}
                      </td>
                      <td className="py-2 text-right pr-4 text-gray-500">{row.ad_count}</td>
                      <td className="py-2">{quadrantBadge(row.dominant_quadrant)}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => handleDelete(row.id)}
                          className="text-gray-700 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Merge bar */}
          {selected.size >= 2 && (
            <div className="px-5 py-3 border-t border-gray-800 shrink-0 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-gray-400">{selected.size} selected — merge into:</span>
              <select
                value={mergeTargetId}
                onChange={e => setMergeTargetId(e.target.value)}
                className="flex-1 min-w-[160px] bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Choose target...</option>
                {nonSelectedRows.map(r => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <button
                disabled={!mergeTargetId}
                onClick={openMergeConfirm}
                className="px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
              >
                Merge {selected.size} selected
              </button>
            </div>
          )}

          {/* Error */}
          {actionError && (
            <div className="px-5 pb-3 shrink-0">
              <p className="text-[10px] text-red-400">{actionError}</p>
            </div>
          )}
        </div>
      </div>

      {/* Merge confirmation sub-modal */}
      {mergeConfirm && (
        <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass bg-gray-950 border border-gray-700 rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">
              Merge {mergeConfirm.sourceRows.length} {tab} into &ldquo;{mergeConfirm.target.label}&rdquo;?
            </h3>
            <div className="space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Source labels
              </p>
              <ul className="space-y-0.5">
                {mergeConfirm.sourceRows.map(r => (
                  <li key={r.id} className="text-xs text-gray-300">{r.label}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-gray-400">
              This will move {totalAffected} ad{totalAffected !== 1 ? 's' : ''} and permanently
              delete the {mergeConfirm.sourceRows.length} source row{mergeConfirm.sourceRows.length !== 1 ? 's' : ''}.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setMergeConfirm(null)}
                className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeMerge}
                className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors"
              >
                Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
