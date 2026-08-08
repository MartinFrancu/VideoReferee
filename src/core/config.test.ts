import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, readConfig } from './config.js';

const read = (input: unknown) => readConfig(input);
const said = (input: unknown) => read(input).problems.join(' | ');

describe('readConfig', () => {
  it('uses the defaults when there is no file', () => {
    expect(read(undefined).config).toEqual(DEFAULT_CONFIG);
    expect(read(undefined).problems).toEqual([]);
  });

  it('applies one setting and defaults the rest', () => {
    const { config, problems } = read({ bookmark: { preRollMs: 4000 } });
    expect(config.bookmark.preRollMs).toBe(4000);
    expect(config.bookmark.postRollMs).toBe(DEFAULT_CONFIG.bookmark.postRollMs);
    expect(config.review.frameMs).toBe(DEFAULT_CONFIG.review.frameMs);
    expect(problems).toEqual([]);
  });

  it('applies settings across several sections at once', () => {
    const { config, problems } = read({
      bookmark: { preRollMs: 4000 },
      camera: { ringWindowMs: 40_000, warmUpMs: 30_000 },
      review: { frameMs: 40 },
    });
    expect(config.bookmark.preRollMs).toBe(4000);
    expect(config.camera.warmUpMs).toBe(30_000);
    expect(config.review.frameMs).toBe(40);
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
        expect(said(junk)).toMatch(/not a set of settings/i);
      }
    });

    // A string is iterable, so a section left as one is otherwise "read"
    // character by character and complained about a letter at a time.
    it('on a section that is not an object', () => {
      const { config, problems } = read({ review: 'fast' });
      expect(config.review).toEqual(DEFAULT_CONFIG.review);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/"review" should be a group of settings/);
    });

    it('on a setting that is not a number', () => {
      const { config } = read({ bookmark: { preRollMs: '4000' } });
      expect(config.bookmark.preRollMs).toBe(DEFAULT_CONFIG.bookmark.preRollMs);
      expect(said({ bookmark: { preRollMs: '4000' } })).toMatch(/preRollMs/);
    });

    it('on a setting that is zero, negative or not finite', () => {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const { config } = read({ review: { frameMs: bad } });
        expect(config.review.frameMs).toBe(DEFAULT_CONFIG.review.frameMs);
        expect(said({ review: { frameMs: bad } })).toMatch(/frameMs/);
      }
    });
  });

  describe('says what it did not understand', () => {
    // A typo is otherwise completely silent: the setting the operator thought
    // they changed simply keeps its old value.
    it('names an unknown setting inside a section it knows', () => {
      expect(said({ review: { frameMS: 40 } })).toMatch(/frameMS/);
    });

    it('names an unknown section', () => {
      expect(said({ playback: { frameMs: 40 } })).toMatch(/playback/);
    });

    // The whole reason for sections is knowing where a setting belongs, so
    // being in the wrong one is the mistake most worth answering properly.
    it('points a setting put in the wrong section at the right one', () => {
      const problems = said({ review: { preRollMs: 4000 } });
      expect(problems).toMatch(/preRollMs/);
      expect(problems).toMatch(/bookmark/);
    });
  });

  describe('settings that would break each other', () => {
    /**
     * The ring holds a window of footage, so what a camera can ever be holding
     * is bounded by it. A warm-up at or above the window is never reached, and
     * the camera would sit at "getting ready" for the whole bout with BOOKMARK
     * disabled — so it is pulled back inside rather than obeyed.
     */
    it('a warm-up the ring can never reach is brought back inside it', () => {
      const { config, problems } = read({ camera: { warmUpMs: 30_000, ringWindowMs: 25_000 } });
      expect(config.camera.warmUpMs).toBeLessThan(config.camera.ringWindowMs);
      expect(problems.join(' ')).toMatch(/warmUpMs/);
    });

    it('leaves a warm-up that fits alone', () => {
      const { config, problems } = read({ camera: { warmUpMs: 10_000, ringWindowMs: 25_000 } });
      expect(config.camera.warmUpMs).toBe(10_000);
      expect(problems).toEqual([]);
    });

    // These two rules span sections, which is exactly why they are checked
    // here rather than left to whoever is reading the file.
    it('says when the roll either side cannot fit in the ring', () => {
      const problems = said({
        bookmark: { preRollMs: 20_000, postRollMs: 10_000 },
        camera: { ringWindowMs: 25_000 },
      });
      expect(problems).toMatch(/preRollMs|postRollMs/);
      expect(problems).toMatch(/ring/i);
    });

    it('says when the upload wait is shorter than the post-roll', () => {
      expect(said({ bookmark: { postRollMs: 3000, postRollWaitMs: 1500 } })).toMatch(/postRollWaitMs/);
    });
  });
});
