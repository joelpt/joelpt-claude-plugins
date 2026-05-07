import { writeFileSync } from 'node:fs';

export function writeCuesToBuffer(buf) {
  const pos = buf.length - 20;
  buf[pos] = 0x1c; buf[pos + 1] = 0x53; buf[pos + 2] = 0xbb; buf[pos + 3] = 0x6b;
  buf[pos + 4] = 0x85; buf[pos + 5] = 0xbb;
}

export function writeWebmWithCues(path, size = 1_001_000) {
  const buf = Buffer.alloc(size);
  writeCuesToBuffer(buf);
  writeFileSync(path, buf);
}
