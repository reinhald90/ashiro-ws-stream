import http from 'http';
import https from 'https';
import { WebSocketServer } from 'ws';
import { URL } from 'url';

/* ==========================================================
   🎧 Ashiro WebSocket Stream Server (Vercel Compatible) v2
   ========================================================== */

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 120000;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/' || url.pathname === '/health' || url.pathname.startsWith('/api/ws')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: true,
      message: 'Ashiro WebSocket Stream Server v2'
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

  console.log(`[WS] Streaming: ${audioUrl.slice(0, 120)}`);

  let aborted = false;
  let upstreamReq = null;

  const cleanup = () => {
    aborted = true;
    if (upstreamReq) {
      try { upstreamReq.destroy(); } catch {}
    }
  };

  ws.on('close', () => { console.log('[WS] Client disconnected.'); cleanup(); });
  ws.on('error', (e) => { console.error('[WS] Client error:', e.message); cleanup(); });

  try {
    await streamWithRetry(audioUrl, ws, () => aborted, (r) => { upstreamReq = r; });
  } catch (e) {
    console.error('[WS] Stream error:', e.message);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
      ws.close(1011, 'Stream error');
    }
    cleanup();
  }
});

async function streamWithRetry(audioUrl, ws, isAborted, setReq) {
  const attempts = [
    { headers: { 'Range': 'bytes=0-' }, label: 'Range' },
    { headers: {}, label: 'Plain' }
  ];

  let lastError = null;

  for (const attempt of attempts) {
    if (isAborted()) return;
    try {
      console.log(`[WS] Attempt (${attempt.label}): ${audioUrl.slice(0, 80)}`);
      await streamAudio(audioUrl, ws, isAborted, 0, attempt.headers, setReq);
      return;
    } catch (e) {
      lastError = e;
      console.log(`[WS] Attempt (${attempt.label}) gagal: ${e.message}`);
      if (!/Upstream HTTP/.test(e.message)) break;
    }
  }

  throw lastError || new Error('All attempts failed');
}

async function streamAudio(audioUrl, ws, isAborted, redirects, extraHeaders, setReq) {
  if (isAborted()) return;
  if (redirects > MAX_REDIRECTS) throw new Error('Too many redirects');

  return new Promise((resolve, reject) => {
    const client = audioUrl.startsWith('https') ? https : http;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'audio/*,video/*,*/*;q=0.9',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'en-US,en;q=0.9',
      ...extraHeaders
    };

    let req;
    try {
      req = client.get(audioUrl, { headers, timeout: TIMEOUT_MS }, async (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const nextUrl = new URL(res.headers.location, audioUrl).toString();
          console.log(`[WS] Redirect (${res.statusCode}) -> ${nextUrl.slice(0, 80)}`);
          res.resume();
          try {
            const result = await streamAudio(nextUrl, ws, isAborted, redirects + 1, extraHeaders, setReq);
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
          if (isAborted() || ws.readyState !== ws.OPEN) { res.destroy(); return; }
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

        res.on('error', (e) => { console.error('[WS] Upstream error:', e.message); reject(e); });
      });

      setReq(req);
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('Upstream timeout')); });
    } catch (e) {
      reject(e);
    }
  });
}

export default server;
