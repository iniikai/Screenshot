// Minimal ZIP writer (STORE method — PNGs are already compressed, so no
// deflate needed). Enough to produce a standard archive for "Export all".

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(ts) {
  const d = new Date(ts);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function u16(v) {
  return [v & 0xff, (v >> 8) & 0xff];
}

function u32(v) {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

// entries: [{ name: string, data: Uint8Array, mtime: epoch-ms }]
export function buildZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const { time, date } = dosDateTime(entry.mtime || Date.now());
    const header = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // local file header signature
      ...u16(20), ...u16(0x0800), ...u16(0), // version, UTF-8 flag, method STORE
      ...u16(time), ...u16(date),
      ...u32(crc), ...u32(entry.data.length), ...u32(entry.data.length),
      ...u16(nameBytes.length), ...u16(0),
    ]);
    chunks.push(header, nameBytes, entry.data);
    central.push({ nameBytes, crc, size: entry.data.length, time, date, offset });
    offset += header.length + nameBytes.length + entry.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    const record = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, // central directory signature
      ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(c.time), ...u16(c.date),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size),
      ...u16(c.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(c.offset),
    ]);
    chunks.push(record, c.nameBytes);
    centralSize += record.length + c.nameBytes.length;
  }

  chunks.push(new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, // end of central directory
    ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(centralSize), ...u32(centralStart), ...u16(0),
  ]));

  return new Blob(chunks, { type: 'application/zip' });
}
