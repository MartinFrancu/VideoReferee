import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CAPTURE_FORMAT, captureName, captureRecord, capturesToDrop } from './capture.js';
import { readClusters } from './media/webm.js';

/** A real recording, so the keyframe flags in it are real ones. */
const recording = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../fixtures/two-keyframe-gaps.webm', import.meta.url)))
);
const clusters = readClusters(recording);

const input = {
  capturedAt: new Date('2026-08-12T20:22:08.520Z'),
  version: '0.0.20',
  bookmark: { id: 'bm-1', sessionMs: 1_786_566_128_520 },
  camera: { id: 'cam-1', name: 'mike' },
  settings: { preRollMs: 1500, postRollMs: 1000, ringWindowMs: 25_000 },
  upload: { bytes: 2_400_000, prefixLength: 65_000, runLength: 2_335_000, keptAs: 'bm-1_cam-1.bin' },
  arrivals: [{ offset: 0, length: 1000, arrivedAtDeviceMs: 41_000 }],
  syncSamples: [{ sentAt: 1_786_566_120_000, deviceAt: 33_000, receivedAt: 1_786_566_120_012 }],
  clock: { offsetMs: 1_786_566_087_006, uncertaintyMs: 6 },
  originSamples: [{ arrivedAtDeviceMs: 41_000, mediaMs: 40_750 }],
  origin: { originDeviceMs: 250, uncertaintyMs: 120 },
  videoTrack: 1,
  clusters,
};

describe('captureRecord', () => {
  it('records every input the cut was made from, and what came out', () => {
    const record = captureRecord({
      ...input,
      outcome: { cut: true, startSessionMs: 1_786_566_127_006, bookmarkOffsetMs: 1514, bytes: 213_000 },
    });

    expect(record.format).toBe(CAPTURE_FORMAT);
    expect(record.bookmark).toEqual({ id: 'bm-1', sessionMs: 1_786_566_128_520 });
    expect(record.camera).toEqual({ id: 'cam-1', name: 'mike' });
    expect(record.clock).toEqual({
      offsetMs: 1_786_566_087_006,
      uncertaintyMs: 6,
      samples: input.syncSamples,
    });
    expect(record.origin).toEqual({
      originDeviceMs: 250,
      uncertaintyMs: 120,
      samples: input.originSamples,
    });
    expect(record.outcome).toEqual({
      cut: true,
      startSessionMs: 1_786_566_127_006,
      bookmarkOffsetMs: 1514,
      bytes: 213_000,
    });
  });

  /**
   * The keyframe before the bookmark is where a clip actually starts, so which
   * clusters were keyframes is half of any argument about where one began.
   */
  it('records each cluster with its timecode, its place in the run, and whether it is a keyframe', () => {
    const record = captureRecord({ ...input, outcome: { cut: false, why: 'no footage covering that moment' } });

    expect(record.clusters).toHaveLength(clusters.length);
    expect(record.clusters[0]).toEqual({
      timeMs: clusters[0]!.timeMs,
      offset: clusters[0]!.offset,
      length: clusters[0]!.bytes.length,
      keyframe: true,
    });
    // The same four the reader finds; anything else means we described them wrong.
    expect(record.clusters.filter((c) => c.keyframe).map((c) => c.timeMs)).toEqual([0, 3357, 6722, 10086]);
  });

  it('records a refusal in place of a clip, saying why', () => {
    const record = captureRecord({ ...input, outcome: { cut: false, why: 'no clock estimate for that camera yet' } });

    expect(record.outcome).toEqual({ cut: false, why: 'no clock estimate for that camera yet' });
  });

  // An estimate that could not be made is the most interesting thing in a
  // capture, so it is recorded as absent rather than left out of the file.
  it('says so plainly when an estimate could not be made at all', () => {
    const record = captureRecord({
      ...input,
      clock: null,
      origin: null,
      outcome: { cut: false, why: 'no clock estimate for that camera yet' },
    });

    expect(record.clock).toBeNull();
    expect(record.origin).toBeNull();
  });

  /**
   * The footage lives beside the record, not in it. A record has to stay small
   * enough to keep for every bookmark of an afternoon and to read in a terminal.
   */
  it('carries no footage, only the shape of it', () => {
    const record = captureRecord({
      ...input,
      outcome: { cut: true, startSessionMs: 1, bookmarkOffsetMs: 2, bytes: 3 },
    });

    const written = JSON.stringify(record);
    // Around 60 bytes a cluster: a 25s ring of them is tens of kilobytes, not
    // the megabytes the footage itself weighs.
    expect(written.length).toBeLessThan(100 * clusters.length);
    expect(written).not.toContain('"bytes":{');
    expect(record.upload).toMatchObject({ bytes: 2_400_000, keptAs: 'bm-1_cam-1.bin' });
  });

  it('records that the upload itself was not kept, when it was not', () => {
    const record = captureRecord({
      ...input,
      upload: { ...input.upload, keptAs: null },
      outcome: { cut: true, startSessionMs: 1, bookmarkOffsetMs: 2, bytes: 3 },
    });

    expect(record.upload.keptAs).toBeNull();
  });
});

describe('captureName', () => {
  const at = new Date('2026-08-12T20:22:08.520Z');

  it('sorts by when it was captured, and says which bookmark and camera', () => {
    const name = captureName(at, 'bm-1234567890', 'cam-abcdefgh');
    expect(name.startsWith('2026-08-12T20-22-08')).toBe(true);
    expect(name).toContain('bm-12345');
    expect(name).toContain('cam-abcd');
  });

  it('carries nothing a filename cannot hold', () => {
    expect(captureName(at, 'bm-1', 'cam-1')).not.toMatch(/[:*?"<>|/\\]/);
  });

  it('gives two captures of one bookmark by two cameras different names', () => {
    expect(captureName(at, 'bm-1', 'cam-1')).not.toBe(captureName(at, 'bm-1', 'cam-2'));
  });
});

describe('capturesToDrop', () => {
  // Named by time, so oldest first is alphabetical, and the newest are the ones
  // worth keeping: you go looking for a capture just after it went wrong.
  const names = ['a.bin', 'b.bin', 'c.bin', 'd.bin', 'e.bin'];

  it('drops the oldest once there are more than we keep', () => {
    expect(capturesToDrop(names, 3)).toEqual(['a.bin', 'b.bin']);
  });

  it('drops nothing while under the limit', () => {
    expect(capturesToDrop(['a.bin', 'b.bin'], 3)).toEqual([]);
    expect(capturesToDrop([], 3)).toEqual([]);
  });

  it('sorts before it decides, so the order it was handed does not matter', () => {
    expect(capturesToDrop(['d.bin', 'a.bin', 'e.bin', 'c.bin', 'b.bin'], 3)).toEqual(['a.bin', 'b.bin']);
  });

  // Keeping none is a legitimate setting: the records alone are still written.
  it('drops everything when nothing is to be kept', () => {
    expect(capturesToDrop(names, 0)).toEqual(names);
  });
});
