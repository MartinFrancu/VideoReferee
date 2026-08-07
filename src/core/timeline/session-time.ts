// Moving between a camera's private timeline and the hub's shared one.
//
// Three clocks are in play and conflating them is the likeliest source of
// "the angles look almost right". Media time is per-camera, starting at zero
// when that phone began recording. Device time is that phone's monotonic clock.
// Session time is the hub's, and the only frame of reference two cameras share.

import type { ClockEstimate } from './clock.js';

export interface CameraTimeline {
  readonly clock: ClockEstimate;
  /** The camera's own monotonic clock at the moment its recorder started. */
  readonly recordingStartedAt: number;
}

/** Where a shared instant falls in one camera's recording. */
export function toMediaMs(timeline: CameraTimeline, sessionMs: number): number {
  return sessionMs - timeline.clock.offsetMs - timeline.recordingStartedAt;
}

/**
 * When a moment in one camera's recording happened, in shared terms. This is
 * what a clip carries alongside its bytes, and what lets two clips cut from
 * different recordings be laid over the same timeline.
 */
export function toSessionMs(timeline: CameraTimeline, mediaMs: number): number {
  return mediaMs + timeline.recordingStartedAt + timeline.clock.offsetMs;
}
