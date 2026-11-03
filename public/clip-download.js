// Store-only ZIP, assembled locally. No upload or third-party ZIP dependency.
export function downloadClip(media) {
  const encoder = new TextEncoder();
  const files = media.map((m, i) => ({
    name: `${String(i + 1).padStart(2, "0")}.${m.mime === "audio/wav" ? "wav" : m.mime === "video/mp4" ? "mp4" : "jpg"}`,
    data: Uint8Array.from(atob(m.data_b64), (c) => c.charCodeAt(0)),
  }));
  let offset = 0;
  const local = [],
    central = [];
  const crc = (bytes) => {
    let value = -1;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    return (value ^ -1) >>> 0;
  };
  for (const file of files) {
    const name = encoder.encode(file.name),
      checksum = crc(file.data);
    const header = new Uint8Array(30 + name.length),
      h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint32(14, checksum, true);
    h.setUint32(18, file.data.length, true);
    h.setUint32(22, file.data.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length),
      c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint32(16, checksum, true);
    c.setUint32(20, file.data.length, true);
    c.setUint32(24, file.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    entry.set(name, 46);
    local.push(header, file.data);
    central.push(entry);
    offset += header.length + file.data.length;
  }
  const size = central.reduce((n, item) => n + item.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const url = URL.createObjectURL(
    new Blob([...local, ...central, end], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "perrito-vet-clip.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
