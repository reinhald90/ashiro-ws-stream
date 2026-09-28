/* Root handler — health check + info */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: true,
    message: 'Ashiro WebSocket Stream Server',
    websocket_endpoint: `wss://${req.headers.host}/api/ws?url=<audio_url>`,
    health: `https://${req.headers.host}/api/ws`,
    note: 'Gunakan endpoint WebSocket di atas untuk streaming audio'
  });
}
