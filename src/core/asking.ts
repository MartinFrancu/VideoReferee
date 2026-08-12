// Asking a camera again for footage it has not sent.
//
// A bookmark is broadcast once. If that message, or the upload it should have
// produced, is lost — a phone that blinked off the Wi-Fi, a page that stopped
// running while the screen was locked, a POST that failed in flight — the
// footage is still sitting in the phone's ring for another twenty seconds, and
// nothing used to go back for it.
//
// The hub does the deciding here, as it does everywhere else (INV-3). The phone
// cannot know what it owes: it holds bytes, and it has no idea which of them
// cover which moment.

export interface RingReach {
  /** How much footage the phone keeps. */
  readonly ringWindowMs: number;
  /** How much of the run-up a clip has to carry. */
  readonly preRollMs: number;
}

/**
 * Whether a camera could still answer this bookmark at all.
 *
 * The run-up is the part that expires first: a ring holding 25 s stops being
 * able to produce the 1.5 s before an instant 23.5 s after it, and a clip that
 * begins at the moment itself is not the clip that was asked for.
 */
export function stillAnswerable({
  bookmarkSessionMs,
  now,
  ringWindowMs,
  preRollMs,
}: RingReach & { bookmarkSessionMs: number; now: number }): boolean {
  return now - bookmarkSessionMs <= ringWindowMs - preRollMs;
}

/**
 * Whether to ask this camera for this bookmark now.
 *
 * Rate-limited so a phone already uploading eight megabytes is not asked for
 * another copy of them, and stopped entirely once the footage has certainly
 * rolled out — chasing it then costs the phone bandwidth it needs for the
 * bookmark being taken now.
 */
export function shouldAskAgain({
  bookmarkSessionMs,
  now,
  lastAskedAt,
  askAgainEveryMs,
  ringWindowMs,
  preRollMs,
}: RingReach & {
  bookmarkSessionMs: number;
  now: number;
  /** When this camera was last asked for this bookmark; null if never. */
  lastAskedAt: number | null;
  askAgainEveryMs: number;
}): boolean {
  if (!stillAnswerable({ bookmarkSessionMs, now, ringWindowMs, preRollMs })) return false;
  if (lastAskedAt === null) return true;
  return now - lastAskedAt >= askAgainEveryMs;
}
