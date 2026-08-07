// What was bookmarked, and which angles have turned up for it.
//
// A bookmark is an instant, not a clip (INV-4). Clips are evidence that may
// arrive late, partially, or never — so a bookmark always knows which cameras it
// is still waiting on, and is renderable long before they all report in.

export type AngleStatus = 'pending' | 'received';

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
}

export class BookmarkLedger {
  readonly #bookmarks = new Map<string, { id: string; sessionMs: number; triggeredBy: string; angles: Map<string, Angle> }>();

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
    this.#bookmarks.set(id, { id, sessionMs, triggeredBy, angles });
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

  #view(id: string): Bookmark | undefined {
    const bookmark = this.#bookmarks.get(id);
    if (!bookmark) return undefined;
    return {
      id: bookmark.id,
      sessionMs: bookmark.sessionMs,
      triggeredBy: bookmark.triggeredBy,
      angles: [...bookmark.angles.values()],
    };
  }

  /** Newest first — a referee is almost always after the thing that just happened. */
  list(): Bookmark[] {
    return [...this.#bookmarks.values()]
      .map((bookmark) => this.#view(bookmark.id)!)
      .sort((a, b) => b.sessionMs - a.sessionMs);
  }
}
