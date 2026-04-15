'use client'

import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Upload, Video, X } from 'lucide-react'

const MAX_DURATION_SEC = 60
const MAX_SIZE_MB = 200
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

interface Props {
  token: string
  userId: string
  onAnalysisStarted: (analysisId: string) => void
  disabled?: boolean
}

export function VideoUploader({ token, userId, onAnalysisStarted, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [, setUploadProgress] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'validating' | 'uploading' | 'dispatching' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFile = useCallback((file: File): Promise<string | null> => {
    return new Promise(resolve => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        resolve('Only MP4, MOV, and WebM files are supported.')
        return
      }
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        resolve(`File is too large. Maximum size is ${MAX_SIZE_MB}MB.`)
        return
      }

      // Check duration via a hidden video element
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        if (video.duration > MAX_DURATION_SEC) {
          resolve(`Video is ${Math.round(video.duration)}s long. Maximum is ${MAX_DURATION_SEC} seconds.`)
        } else {
          resolve(null)
        }
      }
      video.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null) // Let server handle if metadata unreadable
      }
      video.src = url
    })
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setValidationError(null)
    setErrorMsg(null)
    setStatus('validating')
    setSelectedFile(file)

    const err = await validateFile(file)
    if (err) {
      setValidationError(err)
      setStatus('idle')
      return
    }

    setStatus('uploading')
    setUploadProgress(0)

    // Upload directly to Supabase Storage from the client — bypasses Vercel body size limit
    const storageKey = `${userId}/${crypto.randomUUID()}.${file.name.split('.').pop()}`

    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(storageKey, file, { cacheControl: '3600', upsert: false })

    if (uploadError) {
      setStatus('error')
      setErrorMsg(`Upload failed: ${uploadError.message}`)
      return
    }

    setUploadProgress(100)
    setStatus('dispatching')

    // Fire the analysis
    const res = await fetch('/api/analyze/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storage_key: storageKey }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setStatus('error')
      setErrorMsg(data.error ?? 'Failed to start analysis.')
      return
    }

    const { analysis_id } = await res.json()
    onAnalysisStarted(analysis_id)
  }, [token, userId, validateFile, onAnalysisStarted])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = '' // reset so same file can be reselected
  }, [handleFile])

  const reset = () => {
    setSelectedFile(null)
    setValidationError(null)
    setUploadProgress(null)
    setStatus('idle')
    setErrorMsg(null)
  }

  const isLoading = status === 'validating' || status === 'uploading' || status === 'dispatching'

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !isLoading && !disabled && fileInputRef.current?.click()}
        className={[
          'relative border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer',
          dragOver ? 'border-indigo-500 bg-indigo-950/20' : 'border-gray-700 hover:border-gray-600',
          (isLoading || disabled) ? 'opacity-60 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={onInputChange}
          disabled={isLoading || disabled}
        />

        <div className="flex flex-col items-center gap-3">
          {status === 'idle' && !selectedFile && (
            <>
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
                <Upload className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm text-gray-300 font-medium">Drop a video or click to browse</p>
                <p className="text-xs text-gray-600 mt-1">MP4 · MOV · WebM · max {MAX_DURATION_SEC}s · max {MAX_SIZE_MB}MB</p>
              </div>
            </>
          )}

          {selectedFile && !validationError && (
            <div className="flex items-center gap-3 w-full max-w-sm">
              <Video className="w-5 h-5 text-indigo-400 shrink-0" />
              <p className="text-sm text-gray-300 truncate flex-1">{selectedFile.name}</p>
              {!isLoading && (
                <button
                  onClick={e => { e.stopPropagation(); reset() }}
                  className="text-gray-600 hover:text-gray-400"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Upload progress */}
          {status === 'uploading' && (
            <div className="w-full max-w-sm space-y-1.5">
              <p className="text-xs text-gray-500 animate-pulse">Uploading…</p>
              <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-1.5 rounded-full animate-pulse w-2/3" />
              </div>
            </div>
          )}

          {status === 'dispatching' && (
            <p className="text-sm text-indigo-400 animate-pulse">Starting analysis…</p>
          )}
        </div>
      </div>

      {/* Validation / error messages */}
      {validationError && (
        <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{validationError}</span>
        </div>
      )}
      {status === 'error' && errorMsg && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg px-4 py-3">
          <span className="shrink-0 mt-0.5">✕</span>
          <div className="flex-1">
            <span>{errorMsg}</span>
            <button onClick={reset} className="block text-xs text-red-500 hover:text-red-300 mt-1 underline">
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
