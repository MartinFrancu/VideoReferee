// Throwaway feasibility spike — validates: browser video capture reliability,
// local rolling buffer + broadcast-triggered clip upload, and timestamp-based
// multi-camera sync. Not production code (no auth, no persistence, no
// reconnect-hardening beyond the basics).
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const CERT_DIR = path.join(__dirname, 'certs');
const CLIPS_DIR = path.join(__dirname, 'clips');
fs.mkdirSync(CLIPS_DIR, { recursive: true });

const keyPath = path.join(CERT_DIR, 'key.pem');
const certPath = path.join(CERT_DIR, 'cert.pem');
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('Missing TLS cert. Run `npm run gen-cert` first (see spike/README.md).');
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/clips', express.static(CLIPS_DIR));

// Raw video blob upload — client sends the Blob directly as the body, no multipart.
app.post('/upload', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const { bookmarkId, cameraId } = req.query;
  const bookmark = bookmarks.get(bookmarkId);
  if (!bookmark) return res.status(404).send('unknown bookmark');
  if (!cameraId) return res.status(400).send('missing cameraId');

  const filename = `${bookmarkId}_${sanitize(cameraId)}.webm`;
  fs.writeFileSync(path.join(CLIPS_DIR, filename), req.body);
  bookmark.clips[cameraId] = filename;

  broadcast({ type: 'clipReady', bookmarkId, cameraId, url: `/clips/${filename}` });
  console.log(`clip received: bookmark=${bookmarkId} camera=${cameraId} bytes=${req.body.length}`);
  res.sendStatus(200);
});

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

const server = https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  app
);
const wss = new WebSocketServer({ server });

const bookmarks = new Map(); // id -> { id, serverTime, triggeredBy, clips: {cameraId: filename} }
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'sync') {
      ws.send(JSON.stringify({ type: 'syncReply', clientSendTime: msg.clientSendTime, serverTime: Date.now() }));
      return;
    }

    if (msg.type === 'bookmark') {
      const id = crypto.randomUUID();
      const bookmark = { id, serverTime: msg.serverTime, triggeredBy: msg.cameraId, clips: {} };
      bookmarks.set(id, bookmark);
      broadcast({ type: 'bookmarkCreated', id, serverTime: bookmark.serverTime, triggeredBy: bookmark.triggeredBy });
      console.log(`bookmark created: id=${id} from=${msg.cameraId} serverTime=${bookmark.serverTime}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`VideoReferee spike server listening on https://0.0.0.0:${PORT}`);
  console.log('Open https://<this-machine-local-ip>:' + PORT + '/camera.html on each phone (same Wi-Fi).');
  console.log('Open https://<this-machine-local-ip>:' + PORT + '/referee.html on the laptop.');
});
