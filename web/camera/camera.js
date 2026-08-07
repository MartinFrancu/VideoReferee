// The camera. Deliberately the least clever thing in the system.
//
// It answers sync probes with a raw reading of its own clock and never works out
// an offset. It holds bytes and notes when they arrived, and understands nothing
// about video formats. The hub draws every conclusion, where it can be stepped
// through in a debugger and covered by tests (INV-2, INV-3).
import { ChunkRing } from './ring.js';

const CHUNK_MS = 250;
const STATUS_INTERVAL_MS = 1000;

const nameEl = document.getElementById('name');
const pipEl = document.getElementById('pip');
const stateTextEl = document.getElementById('stateText');
const logEl = document.getElementById('log');
const previewEl = document.getElementById('preview');
const heldEl = document.getElementById('held');

const token = new URLSearchParams(location.search).get('t');
const ring = new ChunkRing();
let socket = null;

function log(message) {
  const line = `${new Date().toLocaleTimeString()}  ${message}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.split('\n').slice(0, 40).join('\n');
}

function setState(text, live) {
  stateTextEl.textContent = text;
  pipEl.classList.toggle('live', Boolean(live));
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

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
    setState(`cannot record ${recorder.mimeType}`, false);
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
  setState('recording', true);

  setInterval(() => {
    const held = ring.heldMs();
    heldEl.textContent = `${(held / 1000).toFixed(0)}s buffered`;
    send({ type: 'recording', heldMs: held });
  }, STATUS_INTERVAL_MS);
}

// ------------------------------------------------------------ connection ----

function connect() {
  socket = new WebSocket(`wss://${location.host}/camera`);

  socket.addEventListener('open', () => {
    setState('joining', false);
    send({ type: 'hello', token });
  });

  socket.addEventListener('close', () => {
    setState('reconnecting', false);
    setTimeout(connect, 1500);
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'welcome') {
      nameEl.textContent = message.name;
      log(`joined as "${message.name}"`);
      startRecording().catch((error) => {
        setState('camera unavailable', false);
        log(`camera error: ${error.message}`);
      });
      return;
    }

    if (message.type === 'rejected') {
      setState(message.reason, false);
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
    }
  });
}

if (!token) {
  setState('no join code', false);
  nameEl.textContent = 'not enrolled';
  log('This link has no join code. Add a camera on the operator screen and scan its QR.');
} else {
  connect();
}
