'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'

interface Props {
  ads: ProductAdRow[]
}

const STROKES = ['#34d399', '#a78bfa', '#fbbf24', '#ff2a2b', '#60a5fa', '#f472b6', '#10b981', '#facc15']

export function CtrFatigueChart({ ads }: Props) {
  // Only ads with at least 2 CTR snapshots — anything less can't show decay.
  const tracked = ads.filter(a => (a.ctr_history?.filter(h => h.ctr_pct != null).length ?? 0) >= 2)

  if (tracked.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <h3 className="text-xs font-semibold text-white mb-1">CTR over time</h3>
        <p className="text-[10px] text-gray-500 mb-3">Update CTR on the same ad at least twice to populate this fatigue chart.</p>
        <p className="text-[10px] text-gray-600 py-8 text-center">No CTR history yet.</p>
      </div>
    )
  }

  // Build long-form: { day: 'YYYY-MM-DD', [ad_label]: ctr_pct }
  const dayMap = new Map<string, Record<string, number | string>>()
  tracked.forEach((a, i) => {
    const label = a.headline_text ? a.headline_text.slice(0, 24) : `Ad ${i + 1}`
    for (const h of a.ctr_history) {
      if (h.ctr_pct == null) continue
      const day = h.recorded_at.slice(0, 10)
      const row = dayMap.get(day) ?? { day }
      row[label] = h.ctr_pct
      dayMap.set(day, row)
    }
  })
  const data = Array.from(dayMap.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)))
  const labels = tracked.map((a, i) => a.headline_text ? a.headline_text.slice(0, 24) : `Ad ${i + 1}`)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-white mb-1">CTR over time (fatigue)</h3>
      <p className="text-[10px] text-gray-500 mb-3">Lines that bend downward = decaying creative. Flag = iterate.</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#9ca3af' }} stroke="#374151" />
          <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} stroke="#374151" tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          {labels.map((label, i) => (
            <Line key={label} type="monotone" dataKey={label} stroke={STROKES[i % STROKES.length]} strokeWidth={1.5} dot={{ r: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
