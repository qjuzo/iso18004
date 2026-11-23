import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALIGNMENT_COORDS,
  EXP_TABLE,
  buildFunctionPatternMask,
  createBitMatrix,
  decode,
  decodeBitStream,
  decodeFormatBits,
  decodeVersionBits,
  encodeFormatBits,
  encodeVersionBits,
  evaluateMaskBit,
  getBit,
  getBlockSpec,
  gfDiv,
  gfInv,
  gfMul,
  gfPow,
  polyMul,
  polyRest,
  projectPoint,
  rsDecode,
  rsGeneratorPoly,
  setBit,
  solveHomography,
  type BitMatrix,
  type ECLevel,
  type Point,
} from '../src/index.ts';

const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

class BitWriter {
  private buf: number[] = [];
  private cur = 0;
  private bits = 0;

  write(val: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((val >> i) & 1);
      this.bits++;
      if (this.bits === 8) {
        this.buf.push(this.cur);
        this.cur = 0;
        this.bits = 0;
      }
    }
  }

  finish(totalDataBytes: number): Uint8Array {
    const usedBits = this.buf.length * 8 + this.bits;
    const totalBits = totalDataBytes * 8;
    if (usedBits > totalBits) {
      throw new Error(`Payload overflow: ${usedBits} > ${totalBits} bits`);
    }
    const term = Math.min(4, totalBits - usedBits);
    if (term > 0) this.write(0, term);
    if (this.bits > 0) {
      this.cur <<= 8 - this.bits;
      this.buf.push(this.cur);
      this.cur = 0;
      this.bits = 0;
    }
    let padIdx = 0;
    while (this.buf.length < totalDataBytes) {
      this.buf.push((padIdx++ & 1) === 0 ? 0xec : 0x11);
    }
    return new Uint8Array(this.buf);
  }
}

function countBitsIndex(version: number): number {
  if (version <= 9) return 0;
  if (version <= 26) return 1;
  return 2;
}

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

function encodeSyntheticQR(
  version: number,
  ecLevel: ECLevel,
  mask: number,
  buildPayload: (bw: BitWriter) => void
): BitMatrix {
  const dim = version * 4 + 17;
  const funcMask = buildFunctionPatternMask(version);

  let nonFunc = 0;
  for (let i = 0; i < funcMask.data.length; i++) {
    if (funcMask.data[i] === 0) nonFunc++;
  }
  const totalCodewords = nonFunc >> 3;
  const spec = getBlockSpec(version, ecLevel, totalCodewords);

  const bw = new BitWriter();
  buildPayload(bw);
  const dataBytes = bw.finish(spec.totalData);

  const gen = rsGeneratorPoly(spec.ecPerBlock);
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (let b = 0; b < spec.totalBlocks; b++) {
    const len = b < spec.g1Blocks ? spec.g1Data : spec.g1Data + 1;
    const dataSlice = dataBytes.slice(offset, offset + len);
    offset += len;

    const dividend = new Uint8Array(len + spec.ecPerBlock);
    dividend.set(dataSlice, 0);
    const ec = polyRest(dividend, gen);
    blocks.push(dataSlice);
    ecBlocks.push(ec);
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

  const alignCoords = ALIGNMENT_COORDS[version - 1];
  for (let i = 0; i < alignCoords.length; i++) {
    for (let j = 0; j < alignCoords.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === alignCoords.length - 1) ||
        (i === alignCoords.length - 1 && j === 0)
      ) {
        continue;
      }
      drawAlignment(matrix, alignCoords[j], alignCoords[i]);
    }
  }

  const fmt = encodeFormatBits(ecLevel, mask);
  for (let b = 14; b >= 0; b--) {
    const bit = (fmt >> b) & 1;
    // Copy 1
    if (b >= 9) setBit(matrix, 14 - b, 8, bit);
    else if (b === 8) setBit(matrix, 7, 8, bit);
    else if (b === 7) setBit(matrix, 8, 8, bit);
    else if (b === 6) setBit(matrix, 8, 7, bit);
    else setBit(matrix, 8, b, bit);

    // Copy 2
    if (b >= 8) setBit(matrix, 8, dim - 1 - (14 - b), bit);
    else setBit(matrix, dim - 1 - b, 8, bit);
  }

  if (version >= 7) {
    const verBits = encodeVersionBits(version);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const bit = (verBits >> (i * 3 + j)) & 1;
        setBit(matrix, i, dim - 11 + j, bit);
        setBit(matrix, dim - 11 + j, i, bit);
      }
    }
  }

  let bitIdx = 0;
  let up = true;
  for (let col = dim - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < dim; step++) {
      const r = up ? dim - 1 - step : step;
      for (let offsetCol = 0; offsetCol < 2; offsetCol++) {
        const c = col - offsetCol;
        if (getBit(funcMask, c, r) !== 0) continue;
        const cwByte = bitIdx >> 3 < interleaved.length ? interleaved[bitIdx >> 3] : 0;
        const rawBit = (cwByte >> (7 - (bitIdx & 7))) & 1;
        bitIdx++;
        setBit(matrix, c, r, rawBit ^ evaluateMaskBit(mask, r, c));
      }
    }
    up = !up;
  }

  return matrix;
}

