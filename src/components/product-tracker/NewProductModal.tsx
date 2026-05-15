'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

const VERTICAL_OPTIONS = [
  '', 'health', 'beauty_skincare', 'apparel', 'food_beverage', 'home_lifestyle',
  'fitness', 'supplements', 'pet', 'accessories', 'wellness', 'other',
]

interface Props {
  token: string
  onClose: () => void
  onCreated: (productId: string) => void
}

export function NewProductModal({ token, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [vertical, setVertical] = useState('')
  const [targetCpa, setTargetCpa] = useState('')
  const [winnerThreshold, setWinnerThreshold] = useState('1000')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          vertical_category: vertical || null,
          target_cpa_usd: targetCpa ? Number(targetCpa) : null,
          winner_spend_threshold_usd: winnerThreshold ? Number(winnerThreshold) : 1000,
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create product')
      } else {
        onCreated(data.product.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">New product</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">Product name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Beam Sleep"
              required
              className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">Niche / category</label>
            <select
              value={vertical}
              onChange={e => setVertical(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-600 focus:outline-none"
            >
              {VERTICAL_OPTIONS.map(v => (
                <option key={v} value={v}>{v === '' ? '— select —' : v.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">Target CPA (USD)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={targetCpa}
              onChange={e => setTargetCpa(e.target.value)}
              placeholder="e.g. 30.00"
              className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-600 focus:outline-none"
            />
            <p className="text-[10px] text-gray-600 mt-1">Ads with CPA ≤ target hit the winner / promising side of the quadrant.</p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">Winner spend threshold (USD)</label>
            <input
              type="number"
              step="100"
              min="100"
              value={winnerThreshold}
              onChange={e => setWinnerThreshold(e.target.value)}
              placeholder="1000"
              className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-600 focus:outline-none"
            />
            <p className="text-[10px] text-gray-600 mt-1">Spend at which an ad on-target becomes a confirmed winner. Default $1,000. Raise for high-margin products, lower for tight tests.</p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-[#ff2a2b]">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-white px-3 py-1.5">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {saving ? 'Creating…' : 'Create product'}
          </button>
        </div>
      </form>
    </div>
  )
}
