'use client'

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'

interface Props {
  ads: ProductAdRow[]
}

export function FormatBreakdownBar({ ads }: Props) {
  // Tally winners vs losers per ad_format.type
  const tally = new Map<string, { winners: number; losers: number }>()
  for (const a of ads) {
    if (!a.ad_format || !a.effective_quadrant) continue
    const cur = tally.get(a.ad_format) ?? { winners: 0, losers: 0 }
    if (a.effective_quadrant === 'winner' || a.effective_quadrant === 'promising') cur.winners += 1
    else cur.losers += 1
    tally.set(a.ad_format, cur)
  }
  const data = Array.from(tally.entries())
    .map(([format, c]) => ({ format, winners: c.winners, losers: c.losers }))
    .sort((a, b) => (b.winners + b.losers) - (a.winners + a.losers))

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-white mb-1">Winners vs losers by ad format</h3>
      <p className="text-[10px] text-gray-500 mb-3">Which formats consistently produce winners.</p>
      {data.length === 0 ? (
        <p className="text-[10px] text-gray-600 py-8 text-center">No format data yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="format" tick={{ fontSize: 9, fill: '#9ca3af' }} stroke="#374151" />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} stroke="#374151" />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <Bar dataKey="winners" stackId="a" fill="#34d399" />
            <Bar dataKey="losers" stackId="a" fill="#ff2a2b" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
