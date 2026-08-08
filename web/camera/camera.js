// The camera. Deliberately the least clever thing in the system.
//
// It answers sync probes with a raw reading of its own clock and never works out
// an offset. It holds bytes and notes when they arrived, and understands nothing
// about video formats. The hub draws every conclusion, where it can be stepped
// through in a debugger and covered by tests (INV-2, INV-3).
import { ChunkRing } from './ring.js';

const CHUNK_MS = 250;
const STATUS_INTERVAL_MS = 1000;

/**
 * Settings come from the hub, so there is one place to change them and no copy
 * here to drift. These are only the fallbacks for a hub too old to be asked.
 */
let config = { postRollWaitMs: 1500, warmUpMs: 20_000, ringWindowMs: 25_000 };

const nameEl = document.getElementById('name');
const pipEl = document.getElementById('pip');
const stateTextEl = document.getElementById('stateText');
const logEl = document.getElementById('log');
const previewEl = document.getElementById('preview');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const heldEl = document.getElementById('held');
const warmupEl = document.getElementById('warmup');
const warmupFillEl = document.getElementById('warmupFill');
const warmupTextEl = document.getElementById('warmupText');

const token = new URLSearchParams(location.search).get('t');
let ring = new ChunkRing();
let socket = null;
/** Assigned by the hub when we join; the upload has no socket to be traced to. */
let cameraId = null;

