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

function clipFor(cameraName: string, bookmarkSessionMs: number) {
  const camera = meta.cameras[cameraName];
  const recording = new Uint8Array(readFileSync(FIXTURES + camera.recording));

  const clip = cutClipForBookmark({
    initSegment: readInitSegment(recording),
    clusters: readClusters(recording),
    videoTrack: readVideoTrackNumber(recording) ?? 1,
    timeline: {
      clock: { offsetMs: 0, uncertaintyMs: 0 },
      // Session time of media zero. Measured from the frames rather than taken
      // from recorder.onstart — see fixtures/README.md.
      recordingStartedAt: camera.mediaOriginSessionMs,
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

    // Tolerances are one video frame (33 ms) plus one tick of the clock bar
    // (20 ms), rounded up. Measured error on the committed fixtures is 0 ms
    // between cameras and 20 ms against the bookmark, so anything approaching
    // these bounds is a real regression rather than noise.
    expect(Math.abs(shownByNorth - shownByEast)).toBeLessThanOrEqual(60);
    expect(Math.abs(shownByNorth - bookmarkSessionMs)).toBeLessThanOrEqual(80);
    expect(Math.abs(shownByEast - bookmarkSessionMs)).toBeLessThanOrEqual(80);
  });
});
