'use client'

import { useState } from 'react'
import type { Quadrant } from '@/lib/quadrant'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'

interface Props {
  token: string
  productId: string
  row: ProductAdRow
  onSaved: () => void
  onClose: () => void
}

const QUADRANT_OPTIONS: { value: '' | Quadrant; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'winner', label: 'Winner' },
  { value: 'promising', label: 'Promising' },
  { value: 'investigate', label: 'Investigate' },
  { value: 'loser', label: 'Loser' },
]

export function AdMetricsEditor({ token, productId, row, onSaved, onClose }: Props) {
  const [spend, setSpend] = useState(row.spend_usd?.toString() ?? '')
  const [cpa, setCpa] = useState(row.cpa_usd?.toString() ?? '')
  const [ctr, setCtr] = useState(row.ctr_pct?.toString() ?? '')
  const [ageRange, setAgeRange] = useState(row.age_range ?? '')
  const [dateStart, setDateStart] = useState(row.date_range_start ?? '')
  const [dateEnd, setDateEnd] = useState(row.date_range_end ?? '')
  const [active, setActive] = useState<boolean>(row.ad_active ?? true)
  const [override, setOverride] = useState<'' | Quadrant>(row.quadrant_override ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const metricsRes = await fetch(`/api/products/${productId}/ads/${row.analysis_id}/metrics`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          spend_usd: spend === '' ? null : Number(spend),
          cpa_usd:   cpa   === '' ? null : Number(cpa),
          ctr_pct:   ctr   === '' ? null : Number(ctr),
          age_range: ageRange.trim() || null,
          date_range_start: dateStart || null,
          date_range_end: dateEnd || null,
          ad_active: active,
        }),
      })
      if (!metricsRes.ok) {
        const data = await metricsRes.json().catch(() => ({}))
        setError(data.error ?? `Save failed (${metricsRes.status})`)
        setSaving(false)
        return
      }

      // Only PATCH override if it actually changed
      if ((override || null) !== (row.quadrant_override ?? null)) {
        await fetch(`/api/products/${productId}/ads/${row.analysis_id}/quadrant`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ quadrant_override: override === '' ? null : override }),
        })
      }

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
    setSaving(false)
  }

  return (
    <tr className="bg-gray-950/50 border-b border-gray-800">
      <td colSpan={11} className="px-3 py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Field label="Spend (USD)" type="number" value={spend} onChange={setSpend} placeholder="0.00" />
          <Field label="CPA (USD)" type="number" value={cpa} onChange={setCpa} placeholder="0.00" />
          <Field label="CTR (%)" type="number" value={ctr} onChange={setCtr} placeholder="0.00" />
          <Field label="Age range" type="text" value={ageRange} onChange={setAgeRange} placeholder="e.g. 25-44" />
          <Field label="Date start" type="date" value={dateStart} onChange={setDateStart} />
          <Field label="Date end" type="date" value={dateEnd} onChange={setDateEnd} />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">Status override</label>
            <select
              value={override}
              onChange={e => setOverride(e.target.value as '' | Quadrant)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-white focus:border-indigo-600 focus:outline-none"
            >
              {QUADRANT_OPTIONS.map(o => <option key={o.value || 'auto'} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">Active</label>
            <button
              onClick={() => setActive(v => !v)}
              type="button"
              className={`text-xs px-2 py-1 rounded border ${active ? 'bg-emerald-900/30 border-emerald-800/60 text-emerald-300' : 'bg-gray-900 border-gray-800 text-gray-500'}`}
            >
              {active ? 'Active' : 'Paused'}
            </button>
          </div>
        </div>

        {error && <p className="text-[10px] text-[#ff2a2b] mt-2">{error}</p>}

        <div className="flex items-center justify-end gap-2 mt-3">
          <button onClick={onClose} className="text-[10px] text-gray-400 hover:text-white px-2 py-1">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1 rounded transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </td>
    </tr>
  )
}

function Field({ label, type, value, onChange, placeholder }: {
  label: string; type: 'text' | 'number' | 'date'; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:border-indigo-600 focus:outline-none"
      />
    </div>
  )
}
