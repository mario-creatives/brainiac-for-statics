// Supabase Storage wrapper — replaces Cloudflare R2 from the original spec.
// Buckets: 'creatives' (private), 'heatmaps' (public)

import { supabaseServer } from '@/lib/supabase-server'

const CREATIVES_BUCKET = 'creatives'
const HEATMAPS_BUCKET = 'heatmaps'

export async function uploadCreative(
  fileBuffer: Buffer,
  analysisId: string,
  mimeType: string
): Promise<string> {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg'
  const path = `${analysisId}.${ext}`

  const { error } = await supabaseServer.storage
    .from(CREATIVES_BUCKET)
    .upload(path, fileBuffer, { contentType: mimeType, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return path
}

export async function getCreativeSignedUrl(
  storageKey: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabaseServer.storage
    .from(CREATIVES_BUCKET)
    .createSignedUrl(storageKey, expiresInSeconds)

  if (error || !data) throw new Error(`Failed to create signed URL: ${error?.message}`)
  return data.signedUrl
}

export async function getCreativeBytes(storageKey: string): Promise<Buffer> {
  const { data, error } = await supabaseServer.storage
    .from(CREATIVES_BUCKET)
    .download(storageKey)

  if (error || !data) throw new Error(`Failed to download creative: ${error?.message}`)
  return Buffer.from(await data.arrayBuffer())
}

export function getHeatmapPublicUrl(storageKey: string): string {
  const { data } = supabaseServer.storage
    .from(HEATMAPS_BUCKET)
    .getPublicUrl(storageKey)
  return data.publicUrl
}

export async function deleteUserFiles(userId: string): Promise<void> {
  // List and delete all creatives for the user (stored with analysisId prefix, linked via DB)
  // Deletion is handled at the analyses level — storage keys are in the analyses table.
  // This function is called during account deletion after the DB rows are purged.
  const { data: files } = await supabaseServer.storage
    .from(CREATIVES_BUCKET)
    .list(userId)

  if (files && files.length > 0) {
    const paths = files.map(f => `${userId}/${f.name}`)
    await supabaseServer.storage.from(CREATIVES_BUCKET).remove(paths)
  }
}
