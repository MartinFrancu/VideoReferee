import { describe, expect, it } from 'vitest';

import { shouldAskAgain, stillAnswerable } from './asking.js';

// A phone holding 25s, and a bookmark that wants 1.5s of run-up.
const ring = { ringWindowMs: 25_000, preRollMs: 1500 };
const at = 1_786_566_128_520;

describe('stillAnswerable', () => {
  it('says yes while the whole window is still in the phone`s buffer', () => {
    expect(stillAnswerable({ bookmarkSessionMs: at, now: at + 1000, ...ring })).toBe(true);
    expect(stillAnswerable({ bookmarkSessionMs: at, now: at + 20_000, ...ring })).toBe(true);
  });

  /**
   * The run-up is what goes first. A ring holding 25 s can answer a bookmark
   * for 23.5 s of them, because the 1.5 s before the instant has to be in there
   * too — and a clip that starts at the punch is not what was asked for.
   */
  it('says no once the run-up has rolled out of the buffer', () => {
    expect(stillAnswerable({ bookmarkSessionMs: at, now: at + 23_499, ...ring })).toBe(true);
    expect(stillAnswerable({ bookmarkSessionMs: at, now: at + 23_501, ...ring })).toBe(false);
  });

  it('says no for a bookmark from an hour ago, whatever the buffer', () => {
    expect(stillAnswerable({ bookmarkSessionMs: at, now: at + 3_600_000, ...ring })).toBe(false);
  });
});

describe('shouldAskAgain', () => {
  const asking = { ...ring, askAgainEveryMs: 5000 };

  it('waits out the interval before chasing a camera that was just asked', () => {
    const asked = { bookmarkSessionMs: at, lastAskedAt: at, ...asking };
    expect(shouldAskAgain({ ...asked, now: at + 4999 })).toBe(false);
    expect(shouldAskAgain({ ...asked, now: at + 5001 })).toBe(true);
  });

  /**
   * The point of the whole thing: one lost exchange used to mean a bookmark
   * pending forever, with the footage still sitting in the ring untouched.
   */
  it('keeps asking for as long as the footage could still be there', () => {
    const asked = { bookmarkSessionMs: at, lastAskedAt: at + 15_000, ...asking };
    expect(shouldAskAgain({ ...asked, now: at + 21_000 })).toBe(true);
  });

  // Chasing footage that has certainly rolled out only costs the phone bandwidth
  // it needs for the bookmark being taken now.
  it('stops asking once the camera could not answer even if it wanted to', () => {
    const longSinceAsked = { bookmarkSessionMs: at, lastAskedAt: at, ...asking };
    expect(shouldAskAgain({ ...longSinceAsked, now: at + 24_000 })).toBe(false);
  });

  it('asks a camera that has never been asked, without waiting an interval', () => {
    expect(shouldAskAgain({ bookmarkSessionMs: at, lastAskedAt: null, now: at + 10, ...asking })).toBe(true);
  });
});
