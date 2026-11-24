import { scan, type DecodeResult } from '@qr-scan/core';

export interface DecodeWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  debug: boolean;
  maxTimeMs?: number;
  maxWindows?: number;
}

export interface DecodeWorkerResponse {
  id: number;
  result: DecodeResult | null;
  elapsedMs: number;
}

self.addEventListener('message', (event: MessageEvent<DecodeWorkerRequest>) => {
  const { id, buffer, width, height, debug, maxTimeMs, maxWindows } = event.data;
  const rgba = new Uint8ClampedArray(buffer);

  const t0 = performance.now();
  const result = scan(rgba, width, height, { debug, tryInverted: true, maxTimeMs, maxWindows });
  const elapsedMs = performance.now() - t0;

  const transferables: Transferable[] = [];
  if (result) {
    if (result.bytes.buffer instanceof ArrayBuffer) {
      transferables.push(result.bytes.buffer);
    }
    if (result.telemetry) {
      if (result.telemetry.binarized.buffer instanceof ArrayBuffer) {
        transferables.push(result.telemetry.binarized.buffer);
      }
      if (result.telemetry.matrix.data.buffer instanceof ArrayBuffer) {
        transferables.push(result.telemetry.matrix.data.buffer);
      }
    }
  }

  const response: DecodeWorkerResponse = { id, result, elapsedMs };
  self.postMessage(response, { transfer: transferables });
});
