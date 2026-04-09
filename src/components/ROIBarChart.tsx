'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { ROIRegion } from '@/types'

interface Props {
  roiData: ROIRegion[]
}

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as ROIRegion
  return (
    <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg text-xs max-w-xs shadow-lg">
      <p className="text-white font-medium mb-1">{d.label}</p>
      <p className="text-gray-400 leading-relaxed">{d.description}</p>
      <p className="text-gray-300 mt-2">
        Activation:{' '}
        <span className="text-white font-mono">{d.activation.toFixed(3)}</span>
      </p>
    </div>
  )
}

export function ROIBarChart({ roiData }: Props) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-300 mb-3">Brain Region Activation</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={roiData}
          layout="vertical"
          margin={{ top: 0, right: 20, bottom: 0, left: 140 }}
        >
          <XAxis
            type="number"
            domain={[0, 1]}
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={135}
            tick={{ fill: '#d1d5db', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="activation" fill="#6366f1" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-600 mt-2">
        Values are raw model outputs. Higher means stronger predicted neural response in that
        region. No value is inherently better or worse.
      </p>
    </div>
  )
}
