// Which slice of the recording a bookmark wants to show, and where in it.
//
// A bookmark is an instant (INV-4), the same as in the main version. What the
// referee actually watches is a short window around it: enough run-up to see
// the movement that led there, and enough after to see what it did.
//
// Nothing here knows about video. It is arithmetic on milliseconds, kept apart
// because a sign error in it is invisible on a screen — the footage would look
// perfectly real, just of the wrong moment.

/**
 * The window to review for a bookmark, clamped to what was actually recorded.
 *
 * Both ends can be short. A bookmark in the first seconds has less run-up than
 * was asked for, and one marked just before the fight was stopped may have
 * almost nothing after it — which the screen has to say, because a window that
 * silently ends early looks like footage that silently stopped.
 *
 * @param {object} spec
 * @param {number} spec.atMs where the bookmark falls in the recording
 * @param {number} spec.leadMs how much before it to show
 * @param {number} spec.tailMs how much after it to show
 * @param {number} spec.durationMs how long the recording turned out to be
 */
export function windowFor({ atMs, leadMs, tailMs, durationMs }) {
  const startMs = Math.max(0, atMs - leadMs);
  const endMs = Math.min(durationMs, atMs + tailMs);
  return {
    startMs,
    endMs,
    atMs: Math.max(startMs, Math.min(atMs, endMs)),
    /** Missing run-up, in ms. Zero when the bookmark got all it asked for. */
    shortLeadMs: Math.max(0, leadMs - (atMs - startMs)),
    /** Missing tail — almost always because the fight was stopped too quickly. */
    shortTailMs: Math.max(0, tailMs - (endMs - atMs)),
  };
}

/**
 * Whether the camera's own frame clock actually ran during this recording.
 *
 * Every mark is timed twice — by the page's clock and by the camera's — because
 * the lag between asking for a recording and the first encoded frame is real
 * and nothing reports it. But the camera's clock is not available everywhere,
 * and where it is missing it does not read as missing: it reads as zero, over
 * and over. Believing it then puts every mark of a bout at the same instant.
 *
 * So it has to be seen to have run. Marks are taken in order, one after
 * another, so their times must come back strictly increasing and above zero.
 * A single reading shows nothing running and is not taken as evidence.
 *
 * @param {readonly {frameMs: number | null}[]} marks in the order they were taken
 */
export function frameClockUsable(marks) {
  if (marks.length < 2) return false;
  let previous = 0;
  for (const mark of marks) {
    if (typeof mark.frameMs !== 'number' || !(mark.frameMs > previous)) return false;
    previous = mark.frameMs;
  }
  return true;
}

/** Keep a playback position inside its window. */
export function clampWithin(positionMs, { startMs, endMs }) {
  return Math.max(startMs, Math.min(positionMs, endMs));
}

/**
 * What to say about a window that did not get everything it asked for.
 *
 * Only ever about the tail: a bookmark near the start of a recording is
 * self-evidently near the start, but a fight stopped a moment after a bookmark
 * gives a window that ends mid-movement, and that is worth saying out loud
 * rather than leaving to look like a fault.
 */
export function shortfallLabel({ shortTailMs }, { noticeAboveMs = 100 } = {}) {
  if (shortTailMs <= noticeAboveMs) return null;
  return `stopped ${(shortTailMs / 1000).toFixed(1)}s after this mark`;
}
