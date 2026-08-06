import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { readClusters, readInitSegment } from '../../../src/core/media/webm.js';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))));
}

describe('reading a WebM byte run', () => {
  test('finds the init segment as the bytes before the first cluster', () => {
    const recording = fixture('two-keyframe-gaps.webm');

    expect(readInitSegment(recording)).toHaveLength(189);
  });

  test('reads every cluster and its timecode in milliseconds', () => {
    const recording = fixture('two-keyframe-gaps.webm');

    const clusters = readClusters(recording);

    expect(clusters).toHaveLength(43);
    expect(clusters.slice(0, 8).map((cluster) => cluster.timeMs)).toEqual([
      0, 314, 546, 854, 1214, 1505, 1806, 2114,
    ]);
  });

  test('skips a leading partial cluster when the run starts mid-cluster', () => {
    // Byte 20000 is inside the cluster at 314 ms, which spans 18655..24411.
    const midCluster = fixture('two-keyframe-gaps.webm').subarray(20_000);

    const clusters = readClusters(midCluster);

    expect(clusters[0]?.timeMs).toBe(546);
  });

  test('treats a cluster id inside block payload as data, not a cluster start', () => {
    const recording = fixture('two-keyframe-gaps.webm');
    const realCluster = recording.subarray(18_655, 24_411); // the cluster at 314 ms
    // A cluster id and a readable size, but no Timecode child after it.
    const decoy = Uint8Array.from([0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00]);
    const run = new Uint8Array(decoy.length + realCluster.length);
    run.set(decoy, 0);
    run.set(realCluster, decoy.length);

    const clusters = readClusters(run);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.timeMs).toBe(314);
  });
});
