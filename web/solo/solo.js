// One referee, one phone, no setup — the spike.
//
// The flow it exists to answer: film a bout, mark up to five moments while it
// runs, stop when the fight is stopped, then flick between those moments and
// step through each one. Filming and reviewing never overlap, which is the
// whole reason this is simple: there is never any need to read the recent past
// while still writing to it. One recorder runs for the bout, stopping it hands
// back a complete file the browser wrote itself, and a mark is a millisecond
// offset into that file.
//
// What is genuinely unknown, and what the diagnostics panel is here to measure:
// whether the recording can be stepped a frame at a time on this device, or
// whether seeking lurches between keyframes. Everything else is layout.

import { clampWithin, frameClockUsable, shortfallLabel, windowFor } from './windows.js';

const VERSION = '0.1.0-spike';
const MAX_MARKS = 5;

const el = (id) => document.getElementById(id);
const preview = el('preview');
const clip = el('clip');

/** The camera, open from the moment permission is granted until the tab dies. */
let stream = null;
let frameMs = 1000 / 30;

let recorder = null;
let chunks = [];
let startedAtWallMs = 0;
/** The preview's own frame clock when recording began; null without rVFC. */
let startedAtFrameMs = null;
let lastFrameMediaMs = null;
let ticker = null;
let wakeLock = null;

/** Each mark, timed two ways — see `markAt` for why both. */
let marks = [];

let blobUrl = null;
let blobBytes = 0;
let durationMs = Number.POSITIVE_INFINITY;
let current = 0;
let positionMs = 0;
let window_ = { startMs: 0, endMs: 0, atMs: 0, shortLeadMs: 0, shortTailMs: 0 };
let playing = false;

let leadMs = 1500;
let tailMs = 1000;

/**
 * Which of the two timings to trust for where a mark falls.
 *
 * The page's clock by default, because it is the one that is always there.
 * The camera's clock is the more accurate of the two where it runs, but it is
 * not offered for a live stream everywhere — and where it is not, it reads zero
 * rather than reading as absent, which put every mark of a bout at the same
 * instant and showed the first one under every tab. `frameClockUsable` is the
 * guard; this is the preference, switchable from the diagnostics panel.
 */
let markSource = 'wall';

/**
 * How far each frame step actually moved the picture, newest last.
 *
 * The one measurement this spike exists for, and it counts *only* steps —
 * switching marks or playing would otherwise fill it with jumps of five
 * seconds and drown the number out.
 */
const stepGaps = [];
/** The media time of the frame currently on screen. */
let shownMs = null;
/** Set the instant a step is asked for, cleared by the frame that answers it. */
let steppedFrom = null;

// ---------------------------------------------------------------- the camera

async function openCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    // The back camera, and as many frames a second as we can get: every extra
    // frame is another position the referee can stop on.
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    },
    audio: false,
  });
  preview.srcObject = stream;
  await preview.play().catch(() => {
    // iOS wants a gesture before it will play anything, even muted.
    el('live-note').textContent = 'Tap anywhere to turn the camera on.';
    document.body.addEventListener('click', () => preview.play().catch(() => {}), { once: true });
  });

  const track = stream.getVideoTracks()[0];
  frameMs = 1000 / (track.getSettings().frameRate || 30);
  track.addEventListener('ended', onCameraLost);
  watchPreviewFrames();
}

/**
 * Follow the preview's own frame clock.
 *
 * It ticks with the camera rather than with the page, so it survives the phone
 * being busy — and the recording is cut from the same track, so it is the
 * better guess at where a mark lands in the file.
 */
function watchPreviewFrames() {
  if (!preview.requestVideoFrameCallback) return;
  preview.requestVideoFrameCallback((_now, meta) => {
    lastFrameMediaMs = meta.mediaTime * 1000;
    watchPreviewFrames();
  });
}

function onCameraLost() {
  if (!recorder) return;
  el('live-note').textContent = 'The camera stopped — a call, or another app took it. Reload the page.';
  stopRecording();
}

// ------------------------------------------------------------- the recording

/**
 * The first container this device will actually record.
 *
 * Safari records MP4 and will not touch WebM; everything else is the other way
 * round. Asking in order and taking the first that answers avoids caring which
 * one we are on — and an empty string means "you choose", which is always
 * better than a mime type the browser has to refuse.
 */
function pickMimeType() {
  const wanted = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const type of wanted) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return '';
}

