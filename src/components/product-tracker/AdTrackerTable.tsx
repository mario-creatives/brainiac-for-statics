'use client'

import { useState } from 'react'
import { Pencil, Flame } from 'lucide-react'
import { QuadrantBadge } from './QuadrantBadge'
import { AdMetricsEditor } from './AdMetricsEditor'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'
import type { Quadrant } from '@/lib/quadrant'

interface Props {
  token: string
  productId: string
  ads: ProductAdRow[]
  onOpenAd: (analysisId: string) => void
  onChanged: () => void
}

type StatusFilter = 'all' | Quadrant
type SortKey = 'created_at' | 'spend' | 'cpa' | 'ctr'

export function AdTrackerTable({ token, productId, ads, onOpenAd, onChanged }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [ageFilter, setAgeFilter] = useState('')

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

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 flex-wrap">
        <span className="text-xs font-semibold text-white">Ads in this product ({ads.length})</span>
        <div className="flex-1" />
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
          className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none w-32"
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

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500">
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
              <th className="py-2 px-3 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 px-3 text-center text-gray-600 text-xs">No ads match the current filters.</td>
              </tr>
            )}
            {filtered.map(a => (
              <FragmentRow
                key={a.analysis_id}
                row={a}
                editing={editingId === a.analysis_id}
                onEdit={() => setEditingId(a.analysis_id)}
                onCloseEdit={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); onChanged() }}
                onOpenAd={onOpenAd}
                token={token}
                productId={productId}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRow({ row, editing, onEdit, onCloseEdit, onSaved, onOpenAd, token, productId }: {
  row: ProductAdRow; editing: boolean; onEdit: () => void; onCloseEdit: () => void; onSaved: () => void;
  onOpenAd: (id: string) => void; token: string; productId: string
}) {
  return (
    <>
      <tr className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
        <td className="py-2 px-3">
          <button onClick={() => onOpenAd(row.analysis_id)} className="flex items-center gap-2 text-left min-w-0 max-w-[280px]">
            {row.heatmap_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.heatmap_url} alt="" className="w-8 h-8 object-cover rounded shrink-0 border border-gray-800" />
            ) : (
              <div className="w-8 h-8 bg-gray-800 rounded shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block text-gray-200 truncate">{row.headline_text ?? 'Untitled ad'}</span>
              <span className="block text-[9px] text-gray-500 truncate">{row.composition_tag ?? '—'}</span>
            </span>
            {row.fatigue_flag && <Flame className="w-3 h-3 text-orange-400 shrink-0" />}
          </button>
        </td>
        <td className="py-2 px-3">
          <QuadrantBadge quadrant={row.effective_quadrant} override={row.quadrant_override != null} />
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
            }`}>{row.framework_grade}</span>
          )}
        </td>
        <td className="py-2 px-3 text-right">
          <button onClick={onEdit} className="text-gray-500 hover:text-indigo-400 p-1" aria-label="Edit metrics">
            <Pencil className="w-3 h-3" />
          </button>
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
