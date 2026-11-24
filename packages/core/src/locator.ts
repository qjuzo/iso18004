import type { FinderPattern, Point } from './types.ts';

function checkFinderRatio(counts: Int32Array, toleranceFactor = 0.6): boolean {
  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (total < 7) return false;
  if (counts[0] === 0 || counts[1] === 0 || counts[2] === 0 || counts[3] === 0 || counts[4] === 0) {
    return false;
  }

  const unit = total / 7;
  const maxVar = Math.max(0.75, unit * toleranceFactor);

  return (
    Math.abs(unit - counts[0]) < maxVar &&
    Math.abs(unit - counts[1]) < maxVar &&
    Math.abs(3 * unit - counts[2]) < 3 * maxVar &&
    Math.abs(unit - counts[3]) < maxVar &&
    Math.abs(unit - counts[4]) < maxVar
  );
}

function centerFromEnd(counts: Int32Array, endIndex: number): number {
  return endIndex - counts[4] - counts[3] - counts[2] * 0.5;
}

function crossCheckVertical(
  binarized: Uint8Array,
  width: number,
  height: number,
  cx: number,
  startY: number,
  centerCount: number,
  originalTotal: number
): { centerY: number; total: number } | null {
  if (cx < 0 || cx >= width || startY < 0 || startY >= height) return null;
  if (binarized[startY * width + cx] !== 1) return null;

  const counts = new Int32Array(5);

  let y = startY;
  while (y >= 0 && binarized[y * width + cx] === 1) {
    counts[2]++;
    y--;
  }
  if (y < 0) return null;
  while (y >= 0 && binarized[y * width + cx] === 0 && counts[1] <= centerCount) {
    counts[1]++;
    y--;
  }
  if (y < 0 || counts[1] > centerCount) return null;
  while (y >= 0 && binarized[y * width + cx] === 1 && counts[0] <= centerCount) {
    counts[0]++;
    y--;
  }
  if (counts[0] === 0 || counts[0] > centerCount) return null;

  y = startY + 1;
  while (y < height && binarized[y * width + cx] === 1) {
    counts[2]++;
    y++;
  }
  if (y >= height) return null;
  while (y < height && binarized[y * width + cx] === 0 && counts[3] <= centerCount) {
    counts[3]++;
    y++;
  }
  if (y >= height || counts[3] > centerCount) return null;
  while (y < height && binarized[y * width + cx] === 1 && counts[4] <= centerCount) {
    counts[4]++;
    y++;
  }
  if (counts[4] === 0 || counts[4] > centerCount) return null;

  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (5 * Math.abs(total - originalTotal) >= 3 * originalTotal) return null;
  if (!checkFinderRatio(counts)) return null;

  return { centerY: centerFromEnd(counts, y), total };
}

function crossCheckHorizontal(
  binarized: Uint8Array,
  width: number,
  cy: number,
  startX: number,
  centerCount: number,
  originalTotal: number
): { centerX: number; total: number } | null {
  const row = cy * width;
  if (startX < 0 || startX >= width || binarized[row + startX] !== 1) return null;

  const counts = new Int32Array(5);

  let x = startX;
  while (x >= 0 && binarized[row + x] === 1) {
    counts[2]++;
    x--;
  }
  if (x < 0) return null;
  while (x >= 0 && binarized[row + x] === 0 && counts[1] <= centerCount) {
    counts[1]++;
    x--;
  }
  if (x < 0 || counts[1] > centerCount) return null;
  while (x >= 0 && binarized[row + x] === 1 && counts[0] <= centerCount) {
    counts[0]++;
    x--;
  }
  if (counts[0] === 0 || counts[0] > centerCount) return null;

  x = startX + 1;
  while (x < width && binarized[row + x] === 1) {
    counts[2]++;
    x++;
  }
  if (x >= width) return null;
  while (x < width && binarized[row + x] === 0 && counts[3] <= centerCount) {
    counts[3]++;
    x++;
  }
  if (x >= width || counts[3] > centerCount) return null;
  while (x < width && binarized[row + x] === 1 && counts[4] <= centerCount) {
    counts[4]++;
    x++;
  }
  if (counts[4] === 0 || counts[4] > centerCount) return null;

  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (5 * Math.abs(total - originalTotal) >= 3 * originalTotal) return null;
  if (!checkFinderRatio(counts)) return null;

  return { centerX: centerFromEnd(counts, x), total };
}

