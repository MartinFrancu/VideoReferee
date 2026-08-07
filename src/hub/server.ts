// The hub: one HTTPS server on the laptop, on the same Wi-Fi as the phones.
//
// Deliberately thin. Everything that could be wrong — clock offsets, where a
// clip starts, what a bookmark means — is computed in src/core, where it is
// covered by tests. This file moves bytes and holds state.
import { createServer } from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';

import { CameraRegistry } from '../core/cameras.js';
import { estimateClock, type SyncSample } from '../core/timeline/clock.js';
import { PING_INTERVAL_MS, type BoutPhase, type CameraToHub, type CameraView } from '../core/protocol.js';
import { localAddresses } from './network.js';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB = join(ROOT, 'web');
const CERT_DIR = join(ROOT, 'certs');

if (!existsSync(join(CERT_DIR, 'cert.pem'))) {
  console.error('No certificate yet. Run `npm run gen-cert` first.');
  process.exit(1);
}

// ---------------------------------------------------------------- state ----

const cameras = new CameraRegistry();
const syncSamples = new Map<string, SyncSample[]>();
const cameraSockets = new Map<string, WebSocket>();
const operatorSockets = new Set<WebSocket>();
let boutPhase: BoutPhase = 'idle';

/** Session time. One clock, on the hub, and everything else is measured against it. */
const sessionNow = () => Date.now();

function cameraViews(): CameraView[] {
  return cameras.list(sessionNow()).map((camera) => {
    const clock = estimateClock(syncSamples.get(camera.id) ?? []);
    return { ...camera, syncUncertaintyMs: clock?.uncertaintyMs ?? null };
  });
}

function tellOperators(): void {
  const message = JSON.stringify({ type: 'cameras', cameras: cameraViews() });
  const phase = JSON.stringify({ type: 'boutPhase', phase: boutPhase });
  for (const socket of operatorSockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    socket.send(message);
    socket.send(phase);
  }
}

function tellCameras(message: unknown): void {
  const payload = JSON.stringify(message);
  for (const socket of cameraSockets.values()) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

// ----------------------------------------------------------------- http ----

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
};

function serveStatic(pathname: string, res: import('node:http').ServerResponse): void {
  // A directory serves its index. Redirect rather than serve it in place: a page
  // delivered at "/" would resolve its relative script to "/operator.js", which
  // is not where it lives — a 404 that fails silently and leaves a dead page.
  if (pathname === '/') {
    res.writeHead(302, { Location: '/operator/' }).end();
    return;
  }
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = join(WEB, normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WEB) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    // Phones cache JS hard and there is no easy hard-refresh gesture on one.
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(file));
}

async function readJson(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const server = createServer(
  {
    key: readFileSync(join(CERT_DIR, 'key.pem')),
    cert: readFileSync(join(CERT_DIR, 'cert.pem')),
  },
  async (req, res) => {
    const url = new URL(req.url ?? '/', `https://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/cameras') {
      const body = (await readJson(req)) as { name?: string };
      const name = (body.name ?? '').trim() || 'camera';
      const { id, token } = cameras.invite(name, sessionNow());
      const joinUrl = `https://${req.headers.host}/camera/?t=${token}`;
      const qr = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 260 });
      tellOperators();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, name, joinUrl, qr }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/bout') {
      const body = (await readJson(req)) as { phase?: BoutPhase };
      if (body.phase) {
        boutPhase = body.phase;
        tellCameras({ type: 'boutPhase', phase: boutPhase });
        tellOperators();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ phase: boutPhase }));
      return;
    }

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    serveStatic(url.pathname, res);
  }
);

// ------------------------------------------------------------ websocket ----

const sockets = new WebSocketServer({ server });

sockets.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'https://placeholder');

  if (url.pathname === '/operator') {
    operatorSockets.add(socket);
    socket.on('close', () => operatorSockets.delete(socket));
    socket.send(JSON.stringify({ type: 'cameras', cameras: cameraViews() }));
    socket.send(JSON.stringify({ type: 'boutPhase', phase: boutPhase }));
    return;
  }

  let cameraId: string | null = null;

  socket.on('message', (raw) => {
    let message: CameraToHub;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === 'hello') {
      cameraId = cameras.join(message.token, sessionNow());
      if (cameraId === null) {
        socket.send(JSON.stringify({ type: 'rejected', reason: 'unknown join token' }));
        socket.close();
        return;
      }
      cameraSockets.set(cameraId, socket);
      const name = cameras.list(sessionNow()).find((c) => c.id === cameraId)?.name ?? '';
      socket.send(JSON.stringify({ type: 'welcome', cameraId, name }));
      socket.send(JSON.stringify({ type: 'boutPhase', phase: boutPhase }));
      tellOperators();
      return;
    }

    if (cameraId === null) return;

    if (message.type === 'pong') {
      // The camera contributed one raw reading; the hub does the arithmetic.
      const samples = syncSamples.get(cameraId) ?? [];
      samples.push({ sentAt: message.sentAt, deviceAt: message.deviceAt, receivedAt: sessionNow() });
      // Keep a short window: a stale sample describes a network that no longer exists.
      syncSamples.set(cameraId, samples.slice(-20));
      cameras.heartbeat(cameraId, sessionNow());
      tellOperators();
    }
  });

  socket.on('close', () => {
    if (cameraId !== null) cameraSockets.delete(cameraId);
    tellOperators();
  });
});

// A ping doubles as the heartbeat: a camera that answers is both in sync and alive.
setInterval(() => {
  tellCameras({ type: 'ping', sentAt: sessionNow() });
  tellOperators();
}, PING_INTERVAL_MS);

server.listen(PORT, () => {
  const addresses = localAddresses();
  console.log(`\n  VideoReferee hub — bout phase: ${boutPhase}\n`);
  if (addresses.length === 0) {
    console.log('  No local network address found. Are you on Wi-Fi?');
  }
  for (const address of addresses) {
    console.log(`  Operator  https://${address}:${PORT}/`);
  }
  console.log(`\n  Cameras join by scanning a QR from the operator screen.`);
  console.log(`  First visit on each device shows a certificate warning — accept it once.\n`);
});
