'use client'

import { useState } from 'react'
import { Pencil, Flame, Trash2, RefreshCw, GitCompare } from 'lucide-react'
import { QuadrantBadge } from './QuadrantBadge'
import { AdMetricsEditor } from './AdMetricsEditor'
import { AdCompareModal } from './AdCompareModal'
import { formatGrade } from '@/lib/format'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'
import type { Quadrant } from '@/lib/quadrant'

function TargetingDot({ quality, personaLabel }: {
  quality: ProductAdRow['audience_match_quality']
  personaLabel?: string | null
}) {
  const suffix = personaLabel ? ` (${personaLabel})` : ''
  if (quality === 'aligned') return <span className="text-emerald-400 text-base leading-none" title={`Audience aligned${suffix}`}>●</span>
  if (quality === 'partial_mismatch') return <span className="text-amber-400 text-base leading-none" title={`Partial audience mismatch${suffix}`}>●</span>
  if (quality === 'major_mismatch') return <span className="text-[#ff2a2b] text-base leading-none" title={`Major audience mismatch — ad reads as targeting a different audience than stated${suffix}`}>●</span>
  return <span className="text-gray-700 text-xs" title="No audience selected — select one in the editor to enable the targeting-fit check">—</span>
}

interface Props {
  token: string
  productId: string
  ads: ProductAdRow[]
  onOpenAd: (analysisId: string) => void
  onChanged: () => void
  currentReanalyzeId?: string | null
}

type StatusFilter = 'all' | Quadrant
type SortKey = 'created_at' | 'spend' | 'cpa' | 'ctr'