function checkDiagonalLine(
  binarized: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  if (binarized[cy * width + cx] !== 1) return false;
  const counts = new Int32Array(5);

  let i = 0;
  while (cx - i * dx >= 0 && cx - i * dx < width && cy - i * dy >= 0 && cy - i * dy < height) {
    if (binarized[(cy - i * dy) * width + (cx - i * dx)] === 1) {
      counts[2]++;
      i++;
    } else {
      break;
    }
  }
  while (cx - i * dx >= 0 && cx - i * dx < width && cy - i * dy >= 0 && cy - i * dy < height) {
    if (binarized[(cy - i * dy) * width + (cx - i * dx)] === 0) {
      counts[1]++;
      i++;
    } else {
      break;
    }
  }
  if (counts[1] === 0) return false;
  while (cx - i * dx >= 0 && cx - i * dx < width && cy - i * dy >= 0 && cy - i * dy < height) {
    if (binarized[(cy - i * dy) * width + (cx - i * dx)] === 1) {
      counts[0]++;
      i++;
    } else {
      break;
    }
  }
  if (counts[0] === 0) return false;

  i = 1;
  while (cx + i * dx >= 0 && cx + i * dx < width && cy + i * dy >= 0 && cy + i * dy < height) {
    if (binarized[(cy + i * dy) * width + (cx + i * dx)] === 1) {
      counts[2]++;
      i++;
    } else {
      break;
    }
  }
  while (cx + i * dx >= 0 && cx + i * dx < width && cy + i * dy >= 0 && cy + i * dy < height) {
    if (binarized[(cy + i * dy) * width + (cx + i * dx)] === 0) {
      counts[3]++;
      i++;
    } else {
      break;
    }
  }
  if (counts[3] === 0) return false;
  while (cx + i * dx >= 0 && cx + i * dx < width && cy + i * dy >= 0 && cy + i * dy < height) {
    if (binarized[(cy + i * dy) * width + (cx + i * dx)] === 1) {
      counts[4]++;
      i++;
    } else {
      break;
    }
  }
  if (counts[4] === 0) return false;

  return checkFinderRatio(counts, 0.78);
}

export function findFinderPatterns(
  binarized: Uint8Array,
  width: number,
  height: number
): FinderPattern[] {
  const candidates: FinderPattern[] = [];
  const rowStep = height < 400 ? 1 : 2;
  const counts = new Int32Array(5);

  const tryRegisterCandidate = (hCounts: Int32Array, endX: number, y: number): void => {
    const hTotal = hCounts[0] + hCounts[1] + hCounts[2] + hCounts[3] + hCounts[4];
    const roughX = centerFromEnd(hCounts, endX);
    const vCheck = crossCheckVertical(binarized, width, height, Math.floor(roughX), y, hCounts[2], hTotal);
    if (!vCheck) return;

    const hCheck = crossCheckHorizontal(
      binarized,
      width,
      Math.floor(vCheck.centerY),
      Math.floor(roughX),
      hCounts[2],
      vCheck.total
    );
    if (!hCheck) return;

    const cx = Math.floor(hCheck.centerX);
    const cy = Math.floor(vCheck.centerY);
    if (
      !checkDiagonalLine(binarized, width, height, cx, cy, 1, 1) &&
      !checkDiagonalLine(binarized, width, height, cx, cy, 1, -1)
    ) {
      return;
    }

    const moduleSize = (hTotal + vCheck.total + hCheck.total) / 21;
    const fx = hCheck.centerX;
    const fy = vCheck.centerY;

    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      const maxDist = Math.max(p.size, moduleSize) * 2.5;
      if (
        Math.hypot(p.x - fx, p.y - fy) <= maxDist &&
        Math.abs(p.size - moduleSize) <= Math.max(1.0, p.size * 0.45)
      ) {
        const n = p.count + 1;
        p.x = (p.x * p.count + fx) / n;
        p.y = (p.y * p.count + fy) / n;
        p.size = (p.size * p.count + moduleSize) / n;
        p.count = n;
        return;
      }
    }

    candidates.push({ x: fx, y: fy, size: moduleSize, count: 1 });
  };

  for (let y = 0; y < height; y += rowStep) {
    counts.fill(0);
    let state = 0;
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const bit = binarized[rowOffset + x];
      if (bit === 1) {
        if ((state & 1) === 1) state++;
        counts[state]++;
      } else {
        if (state === 0) {
          if (counts[0] > 0) {
            state = 1;
            counts[1] = 1;
          }
        } else if (state === 1 || state === 3) {
          counts[state]++;
        } else if (state === 2) {
          state = 3;
          counts[3] = 1;
        } else {
          if (checkFinderRatio(counts)) {
            tryRegisterCandidate(counts, x, y);
          }
          counts[0] = counts[2];
          counts[1] = counts[3];
          counts[2] = counts[4];
          counts[3] = 1;
          counts[4] = 0;
          state = 3;
        }
      }
    }

    if (state === 4 && checkFinderRatio(counts)) {
      tryRegisterCandidate(counts, width, y);
    }
  }

  return candidates;
}

