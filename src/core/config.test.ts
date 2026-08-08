import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, readConfig } from './config.js';

const read = (input: unknown) => readConfig(input);

describe('readConfig', () => {
  it('uses the defaults when there is no file', () => {
    expect(read(undefined).config).toEqual(DEFAULT_CONFIG);
    expect(read(undefined).problems).toEqual([]);
  });

  it('applies one setting and defaults the rest', () => {
    const { config, problems } = read({ preRollMs: 4000 });
    expect(config.preRollMs).toBe(4000);
    expect(config.postRollMs).toBe(DEFAULT_CONFIG.postRollMs);
    expect(problems).toEqual([]);
  });

  /**
   * The hub runs at a tournament. A config it dislikes must never stop it
   * starting — it says what it ignored and carries on with the default.
   */
  describe('never refuses to start', () => {
    it('on a file that is not an object', () => {
      for (const junk of ['nope', 42, null, []]) {
        expect(read(junk).config).toEqual(DEFAULT_CONFIG);
        expect(read(junk).problems.join(' ')).toMatch(/not a set of settings/i);
      }
    });

    it('on a setting that is not a number', () => {
      const { config, problems } = read({ preRollMs: '4000' });
      expect(config.preRollMs).toBe(DEFAULT_CONFIG.preRollMs);
      expect(problems.join(' ')).toMatch(/preRollMs/);
    });

    it('on a setting that is zero, negative or not finite', () => {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const { config, problems } = read({ frameMs: bad });
        expect(config.frameMs).toBe(DEFAULT_CONFIG.frameMs);
        expect(problems.join(' ')).toMatch(/frameMs/);
      }
    });
  });

  // A typo in a config file is otherwise completely silent: the setting the
  // operator thought they changed simply keeps its old value.
  it('names a setting it does not recognise', () => {
    const { problems } = read({ preRollMS: 4000 });
    expect(problems.join(' ')).toMatch(/preRollMS/);
    expect(problems.join(' ')).toMatch(/not a setting|unknown/i);
  });

  describe('settings that would break each other', () => {
    /**
     * The ring holds a window of footage, so what a camera can ever be holding
     * is bounded by it. A warm-up target at or above the window is never
     * reached, and the camera would sit at "getting ready" for the whole bout
     * with BOOKMARK disabled — so it is pulled back inside rather than obeyed.
     */
    it('a warm-up the ring can never reach is brought back inside it', () => {
      const { config, problems } = read({ warmUpMs: 30_000, ringWindowMs: 25_000 });
      expect(config.warmUpMs).toBeLessThan(config.ringWindowMs);
      expect(problems.join(' ')).toMatch(/warmUpMs/);
    });

    it('leaves a warm-up that fits alone', () => {
      const { config, problems } = read({ warmUpMs: 10_000, ringWindowMs: 25_000 });
      expect(config.warmUpMs).toBe(10_000);
      expect(problems).toEqual([]);
    });

    // Asking for more footage around a bookmark than the camera ever holds
    // means clips that are quietly short at one end.
    it('says when the roll either side cannot fit in the ring', () => {
      const { problems } = read({ preRollMs: 20_000, postRollMs: 10_000, ringWindowMs: 25_000 });
      expect(problems.join(' ')).toMatch(/preRollMs|postRollMs/);
      expect(problems.join(' ')).toMatch(/ring/i);
    });

    // The phone waits this long after a bookmark before uploading. Wait less
    // than the post-roll and the footage after the moment is not recorded yet.
    it('says when the upload wait is shorter than the post-roll', () => {
      const { problems } = read({ postRollMs: 3000, postRollWaitMs: 1500 });
      expect(problems.join(' ')).toMatch(/postRollWaitMs/);
    });
  });
});
