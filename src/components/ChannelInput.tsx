'use client'

import { useState } from 'react'
import { Video } from 'lucide-react'

interface Props {
  onSubmit: (handle: string, count: number) => void
  disabled?: boolean
}

export function ChannelInput({ onSubmit, disabled }: Props) {
  const [handle, setHandle] = useState('')
  const [count, setCount] = useState(5)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleaned = handle.trim().replace(/^@/, '')
    if (!cleaned) return
    onSubmit(cleaned, count)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg
                      focus-within:border-indigo-500 transition-colors">
        <Video className="w-4 h-4 text-gray-500 shrink-0" />
        <input
          type="text"
          placeholder="@channelhandle or channel ID"
          value={handle}
          onChange={e => setHandle(e.target.value)}
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500 whitespace-nowrap">Thumbnails to analyze:</label>
        <input
          type="range"
          min={1}
          max={10}
          value={count}
          onChange={e => setCount(parseInt(e.target.value, 10))}
          disabled={disabled}
          className="flex-1 accent-indigo-500"
        />
        <span className="text-sm text-white font-mono w-4">{count}</span>
      </div>

      <p className="text-xs text-gray-600">
        Counts as {count} {count === 1 ? 'analysis' : 'analyses'} toward your daily and monthly limits.
      </p>

      <button
        type="submit"
        disabled={disabled || !handle.trim()}
        className="py-2 px-4 bg-indigo-600 text-white text-sm rounded-lg font-medium
                   disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
      >
        Analyze Channel
      </button>
    </form>
  )
}
