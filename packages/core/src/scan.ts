import { MAX_U32_INTEGRAL_PIXELS, binarizeLuma, buildIntegralImage, rgbaToLuma } from './binarize.ts';
import { decodeLuma } from './index.ts';
import type { DecodeResult, Point, ScanOptions } from './types.ts';

const MAX_FULL_RES_DECODE_PIXELS = 2_500_000;

interface PyramidLevel {
  luma: Uint8Array;
  width: number;
  height: number;
  factor: number;
}

interface TilePlan {
  tileW: number;
  tileH: number;
  scale: number;
  coords: { tx: number; ty: number; dist2: number }[];
}

function downsample2x(src: Uint8Array, srcW: number, srcH: number): {
  luma: Uint8Array;
  width: number;
  height: number;
} {
  const width = srcW >> 1;
  const height = srcH >> 1;
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const r0 = (y << 1) * srcW;
    const r1 = r0 + srcW;
    const dstRow = y * width;
    for (let x = 0; x < width; x++) {
      const x2 = x << 1;
      luma[dstRow + x] =
        (src[r0 + x2] + src[r0 + x2 + 1] + src[r1 + x2] + src[r1 + x2 + 1] + 2) >> 2;
    }
  }
  return { luma, width, height };
}

function copyTile(
  srcLuma: Uint8Array,
  srcStride: number,
  tx: number,
  ty: number,
  tileW: number,
  tileH: number,
  dst: Uint8Array
): void {
  for (let y = 0; y < tileH; y++) {
    const srcRow = (ty + y) * srcStride + tx;
    dst.set(srcLuma.subarray(srcRow, srcRow + tileW), y * tileW);
  }
}

function buildAxisPositions(limit: number, tileSize: number): Int32Array {
  if (tileSize >= limit) return new Int32Array([0]);
  const step = Math.max(1, tileSize >> 1);
  const positions: number[] = [];
  for (let p = 0; p + tileSize <= limit; p += step) {
    positions.push(p);
  }
  const last = limit - tileSize;
  if (positions.length === 0 || positions[positions.length - 1] !== last) {
    positions.push(last);
  }
  return new Int32Array(positions);
}

function hasTileContrast(
  luma: Uint8Array,
  stride: number,
  tx: number,
  ty: number,
  tileW: number,
  tileH: number
): boolean {
  let minVal = 255;
  let maxVal = 0;
  const endY = ty + tileH;
  const endX = tx + tileW;
  for (let y = ty; y < endY; y += 2) {
    const row = y * stride;
    for (let x = tx; x < endX; x += 2) {
      const v = luma[row + x];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
      if (maxVal - minVal >= 24) return true;
    }
  }
  return false;
}

function upscaleTileBilinear(
  srcLuma: Uint8Array,
  srcStride: number,
  tx: number,
  ty: number,
  tileW: number,
  tileH: number,
  scale: number,
  dstLuma: Uint8Array,
  x0Lut: Int32Array,
  x1Lut: Int32Array,
  wxLut: Uint16Array
): void {
  const upW = tileW * scale;
  const upH = tileH * scale;
  const maxX = tileW - 1;
  const maxY = tileH - 1;

  for (let ux = 0; ux < upW; ux++) {
    const sx = (ux + 0.5) / scale - 0.5;
    const clamped = sx < 0 ? 0 : sx > maxX ? maxX : sx;
    const i0 = Math.floor(clamped);
    const i1 = i0 < maxX ? i0 + 1 : maxX;
    x0Lut[ux] = tx + i0;
    x1Lut[ux] = tx + i1;
    wxLut[ux] = Math.round((clamped - i0) * 256);
  }

  for (let uy = 0; uy < upH; uy++) {
    const sy = (uy + 0.5) / scale - 0.5;
    const clamped = sy < 0 ? 0 : sy > maxY ? maxY : sy;
    const j0 = Math.floor(clamped);
    const j1 = j0 < maxY ? j0 + 1 : maxY;
    const wy = Math.round((clamped - j0) * 256);
    const wyInv = 256 - wy;

    const r0 = (ty + j0) * srcStride;
    const r1 = (ty + j1) * srcStride;
    const dstRow = uy * upW;

    for (let ux = 0; ux < upW; ux++) {
      const c0 = x0Lut[ux];
      const c1 = x1Lut[ux];
      const wx = wxLut[ux];
      const wxInv = 256 - wx;

      const top = srcLuma[r0 + c0] * wxInv + srcLuma[r0 + c1] * wx;
      const bot = srcLuma[r1 + c0] * wxInv + srcLuma[r1 + c1] * wx;
      dstLuma[dstRow + ux] = (top * wyInv + bot * wy + 32768) >> 16;
    }
  }
}

