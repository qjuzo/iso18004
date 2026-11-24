import { binarizeLuma, buildIntegralImage, rgbaToLuma } from './binarize.ts';
import { decodeLuma } from './index.ts';
import type { DecodeResult, Point, ScanOptions } from './types.ts';

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
    const integral = buildIntegralImage(fullLuma, frameW, frameH);
    const fullBin = binarizeLuma(fullLuma, integral, frameW, frameH, false);

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

interface TilePlan {
  tileW: number;
  tileH: number;
  scale: number;
  coords: { tx: number; ty: number; dist2: number }[];
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
  let windowsTried = 0;

  const fullLuma = rgbaToLuma(rgba, width, height);

  const direct = decodeLuma(fullLuma, width, height, opts);
  if (direct) return direct;

  if (performance.now() - startTime >= maxTimeMs || windowsTried >= maxWindows) {
    return null;
  }

  const minDim = width < height ? width : height;
  const rawTiers: { winSize: number; scale: number }[] =
    minDim < 220
      ? [{ winSize: Math.max(width, height), scale: minDim < 110 ? 3 : 2 }]
      : [
          { winSize: Math.max(160, Math.round(minDim * 0.28)), scale: 2 },
          { winSize: Math.max(96, Math.round(minDim * 0.16)), scale: 3 },
        ];

  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const plans: TilePlan[] = [];
  let maxUpW = 0;
  let maxUpPixels = 0;
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

    const upW = tileW * scale;
    const upH = tileH * scale;
    if (upW > maxUpW) maxUpW = upW;
    if (upW * upH > maxUpPixels) maxUpPixels = upW * upH;
    const intLen = (upW + 1) * (upH + 1);
    if (intLen > maxIntegralLen) maxIntegralLen = intLen;
  }

  if (plans.length === 0) return null;

  const upLuma = new Uint8Array(maxUpPixels);
  const x0Lut = new Int32Array(maxUpW);
  const x1Lut = new Int32Array(maxUpW);
  const wxLut = new Uint16Array(maxUpW);
  const buffers = {
    integral: new Uint32Array(maxIntegralLen),
    binarized: new Uint8Array(maxUpPixels),
  };

  const tryInverted = opts.tryInverted !== false;
  const polarities = tryInverted ? [false, true] : [false];

  for (let p = 0; p < polarities.length; p++) {
    const invertOnly = polarities[p];

    for (let t = 0; t < plans.length; t++) {
      const { tileW, tileH, scale, coords } = plans[t];
      const upW = tileW * scale;
      const upH = tileH * scale;
      const windowRadius = Math.max(12, scale * 6);

      for (let i = 0; i < coords.length; i++) {
        if (performance.now() - startTime >= maxTimeMs || windowsTried >= maxWindows) {
          return null;
        }

        const { tx, ty } = coords[i];
        if (!hasTileContrast(fullLuma, width, tx, ty, tileW, tileH)) {
          continue;
        }
        windowsTried++;

        upscaleTileBilinear(fullLuma, width, tx, ty, tileW, tileH, scale, upLuma, x0Lut, x1Lut, wxLut);

        const hit = decodeLuma(upLuma, upW, upH, {
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