function startRecording() {
  chunks = [];
  marks = [];
  stepGaps.length = 0;
  shownMs = null;
  steppedFrom = null;

  const mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 8_000_000,
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = finish;

  // A timeslice, so the bytes arrive as the bout runs rather than in one lump
  // at the end — a long bout then has nothing to do when the fight stops.
  recorder.start(1000);
  startedAtWallMs = performance.now();
  startedAtFrameMs = lastFrameMediaMs;

  el('start').hidden = true;
  el('bookmark').hidden = false;
  el('stop').hidden = false;
  el('recording-dot').hidden = false;
  el('live-note').textContent = `Press BOOKMARK when you see something. Up to ${MAX_MARKS}.`;
  renderDots();
  keepAwake(true);
  ticker = setInterval(tickElapsed, 250);
  tickElapsed();
}

/**
 * Note the moment, two ways, and keep filming.
 *
 * The honest problem: there is a lag between asking for a recording and the
 * first frame actually being encoded, and nothing tells us how long it is. So
 * take both readings — the page's own clock and the camera's frame clock — and
 * let the review screen show which one lands on the moment. The run-up is
 * generous enough that the moment is inside the window on either reading.
 */
function markAt() {
  if (!recorder || marks.length >= MAX_MARKS) return;
  marks.push({
    wallMs: performance.now() - startedAtWallMs,
    frameMs:
      lastFrameMediaMs !== null && startedAtFrameMs !== null
        ? lastFrameMediaMs - startedAtFrameMs
        : null,
  });
  renderDots();
  navigator.vibrate?.(35);
  if (marks.length >= MAX_MARKS) el('bookmark').disabled = true;
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  recorder.stop();
  clearInterval(ticker);
  keepAwake(false);
}

async function finish() {
  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/mp4' });
  blobBytes = blob.size;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(blob);
  clip.src = blobUrl;

  await measureDuration();

  if (marks.length === 0) {
    // Nothing was marked, so there is nothing to review. Straight back to live.
    resetToLive();
    el('live-note').textContent = 'Nothing was marked, so there was nothing to look at.';
    return;
  }

  renderTabs();
  select(0);
  document.body.dataset['screen'] = 'review';
}

/**
 * How long the recording turned out to be.
 *
 * A file a browser is still writing carries no duration, so `duration` is
 * Infinity until the blob has been scanned — and it is only scanned when
 * something asks to seek past the end. Waiting for a duration before seeking
 * deadlocks; asking for an impossible position resolves it in milliseconds.
 * (The operator screen in the main version learned this the same way.)
 */
function measureDuration() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled || !Number.isFinite(clip.duration) || clip.duration <= 0) return;
      settled = true;
      durationMs = clip.duration * 1000;
      resolve();
    };
    const giveUp = () => {
      if (settled) return;
      settled = true;
      // Better a window that ends where the footage does than one that cannot
      // be computed at all.
      const seekable = clip.seekable.length ? clip.seekable.end(clip.seekable.length - 1) : 0;
      durationMs = seekable > 0 ? seekable * 1000 : (marks.at(-1)?.wallMs ?? 0) + tailMs;
      resolve();
    };

    clip.addEventListener('durationchange', done);
    clip.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(clip.duration)) return done();
        clip.currentTime = 1e6;
      },
      { once: true }
    );
    setTimeout(giveUp, 4000);
  });
}

// ----------------------------------------------------------------- reviewing

function markMs(mark) {
  return markSource === 'frame' && frameClockUsable(marks) ? mark.frameMs : mark.wallMs;
}

function renderTabs() {
  const tabs = el('tabs');
  tabs.innerHTML = '';
  marks.forEach((_mark, index) => {
    const button = document.createElement('button');
    button.textContent = String(index + 1);
    button.className = index === current ? 'on' : '';
    button.addEventListener('click', () => select(index));
    tabs.append(button);
  });
}

/**
 * Show a mark. Instant, because it is one recording already loaded — switching
 * marks is a seek, not a load.
 */
function select(index) {
  current = index;
  pause();
  window_ = windowFor({ atMs: markMs(marks[index]), leadMs, tailMs, durationMs });

  const scrub = el('scrub');
  scrub.min = String(Math.round(window_.startMs));
  scrub.max = String(Math.round(window_.endMs));

  el('shortfall').textContent = shortfallLabel(window_) ?? '';
  renderTabs();
  // Land on the moment that was marked, not on the start of the run-up.
  seekTo(window_.atMs);
}

