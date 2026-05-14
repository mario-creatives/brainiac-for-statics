'use client'

import { Plus, Boxes } from 'lucide-react'
import type { ProductRow } from '@/app/api/products/route'

interface Props {
  products: ProductRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  loading: boolean
}

export function ProductSidebar({ products, selectedId, onSelect, onNew, loading }: Props) {
  return (
    <aside className="w-64 shrink-0 border-r border-gray-800 bg-gray-950 min-h-[calc(100vh-65px)]">
      <div className="p-4 border-b border-gray-800">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New product
        </button>
      </div>

      <div className="p-2 space-y-0.5 max-h-[calc(100vh-150px)] overflow-y-auto">
        {loading && <p className="text-[10px] text-gray-500 px-3 py-2 animate-pulse-soft">Loading…</p>}
        {!loading && products.length === 0 && (
          <p className="text-[10px] text-gray-500 px-3 py-4 leading-relaxed">
            No products yet. Click <span className="text-gray-300">New product</span> to start tracking one.
          </p>
        )}
        {products.map(p => {
          const active = p.id === selectedId
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
              }`}
            >
              <Boxes className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-indigo-400' : 'text-gray-600'}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs truncate">{p.name}</span>
                <span className="block text-[9px] text-gray-600">
                  {p.ad_count} ad{p.ad_count !== 1 ? 's' : ''}
                  {p.vertical_category && ` · ${p.vertical_category.replace(/_/g, ' ')}`}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
