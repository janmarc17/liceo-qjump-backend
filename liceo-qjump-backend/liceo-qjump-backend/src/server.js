const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const { router: queueRoutes, setWss } = require('./routes/queue.routes');
const { initWebSocket } = require('./websocket/ws.handler');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/ws/queue' });
setWss(wss);
initWebSocket(wss);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/queue', queueRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Liceo Q-Jump API running' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ WebSocket running on ws://localhost:${PORT}/ws/queue`);
});