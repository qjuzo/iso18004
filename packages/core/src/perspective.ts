import { createBitMatrix, setBit, type BitMatrix, type Point } from './types.ts';

export function solveHomography(
  src: readonly [Point, Point, Point, Point],
  dst: readonly [Point, Point, Point, Point]
): Float64Array | null {
  // 8x9 augmented linear system for projective matrix mapping src (u, v) -> dst (x, y)
  const a = new Float64Array(72);

  for (let i = 0; i < 4; i++) {
    const u = src[i].x;
    const v = src[i].y;
    const x = dst[i].x;
    const y = dst[i].y;

    const r0 = i * 2 * 9;
    a[r0] = u;
    a[r0 + 1] = v;
    a[r0 + 2] = 1;
    a[r0 + 6] = -u * x;
    a[r0 + 7] = -v * x;
    a[r0 + 8] = x;

    const r1 = (i * 2 + 1) * 9;
    a[r1 + 3] = u;
    a[r1 + 4] = v;
    a[r1 + 5] = 1;
    a[r1 + 6] = -u * y;
    a[r1 + 7] = -v * y;
    a[r1 + 8] = y;
  }

  for (let col = 0; col < 8; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(a[col * 9 + col]);
    for (let row = col + 1; row < 8; row++) {
      const val = Math.abs(a[row * 9 + col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = row;
      }
    }
    if (maxVal < 1e-12) return null;

    if (pivotRow !== col) {
      for (let j = col; j < 9; j++) {
        const tmp = a[col * 9 + j];
        a[col * 9 + j] = a[pivotRow * 9 + j];
        a[pivotRow * 9 + j] = tmp;
      }
    }

    const pivot = a[col * 9 + col];
    for (let row = col + 1; row < 8; row++) {
      const factor = a[row * 9 + col] / pivot;
      if (factor === 0) continue;
      for (let j = col; j < 9; j++) {
        a[row * 9 + j] -= factor * a[col * 9 + j];
      }
    }
  }

  const h = new Float64Array(9);
  for (let row = 7; row >= 0; row--) {
    let sum = a[row * 9 + 8];
    for (let j = row + 1; j < 8; j++) {
      sum -= a[row * 9 + j] * h[j];
    }
    h[row] = sum / a[row * 9 + row];
  }
  h[8] = 1;

  return h;
}

export function projectPoint(h: Float64Array, u: number, v: number): Point {
  const denom = h[6] * u + h[7] * v + h[8];
  if (Math.abs(denom) < 1e-12) {
    return { x: 0, y: 0 };
  }
  return {
    x: (h[0] * u + h[1] * v + h[2]) / denom,
    y: (h[3] * u + h[4] * v + h[5]) / denom,
  };
}

function sampleBilinear(binarized: Uint8Array, imgW: number, imgH: number, px: number, py: number): number {
  if (px < 0 || px >= imgW || py < 0 || py >= imgH) return 0;

  const sx = Math.max(0, Math.min(imgW - 1, px - 0.5));
  const sy = Math.max(0, Math.min(imgH - 1, py - 0.5));
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1 < imgW ? x0 + 1 : x0;
  const y1 = y0 + 1 < imgH ? y0 + 1 : y0;
  const fx = sx - x0;
  const fy = sy - y0;

  const r0 = y0 * imgW;
  const r1 = y1 * imgW;
  const top = binarized[r0 + x0] * (1 - fx) + binarized[r0 + x1] * fx;
  const bot = binarized[r1 + x0] * (1 - fx) + binarized[r1 + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

const SAMPLE_OFFSETS = [
  0, 0,
  -0.2, 0,
  0.2, 0,
  0, -0.2,
  0, 0.2,
];

export function sampleGrid(
  binarized: Uint8Array,
  imgW: number,
  imgH: number,
  dimension: number,
  h: Float64Array
): BitMatrix {
  const matrix = createBitMatrix(dimension, dimension);
  const h0 = h[0], h1 = h[1], h2 = h[2];
  const h3 = h[3], h4 = h[4], h5 = h[5];
  const h6 = h[6], h7 = h[7], h8 = h[8];

  for (let r = 0; r < dimension; r++) {
    const vCenter = r + 0.5;
    for (let c = 0; c < dimension; c++) {
      const uCenter = c + 0.5;
      let acc = 0;
      for (let s = 0; s < 10; s += 2) {
        const u = uCenter + SAMPLE_OFFSETS[s];
        const v = vCenter + SAMPLE_OFFSETS[s + 1];
        const denom = h6 * u + h7 * v + h8;
        if (Math.abs(denom) < 1e-12) continue;
        const px = (h0 * u + h1 * v + h2) / denom;
        const py = (h3 * u + h4 * v + h5) / denom;
        acc += sampleBilinear(binarized, imgW, imgH, px, py);
      }
      setBit(matrix, c, r, acc >= 2.5 ? 1 : 0);
    }
  }

  return matrix;
}
