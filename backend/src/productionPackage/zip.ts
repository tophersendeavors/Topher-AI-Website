// Minimal stored-mode ZIP writer (no compression). Pure TypeScript /
// Node Buffer — no native dependencies. Sufficient for shipping a
// production package zip with text + JSON + PDF + Markdown entries.
//
// Format reference: PKZIP APPNOTE — local file header (0x04034b50),
// central directory header (0x02014b50), end of central directory
// (0x06054b50). Compression method 0 = stored.

interface ZipEntry {
  /** Relative path inside the zip. Forward slashes. */
  name: string;
  data: Buffer;
  /** Last-modified time. Defaults to "now". */
  mtime?: Date;
}

/** Build the full zip buffer. Files appear in the order added. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = entry.data;
    const crc = crc32(dataBuf);
    const { dosTime, dosDate } = encodeDosTime(entry.mtime ?? new Date());

    // --- Local file header ---
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed
    localHeader.writeUInt16LE(0x0800, 6);     // gp bit flag — bit 11 = UTF-8 filename
    localHeader.writeUInt16LE(0, 8);          // compression method = stored
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18); // compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);              // extra field length

    parts.push(localHeader, nameBuf, dataBuf);

    // --- Central directory header (built now, emitted later) ---
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4);         // version made by (DOS)
    cdHeader.writeUInt16LE(20, 6);         // version needed
    cdHeader.writeUInt16LE(0x0800, 8);     // gp bit flag — UTF-8
    cdHeader.writeUInt16LE(0, 10);         // compression method
    cdHeader.writeUInt16LE(dosTime, 12);
    cdHeader.writeUInt16LE(dosDate, 14);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(dataBuf.length, 20);
    cdHeader.writeUInt32LE(dataBuf.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);         // extra length
    cdHeader.writeUInt16LE(0, 32);         // comment length
    cdHeader.writeUInt16LE(0, 34);         // disk number start
    cdHeader.writeUInt16LE(0, 36);         // internal file attributes
    cdHeader.writeUInt32LE(0, 38);         // external file attributes
    cdHeader.writeUInt32LE(offset, 42);    // local header offset
    centralDir.push(cdHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  // Central directory + EOCD.
  const cdStart = offset;
  for (const buf of centralDir) {
    parts.push(buf);
    offset += buf.length;
  }
  const cdSize = offset - cdStart;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);            // signature
  eocd.writeUInt16LE(0, 4);                      // disk number
  eocd.writeUInt16LE(0, 6);                      // disk where central dir starts
  eocd.writeUInt16LE(entries.length, 8);         // # of entries on this disk
  eocd.writeUInt16LE(entries.length, 10);        // total # of entries
  eocd.writeUInt32LE(cdSize, 12);                // central directory size
  eocd.writeUInt32LE(cdStart, 16);               // central directory offset
  eocd.writeUInt16LE(0, 20);                     // comment length
  parts.push(eocd);

  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE polynomial 0xedb88320)
// ---------------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;
function ensureCrcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(buf: Buffer): number {
  const table = ensureCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// DOS time encoding (MS-DOS)
// ---------------------------------------------------------------------------

function encodeDosTime(d: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, d.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { dosTime, dosDate };
}
