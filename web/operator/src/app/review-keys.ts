// Whether a key press means "step the footage", and which way.
//
// Kept apart from the component because it is all judgement and no DOM: most of
// the arrow presses that reach a review screen are meant for something else —
// the browser, a text field, the radio buttons in the state dialog — and getting
// that wrong is invisible until it moves the frame somebody was deciding about.

export interface KeyPress {
  readonly key: string;
  /** The operating system's auto-repeat, which we do not use. */
  readonly repeat: boolean;
  /** Ctrl, Alt, Meta or Shift is down, so this press belongs to the browser. */
  readonly withModifier: boolean;
  /** Focus is in something that takes typing. */
  readonly typing: boolean;
  /** A dialog is open, and arrows are how a keyboard moves around one. */
  readonly dialogOpen: boolean;
}

/** Frames to step: forward, back, or nothing at all. */
export function stepForKey(press: KeyPress): 1 | -1 | null {
  if (press.repeat || press.withModifier || press.typing || press.dialogOpen) return null;
  if (press.key === 'ArrowRight') return 1;
  if (press.key === 'ArrowLeft') return -1;
  return null;
}
