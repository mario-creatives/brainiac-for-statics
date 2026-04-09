'use client'

import type { UsageInfo } from '@/types'

interface Props {
  usage: UsageInfo
}

export function UsageMeter({ usage }: Props) {
  const dailyPct = Math.min(100, (usage.daily_used / usage.daily_limit) * 100)
  const monthlyPct = Math.min(100, (usage.monthly_used / usage.monthly_limit) * 100)

  return (
    <div className="flex gap-6 text-sm text-gray-400">
      <div className="flex flex-col gap-0.5">
        <div>
          <span className="text-white font-mono">{usage.daily_used}</span>
          <span className="text-gray-500">/{usage.daily_limit}</span>
          <span className="ml-1">today</span>
        </div>
        <div className="h-1 w-20 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${dailyPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <div>
          <span className="text-white font-mono">{usage.monthly_used}</span>
          <span className="text-gray-500">/{usage.monthly_limit}</span>
          <span className="ml-1">this month</span>
        </div>
        <div className="h-1 w-20 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${monthlyPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
