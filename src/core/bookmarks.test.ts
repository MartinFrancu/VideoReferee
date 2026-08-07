import { describe, expect, test } from 'vitest';

import { BookmarkLedger } from './bookmarks.js';

describe('keeping track of bookmarks', () => {
  test('a new bookmark expects a clip from every camera that was filming', () => {
    const ledger = new BookmarkLedger();

    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['mike', 'jana'] });

    expect(ledger.list()).toEqual([
      expect.objectContaining({
        id: bookmark.id,
        sessionMs: 5000,
        triggeredBy: 'mike',
        angles: [
          { cameraId: 'mike', status: 'pending' },
          { cameraId: 'jana', status: 'pending' },
        ],
      }),
    ]);
  });

  test('records a clip against the camera that sent it, leaving the others pending', () => {
    // A bookmark is renderable with two of four angles and says so (INV-4).
    const ledger = new BookmarkLedger();
    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['mike', 'jana'] });

    ledger.recordClip(bookmark.id, {
      cameraId: 'jana',
      url: '/clips/jana.webm',
      startSessionMs: 3400,
      bookmarkOffsetMs: 1600,
    });

    expect(ledger.list()[0]?.angles).toEqual([
      { cameraId: 'mike', status: 'pending' },
      {
        cameraId: 'jana',
        status: 'received',
        url: '/clips/jana.webm',
        startSessionMs: 3400,
        bookmarkOffsetMs: 1600,
      },
    ]);
  });

  test('ignores a clip for a bookmark it has never heard of', () => {
    const ledger = new BookmarkLedger();

    ledger.recordClip('not-a-bookmark', {
      cameraId: 'jana',
      url: '/clips/jana.webm',
      startSessionMs: 0,
      bookmarkOffsetMs: 0,
    });

    expect(ledger.list()).toEqual([]);
  });
});
