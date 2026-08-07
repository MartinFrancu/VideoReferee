import { Injectable, signal } from '@angular/core';

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
  readonly connected = signal(false);

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
    });
  }

  async addCamera(name: string): Promise<NewCamera> {
    const response = await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return response.json();
  }

  async setPhase(phase: BoutPhase): Promise<void> {
    await fetch('/api/bout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase }),
    });
  }
}
