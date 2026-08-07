// Records the staggered fixture pair the alignment test needs.
//
// Two headless cameras start recording several seconds apart, so their media
// timelines have different origins — the situation that made the spike's clips
// look aligned when they were not. Each renders the same shared-epoch clock,
// drawn twice: as digits for a human, and as a 16-cell binary bar that ffmpeg
// can read back out of a decoded frame. A frame therefore states the session
// time it was captured at, independently of any bookkeeping we might get wrong.
//
//   node tools/make-alignment-fixtures.mjs
//
// Needs `npx playwright install chromium` once. Set CHROME_PATH to use a
// Chromium already on disk.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';
import { chromium } from 'playwright';

const OUT = fileURLToPath(new URL('../fixtures/', import.meta.url));
const SECONDS = 14;
const STAGGER_SECONDS = 6;
const TICK_MS = 20; // resolution of the binary bar
const CELLS = 16;
const BAR_Y = 420;
const BAR_HEIGHT = 50;
const WIDTH = 640;
const HEIGHT = 480;

/** Runs in the page: draw the clock, record, hand back bytes and anchors. */
async function record({ name, epoch, seconds, tickMs, cells, barY, barHeight, width, height }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const cellWidth = width / cells;

  setInterval(() => {
    const sessionMs = Date.now() - epoch;
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 120px monospace';
    ctx.textAlign = 'center';
    ctx.fillText((sessionMs / 1000).toFixed(2), width / 2, 230);
    ctx.font = 'bold 40px monospace';
    ctx.fillStyle = '#7fd1ff';
    ctx.fillText(name, width / 2, 300);

    const value = Math.round(sessionMs / tickMs) & 0xffff;
    for (let i = 0; i < cells; i++) {
      ctx.fillStyle = (value >> i) & 1 ? '#ffffff' : '#000000';
      ctx.fillRect(i * cellWidth, barY, cellWidth, barHeight);
    }
  }, 20);

  const stream = canvas.captureStream(30);
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  stream.addTrack(destination.stream.getAudioTracks()[0]);

  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9,opus',
    videoBitsPerSecond: 700_000,
  });

  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  // The two readings that let a clip be placed on the shared timeline: the
  // camera's own monotonic clock when recording began, and what the hub's clock
  // read at that same instant. A real camera reports only the first; the second
  // is what estimateClock infers. Here we capture the truth, so the test is
  // measuring the cut and the mapping rather than the offset estimate.
  const anchors = await new Promise((resolve) => {
    recorder.onstart = () => resolve({ deviceMs: performance.now(), sessionMs: Date.now() - epoch });
    recorder.start(250);
  });

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  await new Promise((resolve) => {
    recorder.onstop = resolve;
    recorder.stop();
  });

  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  return { bytes: [...bytes], ...anchors };
}

const epoch = Date.now();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--no-sandbox'],
});

async function runCamera(name) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');
  return page.evaluate(record, {
    name,
    epoch,
    seconds: SECONDS,
    tickMs: TICK_MS,
    cells: CELLS,
    barY: BAR_Y,
    barHeight: BAR_HEIGHT,
    width: WIDTH,
    height: HEIGHT,
  });
}

console.log(`recording "north" for ${SECONDS}s...`);
const north = runCamera('north');
await new Promise((resolve) => setTimeout(resolve, STAGGER_SECONDS * 1000));
console.log(`recording "east", starting ${STAGGER_SECONDS}s later...`);
const east = runCamera('east');

const [a, b] = await Promise.all([north, east]);
await browser.close();

/** Session time shown by the binary bar in the frame at `mediaMs` of a recording. */
function readBarAt(file, mediaMs) {
  const raw = execFileSync(
    ffmpeg,
    [
      '-v', 'error',
      '-i', file,
      '-ss', String(mediaMs / 1000),
      '-frames:v', '1',
      '-vf', `crop=${WIDTH}:${BAR_HEIGHT}:0:${BAR_Y},scale=${CELLS}:1:flags=area`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
    ],
    { maxBuffer: 1 << 20 }
  );
  let value = 0;
  for (let i = 0; i < CELLS; i++) if (raw[i] > 127) value |= 1 << i;
  return value * TICK_MS;
}

/**
 * Session time of the recording's media time zero, read out of the pixels.
 *
 * Deliberately not derived from `recorder.onstart`: measurement shows the media
 * clock starts about a second before that event fires, by an amount that differs
 * per camera. Reading it from the frames makes the fixture state the truth
 * rather than our assumption about it.
 */
function measureMediaOrigin(file) {
  const samples = [4000, 8000].map((mediaMs) => readBarAt(file, mediaMs) - mediaMs);
  const [first, second] = samples;
  if (first !== second) {
    console.warn(`  warning: media origin samples disagree (${samples.join(' vs ')}), taking the first`);
  }
  return first;
}

mkdirSync(OUT, { recursive: true });
const cameras = {};
for (const [name, result] of [
  ['north', a],
  ['east', b],
]) {
  const file = `${OUT}pair-${name}.webm`;
  writeFileSync(file, Buffer.from(result.bytes));

  const mediaOriginSessionMs = measureMediaOrigin(file);
  const onStartSessionMs = Math.round(result.sessionMs);
  cameras[name] = {
    recording: `pair-${name}.webm`,
    // Session time of the recording's media time zero, measured from the frames.
    mediaOriginSessionMs,
    // What the camera would have reported: its own monotonic clock at
    // recorder.onstart, and session time at that same instant.
    recordingStartedAtDeviceMs: Math.round(result.deviceMs),
    onStartSessionMs,
    // How much later onstart fired than the media clock actually began.
    onStartLagMs: onStartSessionMs - mediaOriginSessionMs,
    bytes: result.bytes.length,
  };
  console.log(
    `${name}: ${result.bytes.length} bytes, media origin at session ${mediaOriginSessionMs}ms, ` +
      `onstart fired ${onStartSessionMs - mediaOriginSessionMs}ms later`
  );
}

writeFileSync(
  `${OUT}pair.json`,
  JSON.stringify(
    {
      note: 'Session time is milliseconds since a shared epoch, burned into every frame.',
      clockBar: { cells: CELLS, tickMs: TICK_MS, y: BAR_Y, height: BAR_HEIGHT, width: WIDTH },
      cameras,
    },
    null,
    2
  ) + '\n'
);
console.log(`wrote ${OUT}pair.json`);
