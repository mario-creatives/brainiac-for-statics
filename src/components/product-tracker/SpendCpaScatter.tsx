'use client'

import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'
import type { Quadrant } from '@/lib/quadrant'

const COLOR: Record<Quadrant, string> = {
  winner: '#34d399',
  promising: '#a78bfa',
  investigate: '#fbbf24',
  loser: '#ff2a2b',
}

interface Props {
  ads: ProductAdRow[]
  targetCpa: number | null
}

export function SpendCpaScatter({ ads, targetCpa }: Props) {
  // Group by quadrant for distinct Scatter series with different colors
  const groups: Record<Quadrant, { spend: number; cpa: number; headline: string }[]> = {
    winner: [], promising: [], investigate: [], loser: [],
  }
  for (const a of ads) {
    if (a.spend_usd == null || a.cpa_usd == null || a.effective_quadrant == null) continue
    groups[a.effective_quadrant].push({
      spend: a.spend_usd,
      cpa: a.cpa_usd,
      headline: a.headline_text ?? 'Untitled',
    })
  }

  const allPlotted = (['winner','promising','investigate','loser'] as Quadrant[]).reduce((n, q) => n + groups[q].length, 0)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-white mb-1">Spend vs CPA</h3>
      <p className="text-[10px] text-gray-500 mb-3">Each dot is an ad. Color = quadrant. Reference line = target CPA.</p>
      {allPlotted === 0 ? (
        <p className="text-[10px] text-gray-600 py-8 text-center">Enter spend and CPA on ads to populate this chart.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ScatterChart margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis
              type="number" dataKey="spend" name="Spend (USD)"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickFormatter={v => `$${v}`}
              stroke="#374151"
            />
            <YAxis
              type="number" dataKey="cpa" name="CPA (USD)"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickFormatter={v => `$${v}`}
              stroke="#374151"
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }}
              formatter={(value: number | string, name: string) => [`${value}`, name]}
              labelFormatter={() => ''}
            />
            {targetCpa != null && (
              <ReferenceLine y={targetCpa} stroke="#a78bfa" strokeDasharray="4 4" label={{ value: `target $${targetCpa}`, fill: '#a78bfa', fontSize: 9 }} />
            )}
            {(['winner','promising','investigate','loser'] as Quadrant[]).map(q => (
              <Scatter key={q} name={q} data={groups[q]} fill={COLOR[q]} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
