const jwt = require('jsonwebtoken');
require('dotenv').config();

const initWebSocket = (wss) => {
  wss.on('connection', (ws, req) => {
    console.log('[WS] New client connected');

    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (token) {
      try {
        ws.user = jwt.verify(token, process.env.JWT_SECRET);
        console.log(`[WS] Authenticated user: ${ws.user.studentId}`);
      } catch {
        console.log('[WS] Invalid token — unauthenticated connection');
      }
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        console.error('[WS] Invalid message:', e);
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err);
    });

    ws.send(JSON.stringify({
      type: 'ping',
      payload: { message: 'Connected to Liceo Q-Jump' }
    }));
  });
};

module.exports = { initWebSocket };