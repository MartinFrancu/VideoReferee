// Reading structure out of a live-recorded WebM byte run.
//
// The runs we get are not files: they are whatever a phone's MediaRecorder
// emitted, sliced at arbitrary byte offsets. Nothing here may assume the run
// starts at an element boundary or that the stream was ever finalised.

const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75] as const;
const ID_TIMECODE = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_REFERENCE_BLOCK = 0xfb;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const TRACK_TYPE_VIDEO = 1;

/** Value and length of the EBML variable-length integer at `pos`, or null if unreadable. */
function readVint(bytes: Uint8Array, pos: number): { value: number; length: number } | null {
  const first = bytes[pos];
  if (first === undefined) return null;

  let length = 1;
  for (let mask = 0x80; mask > 0 && (first & mask) === 0; mask >>= 1) length++;
  if (length > 8 || pos + length > bytes.length) return null;

  let value = first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + (bytes[pos + i] ?? 0);
  return { value, length };
}

/** Element id and its length in bytes at `pos`, or null if unreadable. */
function readId(bytes: Uint8Array, pos: number): { id: number; length: number } | null {
  const first = bytes[pos];
  if (first === undefined) return null;

  let length = 1;
  for (let mask = 0x80; mask > 0 && (first & mask) === 0; mask >>= 1) length++;
  if (length > 4 || pos + length > bytes.length) return null;

  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + (bytes[pos + i] ?? 0);
  return { id, length };
}

/** Big-endian unsigned integer of `length` bytes at `pos`. */
function readUint(bytes: Uint8Array, pos: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + (bytes[pos + i] ?? 0);
  return value;
}

/**
 * A Cluster id can also occur by chance inside block payload, so require the
 * whole signature: the id, a parsable size, then the mandatory Timecode child.
 */
function isClusterStart(bytes: Uint8Array, pos: number): boolean {
  for (let i = 0; i < CLUSTER_ID.length; i++) {
    if (bytes[pos + i] !== CLUSTER_ID[i]) return false;
  }
  const size = readVint(bytes, pos + CLUSTER_ID.length);
  if (size === null) return false;
  return bytes[pos + CLUSTER_ID.length + size.length] === ID_TIMECODE;
}

/** Byte offsets of every cluster in the run, in stream order. */
function findClusterStarts(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  for (let pos = 0; pos < bytes.length; pos++) {
    if (isClusterStart(bytes, pos)) starts.push(pos);
  }
  return starts;
}

export interface Cluster {
  /** Cluster timecode, in milliseconds since the recording started. */
  readonly timeMs: number;
  /** The cluster's own bytes, from its id up to the next cluster or the end of the run. */
  readonly bytes: Uint8Array;
  /** Offset into `bytes` where the cluster's children begin, just past the Timecode. */
  readonly bodyOffset: number;
}

function readCluster(bytes: Uint8Array, start: number, end: number): Cluster {
  // Layout: [cluster id][size][Timecode id][timecode size][timecode value][children...]
  // The size is written as "unknown" by live muxers, so the cluster's extent comes
  // from where the next one starts, never from the size field.
  const size = readVint(bytes, start + CLUSTER_ID.length);
  const timecodeSizePos = start + CLUSTER_ID.length + (size?.length ?? 0) + 1;
  const timecodeSize = readVint(bytes, timecodeSizePos);
  const valuePos = timecodeSizePos + (timecodeSize?.length ?? 0);
  return {
    timeMs: readUint(bytes, valuePos, timecodeSize?.value ?? 0),
    bytes: bytes.subarray(start, end),
    bodyOffset: valuePos + (timecodeSize?.value ?? 0) - start,
  };
}

/** Every cluster in the run, in stream order. */
export function readClusters(bytes: Uint8Array): Cluster[] {
  const starts = findClusterStarts(bytes);
  return starts.map((start, i) => readCluster(bytes, start, starts[i + 1] ?? bytes.length));
}

/**
 * Whether a cluster carries a video frame that decodes without reference to
 * anything earlier — the only place a clip may start.
 */
export function isVideoKeyframe(cluster: Cluster, videoTrack: number): boolean {
  const { bytes } = cluster;
  for (let pos = cluster.bodyOffset; pos < bytes.length; ) {
    const id = readId(bytes, pos);
    if (id === null) break;
    const size = readVint(bytes, pos + id.length);
    if (size === null) break;

    const valuePos = pos + id.length + size.length;
    if (id.id === ID_SIMPLE_BLOCK) {
      // Payload: [track vint][int16 timecode][flags]; 0x80 marks a keyframe.
      const track = readVint(bytes, valuePos);
      const flags = bytes[valuePos + (track?.length ?? 0) + 2] ?? 0;
      if (track?.value === videoTrack && (flags & 0x80) !== 0) return true;
    }
    if (id.id === ID_BLOCK_GROUP) {
      const end = Math.min(valuePos + size.value, bytes.length);
      if (blockGroupIsVideoKeyframe(bytes, valuePos, end, videoTrack)) return true;
    }
    pos = valuePos + size.value;
  }
  return false;
}

/** A Block with no ReferenceBlock beside it refers to nothing: it is a keyframe. */
function blockGroupIsVideoKeyframe(
  bytes: Uint8Array,
  start: number,
  end: number,
  videoTrack: number
): boolean {
  let holdsVideo = false;
  let referencesAnother = false;

  for (let pos = start; pos < end; ) {
    const id = readId(bytes, pos);
    if (id === null) break;
    const size = readVint(bytes, pos + id.length);
    if (size === null) break;

    const valuePos = pos + id.length + size.length;
    if (id.id === ID_BLOCK) {
      const track = readVint(bytes, valuePos);
      if (track !== null && track.value === videoTrack) holdsVideo = true;
    }
    if (id.id === ID_REFERENCE_BLOCK) referencesAnother = true;
    pos = valuePos + size.value;
  }

  return holdsVideo && !referencesAnother;
}

/**
 * The track number carrying video, read from Tracks in the init segment, or null
 * if there is no video track. Needed because keyframe-ness is a per-track
 * property and the audio track sets the keyframe flag on every single block.
 */
export function readVideoTrackNumber(bytes: Uint8Array): number | null {
  for (let pos = 0; pos < bytes.length; pos++) {
    if (bytes[pos] !== ID_TRACK_ENTRY) continue;
    const size = readVint(bytes, pos + 1);
    if (size === null) continue;

    const end = Math.min(pos + 1 + size.length + size.value, bytes.length);
    let trackNumber: number | null = null;
    let trackType: number | null = null;

    for (let child = pos + 1 + size.length; child < end; ) {
      const id = readId(bytes, child);
      if (id === null) break;
      const childSize = readVint(bytes, child + id.length);
      if (childSize === null) break;

      const valuePos = child + id.length + childSize.length;
      if (id.id === ID_TRACK_NUMBER) trackNumber = readUint(bytes, valuePos, childSize.value);
      if (id.id === ID_TRACK_TYPE) trackType = readUint(bytes, valuePos, childSize.value);
      child = valuePos + childSize.value;
    }

    if (trackType === TRACK_TYPE_VIDEO && trackNumber !== null) return trackNumber;
  }
  return null;
}

/** The bytes before the first cluster: everything a player needs to decode the rest. */
export function readInitSegment(bytes: Uint8Array): Uint8Array {
  const starts = findClusterStarts(bytes);
  const first = starts[0];
  if (first === undefined) throw new Error('no cluster found in this byte run');
  return bytes.subarray(0, first);
}
