import { describe, expect, test } from 'vitest';

import { ChunkRing } from './ring.js';

const bytes = (length, fill) => new Uint8Array(length).fill(fill);

describe('the camera ring buffer', () => {
  test('drops the oldest chunk once it falls outside the window', () => {
    const ring = new ChunkRing({ windowMs: 1000, prefixBytes: 4 });

    ring.push(bytes(4, 0xaa), 0);
    ring.push(bytes(2, 0x01), 100);
    ring.push(bytes(2, 0x02), 1200); // the chunk from 100 ms is now 1100 ms old

    expect([...ring.snapshot().run]).toEqual([0x02, 0x02]);
  });

  test('never drops the pinned prefix, however long the recording runs', () => {
    const ring = new ChunkRing({ windowMs: 1000, prefixBytes: 4 });
    ring.push(bytes(4, 0xaa), 0);

    // Ten minutes of footage later, every original chunk has long since rolled out.
    for (let arrivedAt = 250; arrivedAt <= 600_000; arrivedAt += 250) {
      ring.push(bytes(2, 0x01), arrivedAt);
    }

    // The init segment lives in here, and without it nothing decodes.
    expect([...ring.snapshot().prefix]).toEqual([0xaa, 0xaa, 0xaa, 0xaa]);
  });

  test('reports where each retained chunk sits in the run and when it arrived', () => {
    const ring = new ChunkRing({ windowMs: 1000, prefixBytes: 0 });

    ring.push(bytes(3, 0x01), 1000);
    ring.push(bytes(2, 0x02), 1250);

    // The hub pairs arrival times with the timecodes it parses out of the bytes,
    // so it needs to know which stretch of the run arrived when.
    expect(ring.snapshot().arrivals).toEqual([
      { offset: 0, length: 3, arrivedAtDeviceMs: 1000 },
      { offset: 3, length: 2, arrivedAtDeviceMs: 1250 },
    ]);
  });
});
