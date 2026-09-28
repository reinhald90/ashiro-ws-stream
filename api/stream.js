/* ==========================================================
   🎧 Ashiro HTTP Stream Relay (Vercel Edge Runtime)
   Endpoint HTTP GET yang stream audio langsung ke client.
   Tidak butuh WebSocket → bypass CSP WhatsApp WebView.
   ========================================================== */

export const config = { runtime: 'edge' }

export default async function handler(req) {
  const url = new URL(req.url)
  const audioUrl = url.searchParams.get('url')

  // CORS preflight
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

  // Validasi
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

  let upstream
  try {
    upstream = await fetch(audioUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'audio/*,video/*,*/*;q=0.9',
        'Accept-Encoding': 'identity',
        'Referer': 'https://www.youtube.com/',
        'Range': req.headers.get('range') || 'bytes=0-'
      },
      redirect: 'follow'
    })
  } catch (e) {
    console.error('[Stream] Fetch error:', e.message)
    return new Response(JSON.stringify({
      status: false,
      message: 'Upstream fetch failed: ' + e.message
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  // Kalau upstream gagal, coba tanpa Range header
  if (!upstream.ok && upstream.status !== 206) {
    console.log('[Stream] Retry tanpa Range (status ' + upstream.status + ')')
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
      console.error('[Stream] Retry error:', e.message)
    }
  }

  if (!upstream.ok && upstream.status !== 206) {
    console.error('[Stream] Upstream failed:', upstream.status)
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

  // Forward headers penting
  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Cache-Control', 'public, max-age=3600')

  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)

  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)

  console.log('[Stream] OK:', upstream.status, contentLength || 'unknown', 'bytes')

  // Stream body langsung ke client
  return new Response(upstream.body, {
    status: upstream.status,
    headers
  })
}