function encodeUtf8ByteQR(text: string, version: number, ecLevel: ECLevel, mask: number): BitMatrix {
  const bytes = new TextEncoder().encode(text);
  return encodeSyntheticQR(version, ecLevel, mask, (bw) => {
    bw.write(0x4, 4);
    bw.write(bytes.length, [8, 16, 16][countBitsIndex(version)]);
    for (let i = 0; i < bytes.length; i++) bw.write(bytes[i], 8);
  });
}

interface RenderOptions {
  scale?: number;
  quiet?: number;
  invert?: boolean;
  shadowGradient?: boolean;
  blurAndNoise?: boolean;
  dstCorners?: [Point, Point, Point, Point];
  width?: number;
  height?: number;
}

function rasterizeQR(matrix: BitMatrix, opts: RenderOptions = {}): {
  rgba: Uint8Array;
  width: number;
  height: number;
} {
  const scale = opts.scale ?? 8;
  const quiet = opts.quiet ?? 4;
  const dim = matrix.width;
  const width = opts.width ?? (dim + quiet * 2) * scale;
  const height = opts.height ?? (dim + quiet * 2) * scale;

  const srcPts: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: dim, y: 0 },
    { x: 0, y: dim },
    { x: dim, y: dim },
  ];
  const dstPts: [Point, Point, Point, Point] = opts.dstCorners ?? [
    { x: quiet * scale, y: quiet * scale },
    { x: (dim + quiet) * scale, y: quiet * scale },
    { x: quiet * scale, y: (dim + quiet) * scale },
    { x: (dim + quiet) * scale, y: (dim + quiet) * scale },
  ];

  // Inverse homography maps destination image pixels back to QR module coordinates
  const invH = solveHomography(dstPts, srcPts)!;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mPt = projectPoint(invH, x + 0.5, y + 0.5);
      const mc = Math.floor(mPt.x);
      const mr = Math.floor(mPt.y);

      let dark = false;
      if (mc >= 0 && mc < dim && mr >= 0 && mr < dim) {
        dark = getBit(matrix, mc, mr) === 1;
      }
      if (opts.invert) dark = !dark;

      let luma = dark ? 14 : 244;
      if (opts.shadowGradient) {
        const t = (x / width + y / height) * 0.5;
        const factor = 0.22 + 0.78 * t;
        luma = Math.round(luma * factor);
      }

      const idx = (y * width + x) * 4;
      rgba[idx] = luma;
      rgba[idx + 1] = luma;
      rgba[idx + 2] = luma;
      rgba[idx + 3] = 255;
    }
  }

  if (opts.blurAndNoise) {
    const blurred = new Uint8Array(rgba.length);
    let seed = 0x13579bdf;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += rgba[(yy * width + xx) * 4];
            cnt++;
          }
        }
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = ((seed >>> 24) % 37) - 18;
        const v = Math.max(0, Math.min(255, Math.round(sum / cnt) + noise));
        const idx = (y * width + x) * 4;
        blurred[idx] = v;
        blurred[idx + 1] = v;
        blurred[idx + 2] = v;
        blurred[idx + 3] = 255;
      }
    }
    return { rgba: blurred, width, height };
  }

  return { rgba, width, height };
}

