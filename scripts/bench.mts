import { performance } from 'node:perf_hooks';
import { decode } from '../packages/core/dist/index.js';
import { renderSamplePixels, type SamplePreset } from '../packages/web/src/sample-qr.ts';

const PRESETS: { key: SamplePreset; label: string }[] = [
  { key: 'clean', label: 'Clean (V3-M, 29x29)' },
  { key: 'skewed', label: 'Perspective skew (V4-Q, 33x33)' },
  { key: 'damaged', label: 'Shadow + 6B RS repair (V4-Q)' },
  { key: 'chaos', label: 'Chaos 180deg + noise + 11B RS (V6-H)' },
];

const WARMUP = 30;
const RUNS = 200;

console.log(`@qr-scan/core decode benchmark (${process.version}, 400x400 RGBA, ${RUNS} runs)\n`);
console.log(
  `${'Workload'.padEnd(38)} | ${'p50 (ms)'.padStart(9)} | ${'p95 (ms)'.padStart(9)} | ${'ops/sec'.padStart(8)} | ${'RS fixed'.padStart(8)}`
);
console.log('-'.repeat(84));

for (const { key, label } of PRESETS) {
  const { pixels, width, height } = renderSamplePixels(key);

  for (let i = 0; i < WARMUP; i++) {
    const res = decode(pixels, width, height);
    if (!res) throw new Error(`Warmup failed on preset: ${key}`);
  }

  const samples = new Float64Array(RUNS);
  let fixedBytes = 0;

  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = decode(pixels, width, height, { debug: i === 0 });
    samples[i] = performance.now() - t0;
    if (!res) throw new Error(`Decode failed on preset: ${key}`);
    if (i === 0) fixedBytes = res.telemetry?.correctedErrors ?? 0;
  }

  samples.sort();
  const p50 = samples[Math.floor(RUNS * 0.5)];
  const p95 = samples[Math.floor(RUNS * 0.95)];
  const ops = 1000 / p50;

  console.log(
    `${label.padEnd(38)} | ${p50.toFixed(2).padStart(9)} | ${p95.toFixed(2).padStart(9)} | ${ops.toFixed(0).padStart(8)} | ${`${fixedBytes}B`.padStart(8)}`
  );
}
