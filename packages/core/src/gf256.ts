// ISO 18004 §7.5.2: GF(2^8) primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const PRIMITIVE_POLY = 0x11d;

export const EXP_TABLE = new Uint8Array(512);
export const LOG_TABLE = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= PRIMITIVE_POLY;
    }
  }
  EXP_TABLE[510] = 1;
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('GF(256) division by zero');
  if (a === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + 255 - LOG_TABLE[b]];
}

export function gfInv(a: number): number {
  if (a === 0) throw new RangeError('GF(256) zero has no multiplicative inverse');
  return EXP_TABLE[255 - LOG_TABLE[a]];
}

export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] * n) % 255];
}

export function polyMul(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    const ca = a[i];
    if (ca === 0) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] ^= gfMul(ca, b[j]);
    }
  }
  return out;
}

export function polyRest(dividend: Uint8Array, divisor: Uint8Array): Uint8Array {
  const res = new Uint8Array(dividend);
  const steps = dividend.length - divisor.length + 1;
  const lead = divisor[0];
  for (let i = 0; i < steps; i++) {
    const coef = res[i];
    if (coef === 0) continue;
    const factor = lead === 1 ? coef : gfDiv(coef, lead);
    for (let j = 0; j < divisor.length; j++) {
      res[i + j] ^= gfMul(divisor[j], factor);
    }
  }
  return res.slice(dividend.length - (divisor.length - 1));
}

export function rsGeneratorPoly(ecLen: number): Uint8Array {
  let g: Uint8Array = new Uint8Array([1]);
  const root = new Uint8Array(2);
  root[0] = 1;
  for (let i = 0; i < ecLen; i++) {
    root[1] = EXP_TABLE[i];
    g = polyMul(g, root);
  }
  return g;
}
