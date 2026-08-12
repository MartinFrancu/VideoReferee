// The hub: one HTTPS server on the laptop, on the same Wi-Fi as the phones.
//
// Deliberately thin. Everything that could be wrong — clock offsets, where a
// clip starts, what a bookmark means — is computed in src/core, where it is
// covered by tests. This file moves bytes and holds state.
import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import { readFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';

import { cutClipForBookmark } from '../core/alignment.js';
import { BookmarkLedger, type Resolution } from '../core/bookmarks.js';
import { CameraRegistry } from '../core/cameras.js';
import { readClusters, readInitSegment, readVideoTrackNumber } from '../core/media/webm.js';
import { estimateMediaOrigin, originSamples } from '../core/timeline/media-origin.js';
import { estimateClock, type SyncSample } from '../core/timeline/clock.js';
import {
  type CameraToHub,
  type CameraView,
  type UploadHeader,
} from '../core/protocol.js';
import { readConfig } from '../core/config.js';
import {
  STATE_FORMAT,
  isSafeClipName,
  parseSavedState,
  savedStateFilename,
  versionNotice,
  type SavedState,
} from '../core/state.js';
import { localAddresses } from './network.js';
import { joinHost, uncoveredAddresses } from './reachability.js';
import { versionFrom } from './version.js';
import { resolveStaticPath } from './static-path.js';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB = join(ROOT, 'web');
/** The operator screen is an Angular app; the hub serves whatever `ng build` produced. */
const OPERATOR_DIST = join(WEB, 'operator', 'dist', 'browser');
const CERT_DIR = join(ROOT, 'certs');
const CLIPS_DIR = join(ROOT, 'clips');
const CONFIG_FILE = join(ROOT, 'config.json');
mkdirSync(CLIPS_DIR, { recursive: true });

/**
 * Settings, read once at startup.
 *
 * A config the hub dislikes is reported and replaced with its default rather
 * than refused — this runs at a tournament, where failing to start is far worse
 * than running with a number someone mistyped.
 */
function loadConfig() {
  let raw: unknown;
  if (existsSync(CONFIG_FILE)) {
    try {
      raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch (error) {
      console.log(`config.json could not be read (${(error as Error).message}) — using defaults.`);
    }
  }
  const { config, problems } = readConfig(raw);
  for (const problem of problems) console.log(`config: ${problem}`);
  return config;
}

const config = loadConfig();

/** One source for the version: the manifest. Never a second copy to forget. */
const VERSION = (() => {
  try {
    return versionFrom(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')));
  } catch {
    return 'unknown';
  }
})();

if (!existsSync(join(CERT_DIR, 'cert.pem'))) {
  console.error('No certificate yet. Run `npm run gen-cert` first.');
  process.exit(1);
}

// ---------------------------------------------------------------- state ----

const cameras = new CameraRegistry({ staleAfterMs: config.network.staleAfterMs });
const bookmarks = new BookmarkLedger();
const syncSamples = new Map<string, SyncSample[]>();
const heldMs = new Map<string, number>();
const cameraSockets = new Map<string, WebSocket>();
const operatorSockets = new Set<WebSocket>();

/** Session time. One clock, on the hub, and everything else is measured against it. */
const sessionNow = () => Date.now();

function cameraViews(): CameraView[] {
  return cameras.list(sessionNow()).map((camera) => {
    const clock = estimateClock(syncSamples.get(camera.id) ?? []);
    return { ...camera, syncUncertaintyMs: clock?.uncertaintyMs ?? null, heldMs: heldMs.get(camera.id) ?? null };
  });
}

function tellOperators(): void {
  const messages = [
    JSON.stringify({ type: 'cameras', cameras: cameraViews() }),
    JSON.stringify({ type: 'bookmarks', bookmarks: bookmarks.list() }),
  ];
  for (const socket of operatorSockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    for (const message of messages) socket.send(message);
  }
}

function tellCameras(message: unknown): void {
  const payload = JSON.stringify(message);
  for (const socket of cameraSockets.values()) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

/** What an operator-triggered bookmark records, having no camera behind it. */
const THE_DESK = 'the desk';

/**
 * One tap, every camera. The hub stamps the instant on its own clock and asks
 * everyone who is filming for their footage — not only whoever noticed.
 *
 * `triggeredBy` is a camera id, or a name for whoever else asked; a value that
 * matches no camera is recorded as it stands.
 */
function createBookmark(triggeredBy: string): void {
  const filming = cameras.list(sessionNow()).filter((camera) => camera.live);
  const bookmark = bookmarks.create({
    sessionMs: sessionNow(),
    triggeredBy: cameras.list(sessionNow()).find((c) => c.id === triggeredBy)?.name ?? triggeredBy,
    cameraIds: filming.map((camera) => camera.id),
  });

  tellCameras({ type: 'bookmark', bookmarkId: bookmark.id, sessionMs: bookmark.sessionMs });
  tellOperators();
  console.log(`bookmark ${bookmark.id.slice(0, 8)} — asking ${filming.length} camera(s)`);
}

/**
 * A camera's upload. It sent opaque bytes and its own clock readings; everything
 * that turns those into an aligned clip happens here, on the hub (INV-3).
 */
function ingestClip(body: Buffer): void {
  const headerLength = body.readUInt32BE(0);
  const header = JSON.parse(body.subarray(4, 4 + headerLength).toString()) as UploadHeader;
  const prefixAt = 4 + headerLength;
  const prefix = new Uint8Array(body.subarray(prefixAt, prefixAt + header.prefixLength));
  const run = new Uint8Array(body.subarray(prefixAt + header.prefixLength));

  const bookmark = bookmarks.list().find((candidate) => candidate.id === header.bookmarkId);
  if (!bookmark) throw new Error('unknown bookmark');

  // Where this camera's own timeline sits against the hub's.
  const clock = estimateClock(syncSamples.get(header.cameraId) ?? []);
  if (!clock) throw new Error('no clock estimate for that camera yet');

  const initSegment = readInitSegment(prefix);
  const clusters = readClusters(run);
  const origin = estimateMediaOrigin(originSamples({ clusters, arrivals: header.arrivals }));
  if (!origin) throw new Error('cannot tell when that recording started');

  const clip = cutClipForBookmark({
    initSegment,
    clusters,
    videoTrack: readVideoTrackNumber(prefix) ?? 1,
    timeline: { clock, recordingStartedAt: origin.originDeviceMs },
    bookmarkSessionMs: bookmark.sessionMs,
    preRollMs: config.bookmark.preRollMs,
    postRollMs: config.bookmark.postRollMs,
  });
  if (!clip) throw new Error('no footage covering that moment');

  const filename = `${header.bookmarkId}_${header.cameraId}.webm`;
  writeFileSync(join(CLIPS_DIR, filename), clip.bytes);
  bookmarks.recordClip(header.bookmarkId, {
    cameraId: header.cameraId,
    url: `/clips/${filename}`,
    startSessionMs: clip.startSessionMs,
    bookmarkOffsetMs: clip.bookmarkOffsetMs,
  });
  tellOperators();

  console.log(
    `clip from ${header.cameraId.slice(0, 8)}: ${(clip.bytes.length / 1024).toFixed(0)}KB, ` +
      `bookmark at +${(clip.bookmarkOffsetMs / 1000).toFixed(2)}s, ` +
      `origin ±${Math.round(origin.uncertaintyMs)}ms, clock ±${Math.round(clock.uncertaintyMs)}ms`
  );
}

// ------------------------------------------------------- save and load ----
//
// One file holds a whole session — cameras, bookmarks, and the clips inline —
// so a state worth asking someone about can be sent as a single attachment and
// opened on a different laptop.

/** Every clip a bookmark still refers to, base64 into the state file. */
function clipsForState(): SavedState['clips'] {
  const wanted = new Set<string>();
  for (const bookmark of bookmarks.list()) {
    for (const angle of bookmark.angles) {
      if (angle.url) wanted.add(angle.url.slice('/clips/'.length));
    }
  }

  const clips: { name: string; base64: string }[] = [];
  for (const name of wanted) {
    if (!isSafeClipName(name)) continue;
    const file = join(CLIPS_DIR, name);
    // A clip can be missing if the folder was cleaned by hand. Save the rest:
    // a state with a gap is far more useful than a failed save.
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    clips.push({ name, base64: readFileSync(file).toString('base64') });
  }
  return clips;
}

function captureState(): SavedState {
  return {
    format: STATE_FORMAT,
    savedAt: new Date().toISOString(),
    version: VERSION,
    cameras: cameraViews(),
    bookmarks: bookmarks.list(),
    clips: clipsForState(),
  };
}

/**
 * Replace the running session with a saved one.
 *
 * Live cameras are dropped rather than merged. A loaded session describes phones
 * that were filming somewhere else, and a roster that mixes the two would show
 * bookmarks against cameras that never took them.
 */
function loadState(state: SavedState): string | null {
  for (const clip of state.clips) {
    writeFileSync(join(CLIPS_DIR, clip.name), Buffer.from(clip.base64, 'base64'));
  }

  for (const socket of cameraSockets.values()) socket.close();
  cameraSockets.clear();
  syncSamples.clear();
  heldMs.clear();

  cameras.restore(
    state.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      everJoined: camera.everJoined,
    }))
  );
  bookmarks.restore(state.bookmarks);
  tellOperators();

  console.log(
    `loaded ${state.bookmarks.length} bookmark(s), ${state.cameras.length} camera(s), ` +
      `${state.clips.length} clip(s) saved at ${state.savedAt} by version ${state.version}`
  );

  const notice = versionNotice({ savedVersion: state.version, hubVersion: VERSION });
  if (notice) console.log(`  ${notice}`);
  return notice;
}

/** End of bout: the marks go, the phones stay enrolled. */
function resetBookmarks(): void {
  bookmarks.clear();
  for (const name of readdirSync(CLIPS_DIR)) {
    if (isSafeClipName(name)) rmSync(join(CLIPS_DIR, name), { force: true });
  }
  tellOperators();
  console.log('bookmarks cleared');
}

// ----------------------------------------------------------------- http ----

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
};

