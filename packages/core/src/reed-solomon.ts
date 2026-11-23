import { EXP_TABLE, gfDiv, gfMul } from './gf256.ts';
import type { ECLevel } from './types.ts';

// ISO 18004 Table 9: EC codewords per block, indexed by (version - 1) * 4 + ecIndex [L, M, Q, H]
const EC_CODEWORDS_PER_BLOCK = new Uint8Array([
  7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 18, 22, 20, 18, 26, 16, 26, 24, 18, 22,
  18, 16, 24, 28, 20, 18, 18, 26, 24, 22, 22, 26, 30, 22, 20, 24, 18, 26, 24, 28,
  20, 30, 28, 24, 24, 22, 26, 28, 26, 22, 24, 22, 30, 24, 20, 24, 22, 24, 30, 24,
  24, 28, 24, 30, 28, 28, 28, 28, 30, 26, 28, 28, 28, 26, 26, 26, 28, 26, 30, 28,
  28, 26, 28, 30, 28, 28, 30, 24, 30, 28, 30, 30, 30, 28, 30, 30, 26, 28, 30, 30,
  28, 28, 28, 30, 30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30,
  30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30,
  30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30, 30, 28, 30, 30,
]);

// ISO 18004 Table 9: total error correction blocks per symbol, indexed by (version - 1) * 4 + ecIndex
const NUM_ERROR_CORRECTION_BLOCKS = new Uint8Array([
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4, 1, 2, 4, 4,
  2, 4, 4, 4, 2, 4, 6, 5, 2, 4, 6, 6, 2, 5, 8, 8, 4, 5, 8, 8,
  4, 5, 8, 11, 4, 8, 10, 11, 4, 9, 12, 16, 4, 9, 16, 16, 6, 10, 12, 18,
  6, 10, 17, 16, 6, 11, 16, 19, 6, 13, 18, 21, 7, 14, 21, 25, 8, 16, 20, 25,
  8, 17, 23, 25, 9, 17, 23, 34, 9, 18, 25, 30, 10, 20, 27, 32, 12, 21, 29, 35,
  12, 23, 34, 37, 12, 25, 34, 40, 13, 26, 35, 42, 14, 28, 38, 45, 15, 29, 40, 48,
  16, 31, 43, 51, 17, 33, 45, 54, 18, 35, 48, 57, 19, 37, 51, 60, 19, 38, 53, 63,
  20, 40, 56, 66, 21, 43, 59, 70, 22, 45, 62, 74, 24, 47, 65, 77, 25, 49, 68, 81,
]);

const EC_INDEX: Record<ECLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

export interface DeinterleaveResult {
  data: Uint8Array;
  correctedErrors: number;
  blocksTotal: number;
}

export function rsDecode(codewords: Uint8Array, ecLen: number): number {
  const n = codewords.length;
  if (ecLen <= 0 || n <= ecLen) return -1;

  const syndromes = new Uint8Array(ecLen);
  let hasError = false;
  for (let i = 0; i < ecLen; i++) {
    const alpha = EXP_TABLE[i];
    let s = 0;
    for (let j = 0; j < n; j++) {
      s = gfMul(s, alpha) ^ codewords[j];
    }
    syndromes[i] = s;
    if (s !== 0) hasError = true;
  }
  if (!hasError) return 0;

  // Berlekamp-Massey algorithm for error-locator polynomial sigma(z)
  const sigma = new Uint8Array(ecLen + 1);
  const prevSigma = new Uint8Array(ecLen + 1);
  const temp = new Uint8Array(ecLen + 1);
  sigma[0] = 1;
  prevSigma[0] = 1;

  let L = 0;
  let m = 1;
  let b = 1;

  for (let r = 0; r < ecLen; r++) {
    let d = syndromes[r];
    for (let i = 1; i <= L; i++) {
      d ^= gfMul(sigma[i], syndromes[r - i]);
    }
    if (d === 0) {
      m++;
      continue;
    }

    temp.set(sigma);
    const factor = gfDiv(d, b);
    for (let i = 0; i <= ecLen - m; i++) {
      if (prevSigma[i] !== 0) {
        sigma[i + m] ^= gfMul(factor, prevSigma[i]);
      }
    }
    if (2 * L <= r) {
      L = r + 1 - L;
      prevSigma.set(temp);
      b = d;
      m = 1;
    } else {
      m++;
    }
  }

  if (L === 0 || L > (ecLen >> 1)) return -1;

  // Chien search for roots X_k^{-1} of sigma(z)
  const errorPositions = new Uint32Array(L);
  const errorXInv = new Uint8Array(L);
  let found = 0;

  for (let pos = 0; pos < n; pos++) {
    const deg = (n - 1 - pos) % 255;
    const xInv = EXP_TABLE[255 - deg];
    let evalVal = sigma[L];
    for (let j = L - 1; j >= 0; j--) {
      evalVal = gfMul(evalVal, xInv) ^ sigma[j];
    }
    if (evalVal === 0) {
      if (found >= L) return -1;
      errorPositions[found] = pos;
      errorXInv[found] = xInv;
      found++;
    }
  }

  if (found !== L) return -1;

  // Forney algorithm with fcr = 0: omega(z) = (S(z) * sigma(z)) mod z^ecLen
  const omega = new Uint8Array(ecLen);
  for (let i = 0; i < ecLen; i++) {
    let sum = 0;
    const maxJ = i < L ? i : L;
    for (let j = 0; j <= maxJ; j++) {
      sum ^= gfMul(sigma[j], syndromes[i - j]);
    }
    omega[i] = sum;
  }

  for (let k = 0; k < L; k++) {
    const xInv = errorXInv[k];

    let num = 0;
    for (let i = ecLen - 1; i >= 0; i--) {
      num = gfMul(num, xInv) ^ omega[i];
    }

    // Odd-degree terms evaluate X_k^{-1} * sigma'(X_k^{-1}) in GF(2^8)
    let den = 0;
    const xInv2 = gfMul(xInv, xInv);
    for (let j = (L % 2 === 1 ? L : L - 1); j >= 1; j -= 2) {
      den = gfMul(den, xInv2) ^ sigma[j];
    }
    den = gfMul(den, xInv);

    if (den === 0) return -1;
    codewords[errorPositions[k]] ^= gfDiv(num, den);
  }

  // Verify all syndromes vanish after repair
  for (let i = 0; i < ecLen; i++) {
    const alpha = EXP_TABLE[i];
    let s = 0;
    for (let j = 0; j < n; j++) {
      s = gfMul(s, alpha) ^ codewords[j];
    }
    if (s !== 0) return -1;
  }

  return L;
}

