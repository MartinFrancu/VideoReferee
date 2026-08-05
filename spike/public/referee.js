const listEl = document.getElementById('bookmarkList');
const stageEl = document.getElementById('stage');
const controlsEl = document.getElementById('controls');
const scrubEl = document.getElementById('scrub');
const scrubLabelEl = document.getElementById('scrubLabel');
const playBtn = document.getElementById('playBtn');

// How far either side of the bookmark the scrubber can reach. Clips start at
// whatever keyframe preceded the window, so there is usually a few extra
// seconds of lead-in available before the bookmarked moment.
const SCRUB_BEFORE_S = 5;
const SCRUB_AFTER_S = 3;

const bookmarks = new Map(); // id -> { id, serverTime, triggeredBy, clips: {cameraId: {url, clipStart}} }
let activeId = null;
let tiles = []; // { cameraId, video, clipStart, label }

function connect() {
  const ws = new WebSocket(`wss://${location.host}`);
  ws.addEventListener('close', () => setTimeout(connect, 2000));
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'bookmarkCreated') {
      bookmarks.set(msg.id, { id: msg.id, serverTime: msg.serverTime, triggeredBy: msg.triggeredBy, clips: {} });
      renderList();
    }
    if (msg.type === 'clipReady') {
      const b = bookmarks.get(msg.bookmarkId);
      if (!b) return;
      b.clips[msg.cameraId] = { url: msg.url, clipStart: msg.clipStart };
      renderList();
      if (activeId === msg.bookmarkId) renderStage(msg.bookmarkId);
    }
  });
}

function renderList() {
  listEl.innerHTML = '';
  [...bookmarks.values()]
    .sort((a, b) => b.serverTime - a.serverTime)
    .forEach((b) => {
      const li = document.createElement('li');
      const clipCount = Object.keys(b.clips).length;
      li.textContent = `${new Date(b.serverTime).toLocaleTimeString()} — from ${b.triggeredBy} — ${clipCount} clip(s)`;
      if (b.id === activeId) li.classList.add('active');
      li.addEventListener('click', () => renderStage(b.id));
      listEl.appendChild(li);
    });
}

// Position on the shared timeline, in seconds relative to the bookmark instant.
// Each clip converts it to its own local time using the clip's start time, which
// is what keeps the angles aligned despite different keyframe lead-ins.
function seekAll(relativeS) {
  const b = bookmarks.get(activeId);
  if (!b) return;
  for (const tile of tiles) {
    const localTime = (b.serverTime - tile.clipStart) / 1000 + relativeS;
    const clamped = Math.max(0, Math.min(localTime, tile.video.duration || localTime));
    if (Number.isFinite(clamped)) tile.video.currentTime = clamped;
  }
  scrubLabelEl.textContent = `${relativeS >= 0 ? '+' : ''}${relativeS.toFixed(2)}s`;
}

function renderStage(id) {
  activeId = id;
  renderList();
  const b = bookmarks.get(id);
  stageEl.innerHTML = '';
  tiles = [];
  const cameraIds = Object.keys(b.clips);
  if (cameraIds.length === 0) {
    stageEl.innerHTML = '<div id="empty">Waiting for clips to arrive…</div>';
    controlsEl.style.display = 'none';
    return;
  }
  controlsEl.style.display = 'flex';

  cameraIds.forEach((cameraId) => {
    const { url, clipStart } = b.clips[cameraId];
    const offsetS = (b.serverTime - clipStart) / 1000;

    const wrap = document.createElement('div');
    wrap.className = 'clip';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `${cameraId} — bookmark at ${offsetS.toFixed(2)}s of ${url.split('/').pop()}`;

    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Fetch the whole clip and play it from a blob URL. These clips carry no
    // Cues index and no Duration (they are cut out of a live stream), which
    // makes seeking over HTTP unreliable — with the bytes already local the
    // browser can scan freely, and scrubbing is instant.
    fetch(url)
      .then((res) => res.blob())
      .then((blob) => {
        video.src = URL.createObjectURL(blob);
      })
      .catch((err) => {
        label.textContent = `${cameraId} — could not load clip: ${err.message}`;
        label.style.color = '#e74c3c';
      });
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.max(0, Math.min(offsetS, video.duration || offsetS));
    });
    video.addEventListener('error', () => {
      const err = video.error;
      console.error('video decode error', cameraId, err);
      label.textContent = `${cameraId} — playback error (code ${err?.code}): ${err?.message || 'unknown'}`;
      label.style.color = '#e74c3c';
    });

    wrap.appendChild(label);
    wrap.appendChild(video);
    stageEl.appendChild(wrap);
    tiles.push({ cameraId, video, clipStart, label });
  });

  scrubEl.value = '0';
  scrubLabelEl.textContent = '+0.00s';
}

scrubEl.min = String(-SCRUB_BEFORE_S);
scrubEl.max = String(SCRUB_AFTER_S);
scrubEl.step = '0.04'; // ~one frame at 25fps
scrubEl.addEventListener('input', () => {
  tiles.forEach((t) => t.video.pause());
  playBtn.textContent = 'Play all';
  seekAll(Number(scrubEl.value));
});

playBtn.addEventListener('click', () => {
  const playing = tiles.some((t) => !t.video.paused);
  if (playing) {
    tiles.forEach((t) => t.video.pause());
    playBtn.textContent = 'Play all';
  } else {
    seekAll(Number(scrubEl.value));
    tiles.forEach((t) => t.video.play().catch(() => {}));
    playBtn.textContent = 'Pause all';
  }
});

connect();
