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
}

interface Enrolment {
  readonly id: string;
  readonly name: string;
  readonly token: string;
  lastSeenAt: number | null;
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
    this.#cameras.set(id, { id, name, token, lastSeenAt: null });
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
   */
  restore(cameras: readonly { id: string; name: string }[]): void {
    this.#cameras.clear();
    for (const camera of cameras) {
      this.#cameras.set(camera.id, { id: camera.id, name: camera.name, token: '', lastSeenAt: null });
    }
  }

  list(now: number): Camera[] {
    return [...this.#cameras.values()].map((camera) => ({
      id: camera.id,
      name: camera.name,
      live: camera.lastSeenAt !== null && now - camera.lastSeenAt <= this.#staleAfterMs,
      everJoined: camera.lastSeenAt !== null,
    }));
  }
}
