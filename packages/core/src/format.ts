import { createBitMatrix, getBit, setBit, type BitMatrix, type ECLevel } from './types.ts';

// ISO 18004 Annex E Table E.1: alignment pattern center coordinates for Versions 1..40
export const ALIGNMENT_COORDS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

// ISO 18004 §7.9: BCH(15, 5) generator 0x537 and format mask 0x5412
const FORMAT_GEN = 0x537;
const FORMAT_MASK = 0x5412;
const FORMAT_WORDS = new Uint16Array(32);

// ISO 18004 §7.10: BCH(18, 6) generator 0x1f25 for Versions 7..40
const VERSION_GEN = 0x1f25;
const VERSION_WORDS = new Uint32Array(34);

const EC_DECODE_ORDER: readonly ECLevel[] = ['M', 'L', 'H', 'Q'];

function bchRemainder(val: number, gen: number, genDegree: number): number {
  const topBit = 1 << genDegree;
  let r = val;
  for (let bit = 17; bit >= genDegree; bit--) {
    if (r & (1 << bit)) {
      r ^= gen << (bit - genDegree);
    }
  }
  return r & (topBit - 1);
}

for (let d = 0; d < 32; d++) {
  const unmasked = (d << 10) | bchRemainder(d << 10, FORMAT_GEN, 10);
  FORMAT_WORDS[d] = unmasked ^ FORMAT_MASK;
}

for (let v = 7; v <= 40; v++) {
  VERSION_WORDS[v - 7] = (v << 12) | bchRemainder(v << 12, VERSION_GEN, 12);
}

export function encodeFormatBits(ecLevel: ECLevel, mask: number): number {
  const ecCode = EC_DECODE_ORDER.indexOf(ecLevel);
  return FORMAT_WORDS[(ecCode << 3) | (mask & 7)];
}

export function encodeVersionBits(version: number): number {
  return VERSION_WORDS[version - 7];
}

function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export interface FormatInfo {
  ecLevel: ECLevel;
  mask: number;
  distance: number;
}

export function decodeFormatBits(raw15: number): FormatInfo | null {
  let bestDist = 32;
  let bestData = -1;
  for (let d = 0; d < 32; d++) {
    const dist = popcount32(raw15 ^ FORMAT_WORDS[d]);
    if (dist < bestDist) {
      bestDist = dist;
      bestData = d;
    }
  }
  if (bestDist > 3 || bestData < 0) return null;
  return {
    ecLevel: EC_DECODE_ORDER[(bestData >> 3) & 3],
    mask: bestData & 7,
    distance: bestDist,
  };
}

export function decodeVersionBits(raw18: number): { version: number; distance: number } | null {
  let bestDist = 32;
  let bestVersion = -1;
  for (let i = 0; i < 34; i++) {
    const dist = popcount32(raw18 ^ VERSION_WORDS[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestVersion = i + 7;
    }
  }
  if (bestDist > 3 || bestVersion < 7) return null;
  return { version: bestVersion, distance: bestDist };
}

export function readFormatInfo(matrix: BitMatrix): FormatInfo | null {
  const dim = matrix.width;

  // ISO 18004 §7.9 Fig. 25: Copy 1 around top-left finder (bits 14 down to 0)
  let copy1 = 0;
  for (let x = 0; x <= 5; x++) copy1 = (copy1 << 1) | getBit(matrix, x, 8);
  copy1 = (copy1 << 1) | getBit(matrix, 7, 8);
  copy1 = (copy1 << 1) | getBit(matrix, 8, 8);
  copy1 = (copy1 << 1) | getBit(matrix, 8, 7);
  for (let y = 5; y >= 0; y--) copy1 = (copy1 << 1) | getBit(matrix, 8, y);

  // Copy 2 along bottom-left and top-right strips (bits 14 down to 0)
  let copy2 = 0;
  for (let y = dim - 1; y >= dim - 7; y--) copy2 = (copy2 << 1) | getBit(matrix, 8, y);
  for (let x = dim - 8; x < dim; x++) copy2 = (copy2 << 1) | getBit(matrix, x, 8);

  const f1 = decodeFormatBits(copy1);
  const f2 = decodeFormatBits(copy2);

  if (f1 && f2) {
    return f1.distance <= f2.distance ? f1 : f2;
  }
  return f1 ?? f2;
}

export function readVersionInfo(matrix: BitMatrix): number | null {
  const dim = matrix.width;
  if (dim < 45) return null;

  // ISO 18004 §7.10 Fig. 26: 6x3 bottom-left and 3x6 top-right version blocks
  let blRaw = 0;
  let trRaw = 0;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      const bitPos = i * 3 + j;
      blRaw |= getBit(matrix, i, dim - 11 + j) << bitPos;
      trRaw |= getBit(matrix, dim - 11 + j, i) << bitPos;
    }
  }

  const v1 = decodeVersionBits(blRaw);
  const v2 = decodeVersionBits(trRaw);

  if (v1 && v2) {
    return v1.distance <= v2.distance ? v1.version : v2.version;
  }
  return v1?.version ?? v2?.version ?? null;
}

