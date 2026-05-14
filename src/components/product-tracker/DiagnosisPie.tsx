'use client'

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts'
import type { ProductRecommendationReport } from '@/app/api/products/[id]/recommendations/route'

interface Props {
  report: ProductRecommendationReport | null
}

const COLORS = ['#ff2a2b', '#fbbf24', '#f472b6', '#a78bfa', '#60a5fa', '#10b981']

export function DiagnosisPie({ report }: Props) {
  // Bucket per-ad failure_reason strings — only ads with one set.
  const counts = new Map<string, number>()
  for (const ad of report?.per_ad_recommendations ?? []) {
    if (!ad.failure_reason) continue
    const key = shorten(ad.failure_reason)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const data = Array.from(counts.entries()).map(([reason, value]) => ({ name: reason, value }))

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-white mb-1">Most common failure reasons</h3>
      <p className="text-[10px] text-gray-500 mb-3">Across all losers + investigate-bucket ads in this product.</p>
      {data.length === 0 ? (
        <p className="text-[10px] text-gray-600 py-8 text-center">Generate an action plan to populate this chart.</p>
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

// Failure reasons are sentences; collapse to the first 4 words so the legend
// is readable. Sentences with identical openings get the same bucket.
function shorten(reason: string): string {
  const words = reason.trim().split(/\s+/).slice(0, 4).join(' ')
  return words.replace(/[.,;:]$/, '')
}
