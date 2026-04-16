const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const { router: queueRoutes } = require('./routes/queue.routes');
const { initWebSocket } = require('./websocket/ws.handler');

function createApp() {
  const app = express();

  app.use(cors({
    origin: ['http://localhost:4200', 'http://localhost:4201'],
    credentials: true
  }));

  app.use(express.json());
  app.use(require('./middleware/requestLogger'));

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/queue', queueRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Liceo Q-Jump API running' });
  });

  return app;
}

function attachWebSocket(server) {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ server, path: '/ws/queue' });

  // let route modules receive a reference to the wss instance if needed
  const { setWss } = require('./routes/queue.routes');
  setWss(wss);

  initWebSocket(wss);
  return wss;
}

module.exports = { createApp, attachWebSocket };
