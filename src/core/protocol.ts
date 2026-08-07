// The wire contract. The only thing all three tiers agree on.
//
// Every timestamp here is either session time — the hub's clock, the one shared
// frame of reference — or a raw reading of a camera's own monotonic clock.
// Cameras never send a derived value such as an offset (INV-2).

/** Anything the hub says to a camera. */
export type HubToCamera =
  | { type: 'welcome'; cameraId: string; name: string }
  | { type: 'rejected'; reason: string }
  /** Sync probe. `sentAt` is session time; the camera echoes it back untouched. */
  | { type: 'ping'; sentAt: number }
  | { type: 'boutPhase'; phase: BoutPhase };

/** Anything a camera says to the hub. */
export type CameraToHub =
  | { type: 'hello'; token: string }
  /** `deviceAt` is performance.now() on the camera — a raw reading, nothing more. */
  | { type: 'pong'; sentAt: number; deviceAt: number }
  | { type: 'recording'; heldMs: number };

/** Anything the hub says to the operator's screen. */
export type HubToOperator =
  | { type: 'cameras'; cameras: CameraView[] }
  | { type: 'boutPhase'; phase: BoutPhase };

export interface CameraView {
  readonly id: string;
  readonly name: string;
  readonly live: boolean;
  readonly everJoined: boolean;
  /** How much footage this camera is holding, in milliseconds. */
  readonly heldMs: number | null;
  /** How far this camera's clock estimate could be wrong, once known. */
  readonly syncUncertaintyMs: number | null;
}

export type BoutPhase = 'idle' | 'recording' | 'paused';

export const PING_INTERVAL_MS = 1000;
