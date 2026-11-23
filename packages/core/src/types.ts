export type ECLevel = 'L' | 'M' | 'Q' | 'H';

export interface Point {
  x: number;
  y: number;
}

export interface FinderPattern {
  x: number;
  y: number;
  size: number;
  count: number;
}

export interface BitMatrix {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface DecodeOptions {
  debug?: boolean;
  tryInverted?: boolean;
}

export interface Telemetry {
  binarized: Uint8Array;
  width: number;
  height: number;
  finders: [Point, Point, Point];
  alignment: Point | null;
  corners: [Point, Point, Point, Point];
  matrix: BitMatrix;
  version: number;
  ecLevel: ECLevel;
  mask: number;
  correctedErrors: number;
  blocksTotal: number;
}

export interface DecodeResult {
  text: string;
  bytes: Uint8Array;
  version: number;
  ecLevel: ECLevel;
  mask: number;
  corners: [Point, Point, Point, Point];
  telemetry?: Telemetry;
}

export function createBitMatrix(width: number, height: number): BitMatrix {
  return {
    data: new Uint8Array(width * height),
    width,
    height,
  };
}

export function getBit(m: BitMatrix, x: number, y: number): number {
  return m.data[y * m.width + x];
}

export function setBit(m: BitMatrix, x: number, y: number, v: number): void {
  m.data[y * m.width + x] = v & 1;
}
