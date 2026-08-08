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

  readonly #http = inject(HttpClient);

  constructor() {
    this.#connect();
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

  async resetBookmarks(): Promise<void> {
    await firstValueFrom(this.#http.post('/api/reset', {}));
  }
}
