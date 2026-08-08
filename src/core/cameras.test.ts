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
    registry.restore([{ id: 'cam-1', name: 'mike' }]);

    expect(registry.list(1000)).toEqual([
      { id: 'cam-1', name: 'mike', live: false, everJoined: false },
    ]);
    // They hold no token, so an empty one must not be a skeleton key.
    expect(registry.join('', 1000)).toBeNull();
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
