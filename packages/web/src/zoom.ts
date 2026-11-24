import type { Point } from '@qr-scan/core';

export interface ZoomTransform {
  scale: number;
  tx: number;
  ty: number;
  active: boolean;
}

export const IDENTITY_ZOOM: ZoomTransform = { scale: 1, tx: 0, ty: 0, active: false };

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function computeZoomTransform(
  corners: readonly [Point, Point, Point, Point],
  frameW: number,
  frameH: number,
  viewportW: number,
  viewportH: number,
  maxScale = 2.0,
  padFactor = 1.9
): ZoomTransform {
  if (frameW <= 0 || frameH <= 0 || viewportW <= 0 || viewportH <= 0) {
    return IDENTITY_ZOOM;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);
  const containScale = Math.min(viewportW / frameW, viewportH / frameH);
  const renderedW = frameW * containScale;
  const renderedH = frameH * containScale;
  const offsetX = (viewportW - renderedW) * 0.5;
  const offsetY = (viewportH - renderedH) * 0.5;

  const targetCx = offsetX + (minX + maxX) * 0.5 * containScale;
  const targetCy = offsetY + (minY + maxY) * 0.5 * containScale;

  const paddedCssW = boxW * padFactor * containScale;
  const paddedCssH = boxH * padFactor * containScale;
  const rawScale = Math.min(viewportW / paddedCssW, viewportH / paddedCssH);
  const scale = Math.max(1, Math.min(maxScale, rawScale));

  if (scale <= 1.06) {
    return IDENTITY_ZOOM;
  }

  const maxTx = Math.max(0, (renderedW * scale - viewportW) * 0.5);
  const maxTy = Math.max(0, (renderedH * scale - viewportH) * 0.5);
  const tx = clamp((viewportW * 0.5 - targetCx) * scale, -maxTx, maxTx);
  const ty = clamp((viewportH * 0.5 - targetCy) * scale, -maxTy, maxTy);

  return { scale, tx, ty, active: true };
}

export function toZoomCss(z: ZoomTransform): string {
  return z.active
    ? `translate3d(${z.tx.toFixed(2)}px, ${z.ty.toFixed(2)}px, 0) scale(${z.scale.toFixed(4)})`
    : 'translate3d(0px, 0px, 0) scale(1)';
}

export function drawSpotlightMask(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  quad: readonly [Point, Point, Point, Point]
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(8, 10, 12, 0.42)';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.moveTo(quad[0].x, quad[0].y);
  ctx.lineTo(quad[1].x, quad[1].y);
  ctx.lineTo(quad[2].x, quad[2].y);
  ctx.lineTo(quad[3].x, quad[3].y);
  ctx.closePath();
  ctx.fill('evenodd');
  ctx.restore();
}
