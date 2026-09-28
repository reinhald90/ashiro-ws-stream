# 🎧 Ashiro WebSocket Stream Server (Vercel)

WebSocket relay server untuk streaming audio dari URL apa pun ke client WhatsApp WebView.

## Endpoint

- **Health:** `GET /health`
- **WebSocket:** `wss://<host>/?url=<audio_url>`

## Protokol

1. `{"type":"start","mime":"audio/mpeg","contentLength":4761322}`
2. Binary chunks (audio data)
3. `{"type":"end"}`

Error: `{"type":"error","message":"..."}`

## Deploy

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel --prod
