import { describe, expect, test } from 'vitest';

import { BookmarkLedger, isGathering } from './bookmarks.js';

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

  test('starts unresolved', () => {
    const { it } = ledger();
    expect(it.list()[0]?.resolution).toBe('unresolved');
  });

  test('records what it was resolved to', () => {
    const { it, id } = ledger();
    allClipsIn(it, id);
    it.resolve(id, 'blue');
    expect(it.list()[0]?.resolution).toBe('blue');
  });

  test('can be resolved again, in case the first call was wrong', () => {
    const { it, id } = ledger();
    allClipsIn(it, id);
    it.resolve(id, 'blue');
    it.resolve(id, 'red');
    expect(it.list()[0]?.resolution).toBe('red');
  });

  /**
   * The two are independent. A clip may never arrive — a phone dies, a camera
   * joined seconds ago — and the referee can still call it from the angles that
   * did. Nothing here may stand between them and that decision.
   */
  test('can be resolved before any footage has arrived', () => {
    const { it, id } = ledger();
    it.resolve(id, 'purple');
    expect(it.list()[0]?.resolution).toBe('purple');
    expect(isGathering(it.list()[0]!)).toBe(true);
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

      const byId = new Map(it.list().map((b) => [b.id, b.resolution]));
      expect(byId.get(reviewed.id)).toBe('done');
      expect(byId.get(decided.id)).toBe('red');
      // Untouched: no footage yet, so nobody can have reviewed it.
      expect(byId.get(stillArriving.id)).toBe('unresolved');
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

describe('isGathering', () => {
  const ledger = new BookmarkLedger();

  test('is true while any angle is still to come, and about the angles alone', () => {
    const bookmark = ledger.create({ sessionMs: 1000, triggeredBy: 'mike', cameraIds: ['mike', 'jana'] });
    expect(isGathering(ledger.list()[0]!)).toBe(true);

    ledger.recordClip(bookmark.id, { cameraId: 'mike', url: '/c.webm', startSessionMs: 0, bookmarkOffsetMs: 0 });
    expect(isGathering(ledger.list()[0]!)).toBe(true);

    // Resolving is a separate matter and must not change the answer.
    ledger.resolve(bookmark.id, 'red');
    expect(isGathering(ledger.list()[0]!)).toBe(true);

    ledger.recordClip(bookmark.id, { cameraId: 'jana', url: '/c.webm', startSessionMs: 0, bookmarkOffsetMs: 0 });
    expect(isGathering(ledger.list()[0]!)).toBe(false);
  });

  test('is false for a bookmark nobody was filming', () => {
    const empty = new BookmarkLedger();
    empty.create({ sessionMs: 1000, triggeredBy: 'mike', cameraIds: [] });
    expect(isGathering(empty.list()[0]!)).toBe(false);
  });
});
