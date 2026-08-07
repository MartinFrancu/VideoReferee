// The claim the product rests on, checked through real decoded pixels.
//
// Two cameras recorded the same wall-clock stretch but started at different
// moments, so their media timelines have unrelated origins. Each frame carries
// the session time it was captured at, as a binary bar ffmpeg can read back. So
// a clip can be asked, without trusting any of our own bookkeeping, "what moment
// are you actually showing?"
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import ffmpeg from 'ffmpeg-static';

import { cutClipForBookmark } from './alignment.js';
import { readClusters, readInitSegment, readVideoTrackNumber } from './media/webm.js';
import { estimateMediaOrigin, originSamples } from './timeline/media-origin.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const SCRATCH = fileURLToPath(new URL('../../.tmp/', import.meta.url));
const meta = JSON.parse(readFileSync(`${FIXTURES}pair.json`, 'utf8'));

/** The session time shown by the frame at `offsetMs` into a clip file. */
function sessionTimeShownAt(file: string, offsetMs: number): number {
  const { cells, tickMs, y, height, width } = meta.clockBar;
  const raw = execFileSync(
    ffmpeg as unknown as string,
    ['-v', 'error', '-i', file, '-ss', String(offsetMs / 1000), '-frames:v', '1',
     '-vf', `crop=${width}:${height}:0:${y},scale=${cells}:1:flags=area`,
     '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1 << 20 }
  );
  let value = 0;
  for (let i = 0; i < cells; i++) if ((raw[i] ?? 0) > 127) value |= 1 << i;
  return value * tickMs;
}

/** What a hub can work out about where a recording's clock started. */
function inferOriginSessionMs(
  cameraName: string,
  recording: Uint8Array,
  camera: { arrivals: []; onStartSessionMs: number; recordingStartedAtDeviceMs: number }
): number {
  const origin = estimateMediaOrigin(
    originSamples({
      clusters: readClusters(recording).map(({ offset, timeMs }) => ({ offset, timeMs })),
      arrivals: camera.arrivals,
    })
  );
  if (!origin) throw new Error(`no origin for ${cameraName}`);
  const clockOffsetMs = camera.onStartSessionMs - camera.recordingStartedAtDeviceMs;
  return origin.originDeviceMs + clockOffsetMs;
}

function clipFor(cameraName: string, bookmarkSessionMs: number) {
  const camera = meta.cameras[cameraName];
  const recording = new Uint8Array(readFileSync(FIXTURES + camera.recording));

  const clip = cutClipForBookmark({
    initSegment: readInitSegment(recording),
    clusters: readClusters(recording),
    videoTrack: readVideoTrackNumber(recording) ?? 1,
    timeline: {
      clock: { offsetMs: 0, uncertaintyMs: 0 },
      // Inferred exactly as the hub will infer it: from when the camera said
      // each chunk arrived, against the timecodes we parse out of the bytes.
      // Not read from the fixture's measured value, so this exercises the real
      // path rather than a convenient shortcut.
      recordingStartedAt: inferOriginSessionMs(cameraName, recording, camera),
    },
    bookmarkSessionMs,
    preRollMs: 1500,
    postRollMs: 1000,
  });
  if (!clip) throw new Error(`no clip for ${cameraName}`);

  mkdirSync(SCRATCH, { recursive: true });
  const file = `${SCRATCH}${cameraName}-at-${bookmarkSessionMs}.webm`;
  writeFileSync(file, clip.bytes);
  return { ...clip, file };
}

describe('lining two cameras up on one bookmark', () => {
  const bookmarkSessionMs = 12_000;

  test('two recordings with different start anchors meet at the same instant', () => {
    const north = clipFor('north', bookmarkSessionMs);
    const east = clipFor('east', bookmarkSessionMs);

    const shownByNorth = sessionTimeShownAt(north.file, north.bookmarkOffsetMs);
    const shownByEast = sessionTimeShownAt(east.file, east.bookmarkOffsetMs);

    // The clips have nothing in common: they start 2.5 s apart on the shared
    // timeline and put the bookmark at very different offsets. Agreement here is
    // the alignment working, not an accident of similar inputs.
    expect(north.bookmarkOffsetMs).not.toBe(east.bookmarkOffsetMs);

    // What a referee sees is the two angles agreeing with each other. Measured
    // at 20 ms on the committed fixtures; the bound allows one video frame
    // (33 ms) plus one tick of the clock bar (20 ms) on top.
    expect(Math.abs(shownByNorth - shownByEast)).toBeLessThanOrEqual(60);

    // Absolute accuracy is looser, and unavoidably so. The origin is inferred
    // from the smallest delay we ever observed between filming and arrival, and
    // no chunk ever arrives with zero delay — so the estimate lands slightly
    // late and every clip shifts slightly early. Measured at 80-100 ms here.
    //
    // It is a shared bias, which is why the angles still agree to 20 ms, and it
    // is small against 1.5 s of pre-roll. Reading the origin from the frames
    // instead gives 20 ms absolute, but a hub has no frames to read.
    expect(Math.abs(shownByNorth - bookmarkSessionMs)).toBeLessThanOrEqual(200);
    expect(Math.abs(shownByEast - bookmarkSessionMs)).toBeLessThanOrEqual(200);
  });
});
