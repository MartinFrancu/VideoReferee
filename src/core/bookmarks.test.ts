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

  /**
   * How far out an angle could be is computed on every upload and, until now,
   * looked at by nobody — including on the one bookmark at a real bout that came
   * out misaligned, where it is the number that would have said so.
   */
  test('records how far out a clip could be, alongside it', () => {
    const ledger = new BookmarkLedger();
    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['jana'] });

    ledger.recordClip(bookmark.id, {
      cameraId: 'jana',
      url: '/clips/jana.webm',
      startSessionMs: 3400,
      bookmarkOffsetMs: 1600,
      uncertaintyMs: 241,
    });

    expect(ledger.list()[0]?.angles[0]).toEqual({
      cameraId: 'jana',
      status: 'received',
      url: '/clips/jana.webm',
      startSessionMs: 3400,
      bookmarkOffsetMs: 1600,
      uncertaintyMs: 241,
    });
  });

  /**
   * Why an angle has not arrived is the question a saved session is opened to
   * answer, and "pending" alone cannot tell "the phone never heard us" from
   * "the phone sent it and we threw it away".
   */
  test('keeps a note against a pending angle, saying why it has not arrived', () => {
    const ledger = new BookmarkLedger();
    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['mike', 'jana'] });

    ledger.noteAngle(bookmark.id, 'jana', 'refused: no footage covering that moment');

    expect(ledger.list()[0]?.angles).toEqual([
      { cameraId: 'mike', status: 'pending' },
      { cameraId: 'jana', status: 'pending', note: 'refused: no footage covering that moment' },
    ]);
  });

  test('replaces a note rather than stacking them, so it reads as the latest word', () => {
    const ledger = new BookmarkLedger();
    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['jana'] });

    ledger.noteAngle(bookmark.id, 'jana', 'the phone could not reach the hub');
    ledger.noteAngle(bookmark.id, 'jana', 'refused: no clock estimate for that camera yet');

    expect(ledger.list()[0]?.angles[0]?.note).toBe('refused: no clock estimate for that camera yet');
  });

  // A note explains an absence. Once the clip is here there is nothing to explain.
  test('drops the note when the clip finally arrives', () => {
    const ledger = new BookmarkLedger();
    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['jana'] });
    ledger.noteAngle(bookmark.id, 'jana', 'the phone could not reach the hub');

    ledger.recordClip(bookmark.id, {
      cameraId: 'jana',
      url: '/clips/jana.webm',
      startSessionMs: 3400,
      bookmarkOffsetMs: 1600,
    });

    expect(ledger.list()[0]?.angles[0]).not.toHaveProperty('note');
  });

  /**
   * A phone reporting a failed upload can be heard after a retry of the same
   * upload has already succeeded. The clip is here; there is nothing to explain.
   */
  test('refuses to explain an angle that has already arrived', () => {
    const ledger = new BookmarkLedger();
    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['jana'] });
    ledger.recordClip(bookmark.id, {
      cameraId: 'jana',
      url: '/clips/jana.webm',
      startSessionMs: 3400,
      bookmarkOffsetMs: 1600,
    });

    ledger.noteAngle(bookmark.id, 'jana', 'the phone could not reach the hub');

    expect(ledger.list()[0]?.angles[0]).not.toHaveProperty('note');
    expect(ledger.list()[0]?.angles[0]?.status).toBe('received');
  });

  test('ignores a note for a bookmark or a camera it has never heard of', () => {
    const ledger = new BookmarkLedger();
    const bookmark = ledger.create({ sessionMs: 5000, triggeredBy: 'mike', cameraIds: ['jana'] });

    ledger.noteAngle('not-a-bookmark', 'jana', 'nowhere to put this');
    ledger.noteAngle(bookmark.id, 'petr', 'this camera was not filming');

    expect(ledger.list()[0]?.angles).toEqual([{ cameraId: 'jana', status: 'pending' }]);
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
    expect(it.list()[0]?.angles.every((angle) => angle.status === 'pending')).toBe(true);
  });

  test('ignores a resolution for a bookmark it has never heard of', () => {
    const it = new BookmarkLedger();
    it.resolve('not-a-bookmark', 'done');
    expect(it.list()).toEqual([]);
  });

  describe('clearing the decks between exchanges', () => {
    /**
     * The working loop: fight, review what was marked, draw a line under the
     * passage, fight on. Everything undecided goes, including a bookmark still
     * waiting on footage — a phone may have died, and waiting on it would hold
     * up the one thing the referee wants to do.
     */
    test('resolves every undecided bookmark, footage or not, leaving decisions alone', () => {
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
      // The one decision already made is the only thing left alone.
      expect(byId.get(decided.id)).toBe('red');
      expect(byId.get(stillArriving.id)).toBe('done');
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
