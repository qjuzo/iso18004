// ISO 18004 §7.4.4: Alphanumeric mode character table
const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const ECI_CHARSETS: Record<number, string> = {
  0: 'iso-8859-1',
  1: 'iso-8859-1',
  2: 'iso-8859-1',
  3: 'iso-8859-1',
  4: 'iso-8859-2',
  5: 'iso-8859-3',
  6: 'iso-8859-4',
  7: 'iso-8859-5',
  8: 'iso-8859-6',
  9: 'iso-8859-7',
  10: 'iso-8859-8',
  11: 'iso-8859-9',
  12: 'iso-8859-10',
  13: 'iso-8859-11',
  15: 'iso-8859-13',
  16: 'iso-8859-14',
  17: 'iso-8859-15',
  18: 'iso-8859-16',
  20: 'shift-jis',
  21: 'windows-1250',
  22: 'windows-1251',
  23: 'windows-1252',
  24: 'windows-1256',
  26: 'utf-8',
  27: 'ascii',
  28: 'big5',
  29: 'gb18030',
  30: 'euc-kr',
};

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf8Loose = new TextDecoder('utf-8', { fatal: false });
const latin1Decoder = new TextDecoder('iso-8859-1', { fatal: false });

interface BitStream {
  bytes: Uint8Array;
  bitOffset: number;
}

function availableBits(stream: BitStream): number {
  return stream.bytes.length * 8 - stream.bitOffset;
}

function readBits(stream: BitStream, count: number): number {
  if (count === 0) return 0;
  let result = 0;
  let remaining = count;
  while (remaining > 0) {
    const byteIdx = stream.bitOffset >> 3;
    const bitInByte = stream.bitOffset & 7;
    const take = Math.min(remaining, 8 - bitInByte);
    const shift = 8 - bitInByte - take;
    const mask = (1 << take) - 1;
    result = (result << take) | ((stream.bytes[byteIdx] >> shift) & mask);
    stream.bitOffset += take;
    remaining -= take;
  }
  return result;
}

function countBitsIndex(version: number): number {
  if (version <= 9) return 0;
  if (version <= 26) return 1;
  return 2;
}

function decodeByteSegment(bytes: Uint8Array, explicitCharset: string | null): string {
  if (explicitCharset !== null) {
    try {
      return new TextDecoder(explicitCharset, { fatal: false }).decode(bytes);
    } catch {
      return utf8Loose.decode(bytes);
    }
  }
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return latin1Decoder.decode(bytes);
  }
}

function pushAsciiBytes(out: number[], text: string): void {
  for (let i = 0; i < text.length; i++) {
    out.push(text.charCodeAt(i) & 0xff);
  }
}

export interface BitstreamPayload {
  text: string;
  bytes: Uint8Array;
}

export function decodeBitStream(data: Uint8Array, version: number): BitstreamPayload | null {
  const stream: BitStream = { bytes: data, bitOffset: 0 };
  const bucket = countBitsIndex(version);
  const numericCountBits = [10, 12, 14][bucket];
  const alphaCountBits = [9, 11, 13][bucket];
  const byteCountBits = [8, 16, 16][bucket];
  const kanjiCountBits = [8, 10, 12][bucket];

  let activeCharset: string | null = null;
  let text = '';
  const rawBytes: number[] = [];

  while (availableBits(stream) >= 4) {
    const mode = readBits(stream, 4);
    if (mode === 0x0) {
      break;
    }

    if (mode === 0x7) {
      // ISO 18004 §7.4.2: ECI designator encoded in 1, 2, or 3 bytes
      if (availableBits(stream) < 8) return null;
      const b0 = readBits(stream, 8);
      let eci = 0;
      if ((b0 & 0x80) === 0) {
        eci = b0 & 0x7f;
      } else if ((b0 & 0xc0) === 0x80) {
        if (availableBits(stream) < 8) return null;
        eci = ((b0 & 0x3f) << 8) | readBits(stream, 8);
      } else if ((b0 & 0xe0) === 0xc0) {
        if (availableBits(stream) < 16) return null;
        eci = ((b0 & 0x1f) << 16) | readBits(stream, 16);
      } else {
        return null;
      }
      activeCharset = ECI_CHARSETS[eci] ?? 'utf-8';
    } else if (mode === 0x1) {
      if (availableBits(stream) < numericCountBits) return null;
      let count = readBits(stream, numericCountBits);
      let seg = '';
      while (count >= 3) {
        if (availableBits(stream) < 10) return null;
        const v = readBits(stream, 10);
        if (v >= 1000) return null;
        seg += String(v).padStart(3, '0');
        count -= 3;
      }
      if (count === 2) {
        if (availableBits(stream) < 7) return null;
        const v = readBits(stream, 7);
        if (v >= 100) return null;
        seg += String(v).padStart(2, '0');
      } else if (count === 1) {
        if (availableBits(stream) < 4) return null;
        const v = readBits(stream, 4);
        if (v >= 10) return null;
        seg += String(v);
      }
      text += seg;
      pushAsciiBytes(rawBytes, seg);
    } else if (mode === 0x2) {
      if (availableBits(stream) < alphaCountBits) return null;
      let count = readBits(stream, alphaCountBits);
      let seg = '';
      while (count >= 2) {
        if (availableBits(stream) < 11) return null;
        const v = readBits(stream, 11);
        if (v >= 2025) return null;
        seg += ALPHANUMERIC_CHARS[Math.floor(v / 45)] + ALPHANUMERIC_CHARS[v % 45];
        count -= 2;
      }
      if (count === 1) {
        if (availableBits(stream) < 6) return null;
        const v = readBits(stream, 6);
        if (v >= 45) return null;
        seg += ALPHANUMERIC_CHARS[v];
      }
      text += seg;
      pushAsciiBytes(rawBytes, seg);
    } else if (mode === 0x4) {
      if (availableBits(stream) < byteCountBits) return null;
      const count = readBits(stream, byteCountBits);
      if (availableBits(stream) < count * 8) return null;
      const segBytes = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        const b = readBits(stream, 8);
        segBytes[i] = b;
        rawBytes.push(b);
      }
      text += decodeByteSegment(segBytes, activeCharset);
    } else if (mode === 0x8) {
      // ISO 18004 §7.4.6: 13-bit Shift-JIS double-byte Kanji compaction
      if (availableBits(stream) < kanjiCountBits) return null;
      const count = readBits(stream, kanjiCountBits);
      if (availableBits(stream) < count * 13) return null;
      const kanjiBytes = new Uint8Array(count * 2);
      for (let i = 0; i < count; i++) {
        const v = readBits(stream, 13);
        const assembled = (Math.floor(v / 0xc0) << 8) | (v % 0xc0);
        const sjis = assembled + (assembled < 0x1f00 ? 0x8140 : 0xc140);
        const hi = (sjis >> 8) & 0xff;
        const lo = sjis & 0xff;
        kanjiBytes[i * 2] = hi;
        kanjiBytes[i * 2 + 1] = lo;
        rawBytes.push(hi, lo);
      }
      try {
        text += new TextDecoder('shift-jis', { fatal: false }).decode(kanjiBytes);
      } catch {
        text += utf8Loose.decode(kanjiBytes);
      }
    } else if (mode === 0x3) {
      if (availableBits(stream) < 16) return null;
      readBits(stream, 16);
    } else if (mode === 0x5) {
      continue;
    } else if (mode === 0x9) {
      if (availableBits(stream) < 8) return null;
      readBits(stream, 8);
    } else {
      return null;
    }
  }

  return { text, bytes: new Uint8Array(rawBytes) };
}
