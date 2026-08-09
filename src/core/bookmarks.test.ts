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

describe('resolving a bookmark', () => {
  const ledger = () => {
    const it = new BookmarkLedger();
    const bookmark = it.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['mike', 'jana'] });
    return { it, id: bookmark.id };
  };

  const allClipsIn = (led: BookmarkLedger, id: string) => {
    for (const cameraId of ['mike', 'jana']) {
      led.recordClip(id, { cameraId, url: `/clips/${cameraId}.webm`, startSessionMs: 3400, bookmarkOffsetMs: 1600 });
    }
  };

  test('starts unresolved, and shows as loading until every angle is in', () => {
    const { it, id } = ledger();
    expect(it.list()[0]).toMatchObject({ resolution: 'unresolved', state: 'loading' });

    it.recordClip(id, { cameraId: 'mike', url: '/c.webm', startSessionMs: 0, bookmarkOffsetMs: 0 });
    expect(it.list()[0]?.state).toBe('loading');
  });

  test('becomes unresolved once the last angle arrives', () => {
    const { it, id } = ledger();
    allClipsIn(it, id);
    expect(it.list()[0]).toMatchObject({ resolution: 'unresolved', state: 'unresolved' });
  });

  test('shows the colour it was resolved to', () => {
    const { it, id } = ledger();
    allClipsIn(it, id);
    it.resolve(id, 'blue');
    expect(it.list()[0]).toMatchObject({ resolution: 'blue', state: 'blue' });
  });

  test('can be resolved again, in case the first call was wrong', () => {
    const { it, id } = ledger();
    allClipsIn(it, id);
    it.resolve(id, 'blue');
    it.resolve(id, 'red');
    expect(it.list()[0]?.state).toBe('red');
  });

  /**
   * A referee who has already decided does not need to be told footage is still
   * arriving. The decision is the more useful thing to show, so it wins.
   */
  test('a decision made before the footage lands still shows as that decision', () => {
    const { it, id } = ledger();
    it.resolve(id, 'purple');
    expect(it.list()[0]?.state).toBe('purple');
  });

  test('ignores a resolution for a bookmark it has never heard of', () => {
    const it = new BookmarkLedger();
    it.resolve('not-a-bookmark', 'done');
    expect(it.list()).toEqual([]);
  });

  describe('clearing the decks between exchanges', () => {
    /**
     * The working loop: fight, review what was marked, then sweep the rest away
     * and fight on. Only what has been looked at and left alone is swept — a
     * bookmark still waiting for footage has not been reviewed yet.
     */
    test('resolves every unresolved bookmark and leaves the rest alone', () => {
      const it = new BookmarkLedger();
      const reviewed = it.create({ sessionMs: 1000, triggeredBy: 'mike', cameraIds: ['mike'] });
      const decided = it.create({ sessionMs: 2000, triggeredBy: 'mike', cameraIds: ['mike'] });
      const stillArriving = it.create({ sessionMs: 3000, triggeredBy: 'mike', cameraIds: ['mike'] });

      for (const id of [reviewed.id, decided.id]) {
        it.recordClip(id, { cameraId: 'mike', url: '/c.webm', startSessionMs: 0, bookmarkOffsetMs: 0 });
      }
      it.resolve(decided.id, 'red');

      it.resolveAllUnresolved('done');

      const byId = new Map(it.list().map((b) => [b.id, b.state]));
      expect(byId.get(reviewed.id)).toBe('done');
      expect(byId.get(decided.id)).toBe('red');
      expect(byId.get(stillArriving.id)).toBe('loading');
    });

    test('reports how many it swept, so the screen can say so', () => {
      const it = new BookmarkLedger();
      const one = it.create({ sessionMs: 1000, triggeredBy: 'mike', cameraIds: ['mike'] });
      it.recordClip(one.id, { cameraId: 'mike', url: '/c.webm', startSessionMs: 0, bookmarkOffsetMs: 0 });

      expect(it.resolveAllUnresolved('done')).toBe(1);
      expect(it.resolveAllUnresolved('done')).toBe(0);
    });
  });
});