test('GF(256) arithmetic and polynomial identities', () => {
  for (let a = 1; a < 256; a++) {
    const inv = gfInv(a);
    assert.equal(gfMul(a, inv), 1);
    assert.equal(gfDiv(1, a), inv);
    assert.equal(gfDiv(a, a), 1);
  }
  assert.equal(gfMul(0, 123), 0);
  assert.equal(gfDiv(0, 123), 0);
  assert.equal(gfPow(2, 8), 0x1d);

  const p = new Uint8Array([1, 0x05, 0x17]);
  const q = new Uint8Array([1, 0x11]);
  const prod = polyMul(p, q);
  assert.equal(prod.length, 4);

  const rem = polyRest(prod, q);
  assert.deepEqual(Array.from(rem), [0]);
});

test('Reed-Solomon decodes clean, max-t corrupted, and rejects >t errors', () => {
  const data = new Uint8Array([
    0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d, 0x43, 0x40, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
  ]);
  const ecLen = 10;
  const gen = rsGeneratorPoly(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data, 0);
  msg.set(polyRest(msg, gen), data.length);

  const clean = msg.slice();
  assert.equal(rsDecode(clean, ecLen), 0);

  // Corrupt maximum correctable t = 5 bytes across both data and EC regions
  const corrupted = msg.slice();
  const errorPositions = [0, 4, 9, 16, 25];
  const errorMasks = [0xff, 0x3a, 0x81, 0x44, 0x0f];
  for (let i = 0; i < errorPositions.length; i++) {
    corrupted[errorPositions[i]] ^= errorMasks[i];
  }
  const fixed = rsDecode(corrupted, ecLen);
  assert.equal(fixed, 5);
  assert.deepEqual(Array.from(corrupted), Array.from(msg));

  // Corrupt t + 1 = 6 bytes -> uncorrectable
  corrupted[12] ^= 0x55;
  for (let i = 0; i < errorPositions.length; i++) {
    corrupted[errorPositions[i]] ^= errorMasks[i];
  }
  assert.equal(rsDecode(corrupted, ecLen), -1);
});

test('BCH format (15,5) and version (18,6) decoding tolerates up to 3 bit flips', () => {
  const levels: ECLevel[] = ['L', 'M', 'Q', 'H'];
  for (const ec of levels) {
    for (let mask = 0; mask < 8; mask++) {
      const encoded = encodeFormatBits(ec, mask);
      const corrupted = encoded ^ (1 << 0) ^ (1 << 7) ^ (1 << 14);
      const decoded = decodeFormatBits(corrupted);
      assert.ok(decoded);
      assert.equal(decoded.ecLevel, ec);
      assert.equal(decoded.mask, mask);
      assert.equal(decoded.distance, 3);
    }
  }

  for (let v = 7; v <= 40; v++) {
    const encoded = encodeVersionBits(v);
    const corrupted = encoded ^ (1 << 1) ^ (1 << 8) ^ (1 << 16);
    const decoded = decodeVersionBits(corrupted);
    assert.ok(decoded);
    assert.equal(decoded.version, v);
    assert.equal(decoded.distance, 3);
  }
});

