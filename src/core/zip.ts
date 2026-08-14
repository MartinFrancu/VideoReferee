// A zip archive, written by hand.
//
// One file to send is the whole point: a folder of parts is something to get
// wrong while passing it on, and the reason for a debug dump is that somebody
// else has to look at it. Node can deflate but cannot write the container, and
// the container is the simple half of the format — so it is here, with tests,
// rather than being a dependency installed at a venue with no internet.
//
// Everything is stored rather than compressed. What makes a dump big is video
// and video is already compressed; the records that would squeeze are a rounding
// error beside it.

export interface ZipEntry {
  /** Path inside the archive. Forward slashes, as the format requires. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The checksum every zip entry carries, so a truncated one is noticed. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_DIRECTORY_BYTES = 22;
/** Stored, not deflated. */
const METHOD_STORED = 0;
/** The version that first understood this much of the format. */
const VERSION_2_0 = 20;

/** Pack the whole archive: every file, then a directory of where they all are. */
export function zipArchive(entries: readonly ZipEntry[]): Uint8Array {
  const names = entries.map((entry) => new TextEncoder().encode(entry.name));
  const checksums = entries.map((entry) => crc32(entry.bytes));

  const filesBytes = entries.reduce(
    (total, entry, index) => total + LOCAL_HEADER_BYTES + names[index]!.length + entry.bytes.length,
    0
  );
  const directoryBytes = entries.reduce(
    (total, _entry, index) => total + CENTRAL_HEADER_BYTES + names[index]!.length,
    0
  );

  const out = new Uint8Array(filesBytes + directoryBytes + END_OF_DIRECTORY_BYTES);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;

  for (const [index, entry] of entries.entries()) {
    const name = names[index]!;
    offsets.push(at);

    view.setUint32(at, LOCAL_HEADER, true);
    view.setUint16(at + 4, VERSION_2_0, true);
    view.setUint16(at + 6, 0, true); // no flags: no encryption, sizes known up front
    view.setUint16(at + 8, METHOD_STORED, true);
    // No modification time. A dump is named for when it was made, and a
    // timestamp here would only be a second copy of that to disagree with.
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, 0, true);
    view.setUint32(at + 14, checksums[index]!, true);
    view.setUint32(at + 18, entry.bytes.length, true);
    view.setUint32(at + 22, entry.bytes.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true); // no extra field
    out.set(name, at + LOCAL_HEADER_BYTES);
    out.set(entry.bytes, at + LOCAL_HEADER_BYTES + name.length);
    at += LOCAL_HEADER_BYTES + name.length + entry.bytes.length;
  }

  const directoryAt = at;
  for (const [index, entry] of entries.entries()) {
    const name = names[index]!;

    view.setUint32(at, CENTRAL_HEADER, true);
    view.setUint16(at + 4, VERSION_2_0, true);
    view.setUint16(at + 6, VERSION_2_0, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, METHOD_STORED, true);
    view.setUint16(at + 12, 0, true);
    view.setUint16(at + 14, 0, true);
    view.setUint32(at + 16, checksums[index]!, true);
    view.setUint32(at + 20, entry.bytes.length, true);
    view.setUint32(at + 24, entry.bytes.length, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint16(at + 30, 0, true); // no extra field
    view.setUint16(at + 32, 0, true); // no comment
    view.setUint16(at + 34, 0, true); // one disk, and it is this one
    view.setUint16(at + 36, 0, true); // no internal attributes
    view.setUint32(at + 38, 0, true); // no external attributes
    view.setUint32(at + 42, offsets[index]!, true);
    out.set(name, at + CENTRAL_HEADER_BYTES);
    at += CENTRAL_HEADER_BYTES + name.length;
  }

  view.setUint32(at, END_OF_DIRECTORY, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, directoryBytes, true);
  view.setUint32(at + 16, directoryAt, true);
  view.setUint16(at + 20, 0, true); // no archive comment

  return out;
}
