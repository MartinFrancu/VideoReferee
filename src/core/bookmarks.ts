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
  /** What the referee decided, independently of whether the footage arrived. */
  readonly resolution: Resolution;
}

/**
 * Still waiting on footage from at least one camera.
 *
 * A fact about the angles and nothing else. It says nothing about whether the
 * referee has decided — a clip may never come and the call can still be made —
 * and how the two are shown together is a question for whoever is drawing.
 */
export function isGathering(bookmark: Pick<Bookmark, 'angles'>): boolean {
  return bookmark.angles.some((angle) => angle.status === 'pending');
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
   * Two conditions, both plainly stated: undecided, and not still gathering. A
   * bookmark whose footage has not arrived cannot have been reviewed, so a bulk
   * action would bury it unseen — which is a property of *this action*, not of
   * the bookmark. Resolving one by hand is unaffected.
   */
  resolveAllUnresolved(resolution: Resolution): number {
    let swept = 0;
    for (const bookmark of this.#bookmarks.values()) {
      const angles = [...bookmark.angles.values()];
      if (bookmark.resolution !== 'unresolved' || isGathering({ angles })) continue;
      bookmark.resolution = resolution;
      swept += 1;
    }
    return swept;
  }

  /** Replace everything with a loaded session. Used by save/load, not by a bout. */
  restore(bookmarks: readonly Bookmark[]): void {
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
    return {
      id: bookmark.id,
      sessionMs: bookmark.sessionMs,
      triggeredBy: bookmark.triggeredBy,
      angles: [...bookmark.angles.values()],
      resolution: bookmark.resolution,
    };
  }

  /** Newest first — a referee is almost always after the thing that just happened. */
  list(): Bookmark[] {
    return [...this.#bookmarks.values()]
      .map((bookmark) => this.#view(bookmark.id)!)
      .sort((a, b) => b.sessionMs - a.sessionMs);
  }
}
