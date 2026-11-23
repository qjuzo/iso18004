import {
  ALIGNMENT_COORDS,
  buildFunctionPatternMask,
  createBitMatrix,
  encodeFormatBits,
  evaluateMaskBit,
  getBit,
  getBlockSpec,
  polyRest,
  projectPoint,
  rsGeneratorPoly,
  setBit,
  solveHomography,
  type BitMatrix,
  type ECLevel,
  type Point,
} from '@qr-scan/core';

export type SamplePreset = 'clean' | 'skewed' | 'damaged' | 'chaos' | 'wifi';

function drawFinder(m: BitMatrix, x0: number, y0: number): void {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const dark =
        r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      setBit(m, x0 + c, y0 + r, dark ? 1 : 0);
    }
  }
}

function drawAlignment(m: BitMatrix, cx: number, cy: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      setBit(m, cx + c, cy + r, dark ? 1 : 0);
    }
  }
}

function encodeByteMatrix(text: string, version: number, ecLevel: ECLevel, mask: number): BitMatrix {
  const dim = version * 4 + 17;
  const funcMask = buildFunctionPatternMask(version);
  let nonFunc = 0;
  for (let i = 0; i < funcMask.data.length; i++) {
    if (funcMask.data[i] === 0) nonFunc++;
  }
  const totalCodewords = nonFunc >> 3;
  const spec = getBlockSpec(version, ecLevel, totalCodewords);
  const payload = new TextEncoder().encode(text);

  const raw: number[] = [];
  let cur = 0;
  let bits = 0;
  const pushBits = (val: number, count: number): void => {
    for (let i = count - 1; i >= 0; i--) {
      cur = (cur << 1) | ((val >> i) & 1);
      bits++;
      if (bits === 8) {
        raw.push(cur);
        cur = 0;
        bits = 0;
      }
    }
  };

  pushBits(0x4, 4);
  pushBits(payload.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < payload.length; i++) pushBits(payload[i], 8);

  const usedBits = raw.length * 8 + bits;
  const totalBits = spec.totalData * 8;
  if (usedBits > totalBits) {
    throw new Error(`QR V${version}-${ecLevel} capacity exceeded (${usedBits} > ${totalBits} bits)`);
  }

  const termBits = Math.min(4, totalBits - usedBits);
  if (termBits > 0) pushBits(0, termBits);
  if (bits > 0) {
    raw.push(cur << (8 - bits));
  }
  let pad = 0;
  while (raw.length < spec.totalData) {
    raw.push((pad++ & 1) === 0 ? 0xec : 0x11);
  }
  const dataBytes = new Uint8Array(raw);

  const gen = rsGeneratorPoly(spec.ecPerBlock);
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < spec.totalBlocks; b++) {
    const len = b < spec.g1Blocks ? spec.g1Data : spec.g1Data + 1;
    const slice = dataBytes.slice(offset, offset + len);
    offset += len;
    const dividend = new Uint8Array(len + spec.ecPerBlock);
    dividend.set(slice, 0);
    blocks.push(slice);
    ecBlocks.push(polyRest(dividend, gen));
  }

  const interleaved = new Uint8Array(totalCodewords);
  let idx = 0;
  for (let col = 0; col < spec.g1Data; col++) {
    for (let b = 0; b < spec.totalBlocks; b++) interleaved[idx++] = blocks[b][col];
  }
  for (let b = spec.g1Blocks; b < spec.totalBlocks; b++) {
    interleaved[idx++] = blocks[b][spec.g1Data];
  }
  for (let col = 0; col < spec.ecPerBlock; col++) {
    for (let b = 0; b < spec.totalBlocks; b++) interleaved[idx++] = ecBlocks[b][col];
  }

  const matrix = createBitMatrix(dim, dim);
  drawFinder(matrix, 0, 0);
  drawFinder(matrix, dim - 7, 0);
  drawFinder(matrix, 0, dim - 7);
  setBit(matrix, 8, dim - 8, 1);

  for (let i = 8; i < dim - 8; i++) {
    const bit = (i & 1) === 0 ? 1 : 0;
    setBit(matrix, i, 6, bit);
    setBit(matrix, 6, i, bit);
  }

  const align = ALIGNMENT_COORDS[version - 1];
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) {
        continue;
      }
      drawAlignment(matrix, align[j], align[i]);
    }
  }

  const fmt = encodeFormatBits(ecLevel, mask);
  for (let b = 14; b >= 0; b--) {
    const bit = (fmt >> b) & 1;
    if (b >= 9) setBit(matrix, 14 - b, 8, bit);
    else if (b === 8) setBit(matrix, 7, 8, bit);
    else if (b === 7) setBit(matrix, 8, 8, bit);
    else if (b === 6) setBit(matrix, 8, 7, bit);
    else setBit(matrix, 8, b, bit);

    if (b >= 8) setBit(matrix, 8, dim - 1 - (14 - b), bit);
    else setBit(matrix, dim - 1 - b, 8, bit);
  }

  let bitIdx = 0;
  let up = true;
  for (let col = dim - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < dim; step++) {
      const r = up ? dim - 1 - step : step;
      for (let off = 0; off < 2; off++) {
        const c = col - off;
        if (getBit(funcMask, c, r) !== 0) continue;
        const byteVal = bitIdx >> 3 < interleaved.length ? interleaved[bitIdx >> 3] : 0;
        const rawBit = (byteVal >> (7 - (bitIdx & 7))) & 1;
        bitIdx++;
        setBit(matrix, c, r, rawBit ^ evaluateMaskBit(mask, r, c));
      }
    }
    up = !up;
  }

  return matrix;
}

