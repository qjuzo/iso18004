import { binarizeLuma, buildIntegralImage, rgbaToLuma, type IntegralImage } from './binarize.ts';
import { decodeBitStream } from './bitstream.ts';
import { extractRawCodewords, readFormatInfo, readVersionInfo } from './format.ts';
import {
  estimateProjectiveBottomRight,
  findAlignmentPattern,
  findFinderPatterns,
  measureModuleSizeAlongAxis,
  selectFinderTriads,
  traceBottomRightCorner,
} from './locator.ts';
import { projectPoint, sampleGrid, solveHomography } from './perspective.ts';
import { deinterleaveAndCorrect } from './reed-solomon.ts';
import type { BitMatrix, DecodeOptions, DecodeResult, FinderPattern, Point } from './types.ts';

export * from './types.ts';
export {
  MAX_U32_INTEGRAL_PIXELS,
  binarizeLuma,
  buildIntegralImage,
  rgbaToLuma,
  type IntegralImage,
} from './binarize.ts';
export { decodeBitStream } from './bitstream.ts';
export {
  ALIGNMENT_COORDS,
  buildFunctionPatternMask,
  decodeFormatBits,
  decodeVersionBits,
  encodeFormatBits,
  encodeVersionBits,
  evaluateMaskBit,
  extractRawCodewords,
  readFormatInfo,
  readVersionInfo,
} from './format.ts';
export { EXP_TABLE, LOG_TABLE, gfDiv, gfInv, gfMul, gfPow, polyMul, polyRest, rsGeneratorPoly } from './gf256.ts';
export { findAlignmentPattern, findFinderPatterns, selectFinderTriad, selectFinderTriads } from './locator.ts';
export { projectPoint, sampleGrid, solveHomography } from './perspective.ts';
export { deinterleaveAndCorrect, getBlockSpec, rsDecode } from './reed-solomon.ts';
export { scan } from './scan.ts';

function estimateProvisionalVersion(
  binarized: Uint8Array,
  width: number,
  height: number,
  tl: FinderPattern,
  tr: FinderPattern,
  bl: FinderPattern
): number {
  const dxTop = tr.x - tl.x;
  const dyTop = tr.y - tl.y;
  const lenTop = Math.hypot(dxTop, dyTop);
  const dxLeft = bl.x - tl.x;
  const dyLeft = bl.y - tl.y;
  const lenLeft = Math.hypot(dxLeft, dyLeft);

  const fallbackMod = (tl.size + tr.size + bl.size) / 3;
  const maxScan = fallbackMod * 8;

  const modTopA = measureModuleSizeAlongAxis(binarized, width, height, tl, dxTop / lenTop, dyTop / lenTop, maxScan);
  const modTopB = measureModuleSizeAlongAxis(binarized, width, height, tr, dxTop / lenTop, dyTop / lenTop, maxScan);
  const modLeftA = measureModuleSizeAlongAxis(binarized, width, height, tl, dxLeft / lenLeft, dyLeft / lenLeft, maxScan);
  const modLeftB = measureModuleSizeAlongAxis(binarized, width, height, bl, dxLeft / lenLeft, dyLeft / lenLeft, maxScan);

  const topMod =
    modTopA !== null && modTopB !== null
      ? (modTopA + modTopB) * 0.5
      : modTopA ?? modTopB ?? fallbackMod;
  const leftMod =
    modLeftA !== null && modLeftB !== null
      ? (modLeftA + modLeftB) * 0.5
      : modLeftA ?? modLeftB ?? fallbackMod;

  const distTop = lenTop / topMod;
  const distLeft = lenLeft / leftMod;
  const estDim = Math.round((distTop + distLeft) * 0.5) + 7;
  const clampedDim = Math.max(21, Math.min(177, estDim));
  return Math.max(1, Math.min(40, Math.round((clampedDim - 17) / 4)));
}

function tryDecodeWithQuad(
  binarized: Uint8Array,
  width: number,
  height: number,
  tl: FinderPattern,
  tr: FinderPattern,
  bl: FinderPattern,
  brSrc: Point,
  brDst: Point,
  version: number,
  alignment: Point | null,
  debug: boolean
): DecodeResult | null {
  const dim = version * 4 + 17;
  const srcPts: [Point, Point, Point, Point] = [
    { x: 3.5, y: 3.5 },
    { x: dim - 3.5, y: 3.5 },
    { x: 3.5, y: dim - 3.5 },
    brSrc,
  ];
  const dstPts: [Point, Point, Point, Point] = [
    { x: tl.x, y: tl.y },
    { x: tr.x, y: tr.y },
    { x: bl.x, y: bl.y },
    brDst,
  ];

  const h = solveHomography(srcPts, dstPts);
  if (!h) return null;

  let activeVersion = version;
  let activeDim = dim;
  let activeH = h;
  let matrix: BitMatrix = sampleGrid(binarized, width, height, activeDim, activeH);

  if (activeVersion >= 7 || activeDim >= 45) {
    const stripVersion = readVersionInfo(matrix);
    if (stripVersion !== null && stripVersion !== activeVersion) {
      activeVersion = stripVersion;
      activeDim = activeVersion * 4 + 17;
      const updatedAlign = findAlignmentPattern(binarized, width, height, tl, tr, bl, activeDim);
      const updatedBrSrc = updatedAlign
        ? { x: activeDim - 6.5, y: activeDim - 6.5 }
        : { x: activeDim - 3.5, y: activeDim - 3.5 };
      const updatedBrDst =
        updatedAlign ?? traceBottomRightCorner(binarized, width, height, tl, tr, bl, activeDim);
      const reSolved = solveHomography(
        [
          { x: 3.5, y: 3.5 },
          { x: activeDim - 3.5, y: 3.5 },
          { x: 3.5, y: activeDim - 3.5 },
          updatedBrSrc,
        ],
        [
          { x: tl.x, y: tl.y },
          { x: tr.x, y: tr.y },
          { x: bl.x, y: bl.y },
          updatedBrDst,
        ]
      );
      if (!reSolved) return null;
      activeH = reSolved;
      alignment = updatedAlign;
      matrix = sampleGrid(binarized, width, height, activeDim, activeH);
    }
  }

  const format = readFormatInfo(matrix);
  if (!format) return null;

  const rawCodewords = extractRawCodewords(matrix, activeVersion, format.mask);
  const rs = deinterleaveAndCorrect(rawCodewords, activeVersion, format.ecLevel);
  if (!rs) return null;

  const payload = decodeBitStream(rs.data, activeVersion);
  if (!payload) return null;

  const corners: [Point, Point, Point, Point] = [
    projectPoint(activeH, 0, 0),
    projectPoint(activeH, activeDim, 0),
    projectPoint(activeH, activeDim, activeDim),
    projectPoint(activeH, 0, activeDim),
  ];

  const result: DecodeResult = {
    text: payload.text,
    bytes: payload.bytes,
    version: activeVersion,
    ecLevel: format.ecLevel,
    mask: format.mask,
    corners,
  };

  if (debug) {
    result.telemetry = {
      binarized,
      width,
      height,
      finders: [
        { x: tl.x, y: tl.y },
        { x: tr.x, y: tr.y },
        { x: bl.x, y: bl.y },
      ],
      alignment,
      corners,
      matrix,
      version: activeVersion,
      ecLevel: format.ecLevel,
      mask: format.mask,
      correctedErrors: rs.correctedErrors,
      blocksTotal: rs.blocksTotal,
    };
  }

  return result;
}

