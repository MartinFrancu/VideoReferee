import { describe, expect, test } from 'vitest';

import { CameraRegistry } from './cameras.js';

describe('enrolling cameras', () => {
  test('a camera that has been invited is not yet live', () => {
    const registry = new CameraRegistry();

    const invited = registry.invite('mike', 1000);

    expect(registry.list(1000)).toEqual([
      expect.objectContaining({ id: invited.id, name: 'mike', live: false }),
    ]);
  });

  test('a camera goes live when it joins with the token it was given', () => {
    const registry = new CameraRegistry();
    const invited = registry.invite('mike', 1000);

    registry.join(invited.token, 1200);

    expect(registry.list(1200)[0]?.live).toBe(true);
  });

  test('a join with an unknown token is refused', () => {
    const registry = new CameraRegistry();
    registry.invite('mike', 1000);

    expect(registry.join('not-a-token-we-issued', 1200)).toBeNull();
  });

  test('a camera that has not been heard from recently is no longer live', () => {
    const registry = new CameraRegistry({ staleAfterMs: 3000 });
    const invited = registry.invite('mike', 1000);
    registry.join(invited.token, 1200);

    // Still there, still named, but we have stopped believing it is filming.
    expect(registry.list(1200 + 3001)[0]).toMatchObject({ name: 'mike', live: false });
  });

  test('cameras restored from a saved session are listed, but cannot be joined', () => {
    const registry = new CameraRegistry();
    registry.restore([{ id: 'cam-1', name: 'mike', everJoined: false, removed: false }]);

    expect(registry.list(1000)).toEqual([
      { id: 'cam-1', name: 'mike', live: false, everJoined: false, removed: false },
    ]);
    // They hold no token, so an empty one must not be a skeleton key.
    expect(registry.join('', 1000)).toBeNull();
  });

  /**
   * The distinction above is exactly what a saved session is opened to look at,
   * and it survived being saved — so losing it on the way back in turned every
   * camera in the file into one whose QR was never scanned.
   */
  test('a camera that had joined before the session was saved is still shown as having joined', () => {
    const registry = new CameraRegistry();
    registry.restore([
      { id: 'cam-1', name: 'mike', everJoined: true, removed: false },
      { id: 'cam-2', name: 'jana', everJoined: false, removed: false },
    ]);

    const [mike, jana] = registry.list(1000);

    expect(mike).toMatchObject({ name: 'mike', live: false, everJoined: true });
    expect(jana).toMatchObject({ name: 'jana', live: false, everJoined: false });
  });

  /**
   * The QR is shown once, when the camera is added, and a dialog closed by
   * accident used to mean the phone could never join. The token behind it is
   * still here; nothing ever asked for it again.
   */
  test('hands back the join token of a camera it invited, so its code can be shown again', () => {
    const registry = new CameraRegistry();
    const invited = registry.invite('mike', 1000);

    expect(registry.tokenFor(invited.id)).toBe(invited.token);
  });

  test('has no token for a camera it has never heard of', () => {
    expect(new CameraRegistry().tokenFor('not-a-camera')).toBeNull();
  });

  /**
   * A camera out of a saved file holds no token — deliberately, or an unrelated
   * phone could claim it. There is no code to show, and saying so beats showing
   * one that cannot work.
   */
  test('has no token for a camera restored from a file', () => {
    const registry = new CameraRegistry();
    registry.restore([{ id: 'cam-1', name: 'mike', everJoined: true, removed: false }]);

    expect(registry.tokenFor('cam-1')).toBeNull();
  });

  /**
   * A phone changes hands mid-tournament, or the name was typed in a hurry. The
   * name is what the operator reads on every tile, so it has to be correctable
   * without taking the camera out and putting it back.
   */
  describe('renaming a camera', () => {
    const invited = () => {
      const registry = new CameraRegistry();
      const camera = registry.invite('mike', 1000);
      registry.join(camera.token, 1100);
      return { registry, ...camera };
    };

    test('takes the new name', () => {
      const { registry, id } = invited();

      registry.rename(id, 'jana');

      expect(registry.list(1200)[0]?.name).toBe('jana');
    });

    test('changes nothing else — it is still the same camera, still joined', () => {
      const { registry, id, token } = invited();

      registry.rename(id, 'jana');

      expect(registry.list(1200)[0]).toMatchObject({ id, live: true, everJoined: true, removed: false });
      expect(registry.tokenFor(id)).toBe(token);
    });

    test('trims what was typed', () => {
      const { registry, id } = invited();

      registry.rename(id, '  jana  ');

      expect(registry.list(1200)[0]?.name).toBe('jana');
    });

    // A nameless camera is exactly what naming one was meant to prevent.
    test('refuses a name that is empty or nothing but space', () => {
      const { registry, id } = invited();

      registry.rename(id, '   ');
      registry.rename(id, '');

      expect(registry.list(1200)[0]?.name).toBe('mike');
    });

    test('ignores a camera it has never heard of', () => {
      const { registry, id } = invited();

      registry.rename('not-a-camera', 'jana');

      expect(registry.list(1200)[0]).toMatchObject({ id, name: 'mike' });
    });
  });

  describe('removing a camera from the session', () => {
    const joined = () => {
      const registry = new CameraRegistry({ staleAfterMs: 3000 });
      const invited = registry.invite('mike', 1000);
      registry.join(invited.token, 1200);
      return { registry, ...invited };
    };

    test('marks it removed, and stops calling it live however recently it spoke', () => {
      const { registry, id } = joined();

      registry.remove(id);

      expect(registry.list(1300)).toEqual([
        expect.objectContaining({ id, name: 'mike', live: false, removed: true }),
      ]);
    });

    /**
     * The name has to survive. Every angle of every past bookmark names its
     * camera by looking it up here, so a forgotten camera would quietly rename
     * footage that has already been reviewed.
     */
    test('keeps its name, for the bookmarks it already answered', () => {
      const { registry, id } = joined();

      registry.remove(id);

      expect(registry.list(1300)[0]?.name).toBe('mike');
    });

    // The phone is not asked to leave — it is stopped from coming back.
    test('refuses the token it was let in with', () => {
      const { registry, id, token } = joined();

      registry.remove(id);

      expect(registry.join(token, 1400)).toBeNull();
      expect(registry.tokenFor(id)).toBeNull();
    });

    test('leaves every other camera alone', () => {
      const registry = new CameraRegistry();
      const mike = registry.invite('mike', 1000);
      const jana = registry.invite('jana', 1000);

      registry.remove(mike.id);

      expect(registry.list(1100).find((c) => c.id === jana.id)).toMatchObject({ removed: false });
      expect(registry.join(jana.token, 1100)).toBe(jana.id);
    });

    test('ignores a camera it has never heard of', () => {
      const { registry, id } = joined();

      registry.remove('not-a-camera');

      expect(registry.list(1300)[0]).toMatchObject({ id, removed: false });
    });

    test('a camera that was never removed says so', () => {
      const { registry } = joined();
      expect(registry.list(1300)[0]?.removed).toBe(false);
    });

    // A session saved with a camera removed should open the same way.
    test('carries removal through a saved session', () => {
      const registry = new CameraRegistry();
      registry.restore([
        { id: 'cam-1', name: 'mike', everJoined: true, removed: true },
        { id: 'cam-2', name: 'jana', everJoined: true, removed: false },
      ]);

      expect(registry.list(1000).map((camera) => camera.removed)).toEqual([true, false]);
    });
  });

  test('a camera that has gone quiet is distinguishable from one that never joined', () => {
    // Different problems: one phone needs its QR scanned, the other has died.
    const registry = new CameraRegistry({ staleAfterMs: 3000 });
    const quiet = registry.invite('mike', 1000);
    registry.invite('jana', 1000);
    registry.join(quiet.token, 1200);

    const [mike, jana] = registry.list(1200 + 3001);

    expect(mike).toMatchObject({ live: false, everJoined: true });
    expect(jana).toMatchObject({ live: false, everJoined: false });
  });
});
