/* ==========================================================
   🎧 Ashiro HTTP Stream Relay (Vercel Edge Runtime)
   Endpoint HTTP GET yang stream audio langsung ke client.
   Force Content-Type: application/octet-stream agar bypass
   CSP `media-src` WhatsApp WebView.
   ========================================================== */

export const config = { runtime: 'edge' }

export default async function handler(req) {
  const url = new URL(req.url)
  const audioUrl = url.searchParams.get('url')

  /* ---------- CORS Preflight ---------- */
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      }
    })
  }

  /* ---------- Validasi Parameter ---------- */
  if (!audioUrl || !audioUrl.startsWith('http')) {
    return new Response(JSON.stringify({
      status: false,
      message: 'Missing or invalid ?url= parameter'
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  console.log('[Stream] Fetching:', audioUrl.slice(0, 100))

  /* ---------- Fetch Upstream (Attempt 1: dengan Range) ---------- */
  let upstream
  let attempt = 1

  try {
    upstream = await fetch(audioUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'audio/*,video/*,*/*;q=0.9',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.youtube.com/',
        'Range': req.headers.get('range') || 'bytes=0-'
      },
      redirect: 'follow'
    })
  } catch (e) {
    console.error('[Stream] Attempt 1 error:', e.message)
    upstream = null
  }

  /* ---------- Fetch Upstream (Attempt 2: tanpa Range) ---------- */
  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    attempt = 2
    console.log('[Stream] Attempt 2 (no Range) — status sebelumnya:', upstream ? upstream.status : 'null')
    try {
      upstream = await fetch(audioUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'audio/*,*/*;q=0.9',
          'Accept-Encoding': 'identity'
        },
        redirect: 'follow'
      })
    } catch (e) {
      console.error('[Stream] Attempt 2 error:', e.message)
      upstream = null
    }
  }

  /* ---------- Fetch Upstream (Attempt 3: tanpa header sama sekali) ---------- */
  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    attempt = 3
    console.log('[Stream] Attempt 3 (minimal) — status sebelumnya:', upstream ? upstream.status : 'null')
    try {
      upstream = await fetch(audioUrl, {
        method: 'GET',
        redirect: 'follow'
      })
    } catch (e) {
      console.error('[Stream] Attempt 3 error:', e.message)
      upstream = null
    }
  }

  /* ---------- Semua Attempt Gagal ---------- */
  if (!upstream) {
    return new Response(JSON.stringify({
      status: false,
      message: 'All fetch attempts failed'
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  /* ---------- Upstream Return Error ---------- */
  if (!upstream.ok && upstream.status !== 206) {
    console.error('[Stream] Upstream failed:', upstream.status, 'after', attempt, 'attempts')
    return new Response(JSON.stringify({
      status: false,
      message: 'Upstream HTTP ' + upstream.status
    }), {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  /* ---------- Bangun Response Headers ----------
     PENTING: Force `application/octet-stream` supaya WhatsApp WebView
     tidak klasifikasikan sebagai media → bypass CSP `media-src`.
     Audio tetap bisa diputar setelah di-fetch → blob → play. */
  const headers = new Headers()
  headers.set('Content-Type', 'application/octet-stream')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type')
  headers.set('Cache-Control', 'public, max-age=3600')
  headers.set('X-Stream-Attempt', String(attempt))
  headers.set('X-Upstream-Content-Type', upstream.headers.get('content-type') || 'unknown')

  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)

  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)

  console.log('[Stream] OK attempt', attempt, '|', upstream.status, '|', contentLength || 'unknown', 'bytes')

  /* ---------- Stream Response Body ---------- */
  return new Response(upstream.body, {
    status: upstream.status,
    headers
  })
}
