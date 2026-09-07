import { inflateRawSync } from 'node:zlib';

/**
 * Just enough ZIP to read a spreadsheet.
 *
 * An .xlsx is a ZIP archive of XML. Rather than take a dependency for it, this
 * reads the container directly: `node:zlib` already contains the DEFLATE
 * implementation, and what is left is the archive's index, which is a fixed
 * layout described by APPNOTE.TXT and about a hundred lines.
 *
 * It is deliberately a *reader for files we name*, not a general extractor.
 * Nothing here writes to disk, so archive path traversal — the "zip slip"
 * family — cannot apply; and because entries are fetched by name, a workbook's
 * `calcChain.xml` (8 KB of nothing we want, and unbounded in general) is never
 * decompressed at all.
 *
 * The threat this does have to answer is a decompression bomb: a few hundred
 * bytes that inflate to gigabytes. Every entry declares its uncompressed size
 * in the central directory, which is checked *before* inflating, and the
 * inflated result is checked again afterwards in case the header lied.
 */

/** Signatures, little-endian. */
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const STORED = 0;
const DEFLATE = 8;

/**
 * Caps, chosen against real files rather than guessed. The 197-dive workbook
 * this was written for has a 277 KB worksheet; a 10,000-dive log would be
 * around 14 MB. 64 MB per entry leaves room for something far larger while
 * still refusing anything that could only be hostile.
 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

/** The trailer is at the end, after a comment of up to 65,535 bytes. */
const MAX_EOCD_SEARCH = 65_557;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export type ZipArchive = {
  entries: Map<string, ZipEntry>;
  /** Inflates one entry by name. Throws `ZipError` rather than returning junk. */
  read: (name: string) => Uint8Array;
  /** Decodes an entry as UTF-8. Every part of an .xlsx is text. */
  readText: (name: string) => string;
  has: (name: string) => boolean;
};

export function isZip(bytes: Uint8Array): boolean {
  // "PK\x03\x04". An empty archive starts "PK\x05\x06", which no .xlsx is.
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function openZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);

  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset >= bytes.length) {
    throw new ZipError('The archive index points past the end of the file.');
  }

  const entries = new Map<string, ZipEntry>();
  let cursor = centralOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL) {
      throw new ZipError('The archive index is truncated or malformed.');
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    // 0xFFFFFFFF is the ZIP64 sentinel: the real size lives in an extra field.
    // No spreadsheet reaches 4 GB, so rather than implement ZIP64 for a case
    // that cannot legitimately occur, say plainly that this is not supported.
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) {
      throw new ZipError('This archive uses ZIP64, which is not supported.');
    }

    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  let spent = 0;

  const read = (name: string): Uint8Array => {
    const entry = entries.get(name);
    if (!entry) throw new ZipError(`The archive has no entry named ${name}.`);

    // Refused from the declared size, before a single byte is inflated.
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipError(
        `${name} expands to ${entry.uncompressedSize} bytes, beyond the ${MAX_ENTRY_BYTES}-byte limit.`,
      );
    }
    if (spent + entry.uncompressedSize > MAX_TOTAL_BYTES) {
      throw new ZipError('The archive expands to more than this reader will decompress.');
    }

    // The local header repeats the name and extra field, and its extra field
    // length routinely differs from the central directory's — so where the
    // data begins can only be computed from the local header itself.
    const local = entry.localHeaderOffset;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) {
      throw new ZipError(`The entry ${name} has no valid local header.`);
    }
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    const end = start + entry.compressedSize;
    if (end > bytes.length) {
      throw new ZipError(`The entry ${name} runs past the end of the file.`);
    }

    const raw = bytes.subarray(start, end);
    let out: Uint8Array;

    if (entry.compressionMethod === STORED) {
      out = raw;
    } else if (entry.compressionMethod === DEFLATE) {
      // maxOutputLength is the belt to the declared size's braces: a crafted
      // archive can understate uncompressedSize, and this is enforced by zlib
      // during inflation rather than after it.
      out = new Uint8Array(
        inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) as unknown as ArrayBufferLike &
          Uint8Array,
      );
    } else {
      throw new ZipError(
        `${name} uses compression method ${entry.compressionMethod}, which is not supported.`,
      );
    }

    spent += out.byteLength;
    return out;
  };

  return {
    entries,
    read,
    readText: (name) => new TextDecoder().decode(read(name)),
    has: (name) => entries.has(name),
  };
}

/**
 * The End of Central Directory record, searched for backwards.
 *
 * It is the only structure whose position is not written down anywhere: it
 * sits at the very end, unless the archive has a comment, in which case it
 * sits up to 65,535 bytes earlier. Scanning backwards finds the last one,
 * which is the right one when an archive contains a stray signature in data.
 */
function findEocd(bytes: Uint8Array, view: DataView): number {
  if (bytes.length < 22) throw new ZipError('The file is too small to be an archive.');

  const earliest = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  for (let i = bytes.length - 22; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === EOCD) return i;
  }
  throw new ZipError('The file has no archive index; it may be truncated.');
}