function seekTo(ms) {
  positionMs = clampWithin(ms, window_);
  clip.currentTime = positionMs / 1000;
  el('scrub').value = String(Math.round(positionMs));
  const relative = (positionMs - window_.atMs) / 1000;
  el('readout').textContent = `${relative >= 0 ? '+' : ''}${relative.toFixed(2)}s`;
  watchShownFrame();
}

/**
 * Which frame actually came up.
 *
 * The one measurement this spike exists for. Asking for a position and reading
 * back the position you asked for proves nothing; `mediaTime` is the media time
 * of the frame the device really put on the screen, so the gaps between
 * successive readings are the true step size. If they come back at the frame
 * interval, stepping works. If they come back at half a second, the encoder's
 * keyframes are the limit and this approach cannot do the job.
 */
function watchShownFrame() {
  if (!clip.requestVideoFrameCallback) return;
  clip.requestVideoFrameCallback((_now, meta) => {
    shownMs = meta.mediaTime * 1000;
    if (steppedFrom !== null) {
      stepGaps.push(Math.round(shownMs - steppedFrom));
      if (stepGaps.length > 12) stepGaps.shift();
      steppedFrom = null;
    }
    if (!el('diag').hidden) renderDiagnostics();
  });
}

function step(frames) {
  pause();
  steppedFrom = shownMs;
  seekTo(positionMs + frames * frameMs);
}

function play() {
  if (playing) return pause();
  // Pressing play at the end means "again", which is what it is for.
  if (positionMs >= window_.endMs - 20) seekTo(window_.startMs);
  clip.playbackRate = Number(el('rate').value);
  playing = true;
  el('play').textContent = 'Pause';
  void clip.play().catch(() => pause());
  follow();
}

/** Stop at the end of the window rather than running on into the rest of the bout. */
function follow() {
  if (!playing) return;
  positionMs = clip.currentTime * 1000;
  el('scrub').value = String(Math.round(positionMs));
  const relative = (positionMs - window_.atMs) / 1000;
  el('readout').textContent = `${relative >= 0 ? '+' : ''}${relative.toFixed(2)}s`;
  if (positionMs >= window_.endMs || clip.ended) {
    pause();
    seekTo(window_.endMs);
    return;
  }
  requestAnimationFrame(follow);
}

function pause() {
  if (!playing) return;
  clip.pause();
  playing = false;
  el('play').textContent = 'Play';
}

function resetToLive() {
  pause();
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  clip.removeAttribute('src');
  recorder = null;
  marks = [];
  chunks = [];
  durationMs = Number.POSITIVE_INFINITY;
  el('start').hidden = false;
  el('bookmark').hidden = true;
  el('bookmark').disabled = false;
  el('stop').hidden = true;
  el('recording-dot').hidden = true;
  el('elapsed').textContent = '0:00';
  el('live-note').textContent = 'Point it at the fight, then press START.';
  renderDots();
  document.body.dataset['screen'] = 'live';
}

// ---------------------------------------------------------------- the trimmings

function renderDots() {
  const dots = el('dots');
  dots.innerHTML = '';
  for (let index = 0; index < MAX_MARKS; index += 1) {
    const dot = document.createElement('i');
    if (index < marks.length) dot.className = 'on';
    dots.append(dot);
  }
}

