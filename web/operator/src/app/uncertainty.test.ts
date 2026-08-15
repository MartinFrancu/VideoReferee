import { describe, expect, it } from 'vitest';

import { loosenessLabel } from './uncertainty';

describe('loosenessLabel', () => {
  const within = 100;

  it('says how far out an angle could be, once it is further than we trust', () => {
    expect(loosenessLabel(241, within)).toBe('±0.24s');
    expect(loosenessLabel(1500, within)).toBe('±1.50s');
  });

  /**
   * Silence is the normal case and has to stay silent. A figure on every angle
   * of every bookmark is a figure nobody reads, and the one time it matters it
   * would look like all the others.
   */
  it('says nothing about an angle inside what we trust', () => {
    expect(loosenessLabel(99, within)).toBeNull();
    expect(loosenessLabel(100, within)).toBeNull();
    expect(loosenessLabel(0, within)).toBeNull();
  });

  it('says nothing for a clip that has no figure — an older file, or none yet', () => {
    expect(loosenessLabel(undefined, within)).toBeNull();
  });

  /**
   * To the nearest hundredth of a second, which at these magnitudes is a
   * rounding of no consequence — but it must round rather than cut, or 999ms
   * reads as "±0.99s" and looks like a figure that stopped short of a second.
   */
  it('rounds to the nearest hundredth of a second', () => {
    expect(loosenessLabel(105, within)).toBe('±0.10s');
    expect(loosenessLabel(117, within)).toBe('±0.12s');
    expect(loosenessLabel(999, within)).toBe('±1.00s');
  });
});
