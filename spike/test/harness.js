// Headless end-to-end harness for the spike — no phones required.
//
// It drives real Chromium instances against a running spike server, but swaps
// getUserMedia for a canvas stream showing a clock driven by a shared epoch.
// Every camera therefore shows the SAME time at the same real instant, no
// matter when it started recording. Alongside the human-readable digits the
// canvas draws that clock as a 16-cell binary bar, which ffmpeg can read back
// out of a decoded frame — so the harness can assert, rather than ask you to
// squint at a screenshot, that:
//   1. each bookmark's clip really contains the moment it was tapped, and
//   2. clips from cameras with different start times line up with each other.
//
// Usage (from spike/test, after `npm install`, with the server running):
//   node harness.js                              # two staggered cameras
//   node harness.js --cameras 1 --marks 8,45,85  # one camera, three bookmarks
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const BASE = arg('url', 'https://localhost:3000');
const CAMERAS = Number(arg('cameras', 2));
const MARKS = String(arg('marks', '30')).split(',').map(Number);
const STAGGER_S = Number(arg('stagger', 9));
// By default use whatever Chromium Playwright installed (`npx playwright
// install chromium`). CHROME_PATH / --chrome overrides it for environments
// that already have a suitable build on disk.
const CHROME = arg('chrome', process.env.CHROME_PATH || undefined);
const CLIPS_DIR = path.join(__dirname, '..', 'server', 'clips');
const FFMPEG = require('ffmpeg-static');

// The binary bar: 16 cells across the full width, encoding elapsed time in
// 50ms ticks (~54 minutes of range before it wraps).
const TICK_MS = 50;
const CELLS = 16;
const BAR_Y = 420;
const BAR_H = 50;

// Tolerances. A bookmark's own clip is checked against when the harness
// clicked, which includes websocket round-trip; cross-camera agreement is the
// tighter of the two because it is what the referee actually sees.
const SELF_TOLERANCE_MS = 500;
const CROSS_TOLERANCE_MS = 300;

const EPOCH = Date.now();

// Runs inside the page, before any of the spike's own script.
function fakeCamera({ name, epoch, tickMs, cells, barY, barH }) {
  localStorage.setItem('vr_cameraId', name);
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const cellW = canvas.width / cells;
    setInterval(() => {
      const elapsed = Date.now() - epoch;
      ctx.fillStyle = '#101820';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 120px monospace';
      ctx.textAlign = 'center';
      ctx.fillText((elapsed / 1000).toFixed(2), 320, 230);
      ctx.font = 'bold 40px monospace';
      ctx.fillStyle = '#7fd1ff';
      ctx.fillText(name, 320, 310);

      const value = Math.round(elapsed / tickMs) & 0xffff;
      for (let i = 0; i < cells; i++) {
        ctx.fillStyle = (value >> i) & 1 ? '#ffffff' : '#000000';
        ctx.fillRect(i * cellW, barY, cellW, barH);
      }
    }, 20);
    const stream = canvas.captureStream(30);
    // Keep an audio track present so muxing matches a real capture.
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    const dest = audio.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
    return stream;
  };
}

// Decode the binary bar from one frame of a clip: crop the bar row, average
// each cell down to a single pixel, and read the bits back out.
function readClockAt(clipPath, offsetSeconds) {
  const raw = execFileSync(
    FFMPEG,
    [
      '-v', 'error',
      '-ss', String(offsetSeconds),
      '-i', clipPath,
      '-frames:v', '1',
      '-vf', `crop=640:${BAR_H}:0:${BAR_Y},scale=${CELLS}:1:flags=area`,
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-',
    ],
    { maxBuffer: 1 << 20 }
  );
  if (raw.length < CELLS) throw new Error(`decoded ${raw.length} bytes, expected ${CELLS}`);
  let value = 0;
  for (let i = 0; i < CELLS; i++) if (raw[i] > 127) value |= 1 << i;
  return value * TICK_MS;
}

