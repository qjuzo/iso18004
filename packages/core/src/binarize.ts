export function rgbaToLuma(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const count = width * height;
  const luma = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    // BT.601 fixed-point luma: (0.299R + 0.587G + 0.114B) * 256
    luma[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return luma;
}

export function buildIntegralImage(
  luma: Uint8Array,
  width: number,
  height: number,
  out?: Uint32Array
): Uint32Array {
  const stride = width + 1;
  const needed = stride * (height + 1);
  const integral = out && out.length >= needed ? out : new Uint32Array(needed);
  integral.fill(0, 0, stride);

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const lumaRow = y * width;
    const prevIntRow = y * stride;
    const currIntRow = (y + 1) * stride;
    integral[currIntRow] = 0;
    for (let x = 0; x < width; x++) {
      rowSum += luma[lumaRow + x];
      integral[currIntRow + x + 1] = integral[prevIntRow + x + 1] + rowSum;
    }
  }

  return integral;
}

export function binarizeLuma(
  luma: Uint8Array,
  integral: Uint32Array,
  width: number,
  height: number,
  invert = false,
  windowRadius?: number,
  out?: Uint8Array
): Uint8Array {
  const totalPixels = width * height;
  const dst = out && out.length >= totalPixels ? out : new Uint8Array(totalPixels);
  const stride = width + 1;

  // Symmetric local window covers >= 3-module finder cores while canceling linear lighting gradients
  const minDim = width < height ? width : height;
  const radius = windowRadius ?? Math.max(12, Math.min(80, Math.floor(minDim / 10)));
  const globalMean = integral[stride * height + width] / totalPixels;

  for (let y = 0; y < height; y++) {
    const y0 = y - radius > 0 ? y - radius : 0;
    const y1 = y + radius + 1 < height ? y + radius + 1 : height;
    const intY0 = y0 * stride;
    const intY1 = y1 * stride;
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const x0 = x - radius > 0 ? x - radius : 0;
      const x1 = x + radius + 1 < width ? x + radius + 1 : width;
      const count = (x1 - x0) * (y1 - y0);
      const sum =
        integral[intY1 + x1] -
        integral[intY0 + x1] -
        integral[intY1 + x0] +
        integral[intY0 + x0];

      const val = luma[rowOffset + x];
      const diff = val * count - sum;
      const contrastBias = 4 * count;

      let bit: number;
      if (diff < -contrastBias) {
        bit = 1;
      } else if (diff > contrastBias) {
        bit = 0;
      } else {
        bit = sum < globalMean * count ? 1 : 0;
      }

      dst[rowOffset + x] = invert ? bit ^ 1 : bit;
    }
  }

  return dst;
}
