// When a recording's clock actually started.
//
// `MediaRecorder.onstart` is not the answer, and not by a little: measured
// against the frames themselves it fired 589 ms late on one camera and 1445 ms
// late on another, which would leave two angles nearly a second apart. The lag
// depends on what the device was doing during setup, so it cannot be calibrated
// away either.
//
// What can be measured is arrival. Footage cannot reach us before it was filmed,
// so every chunk arrives later than the moment it carries, by an encoding and
// muxing delay that is never negative. The smallest gap observed across many
// chunks is therefore the closest we get to watching that delay approach zero —
// the same reasoning as preferring the fastest round trip when reading a clock.

export interface OriginSample {
  /** Device-clock reading when this data arrived from the recorder. */
  readonly arrivedAtDeviceMs: number;
  /** Media time of the footage it carried. */
  readonly mediaMs: number;
}

export interface MediaOrigin {
  /** Device-clock time at which this recording's media time zero happened. */
  readonly originDeviceMs: number;
  /**
   * How much the observed delays varied. A small figure means several arrivals
   * agreed, so the smallest is probably near the floor; a large one means we
   * have not yet seen a chunk arrive promptly.
   */
  readonly uncertaintyMs: number;
}

/** A stretch of the run, and when the camera says it landed. */
export interface Arrival {
  readonly offset: number;
  readonly length: number;
  readonly arrivedAtDeviceMs: number;
}

/**
 * Join what the camera knows to what the hub knows.
 *
 * The camera reports when each chunk landed but cannot read a timecode; the hub
 * parses timecodes but was not there when the bytes arrived. Byte offsets are
 * the only thing both halves can see, so that is what they are matched on.
 */
export function originSamples({
  clusters,
  arrivals,
}: {
  readonly clusters: readonly { offset: number; timeMs: number }[];
  readonly arrivals: readonly Arrival[];
}): OriginSample[] {
  const samples: OriginSample[] = [];
  for (const cluster of clusters) {
    const arrival = arrivals.find(
      (candidate) =>
        cluster.offset >= candidate.offset && cluster.offset < candidate.offset + candidate.length
    );
    // A run can begin mid-cluster, so a cluster may sit outside anything the
    // camera told us about. It simply contributes no sample.
    if (arrival) samples.push({ arrivedAtDeviceMs: arrival.arrivedAtDeviceMs, mediaMs: cluster.timeMs });
  }
  return samples;
}

/** Where this recording's timeline begins, or null until a chunk has arrived. */
export function estimateMediaOrigin(samples: readonly OriginSample[]): MediaOrigin | null {
  const lags = samples.map((sample) => sample.arrivedAtDeviceMs - sample.mediaMs).sort((a, b) => a - b);
  const smallest = lags[0];
  if (smallest === undefined) return null;

  const median = lags[Math.floor(lags.length / 2)] ?? smallest;
  return { originDeviceMs: smallest, uncertaintyMs: median - smallest };
}
