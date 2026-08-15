import { describe, expect, it } from 'vitest';

import { stepForKey } from './review-keys';

const press = (over: Partial<Parameters<typeof stepForKey>[0]> = {}) =>
  stepForKey({ key: 'ArrowRight', repeat: false, withModifier: false, typing: false, dialogOpen: false, ...over });

describe('stepForKey', () => {
  it('walks forward on right and back on left', () => {
    expect(press({ key: 'ArrowRight' })).toBe(1);
    expect(press({ key: 'ArrowLeft' })).toBe(-1);
  });

  it('ignores every other key', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'a', ' ', 'Enter', 'Escape', 'Tab', 'PageDown']) {
      expect(stepForKey({ key, repeat: false, withModifier: false, typing: false, dialogOpen: false }), key).toBeNull();
    }
  });

  /**
   * The key repeat the operating system sends is not the one we want: the
   * buttons wait `holdDelayMs` and then walk at `holdRepeatMs`, and a held arrow
   * should feel the same rather than at whatever rate the machine is set to.
   */
  it('ignores the operating system`s own repeat, having its own', () => {
    expect(press({ repeat: true })).toBeNull();
  });

  // Ctrl-Right and friends belong to the browser: jumping words, switching tabs.
  it('leaves a modified arrow to the browser', () => {
    expect(press({ withModifier: true })).toBeNull();
  });

  it('leaves the arrows alone while something is being typed into', () => {
    expect(press({ typing: true })).toBeNull();
  });

  /**
   * The state dialog is a list of radio buttons, and arrows are how a keyboard
   * moves between them. Stepping the footage underneath at the same time would
   * make choosing red quietly move the frame you were deciding about.
   */
  it('leaves the arrows to the dialog while one is open', () => {
    expect(press({ dialogOpen: true })).toBeNull();
  });
});
