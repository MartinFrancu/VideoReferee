// Throwaway spike client. Keeps a rolling local buffer of recorded video and
// only uploads a slice of it when the server broadcasts that a bookmark
// happened — either from this camera or any other one in the session.
//
// The slicing itself lives in webm.js: cutting a playable clip out of a live
// MediaRecorder stream has to happen on WebM cluster boundaries, not on
// `dataavailable` chunk boundaries (those land at arbitrary byte offsets).
const BUFFER_WINDOW_MS = 20000; // how much history we keep locally
const BEFORE_MS = 1500;
const AFTER_MS = 1000;
const SYNC_INTERVAL_MS = 15000;
const CHUNK_MS = 250;
// How long to keep waiting for the encoder to flush the cluster that covers the
// end of a bookmark window. Clusters land ~300ms apart and the last one is only
// complete once the next has started, so this needs headroom.
const SETTLE_TIMEOUT_MS = 3000;

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
let buffer = null; // WebmClipBuffer
let recordingStartLocal = null; // local clock time of recording timestamp 0
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

// Wait until the buffer holds a completed cluster at or past `targetMs` of
// recording time, so the tail of the window is actually available to cut.
async function waitForCoverage(targetMs) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const newest = buffer.newestTimeMs();
    if (newest !== null && newest >= targetMs) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function handleBookmark(bookmarkId, serverTime) {
  if (!buffer || recordingStartLocal === null) {
    log(`not recording yet, skipping bookmark ${bookmarkId.slice(0, 8)}`);
    return;
  }

  // Everything below is in recording time (ms since this camera's recording
  // started), which is what the cluster timecodes are measured in.
  const centerMs = serverTime - offset - recordingStartLocal;
  const fromMs = centerMs - BEFORE_MS;
  const toMs = centerMs + AFTER_MS;

  const localWindowEnd = recordingStartLocal + toMs;
  const waitMs = localWindowEnd - Date.now();
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const covered = await waitForCoverage(toMs);
  if (!covered) {
    log(`warning: encoder did not flush past ${Math.round(toMs)}ms in time — clip may be short`);
  }

  const clip = buffer.buildClip(fromMs, toMs);
  if (!clip) {
    log(
      `no usable footage for bookmark ${bookmarkId.slice(0, 8)} ` +
        `(window ${Math.round(fromMs)}-${Math.round(toMs)}ms, buffer holds ` +
        `${buffer.oldestTimeMs()}-${buffer.newestTimeMs()}ms)`
    );
    return;
  }

  // Recording time -> server time, so the referee knows where in this clip the
  // bookmark actually falls and can line the angles up against each other.
  const clipStartServerTime = Math.round(recordingStartLocal + clip.startMs + offset);
  const params = new URLSearchParams({
    bookmarkId,
    cameraId,
    clipStart: String(clipStartServerTime),
  });

  try {
    const res = await fetch(`/upload?${params}`, { method: 'POST', body: clip.blob });
    log(
      res.ok
        ? `uploaded clip ${(clip.blob.size / 1024).toFixed(0)}KB — ${clip.clusterCount} clusters, ` +
            `recording time ${Math.round(clip.startMs)}-${Math.round(clip.endMs)}ms ` +
            `(keyframe lead-in ${Math.round(clip.leadInMs)}ms)`
        : `upload failed: ${res.status}`
    );
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
  buffer = new WebmClipBuffer({ windowMs: BUFFER_WINDOW_MS, mimeType: recorder.mimeType || mimeType });

  // The clip builder understands WebM only. Safari on iOS may hand back
  // fragmented MP4 instead, which needs different surgery (moof/mdat fragments
  // and baseMediaDecodeTime rewriting) — fail loudly rather than silently
  // uploading clips that cannot decode.
  if (recorder.mimeType && !/webm/i.test(recorder.mimeType)) {
    log(`UNSUPPORTED CONTAINER: ${recorder.mimeType} — clip building expects WebM. Clips will not be produced.`);
    alert(`This browser records ${recorder.mimeType}, which the spike cannot slice yet. Try Chrome on Android.`);
  }

  // Serialise the async blob->bytes conversion so clusters stay in stream order.
  let appendChain = Promise.resolve();
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    appendChain = appendChain
      .then(() => e.data.arrayBuffer())
      .then((ab) => buffer.append(new Uint8Array(ab)))
      .catch((err) => log(`buffer error: ${err.message}`));
  };
  recorder.onerror = (e) => log(`recorder error: ${e.error?.message || e}`);
  recorder.onstart = () => {
    recordingStartLocal = Date.now();
  };
  recorder.start(CHUNK_MS);
  if (recordingStartLocal === null) recordingStartLocal = Date.now(); // onstart not fired yet
  log('recording started');
}

connect();
start().catch((err) => {
  setStatus('camera error', '#e74c3c');
  log(`camera error: ${err.message}`);
  alert('Camera error: ' + err.message);
});
