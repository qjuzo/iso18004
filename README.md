<h1>
  <img src=".github/logo.svg" alt="" width="26" height="26" align="absmiddle" />
  iso18004
</h1>

Zero-dependency ISO/IEC 18004 QR decoder written from scratch in TypeScript over `Uint8Array`, `Uint32Array`, and `Float64Array` buffers, paired with an off-thread SolidJS web scanner.

Live scanner and X-Ray telemetry workbench: https://qjuzo.github.io/iso18004

<p align="center">
  <a href="https://qjuzo.github.io/iso18004">
    <img src=".github/preview.png" alt="iso18004 optical readout, adaptive threshold view, and unwarped BitMatrix telemetry" width="760" />
  </a>
</p>

The inspector shows each frame's Bradley-Roth threshold bitmap, homography quad lock, finder/alignment sampling points, and the unwarped module grid alongside Reed-Solomon byte repair counts.

## Benchmarks

Measured on `400×400` RGBA buffers in Node `v24.22.1` (30 warmup iterations, 200 timed runs per workload):

| Workload | `@qr-scan/core` p50 (p95) | `jsQR` 1.4.0 p50 (p95) | RS repairs |
| --- | --- | --- | --- |
| Clean (`V3-M`, `29×29`) | **2.22 ms** (2.53 ms) | 5.09 ms (8.08 ms) | 0B |
| Perspective skew (`V4-Q`, `33×33`) | **2.69 ms** (4.29 ms) | 6.38 ms (9.81 ms) | 0B |
| Shadow gradient (`V4-Q`, damaged) | **2.29 ms** (3.27 ms) | 6.29 ms (8.68 ms) | 6B |
| Chaos `180°` tilt + grain (`V6-H`) | **3.30 ms** (4.59 ms) | 42.33 ms (58.42 ms) | 11B |

Why it stays flat under noise and skew: hot loops operate directly on contiguous `Uint8Array`, `Uint32Array`, and `Float64Array` views instead of `number[]` allocations or per-pixel objects, and the SolidJS worker transfers `ImageData.data.buffer` via zero-copy `Transferable` messages. Reproduce the `@qr-scan/core` numbers locally with `pnpm bench`.

## Usage

```ts
import { decode } from '@qr-scan/core';

const result = decode(rgba, width, height, {
  tryInverted: true,
  debug: false,
});

if (result) {
  console.log(result.text, result.version, result.ecLevel, result.corners);
}
```

## Running locally

Requires Node.js 22+ and `pnpm`:

```sh
pnpm install
pnpm dev     # builds @qr-scan/core and starts Vite dev server
pnpm test    # runs node --test suite in packages/core
pnpm bench   # runs 200-iteration decode benchmark
pnpm build   # builds core + web bundle
```

On Windows or macOS/Linux without setting up commands manually, run `start.bat` or `./start.sh` from the repository root to install dependencies and launch the web app.

## Inside `packages/core`

- `binarize.ts`: BT.601 fixed-point luma (`(77R + 150G + 29B) >> 8`), `Uint32Array` integral image, and symmetric Bradley-Roth local thresholding.
- `locator.ts`: horizontal, vertical, and diagonal `1:1:3:1:1` finder pattern scanner, cross-product `[TL, TR, BL]` ordering, and `1:1:1` alignment search (plus Jacobian projective 4th-corner estimation for Version 1).
- `perspective.ts`: `Float64Array(72)` 8×9 Gaussian elimination homography solver and 5-point bilinear sub-module grid sampler.
- `format.ts`: `BCH(15, 5)` format strip decode (`0x5412` unmask), `BCH(18, 6)` version decode (V7–V40), and masks `0–7`.
- `reed-solomon.ts`: ISO 18004 Table 9 de-interleaving, $\text{GF}(2^8)$ (`0x11d`) syndromes, Berlekamp-Massey, Chien search, and Forney error evaluation.
- `bitstream.ts`: Numeric, Alphanumeric, Byte (UTF-8 / ISO-8859-1 / ECI), and Shift-JIS Kanji decoder.

Supports standard and inverted-polarity symbols across Versions 1–40 and error correction levels L, M, Q, and H. Micro QR, rMQR, and multi-symbol Structured Append reassembly are out of scope.

---

QR Code is a registered trademark of DENSO WAVE INCORPORATED.