(async () => {
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--no-sandbox'],
  });

  const referee = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await referee.goto(`${BASE}/referee.html`, { waitUntil: 'domcontentloaded' });

  async function openCamera(name) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    await ctx.addInitScript(fakeCamera, { name, epoch: EPOCH, tickMs: TICK_MS, cells: CELLS, barY: BAR_Y, barH: BAR_H });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (/uploaded|no usable|warning|UNSUPPORTED|error/i.test(m.text())) console.log(`  [${name}] ${m.text()}`);
    });
    await page.goto(`${BASE}/camera.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.getElementById('log').textContent.includes('recording started'),
      { timeout: 20000 }
    );
    console.log(`${name}: recording`);
    return page;
  }

  const names = ['north', 'east', 'south', 'west'].slice(0, CAMERAS);
  const cameras = [];
  for (const name of names) {
    cameras.push(await openCamera(name));
    if (cameras.length < names.length) await cameras[0].waitForTimeout(STAGGER_S * 1000);
  }

  const taps = [];
  const t0 = Date.now();
  for (const mark of MARKS) {
    const wait = t0 + mark * 1000 - Date.now();
    if (wait > 0) await cameras[0].waitForTimeout(wait);
    // Tap on the first camera only — every camera should still upload.
    await cameras[0].click('#bookmarkBtn');
    const tappedAt = Date.now() - EPOCH;
    taps.push(tappedAt);
    console.log(`>>> bookmark tapped on ${names[0]} at T+${mark}s (clock ${(tappedAt / 1000).toFixed(2)}s)`);
  }

  await cameras[0].waitForTimeout(6000);

  // Walk the referee page the way a human would, and verify what it shows.
  const bookmarkCount = await referee.evaluate(() => document.querySelectorAll('#bookmarkList li').length);
  if (bookmarkCount === 0) {
    console.log('\nFAIL: referee page saw no bookmarks');
    await browser.close();
    process.exit(1);
  }

  let failures = 0;
  // The list is newest-first; taps were recorded oldest-first.
  const expectations = [...taps].reverse();

  for (let i = 0; i < bookmarkCount; i++) {
    const expected = expectations[i];
    // Re-query each round: selecting a bookmark re-renders the list, which
    // detaches any handle held from a previous iteration.
    await referee.click(`#bookmarkList li:nth-child(${i + 1})`);
    await referee.waitForTimeout(2500);
    const labels = await referee.$$eval('.clip .label', (els) => els.map((e) => e.textContent));
    console.log(`\nbookmark ${i + 1}/${bookmarkCount} — tapped at clock ${(expected / 1000).toFixed(2)}s`);

    const observed = [];
    for (const label of labels) {
      const m = label.match(/^(.+?) — bookmark at ([\d.]+)s of (\S+)$/);
      if (!m) {
        console.log(`  FAIL: unexpected tile label "${label}"`);
        failures++;
        continue;
      }
      const [, cameraId, offset, filename] = m;
      const clipPath = path.join(CLIPS_DIR, filename);
      if (!fs.existsSync(clipPath)) {
        console.log(`  FAIL: ${cameraId} clip missing on disk (${filename})`);
        failures++;
        continue;
      }
      try {
        const clock = readClockAt(clipPath, Number(offset));
        const drift = clock - expected;
        const ok = Math.abs(drift) <= SELF_TOLERANCE_MS;
        if (!ok) failures++;
        observed.push({ cameraId, clock });
        console.log(
          `  ${ok ? 'ok  ' : 'FAIL'} ${cameraId}: clip shows ${(clock / 1000).toFixed(2)}s at its ` +
            `bookmark offset ${offset}s (drift ${drift >= 0 ? '+' : ''}${drift}ms)`
        );
      } catch (err) {
        console.log(`  FAIL: ${cameraId} clip would not decode — ${err.message}`);
        failures++;
      }
    }

    if (observed.length > 1) {
      const values = observed.map((o) => o.clock);
      const spread = Math.max(...values) - Math.min(...values);
      const ok = spread <= CROSS_TOLERANCE_MS;
      if (!ok) failures++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} cross-camera spread: ${spread}ms across ${observed.length} angles`);
    }
  }

  await referee.screenshot({ path: path.join(__dirname, 'referee.png'), fullPage: true });
  console.log(`\nreferee screenshot: spike/test/referee.png`);
  console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures} problem(s))`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
