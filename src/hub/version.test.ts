import { describe, expect, it } from 'vitest';

import { versionFrom } from './version.js';

describe('versionFrom', () => {
  it('reads the version out of a package manifest', () => {
    expect(versionFrom({ name: 'videoreferee', version: '0.0.2' })).toBe('0.0.2');
  });

  /**
   * The version is decoration everywhere it appears — a screen, a log line, a
   * saved file. None of that is worth failing to start over, so an unreadable
   * manifest says so and the hub carries on.
   */
  describe('says "unknown" rather than throwing', () => {
    it('when there is no version', () => {
      expect(versionFrom({ name: 'videoreferee' })).toBe('unknown');
    });

    it('when the version is not a string', () => {
      expect(versionFrom({ version: 2 })).toBe('unknown');
      expect(versionFrom({ version: null })).toBe('unknown');
    });

    it('when it is not a manifest at all', () => {
      for (const junk of [undefined, null, 'nope', 42, []]) {
        expect(versionFrom(junk)).toBe('unknown');
      }
    });
  });
});
