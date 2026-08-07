import { describe, expect, test } from 'vitest';

import { estimateClock } from './clock.js';

describe('estimating a camera clock', () => {
  test('takes the offset from a round trip as the midpoint between send and receive', () => {
    // The reply left the camera somewhere in [1000, 1040] on the hub's clock;
    // absent better information, assume the middle.
    const clock = estimateClock([{ sentAt: 1000, deviceAt: 500, receivedAt: 1040 }]);

    expect(clock?.offsetMs).toBe(520);
  });

  test('prefers the fastest round trip when several are available', () => {
    // The fastest sits in the middle, so neither "take the first" nor "take the
    // most recent" can pass this by accident.
    const clock = estimateClock([
      // 400 ms in flight: the midpoint guess could be off by up to 200 ms.
      { sentAt: 0, deviceAt: 1000, receivedAt: 400 },
      // 40 ms in flight: the same guess is off by at most 20 ms.
      { sentAt: 1000, deviceAt: 1500, receivedAt: 1040 },
      // 600 ms in flight, and the most recent.
      { sentAt: 2000, deviceAt: 2200, receivedAt: 2600 },
    ]);

    expect(clock?.offsetMs).toBe(-480);
  });

  test('reports how far the estimate could be wrong, as half the round trip it used', () => {
    // All 40 ms could have fallen on one leg, putting the true offset anywhere
    // within 20 ms either side of the midpoint.
    const clock = estimateClock([{ sentAt: 1000, deviceAt: 500, receivedAt: 1040 }]);

    expect(clock?.uncertaintyMs).toBe(20);
  });
});
