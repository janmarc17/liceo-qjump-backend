require('dotenv').config();
const http = require('http');
const { createApp, attachWebSocket } = require('./app');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

const app = createApp();

// Error handling (after routes)
app.use(notFoundHandler);
app.use(errorHandler);

const server = http.createServer(app);

// Attach WebSocket server to the HTTP server
attachWebSocket(server);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ WebSocket running on ws://localhost:${PORT}/ws/queue`);
});
