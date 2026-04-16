'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Clock, ChevronRight } from 'lucide-react'

interface HistoryEntry {
  id: string
  created_at: string
  heatmap_url: string | null
  roi_data: Array<{ region_key: string; label: string; activation: number }> | null
}

interface Props {
  userId: string
  onSelect: (analysisId: string) => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function VideoHistory({ userId, onSelect }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('analyses')
      .select('id, created_at, heatmap_url, roi_data')
      .eq('user_id', userId)
      .eq('type', 'ad_creative')
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setEntries((data as HistoryEntry[]) ?? [])
        setLoading(false)
      })
  }, [userId])

  if (loading) return null
  if (entries.length === 0) return null

  return (
    <div className="pt-4 border-t border-gray-800 space-y-2">
      <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
        <Clock className="w-3 h-3" />
        Previous reports
      </p>
      <div className="space-y-1.5">
        {entries.map(entry => {
          const topRoi = entry.roi_data
            ?.slice()
            .sort((a, b) => b.activation - a.activation)[0]

          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-800/50 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 transition-colors text-left group"
            >
              {/* Heatmap thumbnail */}
              <div className="w-12 h-8 rounded overflow-hidden bg-gray-700 shrink-0">
                {entry.heatmap_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entry.heatmap_url}
                    alt="heatmap"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-700" />
                )}
              </div>

              {/* Meta */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs text-gray-300 truncate">
                  {topRoi
                    ? `Top: ${topRoi.label} (${(topRoi.activation * 100).toFixed(0)}%)`
                    : 'Video analysis'}
                </p>
                <p className="text-[10px] text-gray-600">{timeAgo(entry.created_at)}</p>
              </div>

              <ChevronRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
