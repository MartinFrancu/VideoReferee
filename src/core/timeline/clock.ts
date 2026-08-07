// Turning a camera's raw clock readings into an offset the hub can trust.
//
// A camera reports only what it observed — its own monotonic clock at the moment
// it replied. Every inference is made here, on the hub, where it can be stepped
// through in a debugger and covered by a test (INV-2).

export interface SyncSample {
  /** Hub clock when the ping was sent. */
  readonly sentAt: number;
  /** The camera's own monotonic clock when it replied. */
  readonly deviceAt: number;
  /** Hub clock when the reply arrived. */
  readonly receivedAt: number;
}

export interface ClockEstimate {
  /** Add this to a camera's clock reading to get hub time. */
  readonly offsetMs: number;
  /**
   * How far `offsetMs` could be wrong. The reply is only known to have left the
   * camera somewhere inside the round trip, so the midpoint guess is bounded by
   * half of it — which is why this belongs beside the offset rather than being
   * inferred from it later. A camera whose uncertainty exceeds the accuracy a
   * referee needs should be flagged, not silently trusted.
   */
  readonly uncertaintyMs: number;
}

function roundTripMs(sample: SyncSample): number {
  return sample.receivedAt - sample.sentAt;
}

/**
 * The camera's offset from hub time, or null if it has told us nothing yet.
 *
 * Only the fastest round trip is used. A slow one is not noisy data to be
 * averaged away — it is a sample where the delay could have fallen almost
 * entirely on one leg, so the midpoint guess could be wrong by half the round
 * trip. The quickest exchange is the one that leaves least room to be wrong.
 */
export function estimateClock(samples: readonly SyncSample[]): ClockEstimate | null {
  let best: SyncSample | undefined;
  for (const sample of samples) {
    if (best === undefined || roundTripMs(sample) < roundTripMs(best)) best = sample;
  }
  if (best === undefined) return null;

  const midpoint = (best.sentAt + best.receivedAt) / 2;
  return {
    offsetMs: midpoint - best.deviceAt,
    uncertaintyMs: roundTripMs(best) / 2,
  };
}