function sendFile(file: string, res: import('node:http').ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    // Phones cache JS hard and there is no easy hard-refresh gesture on one.
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(file));
}

function serveStatic(url: URL, res: import('node:http').ServerResponse): void {
  if (url.pathname === '/') {
    res.writeHead(302, { Location: '/operator/' }).end();
    return;
  }

  const target = resolveStaticPath(url.pathname, { web: WEB, operator: OPERATOR_DIST });
  if (!target) {
    res.writeHead(404).end('not found');
    return;
  }

  if (target.underOperator && !existsSync(OPERATOR_DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      '<h1>The operator screen has not been built yet</h1><p>Run <code>npm run build:operator</code>.</p>'
    );
    return;
  }

  const stats = statSync(target.file, { throwIfNoEntry: false });
  if (!stats) {
    res.writeHead(404).end('not found');
    return;
  }

  // A directory serves its index, but by redirect rather than in place: a page
  // delivered at "/operator" would resolve its relative asset paths one level
  // too high — 404s that fail silently and leave a dead page. Reading it as a
  // file is not an option either; that is an EISDIR, which used to be fatal.
  if (stats.isDirectory()) {
    res.writeHead(302, { Location: `${url.pathname}/${url.search}` }).end();
    return;
  }

  sendFile(target.file, res);
}