function selectCandidatePool(candidates: FinderPattern[], limit = 90): FinderPattern[] {
  if (candidates.length <= limit) {
    return candidates.slice().sort((a, b) => a.size - b.size);
  }

  // Partition by log-scale module size so high-count UI text at one scale cannot starve another
  const buckets = new Map<number, FinderPattern[]>();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const band = Math.max(0, Math.min(12, Math.floor(Math.log2(Math.max(0.5, c.size)) * 2 + 2)));
    let list = buckets.get(band);
    if (!list) {
      list = [];
      buckets.set(band, list);
    }
    list.push(c);
  }

  const perBand = Math.max(12, Math.ceil(limit / Math.max(1, buckets.size)));
  const pooled: FinderPattern[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => b.count - a.count);
    const take = Math.min(list.length, perBand);
    for (let i = 0; i < take; i++) pooled.push(list[i]);
  }

  if (pooled.length > limit) {
    pooled.sort((a, b) => b.count - a.count);
    pooled.length = limit;
  }

  return pooled.sort((a, b) => a.size - b.size);
}

export function selectFinderTriads(
  candidates: FinderPattern[],
  maxTriads = 3
): [FinderPattern, FinderPattern, FinderPattern][] {
  if (candidates.length < 3) return [];

  const pool = selectCandidatePool(candidates, 90);

  const scored: {
    triad: [FinderPattern, FinderPattern, FinderPattern];
    score: number;
  }[] = [];

  for (let i = 0; i < pool.length - 2; i++) {
    const p0 = pool[i];
    const maxAllowedSize = p0.size * 1.75;

    for (let j = i + 1; j < pool.length - 1; j++) {
      const p1 = pool[j];
      if (p1.size > maxAllowedSize) break;

      for (let k = j + 1; k < pool.length; k++) {
        const p2 = pool[k];
        if (p2.size > maxAllowedSize) break;

        const minSize = p0.size;
        const maxSize = p2.size;

        const d01 = Math.hypot(p0.x - p1.x, p0.y - p1.y);
        const d12 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const d02 = Math.hypot(p0.x - p2.x, p0.y - p2.y);
        if (d01 < minSize * 8 || d12 < minSize * 8 || d02 < minSize * 8) continue;

        let tl: FinderPattern;
        let a: FinderPattern;
        let b: FinderPattern;
        let legA: number;
        let legB: number;

        if (d12 >= d01 && d12 >= d02) {
          tl = p0;
          a = p1;
          b = p2;
          legA = d01;
          legB = d02;
        } else if (d02 >= d01 && d02 >= d12) {
          tl = p1;
          a = p0;
          b = p2;
          legA = d01;
          legB = d12;
        } else {
          tl = p2;
          a = p0;
          b = p1;
          legA = d02;
          legB = d12;
        }

        const legRatio = Math.max(legA, legB) / Math.min(legA, legB);
        if (legRatio > 1.85) continue;

        const vAx = a.x - tl.x;
        const vAy = a.y - tl.y;
        const vBx = b.x - tl.x;
        const vBy = b.y - tl.y;
        const cosTheta = (vAx * vBx + vAy * vBy) / (legA * legB);
        if (Math.abs(cosTheta) > 0.65) continue;

        const avgMod = (p0.size + p1.size + p2.size) / 3;
        const estDim = (legA + legB) / (2 * avgMod) + 7;
        if (estDim < 16 || estDim > 188) continue;

        // Order TR and BL so (TR - TL) x (BL - TL) > 0 in screen coords (+x right, +y down)
        const cross = vAx * vBy - vAy * vBx;
        const tr = cross > 0 ? a : b;
        const bl = cross > 0 ? b : a;

        // Cap per-finder scanline count bonus so repetitive UI borders cannot outweigh right-angle geometry
        const countBonus = Math.min(4, p0.count) + Math.min(4, p1.count) + Math.min(4, p2.count);
        const sizePenalty = (maxSize - minSize) / minSize;
        const geomPenalty = (legRatio - 1) * 14 + Math.abs(cosTheta) * 16 + sizePenalty * 18;
        const score = countBonus * 1.5 - geomPenalty;

        scored.push({ triad: [tl, tr, bl], score });
      }
    }
  }

  scored.sort((u, v) => v.score - u.score);
  return scored.slice(0, maxTriads).map((entry) => entry.triad);
}

