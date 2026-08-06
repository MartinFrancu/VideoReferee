// Reading structure out of a live-recorded WebM byte run.
//
// The runs we get are not files: they are whatever a phone's MediaRecorder
// emitted, sliced at arbitrary byte offsets. Nothing here may assume the run
// starts at an element boundary or that the stream was ever finalised.

const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75] as const;
const ID_TIMECODE = 0xe7;

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
}

function readCluster(bytes: Uint8Array, start: number): Cluster {
  // Layout: [cluster id][size][Timecode id][timecode size][timecode value]
  const size = readVint(bytes, start + CLUSTER_ID.length);
  const timecodeSizePos = start + CLUSTER_ID.length + (size?.length ?? 0) + 1;
  const timecodeSize = readVint(bytes, timecodeSizePos);
  const valuePos = timecodeSizePos + (timecodeSize?.length ?? 0);
  return { timeMs: readUint(bytes, valuePos, timecodeSize?.value ?? 0) };
}

/** Every cluster in the run, in stream order. */
export function readClusters(bytes: Uint8Array): Cluster[] {
  return findClusterStarts(bytes).map((start) => readCluster(bytes, start));
}

/** The bytes before the first cluster: everything a player needs to decode the rest. */
export function readInitSegment(bytes: Uint8Array): Uint8Array {
  const starts = findClusterStarts(bytes);
  const first = starts[0];
  if (first === undefined) throw new Error('no cluster found in this byte run');
  return bytes.subarray(0, first);
}
