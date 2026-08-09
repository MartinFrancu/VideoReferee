import { describe, expect, it } from 'vitest';

import { STATE_FORMAT, isSafeClipName, parseSavedState, type SavedState } from './state.js';

const valid: SavedState = {
  format: STATE_FORMAT,
  savedAt: '2026-08-08T20:14:33.000Z',
  version: '0.0.2',
  boutPhase: 'recording',
  cameras: [
    { id: 'cam-1', name: 'mike', live: true, everJoined: true, heldMs: 20_000, syncUncertaintyMs: 4 },
  ],
  bookmarks: [
    {
      id: 'bm-1',
      sessionMs: 1_786_000_000_000,
      triggeredBy: 'mike',
      resolution: 'red',
      angles: [
        {
          cameraId: 'cam-1',
          status: 'received',
          url: '/clips/bm-1_cam-1.webm',
          startSessionMs: 1_785_999_998_462,
          bookmarkOffsetMs: 1538,
        },
      ],
    },
  ],
  clips: [{ name: 'bm-1_cam-1.webm', base64: 'GkXfow==' }],
};

/**
 * A mutable deep copy. These tests break one field at a time on purpose, which
 * `SavedState` exists to forbid — so the draft type is deliberately loose.
 */
interface Draft {
  format: number;
  savedAt: string;
  version?: string;
  boutPhase: string;
  cameras: Record<string, unknown>[];
  bookmarks: {
    id: string;
    sessionMs?: number;
    triggeredBy: string;
    resolution?: string;
    angles: Record<string, unknown>[];
  }[];
  clips: { name: string; base64: string }[];
}

const clone = (): Draft => JSON.parse(JSON.stringify(valid));

describe('parseSavedState', () => {
  it('accepts a state it wrote itself', () => {
    const read = parseSavedState(clone());
    expect(read.bookmarks).toEqual(valid.bookmarks);
    expect(read.clips).toEqual(valid.clips);
    expect(read.savedAt).toBe(valid.savedAt);
    expect(read.version).toBe('0.0.2');
    expect(read.boutPhase).toBe('recording');
  });

  // A file cannot be filming. Showing a loaded camera as live would put a green
  // light next to a phone that is not in the room.
  it('marks every loaded camera as not live, however it was saved', () => {
    expect(parseSavedState(clone()).cameras[0]).toMatchObject({
      id: 'cam-1',
      name: 'mike',
      live: false,
      everJoined: true,
    });
  });

  /**
   * Which build wrote it — the first question worth asking of a file someone
   * sends you. A file from before it was recorded simply cannot say.
   */
  it('says which version wrote the file, or admits it does not know', () => {
    const before = clone();
    delete before.version;
    expect(parseSavedState(before).version).toBe('unknown');
    expect(parseSavedState({ ...clone(), version: 7 }).version).toBe('unknown');
  });

  // A file written before bookmarks could be resolved has none of these.
  it('treats a bookmark with no recorded decision as unresolved', () => {
    const state = clone();
    delete state.bookmarks[0]!.resolution;
    expect(parseSavedState(state).bookmarks[0]?.resolution).toBe('unresolved');
  });

  it('refuses a decision it does not recognise rather than storing it', () => {
    const state = clone();
    state.bookmarks[0]!.resolution = 'chartreuse';
    expect(parseSavedState(state).bookmarks[0]?.resolution).toBe('unresolved');
  });

  it('accepts a state with no bookmarks and no clips', () => {
    const empty = { ...clone(), bookmarks: [], clips: [] };
    expect(parseSavedState(empty).bookmarks).toEqual([]);
  });

  describe('refuses what it cannot trust', () => {
    it('a file that is not an object', () => {
      expect(() => parseSavedState('nope')).toThrow(/not a saved state/i);
      expect(() => parseSavedState(null)).toThrow(/not a saved state/i);
    });

    // Saying "format 2" out loud beats failing somewhere deep in the angles.
    it('a format this build does not know', () => {
      expect(() => parseSavedState({ ...clone(), format: 99 })).toThrow(/format 99/i);
    });

    it('bookmarks or cameras that are not arrays', () => {
      expect(() => parseSavedState({ ...clone(), bookmarks: {} })).toThrow(/bookmarks/i);
      expect(() => parseSavedState({ ...clone(), cameras: 'mike' })).toThrow(/cameras/i);
    });

    it('a bookmark missing the instant that defines it', () => {
      const state = clone();
      delete state.bookmarks[0]!.sessionMs;
      expect(() => parseSavedState(state)).toThrow(/sessionMs/i);
    });

    it('an angle that names no camera', () => {
      const state = clone();
      delete state.bookmarks[0]!.angles[0]!['cameraId'];
      expect(() => parseSavedState(state)).toThrow(/cameraId/i);
    });

    // A saved state is a file from outside. Its clip names become filenames.
    it('a clip name that would escape the clips directory', () => {
      const state = clone();
      state.clips[0] = { name: '../../certs/key.pem', base64: 'AA==' };
      expect(() => parseSavedState(state)).toThrow(/clip name/i);
    });
  });
});

describe('isSafeClipName', () => {
  it('accepts the names the hub generates', () => {
    expect(isSafeClipName('bm-1_cam-1.webm')).toBe(true);
    expect(
      isSafeClipName('a406d8e5-5982-4658-a1ff-b576a6ad1d00_9c97a23f-a986-4506-9738-3ae89af507c8.webm')
    ).toBe(true);
  });

  it('refuses anything that is not a bare .webm filename', () => {
    for (const name of [
      '../key.pem',
      '..\\key.pem',
      'sub/dir.webm',
      'sub\\dir.webm',
      '/absolute.webm',
      'C:\\windows.webm',
      '.webm',
      'no-extension',
      'clip.webm.exe',
      'clip\0.webm',
      '',
    ]) {
      expect(isSafeClipName(name), name).toBe(false);
    }
  });
});
