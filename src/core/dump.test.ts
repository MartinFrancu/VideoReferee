import { describe, expect, it } from 'vitest';

import type { Bookmark } from './bookmarks.js';
import { captureName } from './capture.js';
import { capturesInUse, clipsInUse } from './dump.js';

const bookmark = (id: string, angles: Bookmark['angles']): Bookmark => ({
  id,
  sessionMs: 1_786_566_128_520,
  triggeredBy: 'mike',
  resolution: 'unresolved',
  angles,
});

const arrived = (cameraId: string, clip: string) => ({
  cameraId,
  status: 'received' as const,
  url: `/clips/${clip}`,
  startSessionMs: 1,
  bookmarkOffsetMs: 2,
});

describe('clipsInUse', () => {
  it('names the clip behind every angle that arrived', () => {
    const bookmarks = [
      bookmark('bm-1', [arrived('cam-1', 'one.webm'), arrived('cam-2', 'two.webm')]),
      bookmark('bm-2', [arrived('cam-1', 'three.webm')]),
    ];

    expect(clipsInUse(bookmarks)).toEqual(['one.webm', 'two.webm', 'three.webm']);
  });

  // The whole point: a folder holding an afternoon of previous runs contributes
  // nothing, because nothing this session knows about points at any of it.
  it('names nothing for an angle that never arrived', () => {
    const bookmarks = [bookmark('bm-1', [{ cameraId: 'cam-1', status: 'pending', note: 'never arrived' }])];

    expect(clipsInUse(bookmarks)).toEqual([]);
  });

  it('names a clip once, however many angles point at it', () => {
    const bookmarks = [
      bookmark('bm-1', [arrived('cam-1', 'one.webm')]),
      bookmark('bm-2', [arrived('cam-1', 'one.webm')]),
    ];

    expect(clipsInUse(bookmarks)).toEqual(['one.webm']);
  });

  // A url is a url; it has never been anything but our own, and it becomes a
  // filename here, so anything shaped differently is refused rather than joined.
  it('refuses a url that is not a clip of ours', () => {
    const bookmarks = [
      bookmark('bm-1', [
        { ...arrived('cam-1', 'ok.webm') },
        { cameraId: 'cam-2', status: 'received', url: '/clips/../../certs/key.pem' },
        { cameraId: 'cam-3', status: 'received', url: 'https://elsewhere/evil.webm' },
        // Seven characters before the name, like "/clips/" — so a check that
        // only looked at what follows would take this one and be wrong.
        { cameraId: 'cam-4', status: 'received', url: '/other/thing.webm' },
      ]),
    ];

    expect(clipsInUse(bookmarks)).toEqual(['ok.webm']);
  });
});

describe('capturesInUse', () => {
  const at = new Date('2026-08-12T20:22:08.520Z');
  const mine = captureName(at, 'bm-1111111111', 'cam-99999999');
  const theirs = captureName(at, 'bm-2222222222', 'cam-99999999');
  const names = [`${mine}.json`, `${mine}.bin`, `${theirs}.json`, `${theirs}.bin`, 'stray.txt'];

  /**
   * The pairing that matters: a capture written for a bookmark has to be found
   * again from that bookmark. These two rules live apart and would drift apart
   * silently, since nothing else reads a capture's name.
   */
  it('finds the captures written for the bookmarks this session has', () => {
    const bookmarks = [bookmark('bm-1111111111', [])];

    expect(capturesInUse(bookmarks, names)).toEqual([`${mine}.json`, `${mine}.bin`]);
  });

  it('leaves behind captures from bookmarks that are gone', () => {
    expect(capturesInUse([bookmark('bm-1111111111', [])], names)).not.toContain(`${theirs}.json`);
    expect(capturesInUse([], names)).toEqual([]);
  });

  it('takes both the record and the upload, when both are there', () => {
    const bookmarks = [bookmark('bm-1111111111', []), bookmark('bm-2222222222', [])];

    expect(capturesInUse(bookmarks, names)).toHaveLength(4);
  });

  it('takes the record alone when the upload has been rolled off', () => {
    const bookmarks = [bookmark('bm-1111111111', [])];

    expect(capturesInUse(bookmarks, [`${mine}.json`])).toEqual([`${mine}.json`]);
  });

  it('ignores anything else that has found its way into the folder', () => {
    expect(capturesInUse([bookmark('bm-1111111111', [])], ['stray.txt', 'notes.md'])).toEqual([]);
  });
});
