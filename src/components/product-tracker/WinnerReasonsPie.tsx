'use client'

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts'
import type { ProductAdRow } from '@/app/api/products/[id]/dashboard/route'

interface Props {
  ads: ProductAdRow[]
}

const COLORS = ['#818cf8', '#34d399', '#fbbf24', '#60a5fa', '#f472b6', '#a78bfa']

export function WinnerReasonsPie({ ads }: Props) {
  const winners = ads.filter(a => a.effective_quadrant === 'winner' || a.effective_quadrant === 'promising')

  // Use composition_tag (already extracted from comprehensive_analysis in the dashboard route)
  // as the categorical signal for "what pattern drives this winner".
  const counts = new Map<string, number>()
  for (const ad of winners) {
    const key = ad.composition_tag
      ? capitalize(ad.composition_tag.replace(/_/g, ' '))
      : 'Unanalysed'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const data = Array.from(counts.entries()).map(([name, value]) => ({ name, value }))

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-white mb-1">Most common winner patterns</h3>
      <p className="text-[10px] text-gray-500 mb-3">Composition patterns driving winner and promising ads in this product.</p>
      {data.length === 0 ? (
        <p className="text-[10px] text-gray-600 py-8 text-center">No winners or promising ads yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} innerRadius={40}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
