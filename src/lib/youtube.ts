// YouTube RSS thumbnail fetcher — no API key required for thumbnail URLs.
// View count enrichment (optional) requires YOUTUBE_DATA_API_KEY.

export interface YTVideoMeta {
  video_id: string
  title: string
  published: string
}

export async function fetchChannelThumbnails(
  channelHandle: string,
  count: number
): Promise<Array<YTVideoMeta & { thumbnail_bytes: Buffer }>> {
  const channelId = await resolveChannelId(channelHandle)
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

  const feedRes = await fetch(feedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Brainiac/1.0)' },
  })
  if (!feedRes.ok) throw new Error(`YouTube feed fetch failed: ${feedRes.status}`)

  const xml = await feedRes.text()
  const videos = parseYouTubeFeed(xml, count)

  const results: Array<YTVideoMeta & { thumbnail_bytes: Buffer }> = []

  for (const video of videos) {
    try {
      const thumbnail_bytes = await fetchThumbnailBytes(video.video_id)
      results.push({ ...video, thumbnail_bytes })
    } catch {
      // Skip videos where thumbnail fetch fails
      continue
    }
  }

  return results
}

async function resolveChannelId(handle: string): Promise<string> {
  // If it looks like a raw channel ID already (starts with UC, 24 chars), use it directly.
  const cleaned = handle.replace(/^@/, '')
  if (/^UC[\w-]{22}$/.test(cleaned)) return cleaned

  // Fetch the channel page and extract the canonical channel ID from the RSS link
  const url = `https://www.youtube.com/@${cleaned}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Brainiac/1.0)' },
  })
  if (!res.ok) throw new Error(`Could not fetch YouTube channel page: ${res.status}`)

  const html = await res.text()
  const match = html.match(/"channelId":"(UC[\w-]{22})"/)
  if (!match) throw new Error(`Could not extract channel ID for @${cleaned}`)
  return match[1]
}

function parseYouTubeFeed(xml: string, count: number): YTVideoMeta[] {
  const entries: YTVideoMeta[] = []

  // Simple regex-based RSS parser — no xml2js needed
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let match: RegExpExecArray | null

  while ((match = entryRegex.exec(xml)) !== null && entries.length < count) {
    const entry = match[1]
    const videoIdMatch = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)
    const titleMatch = entry.match(/<title>(.*?)<\/title>/)
    const publishedMatch = entry.match(/<published>(.*?)<\/published>/)

    if (videoIdMatch && titleMatch) {
      entries.push({
        video_id: videoIdMatch[1],
        title: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        published: publishedMatch?.[1] ?? '',
      })
    }
  }

  return entries
}

async function fetchThumbnailBytes(videoId: string): Promise<Buffer> {
  const urls = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  ]

  for (const url of urls) {
    const res = await fetch(url)
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > 5000) return buf
    }
  }

  throw new Error(`No thumbnail found for video ${videoId}`)
}
