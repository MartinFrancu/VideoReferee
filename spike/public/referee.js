const listEl = document.getElementById('bookmarkList');
const stageEl = document.getElementById('stage');

const bookmarks = new Map(); // id -> { id, serverTime, triggeredBy, clips: {cameraId: url} }
let activeId = null;

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
      b.clips[msg.cameraId] = msg.url;
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

function renderStage(id) {
  activeId = id;
  renderList();
  const b = bookmarks.get(id);
  stageEl.innerHTML = '';
  const cameraIds = Object.keys(b.clips);
  if (cameraIds.length === 0) {
    stageEl.innerHTML = '<div id="empty">Waiting for clips to arrive…</div>';
    return;
  }
  cameraIds.forEach((cameraId) => {
    const wrap = document.createElement('div');
    wrap.className = 'clip';
    const label = document.createElement('div');
    label.className = 'label';
    const url = b.clips[cameraId];
    label.textContent = `${cameraId} — ${url.split('/').pop()}`;
    const video = document.createElement('video');
    video.src = url;
    video.addEventListener('error', () => {
      const err = video.error;
      console.error('video decode error', cameraId, err);
      label.textContent = `${cameraId} — playback error (code ${err?.code}): ${err?.message || 'unknown'}`;
      label.style.color = '#e74c3c';
    });
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.loop = true;
    wrap.appendChild(label);
    wrap.appendChild(video);
    stageEl.appendChild(wrap);
  });
}

connect();