test('Bitstream decodes Numeric, Alphanumeric, UTF-8 Byte, ECI, and Kanji modes', () => {
  // Known ISO 18004 V1-M "HELLO WORLD" data bytes
  const isoHelloWorld = new Uint8Array([
    0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d,
    0x43, 0x40, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
  ]);
  const hw = decodeBitStream(isoHelloWorld, 1);
  assert.ok(hw);
  assert.equal(hw.text, 'HELLO WORLD');

  // Numeric + Alphanumeric + Byte + ECI(3=iso-8859-1) + Kanji
  const bw = new BitWriter();
  // Numeric "1234567"
  bw.write(0x1, 4);
  bw.write(7, 10);
  bw.write(123, 10);
  bw.write(456, 10);
  bw.write(7, 4);
  // Alphanumeric "-AB"
  bw.write(0x2, 4);
  bw.write(3, 9);
  bw.write(ALPHANUMERIC_CHARS.indexOf('-') * 45 + ALPHANUMERIC_CHARS.indexOf('A'), 11);
  bw.write(ALPHANUMERIC_CHARS.indexOf('B'), 6);
  // Byte UTF-8 "π🚀"
  const utf8 = new TextEncoder().encode('π🚀');
  bw.write(0x4, 4);
  bw.write(utf8.length, 8);
  for (const b of utf8) bw.write(b, 8);
  // ECI 3 (ISO-8859-1) + "é" (0xE9)
  bw.write(0x7, 4);
  bw.write(3, 8);
  bw.write(0x4, 4);
  bw.write(1, 8);
  bw.write(0xe9, 8);
  // Kanji "点" (Shift-JIS 0x935F -> 0x935F - 0x8140 = 0x121F -> 0x12*0xC0 + 0x1F = 3487)
  bw.write(0x8, 4);
  bw.write(1, 8);
  bw.write(0x12 * 0xc0 + 0x1f, 13);

  const mixed = bw.finish(40);
  const parsed = decodeBitStream(mixed, 1);
  assert.ok(parsed);
  assert.equal(parsed.text, '1234567-ABπ🚀é点');
});

test('End-to-end clean synthetic QR codes across versions, EC levels, and masks', () => {
  const cases: { text: string; version: number; ec: ECLevel; mask: number }[] = [
    { text: 'HTTPS://GITHUB.COM/QR-SCAN', version: 2, ec: 'M', mask: 2 },
    { text: 'V1-L compact OK!', version: 1, ec: 'L', mask: 0 },
    { text: 'ISO/IEC 18004 zero-dependency decoder 🚀', version: 5, ec: 'Q', mask: 5 },
    {
      text: 'V7-H activates 18-bit BCH version strips BL & TR!',
      version: 7,
      ec: 'H',
      mask: 7,
    },
  ];

  for (const tc of cases) {
    const matrix = encodeUtf8ByteQR(tc.text, tc.version, tc.ec, tc.mask);
    const { rgba, width, height } = rasterizeQR(matrix, { scale: 6, quiet: 4 });
    const res = decode(rgba, width, height, { debug: true });

    assert.ok(res, `failed to decode V${tc.version}-${tc.ec} mask ${tc.mask}`);
    assert.equal(res.text, tc.text);
    assert.equal(res.version, tc.version);
    assert.equal(res.ecLevel, tc.ec);
    assert.equal(res.mask, tc.mask);
    assert.ok(res.telemetry);
    assert.equal(res.telemetry.correctedErrors, 0);
  }
});

test('End-to-end perspective skew & rotation (V1 and V3)', () => {
  // Version 3 skewed with projective keystone + rotation
  const m3 = encodeUtf8ByteQR('perspective-skew-v3-payload', 3, 'M', 3);
  const r3 = rasterizeQR(m3, {
    width: 420,
    height: 420,
    dstCorners: [
      { x: 64, y: 72 },
      { x: 342, y: 46 },
      { x: 42, y: 338 },
      { x: 374, y: 368 },
    ],
  });
  const res3 = decode(r3.rgba, r3.width, r3.height, { debug: true });
  assert.ok(res3, 'failed skewed V3 decode');
  assert.equal(res3.text, 'perspective-skew-v3-payload');
  assert.equal(res3.version, 3);
  assert.ok(res3.telemetry?.alignment !== null);

  // Version 1 rotated & skewed (no alignment pattern)
  const m1 = encodeUtf8ByteQR('skew-v1', 1, 'L', 1);
  const r1 = rasterizeQR(m1, {
    width: 360,
    height: 360,
    dstCorners: [
      { x: 75, y: 55 },
      { x: 295, y: 80 },
      { x: 52, y: 275 },
      { x: 312, y: 298 },
    ],
  });
  const res1 = decode(r1.rgba, r1.width, r1.height);
  assert.ok(res1, 'failed skewed V1 decode');
  assert.equal(res1.text, 'skew-v1');
  assert.equal(res1.version, 1);
});

