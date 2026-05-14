'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { LogOut, ArrowLeft, RefreshCw, BarChart3, Sparkles, Boxes } from 'lucide-react'
import { AttributionFooter } from '@/components/AttributionFooter'
import { ProductSidebar } from '@/components/product-tracker/ProductSidebar'
import { NewProductModal } from '@/components/product-tracker/NewProductModal'
import { ProductDashboard } from '@/components/product-tracker/ProductDashboard'
import type { ProductRow } from '@/app/api/products/route'

export default function ProductTrackerPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const loadProducts = useCallback(async (authToken: string) => {
    setLoading(true)
    try {
      const res = await fetch('/api/products', { headers: { Authorization: `Bearer ${authToken}` } })
      if (res.ok) {
        const data = await res.json()
        setProducts(data.products ?? [])
        // auto-select first product if nothing selected yet
        setSelectedId(prev => prev ?? data.products?.[0]?.id ?? null)
      }
    } catch { /* non-fatal */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/auth/login'); return }
      setToken(session.access_token)
      loadProducts(session.access_token)
    })
  }, [router, loadProducts])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  function handleCreated(productId: string) {
    setShowNew(false)
    if (token) loadProducts(token)
    setSelectedId(productId)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-30 bg-gray-950/85 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-[#ff2a2b]">Adforge</span>
          <span className="text-xs text-gray-500 hidden sm:block">Product Tracker</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Analyze ads
          </Link>
          <Link href="/dashboard/historical-analysis" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <BarChart3 className="w-3.5 h-3.5" />
            Historical analysis
          </Link>
          <Link href="/dashboard/copy-intelligence" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <Sparkles className="w-3.5 h-3.5" />
            Copy Intelligence
          </Link>
          <button
            onClick={() => window.location.reload()}
            aria-label="Refresh page"
            title="Refresh page"
            className="text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleSignOut} aria-label="Sign out" className="text-gray-400 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex">
        <ProductSidebar
          products={products}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={() => setShowNew(true)}
          loading={loading}
        />

        <main className="flex-1 min-w-0">
          {selectedId && token ? (
            <ProductDashboard
              productId={selectedId}
              token={token}
              onProductChanged={() => token && loadProducts(token)}
            />
          ) : (
            <EmptyState onNew={() => setShowNew(true)} />
          )}
          <div className="p-6">
            <AttributionFooter />
          </div>
        </main>
      </div>

      {showNew && token && (
        <NewProductModal token={token} onClose={() => setShowNew(false)} onCreated={handleCreated} />
      )}
    </div>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="p-12 flex flex-col items-center justify-center text-center max-w-md mx-auto">
      <Boxes className="w-10 h-10 text-gray-700 mb-4" />
      <h1 className="text-xl font-bold text-white">Track ads per product</h1>
      <p className="text-sm text-gray-400 mt-2 leading-relaxed">
        Create a product, set its target CPA, then add the ads you&apos;ve run for it. The tracker
        classifies each ad into winner / promising / investigate / loser and synthesizes the next
        action plan from your data.
      </p>
      <button
        onClick={onNew}
        className="mt-6 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
      >
        + Create your first product
      </button>
    </div>
  )
}