function fillRect(m: BitMatrix, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setBit(m, x, y, 1);
    }
  }
}

export function buildFunctionPatternMask(version: number): BitMatrix {
  const dim = version * 4 + 17;
  const mask = createBitMatrix(dim, dim);

  // Finder patterns, separators, format strips, and dark module
  fillRect(mask, 0, 0, 9, 9);
  fillRect(mask, dim - 8, 0, 8, 9);
  fillRect(mask, 0, dim - 8, 9, 8);

  // Timing patterns along row 6 and col 6
  for (let i = 8; i < dim - 8; i++) {
    setBit(mask, i, 6, 1);
    setBit(mask, 6, i, 1);
  }

  // Alignment patterns (Annex E)
  const coords = ALIGNMENT_COORDS[version - 1];
  for (let i = 0; i < coords.length; i++) {
    const cy = coords[i];
    for (let j = 0; j < coords.length; j++) {
      const cx = coords[j];
      if ((i === 0 && j === 0) || (i === 0 && j === coords.length - 1) || (i === coords.length - 1 && j === 0)) {
        continue;
      }
      fillRect(mask, cx - 2, cy - 2, 5, 5);
    }
  }

  if (version >= 7) {
    fillRect(mask, 0, dim - 11, 6, 3);
    fillRect(mask, dim - 11, 0, 3, 6);
  }

  return mask;
}

// ISO 18004 Table 10: data mask predicates (row = r, col = c)
export function evaluateMaskBit(maskId: number, r: number, c: number): number {
  switch (maskId) {
    case 0:
      return ((r + c) & 1) === 0 ? 1 : 0;
    case 1:
      return (r & 1) === 0 ? 1 : 0;
    case 2:
      return c % 3 === 0 ? 1 : 0;
    case 3:
      return (r + c) % 3 === 0 ? 1 : 0;
    case 4:
      return (((r >> 1) + Math.floor(c / 3)) & 1) === 0 ? 1 : 0;
    case 5:
      return ((r * c) & 1) + ((r * c) % 3) === 0 ? 1 : 0;
    case 6:
      return ((((r * c) & 1) + ((r * c) % 3)) & 1) === 0 ? 1 : 0;
    case 7:
      return ((((r + c) & 1) + ((r * c) % 3)) & 1) === 0 ? 1 : 0;
    default:
      return 0;
  }
}

export function extractRawCodewords(matrix: BitMatrix, version: number, maskId: number): Uint8Array {
  const dim = version * 4 + 17;
  const funcMask = buildFunctionPatternMask(version);

  let nonFuncCount = 0;
  for (let i = 0; i < funcMask.data.length; i++) {
    if (funcMask.data[i] === 0) nonFuncCount++;
  }

  const codewords = new Uint8Array(nonFuncCount >> 3);
  let byteIdx = 0;
  let curByte = 0;
  let bitCount = 0;
  let up = true;

  for (let col = dim - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < dim; step++) {
      const r = up ? dim - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const c = col - offset;
        if (getBit(funcMask, c, r) !== 0) continue;
        const bit = getBit(matrix, c, r) ^ evaluateMaskBit(maskId, r, c);
        curByte = (curByte << 1) | bit;
        bitCount++;
        if (bitCount === 8) {
          codewords[byteIdx++] = curByte;
          curByte = 0;
          bitCount = 0;
        }
      }
    }
    up = !up;
  }

  return codewords;
}
