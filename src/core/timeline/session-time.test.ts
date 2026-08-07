import { describe, expect, test } from 'vitest';

import { toMediaMs, toSessionMs } from './session-time.js';

describe('lining a camera up with the hub', () => {
  // This camera's clock runs 520 ms behind the hub's, and it started recording
  // when its own clock read 500 — so its first frame is session time 1020.
  const timeline = {
    clock: { offsetMs: 520, uncertaintyMs: 20 },
    recordingStartedAt: 500,
  };

  test("converts a bookmark's session time into the camera's own media time", () => {
    expect(toMediaMs(timeline, 4377)).toBe(3357);
  });

  test("converts a clip's media start back into session time", () => {
    // A clip starting at media time 3357 has to say when that was in shared
    // terms, or the referee cannot line it up against another angle.
    expect(toSessionMs(timeline, 3357)).toBe(4377);
  });
});
