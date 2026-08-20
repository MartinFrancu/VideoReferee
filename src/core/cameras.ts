// Who is filming, under what name, and whether they are still with us.
//
// Cameras enrol once per tournament rather than once per bout, because setting
// four phones up twenty times in an afternoon is the difference between a tool
// and a chore. Nothing here may assume how many there are (INV-5).

/** How long after its last word we stop believing a camera is still filming. */
const DEFAULT_STALE_AFTER_MS = 3000;

export interface Camera {
  readonly id: string;
  /** Whoever is holding it. People move, so "mike" beats "north". */
  readonly name: string;
  /** Answered recently enough that we still believe it is filming. */
  readonly live: boolean;
  /**
   * Whether this camera has ever answered. A camera that has gone quiet and one
   * whose QR was never scanned are both "not live", but they are different
   * problems: one phone has died, the other has not been picked up yet.
   */
  readonly everJoined: boolean;
  /**
   * Taken out of the session: asked for nothing, listened to for nothing, and
   * unable to come back with the code it was let in with.
   *
   * Still here, and still named, because every angle of every past bookmark
   * finds its camera's name by looking it up in this roster — so forgetting one
   * would quietly rename footage that has already been reviewed.
   */
  readonly removed: boolean;
}

interface Enrolment {
  readonly id: string;
  readonly name: string;
  /** Emptied when the camera is removed, so its old code lets nobody in. */
  token: string;
  lastSeenAt: number | null;
  removed: boolean;
  /**
   * That this camera had already joined before the session was saved. A camera
   * enrolled in this run proves it by having been heard from; one read out of a
   * file cannot, because nothing in the file is speaking to us.
   */
  readonly joinedBeforeSaving: boolean;
}

export class CameraRegistry {
  readonly #cameras = new Map<string, Enrolment>();
  readonly #staleAfterMs: number;

  constructor({ staleAfterMs = DEFAULT_STALE_AFTER_MS }: { staleAfterMs?: number } = {}) {
    this.#staleAfterMs = staleAfterMs;
  }

  /** Reserve a name and a join token. The camera is not live until it answers. */
  invite(name: string, _now: number): { id: string; token: string } {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    this.#cameras.set(id, { id, name, token, lastSeenAt: null, joinedBeforeSaving: false, removed: false });
    return { id, token };
  }

  /** Bind a connecting camera to its enrolment. Null if the token is not one of ours. */
  join(token: string, now: number): string | null {
    // A camera restored from a saved file has no token. Without this, a phone
    // arriving with an empty one would be let in as that camera.
    if (token === '') return null;
    for (const camera of this.#cameras.values()) {
      if (camera.token !== token) continue;
      camera.lastSeenAt = now;
      return camera.id;
    }
    return null;
  }

  /**
   * The join token of a camera we invited, for showing its code again.
   *
   * Null for a camera restored from a file: those hold no token on purpose, so
   * there is no code to show and pretending otherwise would produce a QR that
   * cannot work.
   */
  tokenFor(id: string): string | null {
    return this.#cameras.get(id)?.token || null;
  }

  /** A camera saying it is still there. */
  heartbeat(id: string, now: number): void {
    const camera = this.#cameras.get(id);
    if (camera) camera.lastSeenAt = now;
  }

  /**
   * Replace the roster with one from a loaded session.
   *
   * Loaded cameras get no join token: a saved file describes phones that were
   * filming somewhere else, and handing out their tokens would let an unrelated
   * phone claim one. They exist so bookmarks have names to show against.
   *
   * Whether each had joined comes in with it. Nothing loaded is live, but "this
   * phone died" and "this QR was never scanned" are still different things to be
   * told, and telling them apart is half of why a session gets opened.
   */
  restore(cameras: readonly { id: string; name: string; everJoined: boolean; removed: boolean }[]): void {
    this.#cameras.clear();
    for (const camera of cameras) {
      this.#cameras.set(camera.id, {
        id: camera.id,
        name: camera.name,
        token: '',
        lastSeenAt: null,
        joinedBeforeSaving: camera.everJoined,
        removed: camera.removed,
      });
    }
  }

  /**
   * Take a camera out of the session.
   *
   * Its token goes with it, so the code it was let in with — and any QR of that
   * code still on a screen somewhere — stops working. The enrolment itself
   * stays: the bookmarks it already answered name it from here.
   */
  remove(id: string): void {
    const camera = this.#cameras.get(id);
    if (!camera) return;
    camera.removed = true;
    camera.token = '';
  }

  list(now: number): Camera[] {
    return [...this.#cameras.values()].map((camera) => ({
      id: camera.id,
      name: camera.name,
      // A removed camera is never live, however recently it spoke: it may still
      // be filming, but not for us, and every caller means "will answer a
      // bookmark" when it asks.
      live:
        !camera.removed && camera.lastSeenAt !== null && now - camera.lastSeenAt <= this.#staleAfterMs,
      everJoined: camera.joinedBeforeSaving || camera.lastSeenAt !== null,
      removed: camera.removed,
    }));
  }
}
