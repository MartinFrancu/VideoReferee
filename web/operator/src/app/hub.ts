import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors CameraView in src/core/protocol.ts. */
export interface Camera {
  id: string;
  name: string;
  live: boolean;
  everJoined: boolean;
  syncUncertaintyMs: number | null;
  heldMs: number | null;
}

export type BoutPhase = 'idle' | 'recording' | 'paused';

/** Mirrors Config in src/core/config.ts. The hub is the source of the values. */
export interface Config {
  bookmark: { preRollMs: number; postRollMs: number; postRollWaitMs: number };
  camera: { ringWindowMs: number; warmUpMs: number };
  review: { frameMs: number; holdRepeatMs: number; holdDelayMs: number };
  network: { pingIntervalMs: number; staleAfterMs: number };
}

/** Only what is needed before the hub has answered; then they are replaced. */
export const FALLBACK_CONFIG: Config = {
  bookmark: { preRollMs: 1500, postRollMs: 1000, postRollWaitMs: 1500 },
  camera: { ringWindowMs: 25_000, warmUpMs: 20_000 },
  review: { frameMs: 33, holdRepeatMs: 200, holdDelayMs: 400 },
  network: { pingIntervalMs: 1000, staleAfterMs: 3000 },
};

/** A camera that is live but not yet holding enough footage to answer well. */
export function isWarmingUp(camera: Camera, warmUpMs: number): boolean {
  return camera.live && (camera.heldMs ?? 0) < warmUpMs;
}

/** Mirrors Resolution and BookmarkState in src/core/bookmarks.ts. */
export type Resolution = 'unresolved' | 'red' | 'blue' | 'purple' | 'done';
export type BookmarkState = 'loading' | Resolution;

/** The decisions offered as buttons, in the order they appear. */
export const RESOLUTIONS: readonly { value: Resolution; label: string }[] = [
  { value: 'red', label: 'Red' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'done', label: 'Done' },
];

/** Mirrors Angle and Bookmark in src/core/bookmarks.ts. */
export interface Angle {
  cameraId: string;
  status: 'pending' | 'received';
  url?: string;
  startSessionMs?: number;
  bookmarkOffsetMs?: number;
}

export interface Bookmark {
  id: string;
  sessionMs: number;
  triggeredBy: string;
  angles: Angle[];
  /** What the referee decided. */
  resolution: Resolution;
  /** What to show. Worked out by the hub, never here. */
  state: BookmarkState;
}

export interface NewCamera {
  id: string;
  name: string;
  joinUrl: string;
  /** A ready-made SVG, so the operator screen needs no QR library of its own. */
  qr: string;
}

const RECONNECT_DELAY_MS = 1500;

/**
 * The operator screen's one link to the hub.
 *
 * It holds no opinions: every value here arrived from the hub, and every action
 * is a request to the hub. Nothing about clocks, clips or bouts is worked out on
 * this side of the wire.
 */
@Injectable({ providedIn: 'root' })
export class Hub {
  readonly cameras = signal<Camera[]>([]);
  readonly phase = signal<BoutPhase>('idle');
  readonly bookmarks = signal<Bookmark[]>([]);
  readonly connected = signal(false);
  /** Settings live on the hub, in config.json; this screen only reads them. */
  readonly config = signal<Config>(FALLBACK_CONFIG);

  readonly #http = inject(HttpClient);

  constructor() {
    this.#connect();
    void firstValueFrom(this.#http.get<Config>('/api/config'))
      .then((config) => this.config.set(config))
      .catch(() => {});
  }

  #connect(): void {
    const socket = new WebSocket(`wss://${location.host}/operator`);

    socket.addEventListener('open', () => this.connected.set(true));
    socket.addEventListener('close', () => {
      this.connected.set(false);
      setTimeout(() => this.#connect(), RECONNECT_DELAY_MS);
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'cameras') this.cameras.set(message.cameras);
      if (message.type === 'boutPhase') this.phase.set(message.phase);
      if (message.type === 'bookmarks') this.bookmarks.set(message.bookmarks);
    });
  }

  addCamera(name: string): Promise<NewCamera> {
    return firstValueFrom(this.#http.post<NewCamera>('/api/cameras', { name }));
  }

  async setPhase(phase: BoutPhase): Promise<void> {
    await firstValueFrom(this.#http.post('/api/bout', { phase }));
  }

  /**
   * Hand a saved session back to the hub.
   *
   * The file is posted as the text it already is rather than being parsed here.
   * The hub has to validate it either way — it is the side that turns clip names
   * into filenames — so parsing it twice would only move where a bad file is
   * first noticed.
   */
  async loadState(file: File): Promise<void> {
    await firstValueFrom(
      this.#http.post('/api/state', await file.text(), {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'text',
      })
    );
  }

  async resolve(id: string, resolution: Resolution): Promise<void> {
    await firstValueFrom(this.#http.post('/api/bookmarks/resolve', { id, resolution }));
  }

  /** Sweep everything reviewed and left alone. Answers how many were swept. */
  async resolveAllUnresolved(resolution: Resolution): Promise<number> {
    const { swept } = await firstValueFrom(
      this.#http.post<{ swept: number }>('/api/bookmarks/resolve', { all: true, resolution })
    );
    return swept;
  }

  async resetBookmarks(): Promise<void> {
    await firstValueFrom(this.#http.post('/api/reset', {}));
  }
}
