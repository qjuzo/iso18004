# qr-scan

Zero-dependency ISO/IEC 18004 QR decoder in strict TypedArray TypeScript, paired with an off-thread SolidJS web scanner. Everything from integral-image adaptive thresholding to Berlekamp-Massey Reed-Solomon recovery runs from scratch on `Uint8Array`, `Uint32Array`, and `Float64Array` buffers.

## Quick Start

### Non-Developer Launch

Requires [Node.js 22+](https://nodejs.org/).

- **Windows:** Double-click `start.bat`
- **macOS / Linux:** Run `./start.sh`

The launcher enables `pnpm`, installs dependencies on first run, compiles `@qr-scan/core`, and opens the web scanner in your default browser.

### Developer Commands

```sh
pnpm install
pnpm test    # Runs @qr-scan/core node --test suite
pnpm dev     # Builds core and starts Vite dev server
pnpm build   # Builds @qr-scan/core and @qr-scan/web
```

## Library Usage

```ts
import { decode } from '@qr-scan/core';

// rgba is an RGBA Uint8Array or Uint8ClampedArray (width * height * 4)
const result = decode(rgba, width, height, {
  tryInverted: true,
  debug: false,
});

if (result) {
  console.log(result.text, result.version, result.ecLevel, result.corners);
}
```

## Architecture

Decoding executes as a linear TypedArray pipeline in [`packages/core/src`](packages/core/src):

| Stage | Module | Implementation |
| --- | --- | --- |
| 1. Binarize | `binarize.ts` | BT.601 fixed-point luma, `Uint32Array` integral image, symmetric local adaptive threshold |
| 2. Locate | `locator.ts` | `1:1:3:1:1` horizontal/vertical/diagonal finder scanner, cross-product triad sort, `1:1:1` alignment search |
| 3. Unwarp | `perspective.ts` | `Float64Array` 8x9 Gaussian elimination homography solver, 5-point bilinear sub-module sampler |
| 4. Format | `format.ts` | 15-bit BCH(15,5) format decode (`0x5412` unmask), 18-bit BCH(18,6) version decode, masks 0–7 |
| 5. ECC | `reed-solomon.ts` | ISO 18004 Table 9 de-interleaving, GF(2^8) (`0x11d`) syndromes, Berlekamp-Massey, Chien search, Forney |
| 6. Payload | `bitstream.ts` | Numeric, Alphanumeric, Byte (UTF-8 / ISO-8859-1 / ECI), and Shift-JIS Kanji segment parser |

The SolidJS frontend in [`packages/web/src`](packages/web/src) transfers `ImageData.data.buffer` to `worker.ts` using zero-copy `Transferable` messages, overlays detected quads over live camera feeds or pasted/dropped images, and exposes intermediate buffers inside the Pipeline Inspector.

## ISO/IEC 18004 Scope

- **Versions:** 1–40 (`21×21` through `177×177`)
- **Error Correction Levels:** L, M, Q, H (single and multi-block interleaved)
- **Data Modes:** Numeric, Alphanumeric, Byte, Kanji, ECI, Structured Append header skip, FNC1
- **Polarity:** Standard dark-on-light and inverted light-on-dark symbols
- **Excluded:** Micro QR, rMQR, Structured Append multi-symbol reassembly

## Trademark Notice

QR Code is a registered trademark of DENSO WAVE INCORPORATED.
