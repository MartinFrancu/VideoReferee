import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  cutClip,
  isVideoKeyframe,
  readClusters,
  readInitSegment,
  readVideoTrackNumber,
} from './webm.js';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))));
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

  test('slicing mid-cluster loses the partial cluster and nothing else', () => {
    const recording = fixture('two-keyframe-gaps.webm');
    const whole = readClusters(recording).map((cluster) => cluster.timeMs);

    // Byte 20000 is inside the cluster at 314 ms, which spans 18655..24411.
    const fromMidCluster = readClusters(recording.subarray(20_000)).map((cluster) => cluster.timeMs);

    // Drops the clusters at 0 ms and 314 ms; every later one survives intact.
    expect(fromMidCluster).toEqual(whole.slice(2));
    expect(fromMidCluster[0]).toBe(546);
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

describe('finding what is decodable', () => {
  test('identifies the video track number from the Tracks element', () => {
    const initSegment = readInitSegment(fixture('two-keyframe-gaps.webm'));

    expect(readVideoTrackNumber(initSegment)).toBe(1);
  });

  test('marks the clusters that begin a decodable video segment', () => {
    const recording = fixture('two-keyframe-gaps.webm');
    const videoTrack = 1;

    const keyframes = readClusters(recording)
      .filter((cluster) => isVideoKeyframe(cluster, videoTrack))
      .map((cluster) => cluster.timeMs);

    // Four of forty-three. Counting the audio track's blocks — every one of which
    // sets the keyframe flag — would report almost all of them.
    expect(keyframes).toEqual([0, 3357, 6722, 10086]);
  });

  test('marks a cluster whose video arrives as a SimpleBlock with the keyframe flag', () => {
    const cluster = clusterWithSimpleBlock({ track: 1, keyframe: true });

    expect(readClusters(cluster).map((c) => isVideoKeyframe(c, 1))).toEqual([true]);
  });

  test("does not count another track's keyframe flag as a video keyframe", () => {
    // Every Opus block sets it, so ignoring the track number reports almost
    // every cluster as decodable.
    const cluster = clusterWithSimpleBlock({ track: 2, keyframe: true });

    expect(readClusters(cluster).map((c) => isVideoKeyframe(c, 1))).toEqual([false]);
  });
});

describe('cutting a clip', () => {
  // Keyframes sit at 0, 3357, 6722 and 10086 ms — see fixtures/README.md.
  function cutFromFixture(window: { fromMs: number; toMs: number }) {
    const recording = fixture('two-keyframe-gaps.webm');
    return cutClip({
      initSegment: readInitSegment(recording),
      clusters: readClusters(recording),
      videoTrack: 1,
      ...window,
    });
  }

  test('a cut clip begins with the init segment', () => {
    const initSegment = readInitSegment(fixture('two-keyframe-gaps.webm'));

    const clip = cutFromFixture({ fromMs: 5000, toMs: 7000 });

    expect(clip?.bytes.subarray(0, initSegment.length)).toEqual(initSegment);
  });

  test('begins at the last keyframe at or before the requested start, and reports it', () => {
    const clip = cutFromFixture({ fromMs: 5000, toMs: 7000 });

    expect(clip?.startMs).toBe(3357);
  });

  test('rebases cluster timecodes so the clip starts at zero', () => {
    const clip = cutFromFixture({ fromMs: 5000, toMs: 7000 });

    const timecodes = readClusters(clip!.bytes).map((cluster) => cluster.timeMs);

    // Source clusters 3357, 3606, 3905, 4206, 4514 — spacing preserved, origin moved.
    expect(timecodes.slice(0, 5)).toEqual([0, 249, 548, 849, 1157]);
  });

  test('includes clusters up to the requested end and no further', () => {
    const clip = cutFromFixture({ fromMs: 5000, toMs: 7000 });

    const timecodes = readClusters(clip!.bytes).map((cluster) => cluster.timeMs);

    // Source clusters 3357 through 6906; the next one at 7204 is outside the window.
    expect(timecodes).toHaveLength(14);
    expect(timecodes.at(-1)).toBe(6906 - 3357);
  });

  test('returns nothing when no keyframe precedes the requested window', () => {
    const recording = fixture('two-keyframe-gaps.webm');

    const clip = cutClip({
      initSegment: readInitSegment(recording),
      // A run starting at 546 ms, so the earliest keyframe available is 3357 ms.
      clusters: readClusters(recording.subarray(20_000)),
      videoTrack: 1,
      fromMs: 1000,
      toMs: 3000,
    });

    expect(clip).toBeNull();
  });
});

/**
 * A minimal cluster — unknown size, timecode 0, one SimpleBlock — for the block
 * shapes our recorded fixture happens not to contain.
 */
function clusterWithSimpleBlock({ track, keyframe }: { track: number; keyframe: boolean }): Uint8Array {
  return Uint8Array.from([
    0x1f, 0x43, 0xb6, 0x75, 0xff, // Cluster, unknown size
    0xe7, 0x81, 0x00, // Timecode = 0
    0xa3, 0x88, // SimpleBlock, 8 bytes of payload
    0x80 | track, // track number as a one-byte vint
    0x00, 0x00, // timecode relative to the cluster
    keyframe ? 0x80 : 0x00, // flags
    0xde, 0xad, 0xbe, 0xef, // frame data
  ]);
}
