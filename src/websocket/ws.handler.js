const jwt = require('jsonwebtoken');
require('dotenv').config();

const initWebSocket = (wss) => {
  wss.on('connection', (ws, req) => {
    // [WS] New client connected (log removed)

    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (token) {
      try {
        ws.user = jwt.verify(token, process.env.JWT_SECRET);
        // [WS] Authenticated user: ${ws.user.studentId} (log removed)
      } catch {
        // [WS] Invalid token — unauthenticated connection (log removed)
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
      // [WS] Client disconnected (log removed)
    });

    ws.on('error', (err) => {
      // [WS] Error: (log removed)
    });

    ws.send(JSON.stringify({
      type: 'ping',
      payload: { message: 'Connected to Liceo Q-Jump' }
    }));
  });
};

module.exports = { initWebSocket };