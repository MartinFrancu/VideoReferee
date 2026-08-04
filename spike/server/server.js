// Throwaway feasibility spike — validates: browser video capture reliability,
// local rolling buffer + broadcast-triggered clip upload, and timestamp-based
// multi-camera sync. Not production code (no auth, no persistence, no
// reconnect-hardening beyond the basics).
const fs = require('fs');
const os = require('os');
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
// Disable caching entirely for the spike's own JS/HTML — mobile browsers
// cache aggressively and there's no easy hard-refresh gesture on a phone,
// which has already caused at least one confusing "did my fix even load"
// moment. This is a throwaway spike; correctness > caching efficiency here.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);
app.use('/clips', express.static(CLIPS_DIR));

// Raw video blob upload — client sends the Blob directly as the body, no
// multipart. Read the stream manually rather than via express.raw()/
// body-parser: body-parser only parses when the request's Content-Type
// matches its configured `type` option, and silently defaults req.body to
// `{}` otherwise (not an error) — mobile browsers don't reliably send a
// Content-Type header on a raw fetch() body, so that mismatch was leaving
// req.body as an empty object instead of the actual bytes.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

app.post('/upload', (req, res) => {
  const { bookmarkId, cameraId } = req.query;
  const bookmark = bookmarks.get(bookmarkId);
  if (!bookmark) return res.status(404).send('unknown bookmark');
  if (!cameraId) return res.status(400).send('missing cameraId');

  const chunks = [];
  let total = 0;
  let rejected = false;

  req.on('data', (chunk) => {
    if (rejected) return;
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      rejected = true;
      res.status(413).send('upload too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (rejected) return;
    const body = Buffer.concat(chunks);
    if (body.length === 0) {
      res.status(400).send('empty upload');
      return;
    }

    const filename = `${bookmarkId}_${sanitize(cameraId)}.webm`;
    fs.writeFileSync(path.join(CLIPS_DIR, filename), body);
    bookmark.clips[cameraId] = filename;

    // A valid WebM/Matroska file must start with the EBML magic bytes
    // 1a45dfa3. If this ever prints something else, the header chunk isn't
    // actually being prepended (stale client JS, or the header-pinning
    // logic isn't working) — that's a client-side bug, not a demuxer quirk.
    const headerHex = body.subarray(0, 4).toString('hex');
    const looksLikeValidWebm = headerHex === '1a45dfa3';
    broadcast({ type: 'clipReady', bookmarkId, cameraId, url: `/clips/${filename}` });
    console.log(
      `clip received: bookmark=${bookmarkId} camera=${cameraId} bytes=${body.length} ` +
        `header=${headerHex} (${looksLikeValidWebm ? 'looks like valid WebM' : 'NOT a valid WebM header!'})`
    );
    res.sendStatus(200);
  });

  req.on('error', (err) => {
    console.error('upload stream error', err);
    if (!res.headersSent) res.status(500).send('upload failed');
  });
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

function getLocalIPs() {
  const ips = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

server.listen(PORT, () => {
  const ips = getLocalIPs();
  console.log(`VideoReferee spike server listening on port ${PORT}`);
  if (ips.length === 0) {
    console.log('Could not auto-detect a local network IP — find it manually (see README).');
  } else {
    console.log('Reachable at (use the one matching the Wi-Fi network your phones are on):');
    for (const ip of ips) {
      console.log(`  https://${ip}:${PORT}/camera.html`);
      console.log(`  https://${ip}:${PORT}/referee.html`);
    }
    if (ips.length > 1) {
      console.log('(Multiple addresses found — likely Wi-Fi + a VPN/virtual adapter. Pick the one on your actual Wi-Fi subnet.)');
    }
  }
});
