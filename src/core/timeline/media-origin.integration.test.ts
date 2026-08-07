// Does the origin a hub can infer match the one the frames actually show?
//
// The hub never sees pixels. It has only what a camera reports — when each chunk
// arrived on that camera's own clock — plus the timecodes it parses out of the
// bytes itself. The fixtures also carry the true origin, read out of a burned-in
// clock, so the inference can be marked against reality.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { readClusters } from '../media/webm.js';
import { estimateMediaOrigin, originSamples } from './media-origin.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const meta = JSON.parse(readFileSync(`${FIXTURES}pair.json`, 'utf8'));

/** What a hub could work out about this camera, from what a camera can tell it. */
function inferOriginSessionMs(cameraName: string): number {
  const camera = meta.cameras[cameraName];
  const recording = new Uint8Array(readFileSync(FIXTURES + camera.recording));

  const origin = estimateMediaOrigin(
    originSamples({
      clusters: readClusters(recording).map(({ offset, timeMs }) => ({ offset, timeMs })),
      arrivals: camera.arrivals,
    })
  );
  if (!origin) throw new Error(`no origin for ${cameraName}`);

  // The camera's clock reading, moved onto the hub's clock. A real hub gets this
  // conversion from estimateClock; the fixture records the true value.
  const clockOffsetMs = camera.onStartSessionMs - camera.recordingStartedAtDeviceMs;
  return origin.originDeviceMs + clockOffsetMs;
}

describe('inferring a recording origin the way a hub must', () => {
  for (const cameraName of ['north', 'east']) {
    test(`matches the origin burned into ${cameraName}'s frames`, () => {
      const camera = meta.cameras[cameraName];

      const inferred = inferOriginSessionMs(cameraName);

      // For scale: anchoring on recorder.onstart is wrong by onStartLagMs, which
      // measured 663 ms and 796 ms on these two recordings.
      expect(Math.abs(inferred - camera.mediaOriginSessionMs)).toBeLessThanOrEqual(120);
    });
  }

  test('leaves the two cameras agreeing far more closely than onstart would', () => {
    const northError = inferOriginSessionMs('north') - meta.cameras['north'].mediaOriginSessionMs;
    const eastError = inferOriginSessionMs('east') - meta.cameras['east'].mediaOriginSessionMs;

    // What a referee sees is the difference between the angles, not either
    // camera's absolute error — a shared bias cancels, a divergent one does not.
    expect(Math.abs(northError - eastError)).toBeLessThanOrEqual(60);
  });
});
