// Answering a bookmark with one camera's footage.
//
// A bookmark is an instant on the hub's shared timeline. Each camera holds a
// recording on its own private timeline. This is the piece that crosses between
// them, in both directions: session time in to choose the window, session time
// back out so the resulting clip can be laid over another camera's.

import type { Cluster } from './media/webm.js';
import { cutClip } from './media/webm.js';
import type { CameraTimeline } from './timeline/session-time.js';
import { toMediaMs, toSessionMs } from './timeline/session-time.js';

export interface BookmarkCutRequest {
  readonly initSegment: Uint8Array;
  readonly clusters: readonly Cluster[];
  readonly videoTrack: number;
  readonly timeline: CameraTimeline;
  /** The bookmarked instant, on the hub's clock. */
  readonly bookmarkSessionMs: number;
  readonly preRollMs: number;
  readonly postRollMs: number;
}

export interface BookmarkClip {
  readonly bytes: Uint8Array;
  /** Session time of the clip's first frame. */
  readonly startSessionMs: number;
  /**
   * Where the bookmarked instant falls inside this clip. Differs per camera even
   * for one bookmark, because each clip starts at its own preceding keyframe —
   * which is why every angle has to carry its own.
   */
  readonly bookmarkOffsetMs: number;
}

/** The clip this camera can offer for a bookmark, or null if it has no footage covering it. */
export function cutClipForBookmark(request: BookmarkCutRequest): BookmarkClip | null {
  const { timeline, bookmarkSessionMs, preRollMs, postRollMs } = request;
  const bookmarkMediaMs = toMediaMs(timeline, bookmarkSessionMs);

  const clip = cutClip({
    initSegment: request.initSegment,
    clusters: request.clusters,
    videoTrack: request.videoTrack,
    fromMs: bookmarkMediaMs - preRollMs,
    toMs: bookmarkMediaMs + postRollMs,
  });
  if (clip === null) return null;

  const startSessionMs = toSessionMs(timeline, clip.startMs);
  return {
    bytes: clip.bytes,
    startSessionMs,
    bookmarkOffsetMs: bookmarkSessionMs - startSessionMs,
  };
}
