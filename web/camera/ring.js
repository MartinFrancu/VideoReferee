// A bounded window of whatever the recorder has emitted lately.
//
// This is the whole of the camera's memory, and it understands nothing about
// video. It holds bytes and notes when each arrival landed on this device's own
// clock; the hub works out what any of it means (INV-3).

const DEFAULT_WINDOW_MS = 25_000;
/**
 * Enough to be certain of containing the stream's init segment. Measured at 189
 * bytes on a real recording, so this is generous by three orders of magnitude
 * and still costs nothing.
 */
const DEFAULT_PREFIX_BYTES = 64 * 1024;

export class ChunkRing {
  #windowMs;
  #prefixBytes;
  #prefix = [];
  #prefixLength = 0;
  #chunks = [];

  constructor({ windowMs = DEFAULT_WINDOW_MS, prefixBytes = DEFAULT_PREFIX_BYTES } = {}) {
    this.#windowMs = windowMs;
    this.#prefixBytes = prefixBytes;
  }

  /** @param {Uint8Array} bytes @param {number} arrivedAtDeviceMs a monotonic reading */
  push(bytes, arrivedAtDeviceMs) {
    if (this.#prefixLength < this.#prefixBytes) {
      this.#prefix.push(bytes);
      this.#prefixLength += bytes.length;
    }
    this.#chunks.push({ bytes, arrivedAtDeviceMs });

    const cutoff = arrivedAtDeviceMs - this.#windowMs;
    while (this.#chunks.length > 0 && this.#chunks[0].arrivedAtDeviceMs < cutoff) {
      this.#chunks.shift();
    }
  }

  /**
   * Everything the hub needs to answer a bookmark from this camera: the pinned
   * head of the stream, the recent tail, and when each piece of that tail
   * landed. The two byte runs are not contiguous — the hub expects that.
   */
  snapshot() {
    const arrivals = [];
    let offset = 0;
    for (const chunk of this.#chunks) {
      arrivals.push({ offset, length: chunk.bytes.length, arrivedAtDeviceMs: chunk.arrivedAtDeviceMs });
      offset += chunk.bytes.length;
    }
    return {
      prefix: concat(this.#prefix),
      run: concat(this.#chunks.map((chunk) => chunk.bytes)),
      arrivals,
    };
  }

  /** How much footage is currently held, in milliseconds. */
  heldMs() {
    const oldest = this.#chunks[0];
    const newest = this.#chunks[this.#chunks.length - 1];
    return oldest && newest ? newest.arrivedAtDeviceMs - oldest.arrivedAtDeviceMs : 0;
  }
}

function concat(parts) {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}