export function selectFinderTriad(
  candidates: FinderPattern[]
): [FinderPattern, FinderPattern, FinderPattern] | null {
  const triads = selectFinderTriads(candidates, 1);
  return triads[0] ?? null;
}

function checkAlignmentRatio(c0: number, c1: number, c2: number, avgMod: number): boolean {
  if (c0 === 0 || c1 === 0 || c2 === 0) return false;
  const total = c0 + c1 + c2;
  const unit = total / 3;
  if (unit < avgMod * 0.4 || unit > avgMod * 2.2) return false;
  const maxVar = Math.max(0.8, unit * 0.65);
  return (
    Math.abs(c0 - unit) <= maxVar &&
    Math.abs(c1 - unit) <= maxVar &&
    Math.abs(c2 - unit) <= maxVar
  );
}

function verifyAlignmentVertically(
  binarized: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  avgMod: number
): number | null {
  if (cx < 0 || cx >= width || cy < 0 || cy >= height) return null;
  if (binarized[cy * width + cx] !== 1) return null;

  let c1 = 0;
  let y = cy;
  while (y >= 0 && binarized[y * width + cx] === 1) {
    c1++;
    y--;
  }
  let c0 = 0;
  while (y >= 0 && binarized[y * width + cx] === 0 && c0 <= avgMod * 2.5) {
    c0++;
    y--;
  }

  y = cy + 1;
  while (y < height && binarized[y * width + cx] === 1) {
    c1++;
    y++;
  }
  let c2 = 0;
  while (y < height && binarized[y * width + cx] === 0 && c2 <= avgMod * 2.5) {
    c2++;
    y++;
  }

  if (!checkAlignmentRatio(c0, c1, c2, avgMod)) return null;
  return y - c2 - c1 * 0.5;
}

export function findAlignmentPattern(
  binarized: Uint8Array,
  width: number,
  height: number,
  tl: FinderPattern,
  tr: FinderPattern,
  bl: FinderPattern,
  dimension: number
): Point | null {
  const f = (dimension - 10) / (dimension - 7);
  const estX = tl.x + f * (tr.x - tl.x + (bl.x - tl.x));
  const estY = tl.y + f * (tr.y - tl.y + (bl.y - tl.y));
  const avgMod = (tl.size + tr.size + bl.size) / 3;
  const radius = Math.max(8, Math.round(avgMod * 5));

  const minX = Math.max(0, Math.floor(estX - radius));
  const maxX = Math.min(width - 1, Math.ceil(estX + radius));
  const minY = Math.max(0, Math.floor(estY - radius));
  const maxY = Math.min(height - 1, Math.ceil(estY + radius));

  let bestPoint: Point | null = null;
  let bestDist = Infinity;

  const counts = new Int32Array(3);
  for (let offset = 0; offset <= radius; offset++) {
    for (const sign of offset === 0 ? [0] : [-1, 1]) {
      const y = Math.round(estY) + offset * sign;
      if (y < minY || y > maxY) continue;

      counts.fill(0);
      let state = 0;
      const row = y * width;

      for (let x = minX; x <= maxX; x++) {
        const bit = binarized[row + x];
        if (bit === 0) {
          if (state === 0) {
            counts[0]++;
          } else if (state === 1) {
            state = 2;
            counts[2] = 1;
          } else {
            counts[2]++;
          }
        } else {
          if (state === 0) {
            if (counts[0] > 0) {
              state = 1;
              counts[1] = 1;
            }
          } else if (state === 1) {
            counts[1]++;
          } else {
            if (checkAlignmentRatio(counts[0], counts[1], counts[2], avgMod)) {
              const cx = x - counts[2] - counts[1] * 0.5;
              const cy = verifyAlignmentVertically(binarized, width, height, Math.floor(cx), y, avgMod);
              if (cy !== null) {
                const dist = Math.hypot(cx - estX, cy - estY);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestPoint = { x: cx, y: cy };
                }
              }
            }
            counts[0] = counts[2];
            counts[1] = 1;
            counts[2] = 0;
            state = 1;
          }
        }
      }
    }
    if (bestPoint !== null && offset > avgMod * 2) break;
  }

  return bestPoint;
}