function mapResultToFrame(
  hit: DecodeResult,
  tx: number,
  ty: number,
  scale: number,
  fullLuma: Uint8Array,
  frameW: number,
  frameH: number,
  tileW: number,
  tileH: number
): DecodeResult {
  const mapPoint = (pt: Point): Point => ({
    x: tx + pt.x / scale,
    y: ty + pt.y / scale,
  });

  const corners: [Point, Point, Point, Point] = [
    mapPoint(hit.corners[0]),
    mapPoint(hit.corners[1]),
    mapPoint(hit.corners[2]),
    mapPoint(hit.corners[3]),
  ];

  const mapped: DecodeResult = {
    text: hit.text,
    bytes: hit.bytes,
    version: hit.version,
    ecLevel: hit.ecLevel,
    mask: hit.mask,
    corners,
  };

  if (hit.telemetry) {
    const tel = hit.telemetry;
    let fullBin: Uint8Array;

    if (scale < 1) {
      fullBin = new Uint8Array(frameW * frameH);
      const srcW = tel.width;
      const srcH = tel.height;
      for (let y = 0; y < frameH; y++) {
        const sy = Math.min(srcH - 1, (y * scale) | 0);
        const srcRow = sy * srcW;
        const dstRow = y * frameW;
        for (let x = 0; x < frameW; x++) {
          const sx = Math.min(srcW - 1, (x * scale) | 0);
          fullBin[dstRow + x] = tel.binarized[srcRow + sx];
        }
      }
    } else {
      const integral = buildIntegralImage(fullLuma, frameW, frameH);
      fullBin = binarizeLuma(fullLuma, integral, frameW, frameH, false);

      // Splice the decoded tile's binarized pixels back into full-frame telemetry view
      const upW = tel.width;
      const halfScale = scale >> 1;
      for (let y = 0; y < tileH; y++) {
        const uy = Math.min(tel.height - 1, y * scale + halfScale);
        const dstRow = (ty + y) * frameW + tx;
        const srcRow = uy * upW;
        for (let x = 0; x < tileW; x++) {
          const ux = Math.min(upW - 1, x * scale + halfScale);
          fullBin[dstRow + x] = tel.binarized[srcRow + ux];
        }
      }
    }

    mapped.telemetry = {
      binarized: fullBin,
      width: frameW,
      height: frameH,
      finders: [
        mapPoint(tel.finders[0]),
        mapPoint(tel.finders[1]),
        mapPoint(tel.finders[2]),
      ],
      alignment: tel.alignment ? mapPoint(tel.alignment) : null,
      corners,
      matrix: tel.matrix,
      version: tel.version,
      ecLevel: tel.ecLevel,
      mask: tel.mask,
      correctedErrors: tel.correctedErrors,
      blocksTotal: tel.blocksTotal,
    };
  }

  return mapped;
}

