// What was bookmarked, and which angles have turned up for it.
//
// A bookmark is an instant, not a clip (INV-4). Clips are evidence that may
// arrive late, partially, or never — so a bookmark always knows which cameras it
// is still waiting on, and is renderable long before they all report in.

export type AngleStatus = 'pending' | 'received';

/**
 * What the referee decided about a bookmark.
 *
 * Colours rather than meanings, because that is what was asked for and the
 * meanings are not settled — red and blue presumably being the two fighters,
 * but nothing here depends on that. Attaching sense to them later is a change
 * of label, not of shape.
 *
 * "unresolved" rather than "pending": an angle is already pending, and two
 * different pendings on one screen would be one too many.
 */
export type Resolution = 'unresolved' | 'red' | 'blue' | 'purple' | 'done';

/**
 * What to show for a bookmark — the decision, or that it is still gathering.
 *
 * `loading` is derived on every read rather than stored, because it stops being
 * true the moment the last clip lands and a stored copy would not notice.
 */
export type BookmarkState = 'loading' | Resolution;

export interface Angle {
  readonly cameraId: string;
  readonly status: AngleStatus;
  /** Where the clip landed, once it has. */
  readonly url?: string;
  /** Session time of the clip's first frame. */
  readonly startSessionMs?: number;
  /** Where the bookmarked instant falls inside this clip. */
  readonly bookmarkOffsetMs?: number;
}

export interface Bookmark {
  readonly id: string;
  /** The bookmarked instant on the hub's clock. */
  readonly sessionMs: number;
  readonly triggeredBy: string;
  readonly angles: readonly Angle[];
  /** What the referee decided. Stored. */
  readonly resolution: Resolution;
  /** What to show. Derived from the resolution and the angles on every read. */
  readonly state: BookmarkState;
}

/**
 * A decision outranks the wait for footage: a referee who has already called it
 * does not need to be told clips are still arriving.
 */
function stateOf(resolution: Resolution, angles: readonly Angle[]): BookmarkState {
  if (resolution !== 'unresolved') return resolution;
  return angles.some((angle) => angle.status === 'pending') ? 'loading' : 'unresolved';
}

export class BookmarkLedger {
  readonly #bookmarks = new Map<
    string,
    { id: string; sessionMs: number; triggeredBy: string; resolution: Resolution; angles: Map<string, Angle> }
  >();

  create({
    sessionMs,
    triggeredBy,
    cameraIds,
  }: {
    sessionMs: number;
    triggeredBy: string;
    cameraIds: readonly string[];
  }): Bookmark {
    const id = crypto.randomUUID();
    const angles = new Map<string, Angle>(
      cameraIds.map((cameraId) => [cameraId, { cameraId, status: 'pending' as const }])
    );
    this.#bookmarks.set(id, { id, sessionMs, triggeredBy, resolution: 'unresolved', angles });
    return this.#view(id)!;
  }

  /** A clip has landed. Silently ignores a bookmark we do not know. */
  recordClip(
    bookmarkId: string,
    angle: { cameraId: string; url: string; startSessionMs: number; bookmarkOffsetMs: number }
  ): void {
    const bookmark = this.#bookmarks.get(bookmarkId);
    if (!bookmark) return;
    bookmark.angles.set(angle.cameraId, { ...angle, status: 'received' });
  }

  /** What the referee decided about this bookmark. Unknown ids are ignored. */
  resolve(bookmarkId: string, resolution: Resolution): void {
    const bookmark = this.#bookmarks.get(bookmarkId);
    if (bookmark) bookmark.resolution = resolution;
  }

  /**
   * Sweep away everything reviewed and left alone, and say how many.
   *
   * Deliberately only the ones showing as unresolved: a bookmark still waiting
   * for footage has not been looked at yet, so sweeping it would bury it.
   */
  resolveAllUnresolved(resolution: Resolution): number {
    let swept = 0;
    for (const bookmark of this.#bookmarks.values()) {
      if (stateOf(bookmark.resolution, [...bookmark.angles.values()]) !== 'unresolved') continue;
      bookmark.resolution = resolution;
      swept += 1;
    }
    return swept;
  }

  /** Replace everything with a loaded session. Used by save/load, not by a bout. */
  restore(bookmarks: readonly Omit<Bookmark, 'state'>[]): void {
    this.#bookmarks.clear();
    for (const bookmark of bookmarks) {
      this.#bookmarks.set(bookmark.id, {
        id: bookmark.id,
        sessionMs: bookmark.sessionMs,
        triggeredBy: bookmark.triggeredBy,
        resolution: bookmark.resolution ?? 'unresolved',
        angles: new Map(bookmark.angles.map((angle) => [angle.cameraId, angle])),
      });
    }
  }

  /** Forget every bookmark. The cameras stay; only the bout's marks go. */
  clear(): void {
    this.#bookmarks.clear();
  }

  #view(id: string): Bookmark | undefined {
    const bookmark = this.#bookmarks.get(id);
    if (!bookmark) return undefined;
    const angles = [...bookmark.angles.values()];
    return {
      id: bookmark.id,
      sessionMs: bookmark.sessionMs,
      triggeredBy: bookmark.triggeredBy,
      angles,
      resolution: bookmark.resolution,
      state: stateOf(bookmark.resolution, angles),
    };
  }

  /** Newest first — a referee is almost always after the thing that just happened. */
  list(): Bookmark[] {
    return [...this.#bookmarks.values()]
      .map((bookmark) => this.#view(bookmark.id)!)
      .sort((a, b) => b.sessionMs - a.sessionMs);
  }
}
