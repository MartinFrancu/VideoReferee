import { describe, expect, it } from 'vitest';

import { crc32, zipArchive } from './zip.js';

const text = (value: string) => new TextEncoder().encode(value);
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
const u16 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

describe('crc32', () => {
  /**
   * The check values every zip implementation agrees on. A wrong CRC makes an
   * archive that opens and then reports itself corrupt, which is worse than one
   * that will not open at all.
   */
  it('matches the known values for known input', () => {
    expect(crc32(text(''))).toBe(0);
    expect(crc32(text('a'))).toBe(0xe8b7be43);
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is not fooled by the same bytes in a different order', () => {
    expect(crc32(text('ab'))).not.toBe(crc32(text('ba')));
  });
});

describe('zipArchive', () => {
  const entries = [
    { name: 'about.txt', bytes: text('VideoReferee 0.0.21') },
    { name: 'clips/one.webm', bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00]) },
  ];

  it('starts with a local file header and ends with an end-of-directory record', () => {
    const zip = zipArchive(entries);

    expect(u32(zip, 0)).toBe(LOCAL_HEADER);
    expect(u32(zip, zip.length - 22)).toBe(END_OF_DIRECTORY);
  });

  it('records every entry once in the central directory', () => {
    const zip = zipArchive(entries);

    expect(u16(zip, zip.length - 22 + 8)).toBe(2); // entries on this disk
    expect(u16(zip, zip.length - 22 + 10)).toBe(2); // entries in total
  });

  /**
   * The directory is what an unzipper reads first, and it finds each file by the
   * offset recorded here. An offset that is out by even one byte makes an
   * archive that lists its contents and then fails to extract them.
   */
  it('points the directory at where each file actually starts', () => {
    const zip = zipArchive(entries);
    const directoryAt = u32(zip, zip.length - 22 + 16);
    expect(u32(zip, directoryAt)).toBe(CENTRAL_HEADER);

    // Every entry, not just the first — whose offset is zero either way, and so
    // proves nothing about an implementation that records zero for all of them.
    let at = directoryAt;
    for (const entry of entries) {
      const nameLength = u16(zip, at + 28);
      const fileAt = u32(zip, at + 42);
      expect(u32(zip, fileAt)).toBe(LOCAL_HEADER);

      const nameInFile = new TextDecoder().decode(zip.subarray(fileAt + 30, fileAt + 30 + u16(zip, fileAt + 26)));
      expect(nameInFile).toBe(entry.name);
      at += 46 + nameLength;
    }
  });

  /**
   * An unzipper reads the end record to find the directory and to know how much
   * of it to read. A size that disagrees with where the directory actually ends
   * either truncates the listing or runs it into the record itself.
   */
  it('says how big the directory is, agreeing with where it sits', () => {
    const zip = zipArchive(entries);
    const endAt = zip.length - 22;
    const directoryAt = u32(zip, endAt + 16);

    expect(u32(zip, endAt + 12)).toBe(endAt - directoryAt);
  });

  it('stores each entry`s bytes uncompressed, at its own size', () => {
    const zip = zipArchive(entries);

    expect(u16(zip, 8)).toBe(0); // method 0 — stored
    expect(u32(zip, 18)).toBe(entries[0]!.bytes.length); // compressed size
    expect(u32(zip, 22)).toBe(entries[0]!.bytes.length); // uncompressed size
  });

  it('carries each name, and the bytes that belong to it', () => {
    const zip = zipArchive(entries);
    const nameLength = u16(zip, 26);
    const name = new TextDecoder().decode(zip.subarray(30, 30 + nameLength));

    expect(name).toBe('about.txt');
    expect(zip.subarray(30 + nameLength, 30 + nameLength + entries[0]!.bytes.length)).toEqual(entries[0]!.bytes);
  });

  it('checksums each entry, so a truncated one is noticed', () => {
    const zip = zipArchive(entries);
    expect(u32(zip, 14)).toBe(crc32(entries[0]!.bytes));
  });

  // Nothing to send is still a valid thing to have made, and an unzipper should
  // open it and say it is empty rather than choke.
  it('makes a valid empty archive', () => {
    const zip = zipArchive([]);

    expect(zip.length).toBe(22);
    expect(u32(zip, 0)).toBe(END_OF_DIRECTORY);
    expect(u16(zip, 10)).toBe(0);
  });

  it('handles a file of no bytes at all', () => {
    const zip = zipArchive([{ name: 'empty.json', bytes: new Uint8Array() }]);

    expect(u32(zip, 14)).toBe(0);
    expect(u32(zip, 18)).toBe(0);
  });
});
