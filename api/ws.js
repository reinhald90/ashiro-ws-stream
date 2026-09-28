import http from 'http';
import https from 'https';
import { WebSocketServer } from 'ws';
import { URL } from 'url';

/* ==========================================================
   🎧 Ashiro WebSocket Stream Server (Vercel Compatible)
   Menerima koneksi WS dengan parameter ?url=<audio_url>
   dan streaming audio dari URL tersebut ke client.
   ========================================================== */

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 120000; // 2 menit, aman di bawah batas Vercel

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: true,
      message: 'Ashiro WebSocket Stream Server (Vercel)',
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const audioUrl = url.searchParams.get('url');

  if (!audioUrl || !audioUrl.startsWith('http')) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing or invalid ?url= parameter' }));
      ws.close(1008, 'Invalid URL');
    }
    return;
  }

  console.log(`[WS] Streaming: ${audioUrl.slice(0, 100)}`);

  let aborted = false;
  let upstreamReq = null;

  const cleanup = () => {
    aborted = true;
    if (upstreamReq) {
      try { upstreamReq.destroy(); } catch {}
    }
  };

  ws.on('close', () => {
    console.log('[WS] Client disconnected.');
    cleanup();
  });

  ws.on('error', (e) => {
    console.error('[WS] Client error:', e.message);
    cleanup();
  });

  try {
    await streamAudio(audioUrl, ws, () => aborted);
  } catch (e) {
    console.error('[WS] Stream error:', e.message);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
      ws.close(1011, 'Stream error');
    }
    cleanup();
  }
});

async function streamAudio(audioUrl, ws, isAborted, redirects = 0) {
  if (isAborted()) return;
  if (redirects > MAX_REDIRECTS) throw new Error('Too many redirects');

  return new Promise((resolve, reject) => {
    const client = audioUrl.startsWith('https') ? https : http;
    let req;

    try {
      req = client.get(audioUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'audio/*,*/*;q=0.9',
          'Accept-Encoding': 'identity',
          'Range': 'bytes=0-'
        },
        timeout: TIMEOUT_MS
      }, async (res) => {
        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const nextUrl = new URL(res.headers.location, audioUrl).toString();
          console.log(`[WS] Redirect (${res.statusCode}) → ${nextUrl.slice(0, 80)}`);
          res.resume();
          try {
            const result = await streamAudio(nextUrl, ws, isAborted, redirects + 1);
            resolve(result);
          } catch (e) { reject(e); }
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 400) {
          res.resume();
          reject(new Error(`Upstream HTTP ${res.statusCode}`));
          return;
        }

        const contentType = res.headers['content-type'] || 'audio/mpeg';
        const contentLength = res.headers['content-length'];
        console.log(`[WS] Upstream OK: ${contentType} | ${contentLength || 'unknown'} bytes`);

        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: 'start',
            mime: contentType,
            contentLength: contentLength ? Number(contentLength) : null
          }));
        }

        let bytes = 0;
        res.on('data', (chunk) => {
          if (isAborted() || ws.readyState !== ws.OPEN) {
            res.destroy();
            return;
          }
          try {
            ws.send(chunk, { binary: true });
            bytes += chunk.length;
          } catch (e) {
            console.error('[WS] Send error:', e.message);
            res.destroy();
          }
        });

        res.on('end', () => {
          if (isAborted()) { resolve(); return; }
          console.log(`[WS] Finished: ${(bytes / 1024).toFixed(1)} KB`);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'end' }));
            ws.close(1000, 'Complete');
          }
          resolve();
        });

        res.on('error', (e) => {
          console.error('[WS] Upstream error:', e.message);
          reject(e);
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Upstream timeout'));
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Wajib: export server HTTP untuk Vercel
export default server;
