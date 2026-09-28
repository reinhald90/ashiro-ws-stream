export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: true,
    message: 'Ashiro Stream Server',
    version: '2.0',
    endpoints: {
      http_stream: `https://${req.headers.host}/api/stream?url=<audio_url>`,
      websocket: `wss://${req.headers.host}/api/ws?url=<audio_url>`,
      health: `https://${req.headers.host}/health`
    },
    note: 'Gunakan /api/stream untuk client WebView (HTTP), /api/ws untuk WebSocket'
  });
}