export function AdTrackerTable({ token, productId, ads, onOpenAd, onChanged, currentReanalyzeId }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [ageFilter, setAgeFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkReanalyzing, setBulkReanalyzing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null)

  const filtered = ads
    .filter(a => statusFilter === 'all' || a.effective_quadrant === statusFilter)
    .filter(a => !ageFilter.trim() || (a.age_range ?? '').toLowerCase().includes(ageFilter.trim().toLowerCase()))
    .slice()
    .sort((a, b) => {
      switch (sortKey) {
        case 'spend': return (b.spend_usd ?? -1) - (a.spend_usd ?? -1)
        case 'cpa':   return (a.cpa_usd ?? Infinity) - (b.cpa_usd ?? Infinity)
        case 'ctr':   return (b.ctr_pct ?? -1) - (a.ctr_pct ?? -1)
        default:      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected(prev =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map(a => a.analysis_id))
    )
  }

  async function handleBulkDelete() {
    if (!selected.size || bulkDeleting) return
    const ids = Array.from(selected)
    setBulkDeleting(true)
    setBulkError(null)
    let failed = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/analyze/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) failed++
      } catch {
        failed++
      }
    }
    setBulkDeleting(false)
    if (failed > 0) setBulkError(`${failed} deletion${failed !== 1 ? 's' : ''} failed`)
    setSelected(new Set())
    onChanged()
  }

  async function handleBulkReanalyze() {
    if (!selected.size || bulkReanalyzing) return
    const ids = Array.from(selected)
    setBulkReanalyzing(true)
    setBulkError(null)
    setBulkProgress({ done: 0, total: ids.length })
    const failedIds: string[] = []
    for (const id of ids) {
      let ok = false
      try {
        const res = await fetch('/api/analyze/reanalyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ analysis_id: id }),
        })
        if (res.ok) {
          // drain stream
          const reader = res.body?.getReader()
          if (reader) {
            const decoder = new TextDecoder()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              decoder.decode(value, { stream: !done })
            }
          }
          ok = true
        }
      } catch { /* ok stays false */ }
      if (!ok) failedIds.push(id)
      setBulkProgress(p => p ? { ...p, done: p.done + 1 } : null)
    }
    setBulkReanalyzing(false)
    setBulkProgress(null)
    if (failedIds.length > 0) {
      setBulkError(`${failedIds.length} re-analysis failure${failedIds.length !== 1 ? 's' : ''} — click Re-analyze to retry just those`)
      setSelected(new Set(failedIds))
    } else {
      setSelected(new Set())
    }
    onChanged()
  }

  function handleCompare() {
    const ids = Array.from(selected)
    if (ids.length === 2) setCompareIds([ids[0], ids[1]])
  }

  const compareAds = compareIds
    ? ads.filter(a => compareIds.includes(a.analysis_id)) as [ProductAdRow, ProductAdRow] | undefined
    : undefined
  const canCompare = selected.size === 2

  return (
    <>
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 flex-wrap">
          <span className="text-xs font-semibold text-white shrink-0">Ads ({ads.length})</span>
          <div className="flex-1" />

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-400">{selected.size} selected</span>
              {canCompare && (
                <button
                  onClick={handleCompare}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border bg-indigo-900/30 border-indigo-700/60 text-indigo-300 hover:bg-indigo-900/50 transition-colors"
                >
                  <GitCompare className="w-3 h-3" />
                  Compare A/B
                </button>
              )}
              <button
                onClick={handleBulkReanalyze}
                disabled={bulkReanalyzing || bulkDeleting}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${bulkReanalyzing ? 'animate-spin' : ''}`} />
                {bulkReanalyzing && bulkProgress
                  ? `${bulkProgress.done}/${bulkProgress.total}`
                  : 'Re-analyze'}
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting || bulkReanalyzing}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border bg-red-900/20 border-red-800/50 text-red-400 hover:bg-red-900/40 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                {bulkDeleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                ✕ clear
              </button>
              {bulkError && <span className="text-[10px] text-red-400">{bulkError}</span>}
            </div>
          )}

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-[10px] text-gray-300 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="winner">Winner</option>
            <option value="promising">Promising</option>
            <option value="investigate">Investigate</option>
            <option value="loser">Loser</option>
          </select>
          <input
            type="text"
            placeholder="age range filter"
            value={ageFilter}
            onChange={e => setAgeFilter(e.target.value)}
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none w-28"
          />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-[10px] text-gray-300 focus:outline-none"
          >
            <option value="created_at">Newest first</option>
            <option value="spend">Highest spend</option>
            <option value="cpa">Lowest CPA</option>
            <option value="ctr">Highest CTR</option>
          </select>
        </div>

        {/* Mobile card list (W-flow8) */}
        <div className="sm:hidden divide-y divide-gray-800/60">
          {filtered.length === 0 && (
            <p className="py-8 px-4 text-center text-gray-600 text-xs">No ads match the current filters.</p>
          )}
          {filtered.map(a => (
            <MobileAdCard
              key={a.analysis_id}
              row={a}
              selected={selected.has(a.analysis_id)}
              onToggleSelect={() => toggleSelect(a.analysis_id)}
              onOpenAd={onOpenAd}
              onEdit={() => setEditingId(a.analysis_id)}
              editing={editingId === a.analysis_id}
              onCloseEdit={() => setEditingId(null)}
              onSaved={() => { setEditingId(null); onChanged() }}
              token={token}
              productId={productId}
              isCurrent={currentReanalyzeId === a.analysis_id}
            />
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500">
                <th className="py-2 px-2 text-left font-medium w-6">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="py-2 px-3 text-left font-medium">Ad</th>
                <th className="py-2 px-3 text-left font-medium">Status</th>
                <th className="py-2 px-3 text-right font-medium">Spend</th>
                <th className="py-2 px-3 text-right font-medium">CPA</th>
                <th className="py-2 px-3 text-right font-medium">CTR</th>
                <th className="py-2 px-3 text-left font-medium">Age</th>
                <th className="py-2 px-3 text-left font-medium">Range</th>
                <th className="py-2 px-3 text-left font-medium">State</th>
                <th className="py-2 px-3 text-left font-medium">Format</th>
                <th className="py-2 px-3 text-left font-medium">Grade</th>
                <th className="py-2 px-3 text-center font-medium" title="Audience match — does Claude's read of the ad agree with the stated audience?">Fit</th>
                <th className="py-2 px-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-8 px-3 text-center text-gray-600 text-xs">No ads match the current filters.</td>
                </tr>
              )}
              {filtered.map(a => (
                <FragmentRow
                  key={a.analysis_id}
                  row={a}
                  selected={selected.has(a.analysis_id)}
                  onToggleSelect={() => toggleSelect(a.analysis_id)}
                  editing={editingId === a.analysis_id}
                  onEdit={() => setEditingId(a.analysis_id)}
                  onCloseEdit={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); onChanged() }}
                  onOpenAd={onOpenAd}
                  token={token}
                  productId={productId}
                  onDeleted={onChanged}
                  isCurrent={currentReanalyzeId === a.analysis_id}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {compareAds && compareAds.length === 2 && (
        <AdCompareModal
          adA={compareAds[0]}
          adB={compareAds[1]}
          onClose={() => setCompareIds(null)}
        />
      )}
    </>
  )
}

function FragmentRow({ row, selected, onToggleSelect, editing, onEdit, onCloseEdit, onSaved, onOpenAd, token, productId, onDeleted, isCurrent }: {
  row: ProductAdRow; selected: boolean; onToggleSelect: () => void
  editing: boolean; onEdit: () => void; onCloseEdit: () => void; onSaved: () => void;
  onOpenAd: (id: string) => void; token: string; productId: string; onDeleted: () => void
  isCurrent?: boolean
}) {
  const [deleting, setDeleting] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this ad? This cannot be undone.')) return
    setDeleting(true)
    try {
      await fetch(`/api/analyze/${row.analysis_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      onDeleted()
    } catch { /* ignore */ }
    setDeleting(false)
  }

  async function handleReanalyze(e: React.MouseEvent) {
    e.stopPropagation()
    if (reanalyzing) return
    setReanalyzing(true)
    try {
      const res = await fetch('/api/analyze/reanalyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ analysis_id: row.analysis_id }),
      })
      if (res.ok) {
        const reader = res.body?.getReader()
        if (reader) {
          const decoder = new TextDecoder()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            decoder.decode(value, { stream: !done })
          }
        }
        onSaved()
      }
    } catch { /* ignore */ }
    setReanalyzing(false)
  }

  return (
    <>
      <tr className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${isCurrent ? 'bg-indigo-950/40 border border-indigo-900/60' : selected ? 'bg-indigo-950/20' : ''}`}>
        <td className="py-2 px-2" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="w-3 h-3 rounded accent-indigo-500 cursor-pointer"
          />
        </td>
        <td className="py-2 px-3">
          <button onClick={() => onOpenAd(row.analysis_id)} className="flex items-center gap-2 text-left min-w-0 max-w-[280px]">
            {row.heatmap_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.heatmap_url} alt="" className="w-8 h-8 object-cover rounded shrink-0 border border-gray-800" />
            ) : (
              <div className="w-8 h-8 bg-gray-800 rounded shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block text-gray-200 truncate">
                {row.headline_text ?? 'Untitled ad'}
              </span>
              <span className="block text-[9px] text-gray-500 truncate">{row.composition_tag ?? '—'}</span>
            </span>
            {row.fatigue_flag && <Flame className="w-3 h-3 text-orange-400 shrink-0" />}
          </button>
        </td>
        <td className="py-2 px-3">
          {isCurrent ? (
            <span className="text-[10px] text-indigo-300 animate-pulse font-mono">re-analyzing…</span>
          ) : row.status === 'failed' ? (
            <span
              className="text-[10px] font-mono font-bold text-[#ff2a2b]"
              title={row.error_message ?? 'Analysis failed'}
            >
              Failed
            </span>
          ) : (
            <QuadrantBadge quadrant={row.effective_quadrant} override={row.quadrant_override != null} />
          )}
        </td>
        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{row.spend_usd != null ? `$${row.spend_usd.toLocaleString()}` : '—'}</td>
        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{row.cpa_usd != null ? `$${row.cpa_usd.toFixed(2)}` : '—'}</td>
        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{row.ctr_pct != null ? `${row.ctr_pct.toFixed(2)}%` : '—'}</td>
        <td className="py-2 px-3 text-gray-400">{row.age_range ?? '—'}</td>
        <td className="py-2 px-3 text-gray-500 text-[10px] whitespace-nowrap">
          {row.date_range_start && row.date_range_end ? `${row.date_range_start} → ${row.date_range_end}` :
           row.date_range_start ? `from ${row.date_range_start}` : '—'}
        </td>
        <td className="py-2 px-3">
          {row.ad_active === true ? <span className="text-[10px] text-emerald-400">Active</span> :
           row.ad_active === false ? <span className="text-[10px] text-gray-500">Paused</span> :
           <span className="text-[10px] text-gray-600">—</span>}
        </td>
        <td className="py-2 px-3 text-gray-400 text-[10px]">{row.ad_format ?? '—'}</td>
        <td className="py-2 px-3">
          {row.framework_grade && (
            <span className={`text-[10px] font-mono font-bold ${
              row.framework_grade === 'A' ? 'text-emerald-400' :
              row.framework_grade === 'B' ? 'text-amber-400' :
              row.framework_grade === 'C' ? 'text-orange-400' :
              'text-[#ff2a2b]'
            }`}>{formatGrade(row.framework_grade, row.framework_score)}</span>
          )}
        </td>
        <td className="py-2 px-3 text-center">
          <TargetingDot quality={row.audience_match_quality} personaLabel={row.persona_label} />
        </td>
        <td className="py-2 px-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={handleReanalyze} disabled={reanalyzing} className="text-gray-500 hover:text-indigo-400 p-1 disabled:opacity-40" aria-label="Re-analyze ad" title="Re-run comprehensive analysis">
              <RefreshCw className={`w-3 h-3 ${reanalyzing ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onEdit} className="text-gray-500 hover:text-indigo-400 p-1" aria-label="Edit metrics">
              <Pencil className="w-3 h-3" />
            </button>
            <button onClick={handleDelete} disabled={deleting} className="text-gray-700 hover:text-[#ff2a2b] p-1 disabled:opacity-40" aria-label="Delete ad">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <AdMetricsEditor
          token={token}
          productId={productId}
          row={row}
          onSaved={onSaved}
          onClose={onCloseEdit}
        />
      )}
    </>
  )
}