test('End-to-end severe diagonal shadow gradient (adaptive binarizer)', () => {
  const text = 'adaptive-bradley-roth-shadow-test';
  const matrix = encodeUtf8ByteQR(text, 4, 'M', 4);
  const { rgba, width, height } = rasterizeQR(matrix, {
    scale: 8,
    quiet: 4,
    shadowGradient: true,
  });

  const res = decode(rgba, width, height);
  assert.ok(res, 'failed shadow gradient decode');
  assert.equal(res.text, text);
});

test('End-to-end Reed-Solomon recovery from corrupted image modules', () => {
  const text = 'rs-recovers-bad-modules';
  const version = 3;
  const ec: ECLevel = 'H';
  const matrix = encodeUtf8ByteQR(text, version, ec, 6);

  // Corrupt 4 data modules in the upper-right data region (away from finders/format/timing)
  const dim = matrix.width;
  const damagedCoords: [number, number][] = [
    [dim - 2, 10],
    [dim - 3, 12],
    [dim - 2, 15],
    [dim - 4, 18],
  ];
  for (const [cx, cy] of damagedCoords) {
    setBit(matrix, cx, cy, getBit(matrix, cx, cy) ^ 1);
  }

  const { rgba, width, height } = rasterizeQR(matrix, { scale: 8, quiet: 4 });
  const res = decode(rgba, width, height, { debug: true });

  assert.ok(res, 'failed RS recovery decode');
  assert.equal(res.text, text);
  assert.ok(res.telemetry);
  assert.ok(res.telemetry.correctedErrors > 0, 'expected non-zero RS repairs');
});

test('End-to-end inverted light-on-dark QR code', () => {
  const text = 'inverted-qr-ok';
  const matrix = encodeUtf8ByteQR(text, 2, 'Q', 0);
  const { rgba, width, height } = rasterizeQR(matrix, {
    scale: 7,
    quiet: 4,
    invert: true,
  });

  assert.equal(decode(rgba, width, height, { tryInverted: false }), null);

  const res = decode(rgba, width, height, { tryInverted: true });
  assert.ok(res);
  assert.equal(res.text, text);
});

test('End-to-end 45-deg / 180-deg rotation and Version 8 multi-block RS with blur + noise', () => {
  // 45-degree rotated V5
  const text45 = 'rotated-45-deg-version-5-check';
  const m5 = encodeUtf8ByteQR(text45, 5, 'M', 3);
  const dim5 = m5.width;
  const cx = 250;
  const cy = 250;
  const halfDiag = 140;
  const r45 = rasterizeQR(m5, {
    width: 500,
    height: 500,
    dstCorners: [
      { x: cx, y: cy - halfDiag },
      { x: cx + halfDiag, y: cy },
      { x: cx - halfDiag, y: cy },
      { x: cx, y: cy + halfDiag },
    ],
  });
  const res45 = decode(r45.rgba, r45.width, r45.height);
  assert.ok(res45, 'failed 45-degree rotated V5');
  assert.equal(res45.text, text45);
  assert.equal(res45.version, 5);

  // 180-degree flipped + skewed V8 (2x2 blocks M) with blur, sensor noise, and module damage
  const text180 = 'V8-180deg-multi-block-interleaved-RS-blur-and-noise-payload';
  const m8 = encodeUtf8ByteQR(text180, 8, 'Q', 6);
  const dim8 = m8.width;
  setBit(m8, dim8 - 2, 12, getBit(m8, dim8 - 2, 12) ^ 1);
  setBit(m8, dim8 - 3, 20, getBit(m8, dim8 - 3, 20) ^ 1);
  setBit(m8, dim8 - 4, 28, getBit(m8, dim8 - 4, 28) ^ 1);

  const r180 = rasterizeQR(m8, {
    width: 520,
    height: 520,
    blurAndNoise: true,
    dstCorners: [
      { x: 455, y: 445 },
      { x: 75, y: 460 },
      { x: 445, y: 65 },
      { x: 60, y: 80 },
    ],
  });
  const res180 = decode(r180.rgba, r180.width, r180.height, { debug: true });
  assert.ok(res180, 'failed 180-degree noisy blurred V8');
  assert.equal(res180.text, text180);
  assert.equal(res180.version, 8);
  assert.ok(res180.telemetry);
  assert.ok(res180.telemetry.blocksTotal > 1);
  assert.ok(res180.telemetry.correctedErrors > 0);
});
