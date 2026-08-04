// Throwaway spike client. Keeps a rolling local buffer of recorded chunks and
// only uploads a slice of it when the server broadcasts that a bookmark
// happened — either from this camera or any other one in the session.
const BUFFER_WINDOW_MS = 20000; // how much history we keep locally
const BEFORE_MS = 1500;
const AFTER_MS = 1000;
const SYNC_INTERVAL_MS = 15000;

const preview = document.getElementById('preview');
const statusEl = document.getElementById('status');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const cameraLabelEl = document.getElementById('cameraLabel');
const logEl = document.getElementById('log');

function log(msg) {
  const line = `${new Date().toLocaleTimeString()} ${msg}`;
  console.log(line);
  logEl.textContent = line + '\n' + logEl.textContent;
}

const cameraId =
  localStorage.getItem('vr_cameraId') ||
  (() => {
    const name = prompt('Camera name (e.g. north, east, referee-side)') || `cam-${Math.random().toString(36).slice(2, 7)}`;
    localStorage.setItem('vr_cameraId', name);
    return name;
  })();
cameraLabelEl.textContent = cameraId;

let offset = 0; // estimated serverTime - localTime
// MediaRecorder puts the WebM container header (needed to decode anything)
// only in the very first emitted chunk — every later chunk is header-less
// cluster data. Keep that first chunk pinned forever (it's tiny) and never
// let it fall out of the rolling window, or clips built later become
// undecodable.
let headerChunk = null; // { blob, start, end }
let chunks = []; // { blob, start, end } in local Date.now() time — post-header only
let ws;

function setStatus(text, color) {
  statusEl.textContent = text;
  statusEl.style.background = color;
}

function connect() {
  ws = new WebSocket(`wss://${location.host}`);

  ws.addEventListener('open', () => {
    setStatus('connected', '#2ecc71');
    log('ws connected');
    syncClock();
  });
  ws.addEventListener('close', () => {
    setStatus('disconnected — retrying', '#e74c3c');
    log('ws closed, retrying in 2s');
    setTimeout(connect, 2000);
  });
  ws.addEventListener('error', () => setStatus('ws error', '#e74c3c'));

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'syncReply') {
      const clientReceiveTime = Date.now();
      const rtt = clientReceiveTime - msg.clientSendTime;
      offset = msg.serverTime + rtt / 2 - clientReceiveTime;
      log(`clock offset ~${Math.round(offset)}ms (rtt ${rtt}ms)`);
    }
    if (msg.type === 'bookmarkCreated') {
      log(`bookmark ${msg.id.slice(0, 8)} from ${msg.triggeredBy}`);
      handleBookmark(msg.id, msg.serverTime);
    }
  });
}

function syncClock() {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'sync', clientSendTime: Date.now() }));
  }
}
setInterval(syncClock, SYNC_INTERVAL_MS);

bookmarkBtn.addEventListener('click', () => {
  if (ws.readyState !== WebSocket.OPEN) {
    log('cannot bookmark: not connected');
    return;
  }
  const serverTime = Date.now() + offset;
  ws.send(JSON.stringify({ type: 'bookmark', cameraId, serverTime }));
});

async function handleBookmark(bookmarkId, serverTime) {
  const localCenter = serverTime - offset;
  const windowStart = localCenter - BEFORE_MS;
  const windowEnd = localCenter + AFTER_MS;

  const waitMs = windowEnd - Date.now();
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs + 300));
  }

  if (!headerChunk) {
    log(`no header chunk yet, can't build a playable clip for bookmark ${bookmarkId.slice(0, 8)}`);
    return;
  }
  const relevant = chunks.filter((c) => c.end >= windowStart && c.start <= windowEnd);
  if (relevant.length === 0) {
    log(`no buffered footage for bookmark ${bookmarkId.slice(0, 8)}`);
    return;
  }

  const blob = new Blob(
    [headerChunk.blob, ...relevant.map((c) => c.blob)],
    { type: headerChunk.blob.type }
  );
  try {
    const res = await fetch(`/upload?bookmarkId=${bookmarkId}&cameraId=${encodeURIComponent(cameraId)}`, {
      method: 'POST',
      body: blob,
    });
    log(res.ok ? `uploaded clip (${(blob.size / 1024).toFixed(0)}KB)` : `upload failed: ${res.status}`);
  } catch (err) {
    log(`upload error: ${err.message}`);
  }
}

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: true,
  });
  preview.srcObject = stream;

  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
      log('wake lock acquired');
    } catch (e) {
      log(`wake lock failed: ${e.message}`);
    }
  } else {
    log('wake lock API not supported on this browser');
  }

  const mimeType =
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) =>
      window.MediaRecorder && MediaRecorder.isTypeSupported(t)
    ) || '';
  log(`using mimeType: ${mimeType || '(browser default)'}`);

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    const now = Date.now();
    const entry = { blob: e.data, start: now - 250, end: now };
    if (!headerChunk) {
      headerChunk = entry;
      log(`captured header chunk (${entry.blob.size}B)`);
      return;
    }
    chunks.push(entry);
    const cutoff = now - BUFFER_WINDOW_MS;
    while (chunks.length && chunks[0].end < cutoff) chunks.shift();
  };
  recorder.onerror = (e) => log(`recorder error: ${e.error?.message || e}`);
  recorder.start(250); // emit a chunk every 250ms
  log('recording started');
}

connect();
start().catch((err) => {
  setStatus('camera error', '#e74c3c');
  log(`camera error: ${err.message}`);
  alert('Camera error: ' + err.message);
});
