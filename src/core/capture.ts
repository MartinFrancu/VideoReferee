// What a clip was cut from, written down before the evidence evaporates.
//
// The hub receives everything it needs to answer a bookmark, decides, writes a
// clip and forgets the inputs. So a clip that came out wrong — misaligned by a
// second, starting at the wrong keyframe — cannot be argued about afterwards,
// let alone fixed and proven fixed. This is the record of the argument.
//
// It is deliberately not the footage. The clip that came out is already kept in
// `clips/`, and the raw upload is kept beside this for the most recent ones; a
// record is the numbers, small enough to keep for every bookmark of an
// afternoon and to read in a terminal.

import { isVideoKeyframe, type Cluster } from './media/webm.js';
import type { SyncSample } from './timeline/clock.js';
import type { OriginSample } from './timeline/media-origin.js';

/** Bumped when the shape changes in a way a replay of an older file could misread. */
export const CAPTURE_FORMAT = 1;

/** A cluster as the decision saw it: when, where, how big, and startable. */
export interface CapturedCluster {
  readonly timeMs: number;
  readonly offset: number;
  readonly length: number;
  /** Whether a clip could begin here. Only a keyframe can. */
  readonly keyframe: boolean;
}

export type CaptureOutcome =
  | { readonly cut: true; readonly startSessionMs: number; readonly bookmarkOffsetMs: number; readonly bytes: number }
  | { readonly cut: false; readonly why: string };

export interface CaptureRecord {
  readonly format: number;
  readonly capturedAt: string;
  /** Which build decided this. Two builds disagreeing is a thing to look for. */
  readonly version: string;
  readonly bookmark: { readonly id: string; readonly sessionMs: number };
  readonly camera: { readonly id: string; readonly name: string };
  /** The settings in force, since they change what a correct answer looks like. */
  readonly settings: { readonly preRollMs: number; readonly postRollMs: number; readonly ringWindowMs: number };
  readonly upload: {
    readonly bytes: number;
    readonly prefixLength: number;
    readonly runLength: number;
    /** The file beside this holding the upload itself, when it was kept. */
    readonly keptAs: string | null;
    /** When each stretch of the run reached the phone, on the phone's own clock. */
    readonly arrivals: readonly { offset: number; length: number; arrivedAtDeviceMs: number }[];
  };
  /** Where this camera's clock sits against the hub's, and every sample behind it. */
  readonly clock: { readonly offsetMs: number; readonly uncertaintyMs: number; readonly samples: readonly SyncSample[] } | null;
  /** When this recording's media time zero happened, and every pair behind it. */
  readonly origin: { readonly originDeviceMs: number; readonly uncertaintyMs: number; readonly samples: readonly OriginSample[] } | null;
  readonly videoTrack: number;
  readonly clusters: readonly CapturedCluster[];
  readonly outcome: CaptureOutcome;
}

export interface CaptureInput {
  readonly capturedAt: Date;
  readonly version: string;
  readonly bookmark: { readonly id: string; readonly sessionMs: number };
  readonly camera: { readonly id: string; readonly name: string };
  readonly settings: { readonly preRollMs: number; readonly postRollMs: number; readonly ringWindowMs: number };
  readonly upload: {
    readonly bytes: number;
    readonly prefixLength: number;
    readonly runLength: number;
    readonly keptAs: string | null;
  };
  readonly arrivals: readonly { offset: number; length: number; arrivedAtDeviceMs: number }[];
  readonly syncSamples: readonly SyncSample[];
  readonly clock: { readonly offsetMs: number; readonly uncertaintyMs: number } | null;
  readonly originSamples: readonly OriginSample[];
  readonly origin: { readonly originDeviceMs: number; readonly uncertaintyMs: number } | null;
  readonly videoTrack: number;
  readonly clusters: readonly Cluster[];
  readonly outcome: CaptureOutcome;
}

/**
 * Everything that went into one camera's answer to one bookmark.
 *
 * An estimate that could not be made is recorded as null rather than left out:
 * "we had no idea where this camera's clock was" is the most interesting thing
 * a capture can say, and a missing key looks like an older format instead.
 */
export function captureRecord(input: CaptureInput): CaptureRecord {
  return {
    format: CAPTURE_FORMAT,
    capturedAt: input.capturedAt.toISOString(),
    version: input.version,
    bookmark: input.bookmark,
    camera: input.camera,
    settings: input.settings,
    upload: { ...input.upload, arrivals: input.arrivals },
    clock: input.clock === null ? null : { ...input.clock, samples: input.syncSamples },
    origin: input.origin === null ? null : { ...input.origin, samples: input.originSamples },
    videoTrack: input.videoTrack,
    clusters: input.clusters.map((cluster) => ({
      timeMs: cluster.timeMs,
      offset: cluster.offset,
      length: cluster.bytes.length,
      keyframe: isVideoKeyframe(cluster, input.videoTrack),
    })),
    outcome: input.outcome,
  };
}

/**
 * A name that sorts by when it happened and says what it is about.
 *
 * Sortable first, because the question is always "what happened just then", and
 * a directory listing is the cheapest possible index. The ids are cut short:
 * two eight-character halves are enough to find one by eye, and a full pair of
 * uuids makes a name too long to read.
 */
export function captureName(at: Date, bookmarkId: string, cameraId: string): string {
  const when = at.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `${when}_${captureIdPrefix(bookmarkId)}_${captureIdPrefix(cameraId)}`;
}

/**
 * How much of an id a capture's name carries.
 *
 * Defined once because it is written by `captureName` and read back when
 * deciding which captures belong to a session — two places that would drift
 * apart silently, since nothing else ever reads one of these names.
 */
export function captureIdPrefix(id: string): string {
  return id.slice(0, 8);
}

/**
 * Which kept uploads to delete, oldest first, to stay within `keep`.
 *
 * The newest are the ones worth having: you go looking for a capture just after
 * something went wrong, not days later. Sorted here rather than trusted from the
 * caller, because a directory listing is only ordered by accident.
 */
export function capturesToDrop(names: readonly string[], keep: number): string[] {
  const oldestFirst = [...names].sort();
  return oldestFirst.slice(0, Math.max(0, oldestFirst.length - keep));
}