function decodeBinarized(
  binarized: Uint8Array,
  width: number,
  height: number,
  debug: boolean
): DecodeResult | null {
  const candidates = findFinderPatterns(binarized, width, height);
  const triads = selectFinderTriads(candidates, 12);

  for (let t = 0; t < triads.length; t++) {
    const [tl, tr, bl] = triads[t];
    const provVersion = estimateProvisionalVersion(binarized, width, height, tl, tr, bl);
    const versionsToTry: number[] = [provVersion];
    if (provVersion > 1) versionsToTry.push(provVersion - 1);
    if (provVersion < 40) versionsToTry.push(provVersion + 1);

    for (let vIdx = 0; vIdx < versionsToTry.length; vIdx++) {
      const version = versionsToTry[vIdx];
      const dim = version * 4 + 17;
      const fallbackDst = traceBottomRightCorner(binarized, width, height, tl, tr, bl, dim);

      if (version >= 2) {
        const alignment = findAlignmentPattern(binarized, width, height, tl, tr, bl, dim);
        if (alignment) {
          const hit = tryDecodeWithQuad(
            binarized,
            width,
            height,
            tl,
            tr,
            bl,
            { x: dim - 6.5, y: dim - 6.5 },
            alignment,
            version,
            alignment,
            debug
          );
          if (hit) return hit;
        }
      }

      const fallbackHit = tryDecodeWithQuad(
        binarized,
        width,
        height,
        tl,
        tr,
        bl,
        { x: dim - 3.5, y: dim - 3.5 },
        fallbackDst,
        version,
        null,
        debug
      );
      if (fallbackHit) return fallbackHit;

      const projDst = estimateProjectiveBottomRight(binarized, width, height, tl, tr, bl);
      if (projDst) {
        const projHit = tryDecodeWithQuad(
          binarized,
          width,
          height,
          tl,
          tr,
          bl,
          { x: dim - 3.5, y: dim - 3.5 },
          projDst,
          version,
          null,
          debug
        );
        if (projHit) return projHit;
      }
    }
  }

  return null;
}

export interface DecodeLumaOptions extends DecodeOptions {
  windowRadius?: number;
  buffers?: {
    integral: IntegralImage;
    binarized: Uint8Array;
  };
  invertOnly?: boolean;
}

export function decodeLuma(
  luma: Uint8Array,
  width: number,
  height: number,
  opts: DecodeLumaOptions = {}
): DecodeResult | null {
  if (width <= 0 || height <= 0 || luma.length < width * height) {
    return null;
  }

  const debug = opts.debug === true;
  const tryInverted = opts.tryInverted !== false;
  const invertOnly = opts.invertOnly === true;
  const windowRadius = opts.windowRadius;
  const integralScratch = opts.buffers?.integral;
  const binScratch = opts.buffers?.binarized;

  const integral = buildIntegralImage(luma, width, height, integralScratch);

  if (!invertOnly) {
    const normalBin = binarizeLuma(luma, integral, width, height, false, windowRadius, binScratch);
    const normalHit = decodeBinarized(normalBin, width, height, debug);
    if (normalHit) {
      if (debug && normalHit.telemetry && binScratch) {
        normalHit.telemetry.binarized = normalBin.slice(0, width * height);
      }
      return normalHit;
    }
  }

  if (invertOnly || tryInverted) {
    const invertedBin = binarizeLuma(luma, integral, width, height, true, windowRadius, binScratch);
    const invertedHit = decodeBinarized(invertedBin, width, height, debug);
    if (invertedHit) {
      if (debug && invertedHit.telemetry && binScratch) {
        invertedHit.telemetry.binarized = invertedBin.slice(0, width * height);
      }
      return invertedHit;
    }
  }

  return null;
}

export function decode(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opts: DecodeOptions = {}
): DecodeResult | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return null;
  }

  const luma = rgbaToLuma(rgba, width, height);
  return decodeLuma(luma, width, height, opts);
}
