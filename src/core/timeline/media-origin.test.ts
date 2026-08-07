import { describe, expect, test } from 'vitest';

import { estimateMediaOrigin, originSamples } from './media-origin.js';

describe('finding when a recording started', () => {
  test('takes the origin from the arrival that lagged least', () => {
    // Footage cannot arrive before it was filmed, so every arrival is later than
    // the moment it carries by some encoding delay. The smallest observed gap is
    // the closest we get to seeing that delay at zero. The best sample sits in
    // the middle, so "least lag" cannot be confused with first or most recent.
    const origin = estimateMediaOrigin([
      { arrivedAtDeviceMs: 1000, mediaMs: 100 }, // lagged 900 ms
      { arrivedAtDeviceMs: 1500, mediaMs: 900 }, // lagged 600 ms
      { arrivedAtDeviceMs: 2000, mediaMs: 1300 }, // lagged 700 ms
    ]);

    expect(origin?.originDeviceMs).toBe(600);
  });

  test('reports how far the estimate could be wrong, from the spread of the lags', () => {
    // Lags of 900, 600 and 700 ms: the middle one is 700, so the best sample
    // beats the typical one by 100 ms. Arrivals that all agree would report
    // near zero here, and a camera whose delays scatter would report a lot.
    const origin = estimateMediaOrigin([
      { arrivedAtDeviceMs: 1000, mediaMs: 100 },
      { arrivedAtDeviceMs: 1500, mediaMs: 900 },
      { arrivedAtDeviceMs: 2000, mediaMs: 1300 },
    ]);

    expect(origin?.uncertaintyMs).toBe(100);
  });

  test('has nothing to say until a chunk has arrived', () => {
    expect(estimateMediaOrigin([])).toBeNull();
  });
});

describe('matching footage to the moment it arrived', () => {
  test('pairs each cluster with the arrival that delivered its first byte', () => {
    // The camera reports when each chunk landed; the hub parses timecodes out of
    // the bytes. Neither half knows both, so they are joined by byte offset.
    const samples = originSamples({
      clusters: [
        { offset: 0, timeMs: 0 },
        { offset: 100, timeMs: 300 },
      ],
      arrivals: [
        { offset: 0, length: 80, arrivedAtDeviceMs: 1000 },
        { offset: 80, length: 90, arrivedAtDeviceMs: 1250 },
      ],
    });

    expect(samples).toEqual([
      { arrivedAtDeviceMs: 1000, mediaMs: 0 },
      { arrivedAtDeviceMs: 1250, mediaMs: 300 },
    ]);
  });

  test('ignores a cluster no arrival accounts for', () => {
    // The run can begin mid-cluster, so the first cluster found may sit before
    // anything the camera told us about.
    const samples = originSamples({
      clusters: [{ offset: 500, timeMs: 900 }],
      arrivals: [{ offset: 0, length: 80, arrivedAtDeviceMs: 1000 }],
    });

    expect(samples).toEqual([]);
  });
});
