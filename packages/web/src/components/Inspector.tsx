import type { Telemetry } from '@qr-scan/core';
import { TbOutlineChevronDown, TbOutlineCpu } from 'solid-icons/tb';
import { Show, createEffect, createMemo } from 'solid-js';

export interface InspectorProps {
  open: boolean;
  onToggle: () => void;
  telemetry: Telemetry | null;
  elapsedMs: number | null;
}

function getBattleReport(fixed: number): string {
  if (fixed <= 0) return '';
  if (fixed <= 3) return 'barely a scratch';
  if (fixed <= 9) return 'rescued from the abyss';
  return 'held together by pure Galois Field magic';
}

export function Inspector(props: InspectorProps) {
  let thresholdCanvas: HTMLCanvasElement | undefined;
  let matrixCanvas: HTMLCanvasElement | undefined;

  createEffect(() => {
    const tel = props.telemetry;
    if (!tel) return;

    if (thresholdCanvas) {
      thresholdCanvas.width = tel.width;
      thresholdCanvas.height = tel.height;
      const ctx = thresholdCanvas.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(tel.width, tel.height);
        const dst = img.data;
        const bin = tel.binarized;
        for (let i = 0; i < bin.length; i++) {
          const v = bin[i] === 1 ? 14 : 238;
          const p = i * 4;
          dst[p] = v;
          dst[p + 1] = v;
          dst[p + 2] = v;
          dst[p + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);

        const strokeW = Math.max(2, tel.width * 0.006);
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = strokeW;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(tel.corners[0].x, tel.corners[0].y);
        ctx.lineTo(tel.corners[1].x, tel.corners[1].y);
        ctx.lineTo(tel.corners[2].x, tel.corners[2].y);
        ctx.lineTo(tel.corners[3].x, tel.corners[3].y);
        ctx.closePath();
        ctx.stroke();

        const r = Math.max(3, strokeW * 1.3);
        ctx.fillStyle = '#10B981';
        for (const f of tel.finders) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        if (tel.alignment) {
          ctx.fillStyle = '#F59E0B';
          ctx.beginPath();
          ctx.arc(tel.alignment.x, tel.alignment.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (matrixCanvas) {
      const m = tel.matrix;
      const cell = Math.max(4, Math.min(10, Math.floor(220 / m.width)));
      matrixCanvas.width = m.width * cell;
      matrixCanvas.height = m.height * cell;
      const ctx = matrixCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FAF9F5';
        ctx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);
        ctx.fillStyle = '#0C0D0E';
        for (let r = 0; r < m.height; r++) {
          for (let c = 0; c < m.width; c++) {
            if (m.data[r * m.width + c] === 1) {
              ctx.fillRect(c * cell, r * cell, cell, cell);
            }
          }
        }
      }
    }
  });

  const rsFixed = () => props.telemetry?.correctedErrors ?? 0;
  const battleReport = createMemo(() => getBattleReport(rsFixed()));

  return (
    <section class="xray-drawer" aria-labelledby="xray-heading">
      <div class="xray-strip">
        <div class="xray-strip-left">
          <span class="xray-strip-title">
            <TbOutlineCpu size={14} class="xray-icon" aria-hidden="true" />
            <h2 id="xray-heading" class="card-title">
              X-Ray
            </h2>
          </span>

          <Show
            when={props.telemetry}
            fallback={<span class="strip-pill mono">Homography + Threshold · Idle</span>}
          >
            {(tel) => (
              <div class="strip-pills mono tabular">
                <span class="strip-pill">
                  V{tel().version} · EC-{tel().ecLevel} · M{tel().mask}
                </span>
                <Show when={props.elapsedMs !== null}>
                  <span class="strip-pill">{props.elapsedMs!.toFixed(1)} ms</span>
                </Show>
                <span class="strip-pill" classList={{ 'is-warn': rsFixed() > 0 }}>
                  {rsFixed()}B fixed
                </span>
                <Show when={battleReport()}>
                  {(msg) => <span class="battle-tag">{msg()}</span>}
                </Show>
              </div>
            )}
          </Show>
        </div>

        <button
          type="button"
          class="btn btn-compact"
          aria-expanded={props.open}
          aria-controls="xray-telemetry-body"
          onClick={props.onToggle}
        >
          <TbOutlineChevronDown
            size={14}
            class={`collapse-chevron${props.open ? ' is-open' : ''}`}
            aria-hidden="true"
          />
          <span>{props.open ? 'Hide' : 'Inspect'}</span>
        </button>
      </div>

      <div
        id="xray-telemetry-body"
        class="xray-collapse"
        classList={{ 'is-open': props.open }}
        inert={!props.open}
      >
        <div class="xray-collapse-inner">
          <dl class="telemetry-grid">
            <div class="telemetry-cell">
              <dt>Grid</dt>
              <dd class="mono tabular">
                {props.telemetry
                  ? `V${props.telemetry.version} · ${props.telemetry.matrix.width}×${props.telemetry.matrix.height}`
                  : '—'}
              </dd>
            </div>

            <div class="telemetry-cell">
              <dt>Format</dt>
              <dd class="mono tabular">
                {props.telemetry
                  ? `EC-${props.telemetry.ecLevel} · Mask ${props.telemetry.mask}`
                  : '—'}
              </dd>
            </div>

            <div class="telemetry-cell" classList={{ 'is-warn': rsFixed() > 0 }}>
              <dt>Reed-Solomon</dt>
              <dd class="mono tabular">
                {props.telemetry
                  ? `${props.telemetry.correctedErrors}B fixed · ${props.telemetry.blocksTotal} blk`
                  : '—'}
              </dd>
            </div>

            <div class="telemetry-cell">
              <dt>Latency</dt>
              <dd class="mono tabular">
                {props.elapsedMs !== null ? `${props.elapsedMs.toFixed(1)} ms` : '—'}
              </dd>
            </div>
          </dl>

          <div class="xray-canvases">
            <figure class="xray-frame">
              <div class="xray-box">
                <Show
                  when={props.telemetry}
                  fallback={<span class="xray-placeholder mono">No threshold frame</span>}
                >
                  <canvas ref={thresholdCanvas} class="xray-canvas" />
                </Show>
              </div>
              <figcaption class="mono">Adaptive Threshold</figcaption>
            </figure>

            <figure class="xray-frame">
              <div class="xray-box">
                <Show
                  when={props.telemetry}
                  fallback={<span class="xray-placeholder mono">No unwarped grid</span>}
                >
                  <canvas ref={matrixCanvas} class="xray-canvas" />
                </Show>
              </div>
              <figcaption class="mono">Unwarped BitMatrix</figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}
