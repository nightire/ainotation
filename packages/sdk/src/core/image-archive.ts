const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

/** Uncompressed ZIP keeps PNG attachments intact and avoids a compression dependency. */
export async function imageArchive(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  if (
    entries.length > 65535 ||
    entries.reduce(
      (size, entry) =>
        size + entry.blob.size + 76 + 2 * new TextEncoder().encode(entry.name).length,
      22,
    ) > 0xffffffff
  )
    throw new Error('This export exceeds the ZIP size limit. Download images separately.');
  const files: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(12, 0x21, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, name.length, true);
    local.set(name, 30);
    files.push(local, bytes);
    const directory = new Uint8Array(46 + name.length);
    const record = new DataView(directory.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(14, 0x21, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, bytes.length, true);
    record.setUint32(24, bytes.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    offset += local.length + bytes.length;
  }
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, entries.length, true);
  footer.setUint16(10, entries.length, true);
  footer.setUint32(
    12,
    central.reduce((size, entry) => size + entry.length, 0),
    true,
  );
  footer.setUint32(16, offset, true);
  return new Blob([...files, ...central, end], { type: 'application/zip' });
}