function MobileAdCard({ row, selected, onToggleSelect, onOpenAd, onEdit, editing, onCloseEdit, onSaved, token, productId, isCurrent }: {
  row: ProductAdRow; selected: boolean; onToggleSelect: () => void
  onOpenAd: (id: string) => void; onEdit: () => void
  editing: boolean; onCloseEdit: () => void; onSaved: () => void
  token: string; productId: string; isCurrent?: boolean
}) {
  return (
    <>
      <div className={`flex items-start gap-3 px-4 py-3 ${isCurrent ? 'bg-indigo-950/40' : selected ? 'bg-indigo-950/20' : ''}`}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer shrink-0"
        />
        <button onClick={() => onOpenAd(row.analysis_id)} className="flex items-start gap-3 flex-1 text-left min-w-0">
          {row.heatmap_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.heatmap_url} alt="" className="w-12 h-12 object-cover rounded shrink-0 border border-gray-800" />
          ) : (
            <div className="w-12 h-12 bg-gray-800 rounded shrink-0" />
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-xs text-gray-200 leading-snug truncate">
              {row.headline_text ?? 'Untitled ad'}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {isCurrent ? (
                <span className="text-[10px] text-indigo-300 animate-pulse font-mono">re-analyzing…</span>
              ) : row.status === 'failed' ? (
                <span className="text-[10px] font-mono font-bold text-[#ff2a2b]" title={row.error_message ?? 'Analysis failed'}>Failed</span>
              ) : (
                <QuadrantBadge quadrant={row.effective_quadrant} override={row.quadrant_override != null} />
              )}
              {row.framework_grade && (
                <span className={`text-[9px] font-mono font-bold ${
                  row.framework_grade === 'A' ? 'text-emerald-400' :
                  row.framework_grade === 'B' ? 'text-amber-400' :
                  row.framework_grade === 'C' ? 'text-orange-400' : 'text-[#ff2a2b]'
                }`}>{formatGrade(row.framework_grade, row.framework_score)}</span>
              )}
              <TargetingDot quality={row.audience_match_quality} personaLabel={row.persona_label} />
              {row.fatigue_flag && <Flame className="w-3 h-3 text-orange-400" />}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              {row.spend_usd != null && <span>${row.spend_usd.toLocaleString()}</span>}
              {row.cpa_usd != null && <span>CPA ${row.cpa_usd.toFixed(2)}</span>}
              {row.ctr_pct != null && <span>{row.ctr_pct.toFixed(2)}% CTR</span>}
            </div>
          </div>
        </button>
        <button onClick={onEdit} className="text-gray-500 hover:text-indigo-400 p-1 shrink-0 mt-1" aria-label="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
      {editing && (
        <div className="px-4 pb-3">
          <AdMetricsEditor
            token={token}
            productId={productId}
            row={row}
            onSaved={onSaved}
            onClose={onCloseEdit}
          />
        </div>
      )}
    </>
  )
}
