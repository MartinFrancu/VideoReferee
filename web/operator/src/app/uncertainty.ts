// Saying how far out an angle could be — but only when it is worth saying.
//
// Every clip carries a bound on how wrong its alignment might be, and until now
// nothing anywhere looked at it. The point is not to decorate the screen with a
// figure: it is that two angles which disagree about *when* look exactly like
// two angles that disagree about *what happened*, and this is the one number
// that can tell a referee which of those they are looking at.

/**
 * The label for an angle looser than we trust, or null for one we do.
 *
 * Silence is the normal case, deliberately. A figure on every tile is a figure
 * nobody reads, and then the once it matters it looks like all the others.
 */
export function loosenessLabel(uncertaintyMs: number | undefined, trustedWithinMs: number): string | null {
  if (uncertaintyMs === undefined || uncertaintyMs <= trustedWithinMs) return null;
  return `±${(uncertaintyMs / 1000).toFixed(2)}s`;
}
