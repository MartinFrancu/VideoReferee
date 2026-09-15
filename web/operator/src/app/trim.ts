// Lining an angle up by hand, when the arithmetic has not managed it.
//
// The hub works out where the bookmarked instant falls inside each clip, and
// mostly gets it right. When it does not, two angles disagree about *when*,
// which on screen is indistinguishable from two angles disagreeing about *what
// happened* — and the referee is the one person who can see which it is.
//
// So this is the manual override: a number of milliseconds per angle, added on
// top of the hub's offset. It does not correct the estimates and is not fed
// back into them; it moves one clip against the others, for this bookmark, and
// says on the tile that it has been moved.

/** How far a trim may go. Far beyond any sync error worth correcting by eye. */
export const MAX_TRIM_MS = 2000;

/** Just enough of an angle to place it. The rest of it is nothing to do here. */
interface Placed {
  readonly bookmarkOffsetMs?: number;
}

/**
 * Where in this clip the stage position `relativeMs` falls.
 *
 * Positive `trimMs` shows a later frame of this camera's own footage, which is
 * what is wanted when it is behind the others and has to catch up.
 */
export function mediaMsFor(angle: Placed, trimMs: number, relativeMs: number): number {
  return (angle.bookmarkOffsetMs ?? 0) + trimMs + relativeMs;
}

/**
 * Where this clip's position `mediaMs` falls on the stage — the inverse.
 *
 * Playback reads every angle's position back through this to keep the rest with
 * the lead, so it has to undo `mediaMsFor` exactly: a mismatch would have them
 * chasing a position they are already at.
 */
export function stageMsFor(angle: Placed, trimMs: number, mediaMs: number): number {
  return mediaMs - (angle.bookmarkOffsetMs ?? 0) - trimMs;
}

/**
 * The badge for a trimmed angle, or null for one nobody has touched.
 *
 * Always shown once there is a trim, unlike the uncertainty figure beside it.
 * That one is a measurement and stays quiet until it matters; this one is a
 * decision somebody made about what is on screen, and it should never be
 * possible to look at a corrected angle without knowing it was corrected.
 */
export function trimLabel(trimMs: number | undefined): string | null {
  if (!trimMs) return null;
  // A proper minus sign: this sits next to the ± of the uncertainty badge, and
  // a hyphen beside it reads as a dash rather than as a sign.
  const sign = trimMs < 0 ? '−' : '+';
  return `${sign}${(Math.abs(trimMs) / 1000).toFixed(2)}s`;
}

/** One nudge, kept whole and kept on the clip. */
export function nudgedTrim(trimMs: number | undefined, deltaMs: number): number {
  const wanted = Math.round((trimMs ?? 0) + deltaMs);
  return Math.max(-MAX_TRIM_MS, Math.min(wanted, MAX_TRIM_MS));
}