export function buildSampleImageData(preset: SamplePreset): ImageData {
  const { pixels, width, height } = renderSamplePixels(preset);
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

export function renderSamplePixels(preset: SamplePreset): {
  pixels: Uint8Array;
  width: number;
  height: number;
} {
  const width = 400;
  const height = 400;

  let matrix: BitMatrix;
  let dstCorners: [Point, Point, Point, Point];
  let shadow = false;
  let grain = false;

  if (preset === 'clean') {
    matrix = encodeByteMatrix('https://github.com/qjuzo/qr-scan', 3, 'M', 2);
    dstCorners = [
      { x: 48, y: 48 },
      { x: 352, y: 48 },
      { x: 48, y: 352 },
      { x: 352, y: 352 },
    ];
  } else if (preset === 'skewed') {
    matrix = encodeByteMatrix('https://qr-scan.dev/homography-unwarp', 4, 'Q', 3);
    dstCorners = [
      { x: 74, y: 58 },
      { x: 344, y: 84 },
      { x: 46, y: 318 },
      { x: 358, y: 352 },
    ];
  } else if (preset === 'wifi') {
    matrix = encodeByteMatrix('WIFI:T:WPA;S:FieldOptics-5G;P:galois-field-256;;', 4, 'M', 1);
    dstCorners = [
      { x: 48, y: 48 },
      { x: 352, y: 48 },
      { x: 48, y: 352 },
      { x: 352, y: 352 },
    ];
  } else if (preset === 'chaos') {
    matrix = encodeByteMatrix('(\\__/) (•_•) / >[QR] CHAOS SURVIVED: 180deg + GF(256)!', 6, 'H', 5);
    const dim = matrix.width;
    const corrupt: [number, number][] = [
      [dim - 2, 10],
      [dim - 3, 12],
      [dim - 2, 14],
      [dim - 4, 16],
      [dim - 2, 18],
      [dim - 3, 20],
      [dim - 5, 13],
      [dim - 6, 15],
      [dim - 5, 17],
      [dim - 6, 19],
      [dim - 4, 22],
      [dim - 3, 25],
      [dim - 2, 27],
    ];
    for (const [cx, cy] of corrupt) {
      setBit(matrix, cx, cy, getBit(matrix, cx, cy) ^ 1);
    }
    shadow = true;
    grain = true;
    dstCorners = [
      { x: 346, y: 340 },
      { x: 52, y: 354 },
      { x: 354, y: 58 },
      { x: 64, y: 46 },
    ];
  } else {
    matrix = encodeByteMatrix('Reed-Solomon GF(256) repaired shadow damage', 4, 'Q', 6);
    const dim = matrix.width;
    const corrupt: [number, number][] = [
      [dim - 2, 10],
      [dim - 3, 12],
      [dim - 2, 15],
      [dim - 4, 18],
      [dim - 2, 20],
      [dim - 5, 14],
    ];
    for (const [cx, cy] of corrupt) {
      setBit(matrix, cx, cy, getBit(matrix, cx, cy) ^ 1);
    }
    shadow = true;
    dstCorners = [
      { x: 52, y: 52 },
      { x: 348, y: 52 },
      { x: 52, y: 348 },
      { x: 348, y: 348 },
    ];
  }

  const dim = matrix.width;
  const invH = solveHomography(dstCorners, [
    { x: 0, y: 0 },
    { x: dim, y: 0 },
    { x: 0, y: dim },
    { x: dim, y: dim },
  ])!;

  const pixels = new Uint8Array(width * height * 4);
  let seed = 0x51a0c39b;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pt = projectPoint(invH, x + 0.5, y + 0.5);
      const mc = Math.floor(pt.x);
      const mr = Math.floor(pt.y);
      const dark = mc >= 0 && mc < dim && mr >= 0 && mr < dim && getBit(matrix, mc, mr) === 1;
      let luma = dark ? 16 : 246;
      if (shadow) {
        const factor = 0.24 + 0.76 * ((x / width + y / height) * 0.5);
        luma = Math.round(luma * factor);
      }
      if (grain) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const delta = ((seed >>> 24) % 29) - 14;
        luma = Math.max(0, Math.min(255, luma + delta));
      }
      const p = (y * width + x) * 4;
      pixels[p] = luma;
      pixels[p + 1] = luma;
      pixels[p + 2] = luma;
      pixels[p + 3] = 255;
    }
  }

  return { pixels, width, height };
}