export function scan(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opts: ScanOptions = {}
): DecodeResult | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return null;
  }

  const startTime = performance.now();
  const maxTimeMs = opts.maxTimeMs ?? 1500;
  const maxWindows = opts.maxWindows ?? Infinity;
  if (maxTimeMs <= 0) return null;

  const fullLuma = rgbaToLuma(rgba, width, height);
  const maxDim = width > height ? width : height;
  const minDim = width < height ? width : height;
  const totalPixels = width * height;

  if (maxDim <= 1600 && totalPixels <= MAX_U32_INTEGRAL_PIXELS) {
    const direct = decodeLuma(fullLuma, width, height, opts);
    if (direct) return direct;
  } else {
    const levels: PyramidLevel[] = [{ luma: fullLuma, width, height, factor: 1 }];
    let curLuma = fullLuma;
    let curW = width;
    let curH = height;
    let curFactor = 1;

    while (
      (Math.max(curW, curH) > 1600 || curW * curH > MAX_U32_INTEGRAL_PIXELS) &&
      Math.min(curW, curH) >= 400
    ) {
      if (performance.now() - startTime >= maxTimeMs) return null;
      const next = downsample2x(curLuma, curW, curH);
      curLuma = next.luma;
      curW = next.width;
      curH = next.height;
      curFactor <<= 1;
      levels.push({ luma: curLuma, width: curW, height: curH, factor: curFactor });
    }

    let maxPyrPixels = 0;
    let maxPyrIntLen = 0;
    for (let i = 0; i < levels.length; i++) {
      const lv = levels[i];
      if (lv.factor === 1 && lv.width * lv.height > MAX_FULL_RES_DECODE_PIXELS) continue;
      const px = lv.width * lv.height;
      const il = (lv.width + 1) * (lv.height + 1);
      if (px > maxPyrPixels) maxPyrPixels = px;
      if (il > maxPyrIntLen) maxPyrIntLen = il;
    }

    const pyrBuffers =
      maxPyrPixels > 0
        ? {
            integral: new Uint32Array(maxPyrIntLen),
            binarized: new Uint8Array(maxPyrPixels),
          }
        : undefined;

    for (let i = levels.length - 1; i >= 0; i--) {
      const lv = levels[i];
      if (lv.factor === 1 && lv.width * lv.height > MAX_FULL_RES_DECODE_PIXELS) continue;
      if (performance.now() - startTime >= maxTimeMs) return null;

      const hit = decodeLuma(lv.luma, lv.width, lv.height, {
        debug: opts.debug,
        tryInverted: opts.tryInverted,
        buffers: pyrBuffers,
      });
      if (hit) {
        if (lv.factor === 1) return hit;
        return mapResultToFrame(hit, 0, 0, 1 / lv.factor, fullLuma, width, height, width, height);
      }
    }
  }

  let windowsTried = 0;
  if (performance.now() - startTime >= maxTimeMs || windowsTried >= maxWindows) {
    return null;
  }

  const rawTiers: { winSize: number; scale: number }[] =
    minDim < 220
      ? [{ winSize: maxDim, scale: minDim < 110 ? 3 : 2 }]
      : maxDim > 2000
        ? [
            { winSize: Math.min(720, Math.round(minDim * 0.36)), scale: 1 },
            { winSize: 280, scale: 2 },
          ]
        : [
            { winSize: Math.max(160, Math.round(minDim * 0.28)), scale: 2 },
            { winSize: Math.max(96, Math.round(minDim * 0.16)), scale: 3 },
          ];

  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const plans: TilePlan[] = [];
  let maxWorkW = 0;
  let maxWorkPixels = 0;
  let maxIntegralLen = 0;

  for (let t = 0; t < rawTiers.length; t++) {
    const { winSize, scale } = rawTiers[t];
    const tileW = Math.min(width, winSize);
    const tileH = Math.min(height, winSize);
    if (t > 0 && tileW === width && tileH === height) continue;

    const xs = buildAxisPositions(width, tileW);
    const ys = buildAxisPositions(height, tileH);

    // Order windows from frame center outward so centered symbols resolve first
    const coords: { tx: number; ty: number; dist2: number }[] = [];
    for (let yi = 0; yi < ys.length; yi++) {
      const ty = ys[yi];
      const dy = ty + tileH * 0.5 - centerY;
      for (let xi = 0; xi < xs.length; xi++) {
        const tx = xs[xi];
        const dx = tx + tileW * 0.5 - centerX;
        coords.push({ tx, ty, dist2: dx * dx + dy * dy });
      }
    }
    coords.sort((a, b) => a.dist2 - b.dist2);
    plans.push({ tileW, tileH, scale, coords });

    const workW = tileW * scale;
    const workH = tileH * scale;
    if (scale > 1 && workW > maxWorkW) maxWorkW = workW;
    if (workW * workH > maxWorkPixels) maxWorkPixels = workW * workH;
    const intLen = (workW + 1) * (workH + 1);
    if (intLen > maxIntegralLen) maxIntegralLen = intLen;
  }

  if (plans.length === 0) return null;

  const tileLuma = new Uint8Array(maxWorkPixels);
  const x0Lut = maxWorkW > 0 ? new Int32Array(maxWorkW) : new Int32Array(0);
  const x1Lut = maxWorkW > 0 ? new Int32Array(maxWorkW) : new Int32Array(0);
  const wxLut = maxWorkW > 0 ? new Uint16Array(maxWorkW) : new Uint16Array(0);
  const buffers = {
    integral: new Uint32Array(maxIntegralLen),
    binarized: new Uint8Array(maxWorkPixels),
  };

  const tryInverted = opts.tryInverted !== false;
  const polarities = tryInverted ? [false, true] : [false];

  for (let p = 0; p < polarities.length; p++) {
    const invertOnly = polarities[p];

    for (let t = 0; t < plans.length; t++) {
      const { tileW, tileH, scale, coords } = plans[t];
      const workW = tileW * scale;
      const workH = tileH * scale;
      const windowRadius =
        scale === 1
          ? Math.max(16, Math.min(64, Math.floor(Math.min(tileW, tileH) / 12)))
          : Math.max(12, scale * 6);

      for (let i = 0; i < coords.length; i++) {
        if (performance.now() - startTime >= maxTimeMs || windowsTried >= maxWindows) {
          return null;
        }

        const { tx, ty } = coords[i];
        if (!hasTileContrast(fullLuma, width, tx, ty, tileW, tileH)) {
          continue;
        }
        windowsTried++;

        if (scale === 1) {
          copyTile(fullLuma, width, tx, ty, tileW, tileH, tileLuma);
        } else {
          upscaleTileBilinear(
            fullLuma,
            width,
            tx,
            ty,
            tileW,
            tileH,
            scale,
            tileLuma,
            x0Lut,
            x1Lut,
            wxLut
          );
        }

        const hit = decodeLuma(tileLuma, workW, workH, {
          debug: opts.debug,
          tryInverted: false,
          invertOnly,
          windowRadius,
          buffers,
        });
        if (hit) {
          return mapResultToFrame(hit, tx, ty, scale, fullLuma, width, height, tileW, tileH);
        }
      }
    }
  }

  return null;
}
