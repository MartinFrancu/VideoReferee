import { describe, expect, it } from 'vitest';

import { MAX_TRIM_MS, mediaMsFor, nudgedTrim, stageMsFor, trimLabel } from './trim';

describe('mediaMsFor', () => {
  const angle = { bookmarkOffsetMs: 1500 };

  it('finds the bookmarked instant at the offset the hub cut to', () => {
    expect(mediaMsFor(angle, 0, 0)).toBe(1500);
  });

  it('moves with the stage, a millisecond for a millisecond', () => {
    expect(mediaMsFor(angle, 0, 250)).toBe(1750);
    expect(mediaMsFor(angle, 0, -250)).toBe(1250);
  });

  /**
   * The sign is the whole of what a referee has to understand, and the only
   * thing here that cannot be checked by looking at the screen — a trim of the
   * wrong sign looks exactly like a trim that was not big enough.
   *
   * Positive means this camera is behind the others and has to catch up, so it
   * shows a later frame of its own footage.
   */
  it('shows a later frame of this camera for a positive trim', () => {
    expect(mediaMsFor(angle, 200, 0)).toBe(1700);
  });

  it('shows an earlier frame for a negative trim', () => {
    expect(mediaMsFor(angle, -200, 0)).toBe(1300);
  });

  // A clip cut before the hub recorded where the instant fell inside it.
  it('treats an angle with no offset as one whose instant is at its start', () => {
    expect(mediaMsFor({}, 0, 400)).toBe(400);
  });
});

describe('stageMsFor', () => {
  const angle = { bookmarkOffsetMs: 1500 };

  /**
   * The inverse, and it has to be exactly the inverse: playback reads each
   * angle's position back this way to keep the others with the lead, so a
   * mismatch would have them chase a position they are already at.
   */
  it('undoes mediaMsFor, trim and all', () => {
    for (const trimMs of [0, 200, -200]) {
      for (const relativeMs of [0, 250, -250]) {
        expect(stageMsFor(angle, trimMs, mediaMsFor(angle, trimMs, relativeMs))).toBe(relativeMs);
      }
    }
  });
});

describe('trimLabel', () => {
  /** Silence for an angle nobody has touched: most of them, most of the time. */
  it('says nothing about an untrimmed angle', () => {
    expect(trimLabel(0)).toBeNull();
    expect(trimLabel(undefined)).toBeNull();
  });

  /**
   * Always signed. A correction made by hand is a thing the referee is
   * responsible for, and it should read as one rather than as a measurement.
   */
  it('says which way, and by how much', () => {
    expect(trimLabel(200)).toBe('+0.20s');
    expect(trimLabel(-200)).toBe('−0.20s');
  });

  it('rounds to the nearest hundredth rather than cutting', () => {
    expect(trimLabel(996)).toBe('+1.00s');
    expect(trimLabel(35)).toBe('+0.04s');
  });
});

describe('nudgedTrim', () => {
  it('adds the nudge to what is already there', () => {
    expect(nudgedTrim(100, 33)).toBe(133);
    expect(nudgedTrim(100, -33)).toBe(67);
  });

  it('starts from nothing for an angle that has never been trimmed', () => {
    expect(nudgedTrim(undefined, 33)).toBe(33);
  });

  /**
   * A held button walks, and without a stop it walks the angle off the end of
   * its own footage into a veiled tile with no way back but Reset. The limit is
   * far beyond any sync error worth correcting.
   */
  it('stops at the limit rather than walking off the clip', () => {
    expect(nudgedTrim(MAX_TRIM_MS, 100)).toBe(MAX_TRIM_MS);
    expect(nudgedTrim(-MAX_TRIM_MS, -100)).toBe(-MAX_TRIM_MS);
    expect(nudgedTrim(MAX_TRIM_MS - 10, 100)).toBe(MAX_TRIM_MS);
  });

  it('rounds to whole milliseconds, whatever the frame time is', () => {
    expect(nudgedTrim(0, 16.6667)).toBe(17);
  });
});