function log(message) {
  const line = `${new Date().toLocaleTimeString()}  ${message}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.split('\n').slice(0, 40).join('\n');
}

/** `tone` is 'live', 'warm' (filming but not ready yet) or nothing at all. */
function setState(text, tone) {
  stateTextEl.textContent = text;
  pipEl.classList.toggle('live', tone === 'live');
  pipEl.classList.toggle('warm', tone === 'warm');
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

bookmarkBtn.addEventListener('click', () => {
  send({ type: 'bookmark' });
  bookmarkBtn.classList.add('tapped');
  setTimeout(() => bookmarkBtn.classList.remove('tapped'), 400);
});

// ------------------------------------------------------------- recording ----

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: true,
  });
  previewEl.srcObject = stream;

  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
      log('screen will stay awake');
    } catch (error) {
      log(`could not keep the screen awake: ${error.message}`);
    }
  } else {
    log('this browser cannot keep the screen awake — do not let it lock');
  }

  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
    (type) => window.MediaRecorder?.isTypeSupported(type)
  );
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  // The hub can only cut WebM. Fail loudly rather than fill its disk with clips
  // that will never decode.
  if (recorder.mimeType && !/webm/i.test(recorder.mimeType)) {
    setState(`cannot record ${recorder.mimeType}`);
    log(`This browser records ${recorder.mimeType}, which the hub cannot cut yet.`);
    return;
  }
  log(`recording ${recorder.mimeType}`);

  // Serialised so chunks reach the ring in the order they were produced.
  let pending = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (!event.data?.size) return;
    const arrivedAtDeviceMs = performance.now();
    pending = pending
      .then(() => event.data.arrayBuffer())
      .then((buffer) => ring.push(new Uint8Array(buffer), arrivedAtDeviceMs))
      .catch((error) => log(`could not buffer a chunk: ${error.message}`));
  };
  recorder.onerror = (event) => log(`recorder error: ${event.error?.message ?? event}`);

  recorder.start(CHUNK_MS);
  setState('warming up', 'warm');
  warmupTextEl.textContent = 'buffering footage';

  setInterval(() => {
    const held = ring.heldMs();
    heldEl.textContent = `${(held / 1000).toFixed(0)}s buffered`;
    send({ type: 'recording', heldMs: held });
    showWarmUp(held);
  }, STATUS_INTERVAL_MS);
}

/** True once this camera holds enough footage to answer a bookmark properly. */
let ready = false;

/**
 * Hold the tap until there is footage behind it.
 *
 * A bookmark asks for the moment *and what led up to it*, so a camera that has
 * only just started has nothing worth sending. The clock estimate is at its
 * weakest then too. Rather than accept a tap that would produce a poor clip,
 * show what is missing and how long it will take.
 */
function showWarmUp(heldMs) {
  if (ready) return;

  const fraction = Math.min(1, heldMs / config.warmUpMs);
  warmupFillEl.style.width = `${Math.round(fraction * 100)}%`;

  if (heldMs < config.warmUpMs) {
    const remaining = Math.ceil((config.warmUpMs - heldMs) / 1000);
    warmupTextEl.textContent = `ready in ${remaining}s`;
    return;
  }

  ready = true;
  warmupEl.hidden = true;
  bookmarkBtn.disabled = false;
  setState('recording', 'live');
  log('ready — enough footage buffered to answer a bookmark');
}

// -------------------------------------------------------------- bookmark ----

/**
 * Hand the hub everything we are holding, and let it work out what any of it
 * means. We send the pinned prefix, the ring, and when each stretch of the ring
 * arrived on our own clock — no timecodes, no offsets, no windows (INV-2).
 */
async function uploadFor(bookmarkId) {
  const { prefix, run, arrivals } = ring.snapshot();
  if (run.length === 0) {
    log('nothing buffered yet, cannot answer that bookmark');
    return;
  }

  const header = new TextEncoder().encode(
    JSON.stringify({ bookmarkId, cameraId, prefixLength: prefix.length, runLength: run.length, arrivals })
  );
  const body = new Uint8Array(4 + header.length + prefix.length + run.length);
  new DataView(body.buffer).setUint32(0, header.length);
  body.set(header, 4);
  body.set(prefix, 4 + header.length);
  body.set(run, 4 + header.length + prefix.length);

  try {
    const response = await fetch('/api/clips', { method: 'POST', body });
    log(
      response.ok
        ? `sent ${(body.length / 1024 / 1024).toFixed(1)}MB for review`
        : `hub refused the upload: ${response.status}`
    );
  } catch (error) {
    log(`could not reach the hub: ${error.message}`);
  }
}

// ------------------------------------------------------------ connection ----

function connect() {
  socket = new WebSocket(`wss://${location.host}/camera`);

  socket.addEventListener('open', () => {
    setState('joining');
    send({ type: 'hello', token });
  });

  socket.addEventListener('close', () => {
    setState('reconnecting');
    setTimeout(connect, 1500);
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'welcome') {
      cameraId = message.cameraId;
      nameEl.textContent = message.name;
      log(`joined as "${message.name}"`);
      startRecording().catch((error) => {
        setState('camera unavailable');
        log(`camera error: ${error.message}`);
      });
      return;
    }

    if (message.type === 'rejected') {
      setState(message.reason);
      log(`refused: ${message.reason}`);
      return;
    }

    if (message.type === 'ping') {
      // One raw reading of our own monotonic clock. No arithmetic here.
      send({ type: 'pong', sentAt: message.sentAt, deviceAt: performance.now() });
      return;
    }

    if (message.type === 'boutPhase') {
      log(`bout is ${message.phase}`);
      return;
    }

    if (message.type === 'bookmark') {
      log('bookmark — sending what I have');
      // Wait for the post-roll to actually be recorded before handing it over.
      setTimeout(() => uploadFor(message.bookmarkId), config.postRollWaitMs);
    }
  });
}

/**
 * Ask the hub for its settings before recording starts.
 *
 * The ring size has to be right from the first chunk — it cannot be resized
 * later without throwing away footage — so this happens before connecting
 * rather than alongside it.
 */
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (response.ok) config = { ...config, ...(await response.json()) };
  } catch (error) {
    log(`could not read settings from the hub (${error.message}) — using defaults`);
  }
  ring = new ChunkRing({ windowMs: config.ringWindowMs });
}

if (!token) {
  setState('no join code');
  nameEl.textContent = 'not enrolled';
  log('This link has no join code. Add a camera on the operator screen and scan its QR.');
} else {
  loadConfig().then(connect);
}