export function getBlockSpec(version: number, ecLevel: ECLevel, totalCodewords: number): {
  ecPerBlock: number;
  totalBlocks: number;
  totalData: number;
  g1Data: number;
  g1Blocks: number;
  g2Blocks: number;
} {
  const idx = (version - 1) * 4 + EC_INDEX[ecLevel];
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[idx];
  const totalBlocks = NUM_ERROR_CORRECTION_BLOCKS[idx];
  const totalData = totalCodewords - totalBlocks * ecPerBlock;
  const g1Data = Math.floor(totalData / totalBlocks);
  const g2Blocks = totalData % totalBlocks;
  const g1Blocks = totalBlocks - g2Blocks;
  return { ecPerBlock, totalBlocks, totalData, g1Data, g1Blocks, g2Blocks };
}

export function deinterleaveAndCorrect(
  rawCodewords: Uint8Array,
  version: number,
  ecLevel: ECLevel
): DeinterleaveResult | null {
  if (version < 1 || version > 40) return null;
  const spec = getBlockSpec(version, ecLevel, rawCodewords.length);
  if (spec.totalData <= 0) return null;

  const { ecPerBlock, totalBlocks, totalData, g1Data, g1Blocks } = spec;
  const blocks: Uint8Array[] = new Array(totalBlocks);
  const blockDataLens = new Uint16Array(totalBlocks);

  for (let b = 0; b < totalBlocks; b++) {
    const dataLen = b < g1Blocks ? g1Data : g1Data + 1;
    blockDataLens[b] = dataLen;
    blocks[b] = new Uint8Array(dataLen + ecPerBlock);
  }

  let rawIdx = 0;
  for (let col = 0; col < g1Data; col++) {
    for (let b = 0; b < totalBlocks; b++) {
      blocks[b][col] = rawCodewords[rawIdx++];
    }
  }
  for (let b = g1Blocks; b < totalBlocks; b++) {
    blocks[b][g1Data] = rawCodewords[rawIdx++];
  }
  for (let col = 0; col < ecPerBlock; col++) {
    for (let b = 0; b < totalBlocks; b++) {
      blocks[b][blockDataLens[b] + col] = rawCodewords[rawIdx++];
    }
  }

  const data = new Uint8Array(totalData);
  let outOffset = 0;
  let correctedErrors = 0;

  for (let b = 0; b < totalBlocks; b++) {
    const fixed = rsDecode(blocks[b], ecPerBlock);
    if (fixed < 0) return null;
    correctedErrors += fixed;
    const len = blockDataLens[b];
    data.set(blocks[b].subarray(0, len), outOffset);
    outOffset += len;
  }

  return { data, correctedErrors, blocksTotal: totalBlocks };
}