export function measureModuleSizeAlongAxis(
  binarized: Uint8Array,
  width: number,
  height: number,
  origin: Point,
  ux: number,
  uy: number,
  maxSteps: number
): number | null {
  const sampleAt = (t: number): number => {
    const px = Math.floor(origin.x + ux * t);
    const py = Math.floor(origin.y + uy * t);
    if (px < 0 || px >= width || py < 0 || py >= height) return -1;
    return binarized[py * width + px];
  };

  if (sampleAt(0) !== 1) return null;

  const scanDir = (sign: number): number | null => {
    let t = 0;
    const step = 0.5;
    while (t < maxSteps && sampleAt(sign * t) === 1) t += step;
    if (t >= maxSteps || sampleAt(sign * t) !== 0) return null;
    while (t < maxSteps && sampleAt(sign * t) === 0) t += step;
    if (t >= maxSteps || sampleAt(sign * t) !== 1) return null;
    while (t < maxSteps && sampleAt(sign * t) === 1) t += step;
    return t;
  };

  const forward = scanDir(1);
  const backward = scanDir(-1);
  if (forward === null || backward === null) return null;
  return (forward + backward) / 7;
}

export function traceBottomRightCorner(
  _binarized: Uint8Array,
  _width: number,
  _height: number,
  tl: FinderPattern,
  tr: FinderPattern,
  bl: FinderPattern,
  _dimension: number
): Point {
  return {
    x: tr.x + bl.x - tl.x,
    y: tr.y + bl.y - tl.y,
  };
}

export function estimateProjectiveBottomRight(
  binarized: Uint8Array,
  width: number,
  height: number,
  tl: FinderPattern,
  tr: FinderPattern,
  bl: FinderPattern
): Point | null {
  const dxTop = tr.x - tl.x;
  const dyTop = tr.y - tl.y;
  const lenTop = Math.hypot(dxTop, dyTop);
  const dxLeft = bl.x - tl.x;
  const dyLeft = bl.y - tl.y;
  const lenLeft = Math.hypot(dxLeft, dyLeft);
  if (lenTop < 1 || lenLeft < 1) return null;

  const maxScan = Math.max(tl.size, tr.size, bl.size) * 8;
  const mTop0 = measureModuleSizeAlongAxis(binarized, width, height, tl, dxTop / lenTop, dyTop / lenTop, maxScan);
  const mTop1 = measureModuleSizeAlongAxis(binarized, width, height, tr, dxTop / lenTop, dyTop / lenTop, maxScan);
  const mLeft0 = measureModuleSizeAlongAxis(binarized, width, height, tl, dxLeft / lenLeft, dyLeft / lenLeft, maxScan);
  const mLeft1 = measureModuleSizeAlongAxis(binarized, width, height, bl, dxLeft / lenLeft, dyLeft / lenLeft, maxScan);
  if (!mTop0 || !mTop1 || !mLeft0 || !mLeft1) return null;

  // In a planar homography, local 1D Jacobian along a line scales as 1 / w^2
  const sx = Math.sqrt(mTop0 / mTop1);
  const sy = Math.sqrt(mLeft0 / mLeft1);
  const denom = sx + sy - 1;
  if (denom <= 0.1) return null;

  return {
    x: (sx * tr.x + sy * bl.x - tl.x) / denom,
    y: (sx * tr.y + sy * bl.y - tl.y) / denom,
  };
}
