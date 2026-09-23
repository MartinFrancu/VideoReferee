import { describe, expect, test } from 'vitest';

import { clampWithin, frameClockUsable, shortfallLabel, windowFor } from './windows.js';

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

/**
 * Every mark is timed twice, by the page's clock and by the camera's own frame
 * clock, because the lag between asking for a recording and the first encoded
 * frame is real and nothing reports it.
 *
 * But the camera's clock is only there on some browsers. Where it is not, it
 * does not go missing — it sits at zero and stays there, which put every mark
 * of a bout at the same instant and showed the first one under all three tabs.
 * A reading has to be shown to have run before it can be believed.
 */
describe('whether the camera clock can be believed', () => {
  test('believes a clock that ran', () => {
    expect(frameClockUsable([{ frameMs: 2550 }, { frameMs: 5100 }, { frameMs: 7650 }])).toBe(true);
  });

  // The iPhone case: a live stream's media time never leaves zero.
  test('refuses a clock that never moved off zero', () => {
    expect(frameClockUsable([{ frameMs: 0 }, { frameMs: 0 }, { frameMs: 0 }])).toBe(false);
  });

  test('refuses a clock that was not there at all', () => {
    expect(frameClockUsable([{ frameMs: null }, { frameMs: null }])).toBe(false);
    expect(frameClockUsable([{ frameMs: 2550 }, { frameMs: null }])).toBe(false);
  });

  /** Marks are taken in order, so their times have to come back in order too. */
  test('refuses a clock that went backwards or stood still', () => {
    expect(frameClockUsable([{ frameMs: 5100 }, { frameMs: 2550 }])).toBe(false);
    expect(frameClockUsable([{ frameMs: 2550 }, { frameMs: 2550 }])).toBe(false);
  });

  test('has nothing to believe when nothing was marked', () => {
    expect(frameClockUsable([])).toBe(false);
  });

  /** One mark cannot show a clock running, so it is not evidence either. */
  test('refuses a single reading, which proves nothing either way', () => {
    expect(frameClockUsable([{ frameMs: 2550 }])).toBe(false);
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
