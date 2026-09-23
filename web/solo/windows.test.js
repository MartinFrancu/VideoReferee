import { describe, expect, test } from 'vitest';

import { clampWithin, shortfallLabel, windowFor } from './windows.js';

const spec = { leadMs: 1500, tailMs: 1000, durationMs: 60_000 };

describe('the window a bookmark is reviewed in', () => {
  test('runs from before the mark to after it', () => {
    expect(windowFor({ atMs: 30_000, ...spec })).toMatchObject({
      startMs: 28_500,
      endMs: 31_000,
      atMs: 30_000,
    });
  });

  test('gives a bookmark that got everything it asked for nothing to apologise for', () => {
    const window = windowFor({ atMs: 30_000, ...spec });
    expect(window).toMatchObject({ shortLeadMs: 0, shortTailMs: 0 });
    expect(shortfallLabel(window)).toBeNull();
  });

  /**
   * The referee marks something in the first moments of a bout. There is less
   * run-up than asked for because it does not exist, not because anything went
   * wrong.
   */
  test('starts at the beginning for a bookmark with less run-up than it wanted', () => {
    expect(windowFor({ atMs: 400, ...spec })).toMatchObject({
      startMs: 0,
      endMs: 1400,
      shortLeadMs: 1100,
    });
  });

  /**
   * The case that actually bites: the referee marks a hit and the main referee
   * stops the fight immediately after, so the recording ends before the window
   * does. The footage is not broken — there is simply no more of it.
   */
  test('ends with the recording for a bookmark marked just before the stop', () => {
    const window = windowFor({ atMs: 59_800, ...spec });

    expect(window).toMatchObject({ startMs: 58_300, endMs: 60_000, shortTailMs: 800 });
    expect(shortfallLabel(window)).toBe('stopped 0.8s after this mark');
  });

  test('says nothing about a tail that is short by a hair', () => {
    expect(shortfallLabel({ shortTailMs: 100 })).toBeNull();
    expect(shortfallLabel({ shortTailMs: 101 })).toBe('stopped 0.1s after this mark');
  });

  /**
   * Pathological, but it is the difference between a window and a negative one:
   * a stop between the bookmark being taken and the recorder stopping.
   */
  test('keeps the mark inside its own window when the recording ended on it', () => {
    const window = windowFor({ atMs: 60_500, ...spec });
    expect(window.atMs).toBe(60_000);
    expect(window.startMs).toBeLessThanOrEqual(window.atMs);
  });
});

describe('keeping a position inside its window', () => {
  const window = { startMs: 28_500, endMs: 31_000 };

  test('leaves a position that is already inside alone', () => {
    expect(clampWithin(30_000, window)).toBe(30_000);
  });

  test('stops at each end rather than running off it', () => {
    expect(clampWithin(0, window)).toBe(28_500);
    expect(clampWithin(999_999, window)).toBe(31_000);
  });
});
