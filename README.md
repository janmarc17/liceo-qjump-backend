# Liceo Q-Jump Backend

Lightweight Express + MySQL backend for Liceo Q-Jump.

Getting started

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:

```bash
npm install
```

3. Run in development:

```bash
npm run dev
```

4. Run production:

```bash
npm start
```

Notes

- Entry point: `src/index.js` (creates server and websocket)
- App builder: `src/app.js` (registers middleware and routes)
- Routes: `src/routes/`
- Controllers: `src/controllers/`
- Middleware: `src/middleware/`
- WebSocket: `src/websocket/`

Keep `.env` out of version control and use `.env.example` as template.
