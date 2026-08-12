import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveBlobAs } from './save-file';

const session = new Blob(['{"format":1}'], { type: 'application/json' });

interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

/** A browser whose save-as dialog is accepted, saving under `as`. */
function browserThatSaves(as: string) {
  const offered: PickerOptions[] = [];
  const written: Blob[] = [];
  let closed = false;

  const showSaveFilePicker = async (options: PickerOptions) => {
    offered.push(options);
    return {
      name: as,
      createWritable: async () => ({
        write: async (data: Blob) => void written.push(data),
        close: async () => void (closed = true),
      }),
    };
  };

  vi.stubGlobal('window', { showSaveFilePicker });
  return { offered, written, closed: () => closed };
}

/** A browser whose save-as dialog is dismissed, or that fails outright. */
function browserThatRefuses(error: Error) {
  vi.stubGlobal('window', {
    showSaveFilePicker: async () => {
      throw error;
    },
  });
}

/** A browser with no save-as dialog at all: Firefox, Safari, an old phone. */
function browserWithNoPicker() {
  const link: Record<string, unknown> = {};
  const clicked: string[] = [];
  const revoked: string[] = [];
  let inDocument = false;

  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {
    createElement: () => ({
      set href(value: string) {
        link['href'] = value;
      },
      set download(value: string) {
        link['download'] = value;
      },
      click: () => clicked.push(String(link['download'])),
      remove: () => void (inDocument = false),
    }),
    body: { append: () => void (inDocument = true) },
  });
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:session',
    revokeObjectURL: (url: string) => void revoked.push(url),
  });

  return { link, clicked, revoked, inDocument: () => inDocument };
}

afterEach(() => vi.unstubAllGlobals());

describe('saveBlobAs', () => {
  it('offers the suggested name, and a .json filter to save it under', async () => {
    const browser = browserThatSaves('anything.json');

    await saveBlobAs(session, 'videoreferee-2026-08-09.json');

    expect(browser.offered[0]?.suggestedName).toBe('videoreferee-2026-08-09.json');
    expect(browser.offered[0]?.types?.[0]?.accept).toEqual({ 'application/json': ['.json'] });
  });

  it('writes the session where the operator pointed, and closes the file', async () => {
    const browser = browserThatSaves('bout-3.json');

    await saveBlobAs(session, 'videoreferee-2026-08-09.json');

    expect(browser.written).toEqual([session]);
    expect(browser.closed()).toBe(true);
  });

  /**
   * The name the operator typed, not the one we suggested — that is the whole
   * point of the dialog, and it is the name worth telling them about after.
   */
  it('answers the name it was actually saved under', async () => {
    browserThatSaves('bout-3.json');

    expect(await saveBlobAs(session, 'videoreferee-2026-08-09.json')).toBe('bout-3.json');
  });

  // Changing your mind is a decision, not a failure. Nothing to report.
  it('answers nothing when the dialog is dismissed', async () => {
    const dismissed = new Error('The user aborted a request.');
    dismissed.name = 'AbortError';
    browserThatRefuses(dismissed);

    expect(await saveBlobAs(session, 'videoreferee-2026-08-09.json')).toBeNull();
  });

  // A folder that cannot be written to is worth saying out loud.
  it('does not swallow a failure that is not a dismissal', async () => {
    browserThatRefuses(new DOMException('nope', 'NotAllowedError'));

    await expect(saveBlobAs(session, 'videoreferee-2026-08-09.json')).rejects.toThrow(/nope/);
  });

  describe('where the browser has no save-as dialog', () => {
    it('downloads under the suggested name instead', async () => {
      const browser = browserWithNoPicker();

      const saved = await saveBlobAs(session, 'videoreferee-2026-08-09.json');

      expect(browser.clicked).toEqual(['videoreferee-2026-08-09.json']);
      expect(browser.link['href']).toBe('blob:session');
      expect(saved).toBe('videoreferee-2026-08-09.json');
    });

    // The bug this replaced was an anchor disappearing mid-download. This one is
    // created, clicked and dropped in one go, leaving nothing behind either way.
    it('leaves no link and no blob URL behind', async () => {
      const browser = browserWithNoPicker();

      await saveBlobAs(session, 'videoreferee-2026-08-09.json');

      expect(browser.inDocument()).toBe(false);
      expect(browser.revoked).toEqual(['blob:session']);
    });
  });
});