async function readJson(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

async function handle(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? '/', `https://${req.headers.host}`);
  // On everything, so the version is readable from a browser's network tab even
  // when whatever is being debugged never renders.
  res.setHeader('X-VideoReferee-Version', VERSION);

  if (req.method === 'GET' && url.pathname === '/api/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ version: VERSION }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/cameras') {
    const body = (await readJson(req)) as { name?: string };
    const name = (body.name ?? '').trim() || 'camera';
    const { id, token } = cameras.invite(name, sessionNow());
    const host = joinHost({ requestHost: req.headers.host, addresses: localAddresses(), port: PORT });
    const joinUrl = `https://${host}/camera/?t=${token}`;
    const qr = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 260 });
    tellOperators();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, name, joinUrl, qr }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(config));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const filename = savedStateFilename(new Date());
    const body = JSON.stringify(captureState());
    console.log(`saved state: ${(Buffer.byteLength(body) / 1024 / 1024).toFixed(1)}MB`);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(body);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/state') {
    try {
      const warning = loadState(parseSavedState(await readJson(req)));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, warning }));
    } catch (error) {
      // The file came from outside, so a bad one is expected rather than a fault.
      const reason = error instanceof Error ? error.message : 'could not read that file';
      console.log(`load rejected: ${reason}`);
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end(reason);
    }
    return;
  }

  // What the referee decided: one bookmark, or every one still undecided.
  // The referee is usually at this screen, not holding a phone. Without this
  // they have to ask someone else to mark the thing they just saw.
  if (req.method === 'POST' && url.pathname === '/api/bookmarks') {
    const filming = cameras.list(sessionNow()).filter((camera) => camera.live);
    if (filming.length === 0) {
      // A bookmark nobody was filming has no angles and never will have any.
      res.writeHead(409, { 'Content-Type': 'text/plain' }).end('no camera is filming');
      return;
    }
    createBookmark(THE_DESK);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bookmarks/resolve') {
    const body = (await readJson(req)) as { id?: string; resolution?: Resolution; all?: boolean };
    const resolution = body.resolution;
    if (!resolution) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('no resolution given');
      return;
    }

    if (body.all) {
      const swept = bookmarks.resolveAllUnresolved(resolution);
      console.log(`marked ${swept} bookmark(s) ${resolution}`);
      tellOperators();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ swept }));
      return;
    }

    if (!body.id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('no bookmark given');
      return;
    }
    bookmarks.resolve(body.id, resolution);
    tellOperators();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    resetBookmarks();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/clips') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      ingestClip(Buffer.concat(chunks));
      res.writeHead(200).end('ok');
    } catch (error) {
      // A camera that cannot answer a bookmark is normal — it may have joined
      // moments ago, or the moment may have rolled out of its ring.
      const reason = error instanceof Error ? error.message : 'upload failed';
      console.log(`clip rejected: ${reason}`);
      res.writeHead(422, { 'Content-Type': 'text/plain' }).end(reason);
    }
    return;
  }

  if (url.pathname.startsWith('/clips/')) {
    // A flat directory of generated names, so there is no sub-route to make an
    // operator bundle of — both roots are the same place.
    const target = resolveStaticPath(url.pathname.slice('/clips'.length), {
      web: CLIPS_DIR,
      operator: CLIPS_DIR,
    });
    if (!target || !statSync(target.file, { throwIfNoEntry: false })?.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/webm' }).end(readFileSync(target.file));
    return;
  }

  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }

  serveStatic(url, res);
}

