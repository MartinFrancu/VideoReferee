// WebM-aware rolling buffer.
//
// Why this exists: MediaRecorder's `dataavailable` chunks are arbitrary byte
// slices of one continuous stream, NOT self-contained pieces of video. A chunk
// boundary can land anywhere — including in the middle of an element ID. So you
// cannot build a playable clip by concatenating a subset of chunks, no matter
// which header bytes you staple onto the front.
//
// What you can cut on is the WebM structure underneath: the init segment
// (everything before the first Cluster) followed by whole Clusters. This class
// reassembles the chunk stream, splits it into complete Clusters, keeps a
// rolling window of them, and builds a genuinely standalone clip on demand.
//
// Two details that make or break playability:
//   - Cluster Timecodes are absolute (ms since recording start). A clip cut at
//     t=90s whose first cluster still says 90000 makes a player treat the clip
//     as 90s long with nothing at the front. Each emitted clip rebases them.
//   - Video clusters are only decodable from a keyframe. Chrome emits one every
//     ~3.4s, so a clip start snaps back to the last keyframe at or before the
//     requested window.
(function (global) {
  const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];
  const ID_TIMECODE = 0xe7;
  const ID_SIMPLE_BLOCK = 0xa3;
  const ID_BLOCK_GROUP = 0xa0;
  const ID_BLOCK = 0xa1;
  const ID_REFERENCE_BLOCK = 0xfb;
  const ID_TRACK_ENTRY = 0xae;
  const ID_TRACK_NUMBER = 0xd7;
  const ID_TRACK_TYPE = 0x83;
  const ID_TIMECODE_SCALE = 0x2ad7b1;
  const TRACK_TYPE_VIDEO = 1;

  // EBML variable-length integer. `stripMarker` clears the length-descriptor
  // bit, which is what you want for sizes and track numbers but not for IDs.
  function readVint(b, pos, stripMarker = true) {
    const first = b[pos];
    if (first === undefined) return null;
    let len = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) len++;
    if (len > 8 || pos + len > b.length) return null;
    let value = stripMarker ? first & (0xff >> len) : first;
    for (let i = 1; i < len; i++) value = value * 256 + b[pos + i];
    return { value, len };
  }

  function readId(b, pos) {
    const first = b[pos];
    if (first === undefined) return null;
    let len = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) len++;
    if (len > 4 || pos + len > b.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + b[pos + i];
    return { id, len };
  }

  function readUint(b, pos, len) {
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + b[pos + i];
    return v;
  }

  // A Cluster ID can also occur by chance inside block payloads, so require the
  // full signature: ID, a parsable size, then the mandatory Timecode child.
  function isClusterStart(b, pos) {
    for (let i = 0; i < 4; i++) if (b[pos + i] !== CLUSTER_ID[i]) return false;
    const size = readVint(b, pos + 4);
    if (!size) return false;
    return b[pos + 4 + size.len] === ID_TIMECODE;
  }

  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  // Walk Segment > Tracks > TrackEntry looking for the video track's number,
  // and pick up TimecodeScale while we're in there.
  function parseInitSegment(init) {
    let videoTrack = null;
    let timecodeScale = 1000000; // WebM default: 1ms per timecode tick
    for (let p = 0; p < init.length - 4; p++) {
      if (readId(init, p)?.id === ID_TIMECODE_SCALE) {
        const size = readVint(init, p + 3);
        if (size) timecodeScale = readUint(init, p + 3 + size.len, size.value) || timecodeScale;
      }
      if (init[p] !== ID_TRACK_ENTRY) continue;
      const size = readVint(init, p + 1);
      if (!size) continue;
      const end = Math.min(p + 1 + size.len + size.value, init.length);
      let number = null;
      let type = null;
      let q = p + 1 + size.len;
      while (q < end) {
        const id = readId(init, q);
        if (!id) break;
        const s = readVint(init, q + id.len);
        if (!s) break;
        const valuePos = q + id.len + s.len;
        if (id.id === ID_TRACK_NUMBER) number = readUint(init, valuePos, s.value);
        if (id.id === ID_TRACK_TYPE) type = readUint(init, valuePos, s.value);
        q = valuePos + s.value;
      }
      if (type === TRACK_TYPE_VIDEO && number !== null) videoTrack = number;
    }
    return { videoTrack, timecodeScale };
  }

  // A cluster is decodable-from-scratch if it carries a video keyframe: either a
  // SimpleBlock with the keyframe flag, or a BlockGroup with no ReferenceBlock.
  function hasVideoKeyframe(bytes, bodyOffset, videoTrack) {
    let p = bodyOffset;
    while (p < bytes.length) {
      const id = readId(bytes, p);
      if (!id) break;
      const size = readVint(bytes, p + id.len);
      if (!size) break;
      const valuePos = p + id.len + size.len;

      if (id.id === ID_SIMPLE_BLOCK) {
        const track = readVint(bytes, valuePos);
        if (track && track.value === videoTrack && bytes[valuePos + track.len + 2] & 0x80) return true;
      } else if (id.id === ID_BLOCK_GROUP) {
        const groupEnd = Math.min(valuePos + size.value, bytes.length);
        let q = valuePos;
        let isVideo = false;
        let hasReference = false;
        while (q < groupEnd) {
          const gid = readId(bytes, q);
          if (!gid) break;
          const gsize = readVint(bytes, q + gid.len);
          if (!gsize) break;
          const gvalue = q + gid.len + gsize.len;
          if (gid.id === ID_BLOCK) {
            const track = readVint(bytes, gvalue);
            if (track && track.value === videoTrack) isVideo = true;
          }
          if (gid.id === ID_REFERENCE_BLOCK) hasReference = true;
          q = gvalue + gsize.value;
        }
        if (isVideo && !hasReference) return true;
      }
      p = valuePos + size.value;
    }
    return false;
  }

  class WebmClipBuffer {
    constructor({ windowMs = 20000, mimeType = 'video/webm' } = {}) {
      this.windowMs = windowMs;
      this.mimeType = mimeType;
      this.init = null; // Uint8Array: everything before the first Cluster
      this.clusters = []; // { bytes, timeMs, keyframe, tcValueOffset, tcValueLen }
      this.pending = new Uint8Array(0); // unparsed tail; holds the in-progress cluster
      this.videoTrack = null;
      this.timecodeScale = 1000000;
      this.bytesSeen = 0;
      this.container = null; // 'webm' once the EBML magic is confirmed
    }

    append(bytes) {
      this.bytesSeen += bytes.length;
      if (this.container === null && this.pending.length === 0 && bytes.length >= 4) {
        this.container = bytes[0] === 0x1a && bytes[1] === 0x45 ? 'webm' : 'unknown';
      }
      this.pending = concat(this.pending, bytes);
      this.#parse();
      this.#evict();
    }

    // Split off every cluster that is provably complete. A cluster is complete
    // only once the *next* one has started, because clusters are written with an
    // unknown size — so the newest ~1 cluster always stays in `pending`.
    #parse() {
      const starts = [];
      for (let i = 0; i + 8 < this.pending.length; i++) {
        if (isClusterStart(this.pending, i)) starts.push(i);
      }
      if (starts.length === 0) return;

      if (!this.init) {
        this.init = this.pending.slice(0, starts[0]);
        const parsed = parseInitSegment(this.init);
        this.videoTrack = parsed.videoTrack;
        this.timecodeScale = parsed.timecodeScale;
        this.pending = this.pending.slice(starts[0]);
        for (let i = 0; i < starts.length; i++) starts[i] -= starts[0];
      }

      let consumed = 0;
      for (let k = 0; k + 1 < starts.length; k++) {
        const cluster = this.#makeCluster(this.pending.slice(starts[k], starts[k + 1]));
        if (cluster) this.clusters.push(cluster);
        consumed = starts[k + 1];
      }
      if (consumed > 0) this.pending = this.pending.slice(consumed);
    }

    #makeCluster(bytes) {
      const size = readVint(bytes, 4);
      if (!size) return null;
      const tcSize = readVint(bytes, 4 + size.len + 1);
      if (!tcSize) return null;
      const tcValueOffset = 4 + size.len + 1 + tcSize.len;
      const ticks = readUint(bytes, tcValueOffset, tcSize.value);
      const bodyOffset = tcValueOffset + tcSize.value;
      return {
        bytes,
        timeMs: Math.round((ticks * this.timecodeScale) / 1000000),
        ticks,
        tcValueOffset,
        tcValueLen: tcSize.value,
        keyframe: this.videoTrack !== null && hasVideoKeyframe(bytes, bodyOffset, this.videoTrack),
      };
    }

    #evict() {
      const newest = this.newestTimeMs();
      if (newest === null) return;
      const cutoff = newest - this.windowMs;
      let drop = 0;
      while (drop < this.clusters.length && this.clusters[drop].timeMs < cutoff) drop++;
      // Never drop past the keyframe the oldest retained window still needs.
      while (drop > 0 && !this.clusters[drop]?.keyframe) drop--;
      if (drop > 0) this.clusters.splice(0, drop);
    }

    newestTimeMs() {
      return this.clusters.length ? this.clusters[this.clusters.length - 1].timeMs : null;
    }

    oldestTimeMs() {
      return this.clusters.length ? this.clusters[0].timeMs : null;
    }

    isReady() {
      return Boolean(this.init && this.clusters.length);
    }

    // Build a standalone clip covering [fromMs, toMs] of recording time.
    // Returns null when the window has already rolled out of the buffer.
    buildClip(fromMs, toMs) {
      if (!this.isReady()) return null;

      let startIndex = -1;
      for (let i = 0; i < this.clusters.length; i++) {
        const c = this.clusters[i];
        if (c.keyframe && c.timeMs <= fromMs) startIndex = i;
      }
      if (startIndex === -1) {
        // Window predates our oldest keyframe — fall back to the first keyframe
        // inside it rather than emitting something that cannot decode.
        startIndex = this.clusters.findIndex((c) => c.keyframe && c.timeMs <= toMs);
      }
      if (startIndex === -1) return null;

      let endIndex = startIndex;
      for (let i = startIndex; i < this.clusters.length; i++) {
        if (this.clusters[i].timeMs <= toMs) endIndex = i;
      }

      const selected = this.clusters.slice(startIndex, endIndex + 1);
      const base = selected[0].ticks;
      const parts = [this.init];
      for (const cluster of selected) parts.push(rebase(cluster, base));

      return {
        blob: new Blob(parts, { type: this.mimeType }),
        startMs: selected[0].timeMs,
        endMs: selected[selected.length - 1].timeMs,
        clusterCount: selected.length,
        leadInMs: fromMs - selected[0].timeMs, // keyframe snap-back distance
      };
    }
  }

  // Rewrite a cluster's absolute Timecode as one relative to `base`, in place on
  // a copy. The new value is always smaller, so it fits the original field width
  // — EBML unsigned integers may be zero-padded, so the length stays valid.
  function rebase(cluster, base) {
    const copy = cluster.bytes.slice();
    let value = cluster.ticks - base;
    for (let i = cluster.tcValueLen - 1; i >= 0; i--) {
      copy[cluster.tcValueOffset + i] = value & 0xff;
      value = Math.floor(value / 256);
    }
    return copy;
  }

  global.WebmClipBuffer = WebmClipBuffer;
})(window);