function tickElapsed() {
  const seconds = Math.floor((performance.now() - startedAtWallMs) / 1000);
  el('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The screen must not sleep while a bout is being filmed. */
async function keepAwake(on) {
  try {
    if (on) wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    else {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch {
    // Not supported, or refused. The bout still gets filmed.
  }
}

document.addEventListener('visibilitychange', () => {
  // A wake lock is dropped whenever the page is hidden, and is not given back.
  if (document.visibilityState === 'visible' && recorder?.state === 'recording') keepAwake(true);
});

// --------------------------------------------------------------- diagnostics

/**
 * Read the step measurements out loud.
 *
 * Whoever is looking at this is standing in a sports hall, not reading a table.
 * A step that moves about one frame is the answer we want; one that moves
 * nothing, or half a second, means seeking can only reach keyframes and this
 * whole approach has to be replaced.
 */
function verdictOn(steps) {
  if (!steps.length) return 'step a few frames on the review screen, then look again';
  const numbers = `${steps.join(', ')} ms  (one frame is ${Math.round(frameMs)} ms)`;
  const honest = steps.filter((gap) => Math.abs(gap) >= frameMs * 0.5 && Math.abs(gap) <= frameMs * 1.5);
  if (honest.length === steps.length) return `stepping WORKS here — a step moved ${numbers}`;
  if (honest.length === 0) return `stepping is COARSE here — a step moved ${numbers}`;
  return `stepping is UNEVEN here — steps moved ${numbers}`;
}

function renderDiagnostics() {
  const track = stream?.getVideoTracks()[0];
  const settings = track?.getSettings() ?? {};
  const verdict = verdictOn(stepGaps);
  const usingCameraClock = markSource === 'frame' && frameClockUsable(marks);

  el('diag').innerHTML =
    `<button class="close" id="diag-close">Close</button>` +
    `<h2>the question this spike exists for</h2>` +
    `<span class="headline">${verdict}</span>\n` +
    `<h2>device</h2>` +
    `Solo ${VERSION}\n${navigator.userAgent}\n` +
    `<h2>camera</h2>` +
    `${settings.width ?? '?'}×${settings.height ?? '?'} at ${settings.frameRate ?? '?'} fps\n` +
    `recorded as ${recorder?.mimeType || pickMimeType() || '(browser default)'}\n` +
    `<h2>recording</h2>` +
    `${(blobBytes / 1e6).toFixed(1)} MB, ${Number.isFinite(durationMs) ? (durationMs / 1000).toFixed(2) + ' s' : 'duration unknown'}\n` +
    `<h2>marks — page clock vs camera clock</h2>` +
    (marks.length
      ? marks
          .map(
            (mark, index) =>
              `${index + 1}: wall ${(mark.wallMs / 1000).toFixed(3)}s   ` +
              `frame ${mark.frameMs === null ? '—' : (mark.frameMs / 1000).toFixed(3) + 's'}`
          )
          .join('\n')
      : 'none yet') +
    `\nplacing the marks by the <b>${usingCameraClock ? 'camera' : 'page'}</b> clock\n` +
    (frameClockUsable(marks)
      ? `<button id="diag-flip">use the ${markSource === 'frame' ? 'page' : 'camera'} clock instead</button>\n`
      : 'the camera clock never ran on this device, so it is ignored\n') +
    `<h2>what this device has</h2>` +
    `MediaRecorder        ${!!window.MediaRecorder}\n` +
    `frame callbacks      ${!!preview.requestVideoFrameCallback}\n` +
    `wake lock            ${!!navigator.wakeLock}\n` +
    `WebCodecs encoder    ${!!window.VideoEncoder}\n` +
    `ManagedMediaSource   ${!!window.ManagedMediaSource}\n`;

  el('diag-close').addEventListener('click', () => {
    el('diag').hidden = true;
  });
  el('diag-flip')?.addEventListener('click', () => {
    markSource = markSource === 'frame' ? 'wall' : 'frame';
    if (document.body.dataset['screen'] === 'review') select(current);
    renderDiagnostics();
  });
}

function showDiagnostics() {
  renderDiagnostics();
  el('diag').hidden = false;
}

// ---------------------------------------------------------------------- wiring

el('start').addEventListener('click', startRecording);
el('bookmark').addEventListener('click', markAt);
el('stop').addEventListener('click', stopRecording);
el('again').addEventListener('click', resetToLive);
el('back').addEventListener('click', () => step(-1));
el('fwd').addEventListener('click', () => step(1));
el('play').addEventListener('click', play);
el('rate').addEventListener('change', () => {
  clip.playbackRate = Number(el('rate').value);
});
el('scrub').addEventListener('input', (event) => {
  pause();
  seekTo(Number(event.target.value));
});
el('info').addEventListener('click', showDiagnostics);
el('info2').addEventListener('click', showDiagnostics);

for (const [input, get, set] of [
  ['lead', () => leadMs, (value) => (leadMs = value)],
  ['tail', () => tailMs, (value) => (tailMs = value)],
]) {
  const control = el(input);
  control.value = String(get());
  el(`${input}-value`).textContent = `${(get() / 1000).toFixed(1)}s`;
  control.addEventListener('input', (event) => {
    set(Number(event.target.value));
    el(`${input}-value`).textContent = `${(get() / 1000).toFixed(1)}s`;
    select(current);
  });
}

renderDots();
openCamera().catch((error) => {
  el('live-note').textContent = `No camera: ${error.name}. It needs https and permission.`;
  el('start').disabled = true;
});