const server = createServer(
  {
    key: readFileSync(join(CERT_DIR, 'key.pem')),
    cert: readFileSync(join(CERT_DIR, 'cert.pem')),
  },
  (req, res) => {
    // A bout is one long-lived process holding state that exists nowhere else.
    // A malformed request must not be able to end it — before this, one bad URL
    // took the whole session down mid-bout.
    void handle(req, res).catch((error) => {
      console.error(`${req.method} ${req.url} failed:`, error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('the hub hit an error handling that request');
    });
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
    socket.send(JSON.stringify({ type: 'bookmarks', bookmarks: bookmarks.list() }));
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

    if (message.type === 'recording') {
      heldMs.set(cameraId, message.heldMs);
      cameras.heartbeat(cameraId, sessionNow());
    }

    if (message.type === 'bookmark') {
      createBookmark(cameraId);
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
}, config.network.pingIntervalMs);

/**
 * Say so when this laptop's address is not one the certificate names.
 *
 * A phone files its "accept this certificate" decision under the address it
 * visited, so on a new network every phone asks again. Harmless once you know
 * why — bewildering when you accepted it last week and it looks like the tool
 * has broken.
 */
function warnAboutCertificateCoverage(addresses: readonly string[]): void {
  let subjectAltName: string | undefined;
  try {
    subjectAltName = new X509Certificate(readFileSync(join(CERT_DIR, 'cert.pem'))).subjectAltName;
  } catch {
    return; // Unreadable is not the same as mismatched.
  }

  const uncovered = uncoveredAddresses({ addresses, subjectAltName });
  if (uncovered.length === 0) return;

  console.log(`\n  Note: the certificate does not cover ${uncovered.join(', ')}.`);
  console.log('  Phones will show that warning again even if they accepted it before.');
  console.log('  Run `npm run gen-cert` and restart to include this network.');
}

server.listen(PORT, () => {
  const addresses = localAddresses();
  console.log(`\n  VideoReferee ${VERSION}\n`);
  if (addresses.length === 0) {
    console.log('  No local network address found. Are you on Wi-Fi?');
  }
  for (const address of addresses) {
    console.log(`  Operator  https://${address}:${PORT}/`);
  }
  console.log(`\n  Settings (edit config.json to change):`);
  for (const [section, settings] of Object.entries(config)) {
    console.log(`    ${section}`);
    for (const [key, value] of Object.entries(settings)) console.log(`      ${key.padEnd(16)} ${value}`);
  }
  console.log(`\n  Cameras join by scanning a QR from the operator screen.`);
  console.log(`  First visit on each device shows a certificate warning — accept it once.`);
  warnAboutCertificateCoverage(addresses);
  console.log('');
});
