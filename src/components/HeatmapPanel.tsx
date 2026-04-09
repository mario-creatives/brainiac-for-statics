'use client'

import Image from 'next/image'

interface Props {
  heatmapUrl: string
  originalAlt?: string
}

export function HeatmapPanel({ heatmapUrl, originalAlt = 'Creative analysis heatmap' }: Props) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-300 mb-3">Neural Activation Heatmap</h3>
      <div className="relative rounded-lg overflow-hidden border border-gray-800 bg-gray-900">
        <Image
          src={heatmapUrl}
          alt={originalAlt}
          width={640}
          height={360}
          className="w-full h-auto object-contain"
          unoptimized // heatmap PNGs are served from Supabase Storage, not Next.js image CDN
        />
      </div>
      <p className="text-xs text-gray-600 mt-2">
        Viridis colormap overlay showing predicted neural activation intensity across image
        regions. Purple = lower activation, yellow = higher activation.
      </p>
    </div>
  )
}
