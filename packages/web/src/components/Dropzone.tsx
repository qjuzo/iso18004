import type { DecodeResult } from '@qr-scan/core';
import {
  TbOutlineAlertTriangle,
  TbOutlineCheck,
  TbOutlineClipboard,
  TbOutlineFlask,
  TbOutlineQrcode,
  TbOutlineTrash,
  TbOutlineUpload,
  TbOutlineZoomReset,
} from 'solid-icons/tb';
import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import type { SamplePreset } from '../sample-qr.ts';
import { IDENTITY_ZOOM, computeZoomTransform, drawSpotlightMask, toZoomCss } from '../zoom.ts';

export interface ActiveImageSource {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  label: string;
  revision: number;
}

export interface DropzoneProps {
  activeImage: ActiveImageSource | null;
  result: DecodeResult | null;
  elapsedMs: number | null;
  statusError: string;
  busy: boolean;
  windowDragging: boolean;
  onDragHoverChange: (dragging: boolean) => void;
  onSelectFile: (file: File) => void;
  onPasteClipboardClick: () => void;
  onSelectSample: (preset: SamplePreset, label: string) => void;
  onClear: () => void;
  modeSwitchSlot: JSX.Element;
}

export function Dropzone(props: DropzoneProps) {
  const [draggingLocal, setDraggingLocal] = createSignal(false);
  const [pulseLock, setPulseLock] = createSignal(false);
  const [zoomReset, setZoomReset] = createSignal(false);
  const [vpSize, setVpSize] = createSignal({ w: 0, h: 0 });
  const [wrapEl, setWrapEl] = createSignal<HTMLDivElement | null>(null);
  let displayCanvas: HTMLCanvasElement | undefined;
  let fileInputEl: HTMLInputElement | undefined;
  let pulseTimer: number | undefined;
  let lastRevision = -1;

  createEffect(() => {
    const rev = props.activeImage?.revision ?? -1;
    if (rev !== lastRevision) {
      lastRevision = rev;
      setZoomReset(false);
    }
  });

  createEffect(() => {
    const el = wrapEl();
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setVpSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    setVpSize({ w: el.clientWidth, h: el.clientHeight });
    onCleanup(() => ro.disconnect());
  });

  onCleanup(() => window.clearTimeout(pulseTimer));

  const zoom = createMemo(() => {
    const src = props.activeImage;
    const res = props.result;
    const vp = vpSize();
    if (!src || !res || zoomReset()) return IDENTITY_ZOOM;
    return computeZoomTransform(res.corners, src.width, src.height, vp.w, vp.h, 2.0, 1.9);
  });

  function drawPreview(): void {
    const src = props.activeImage;
    const res = props.result;
    if (!src || !displayCanvas) return;

    displayCanvas.width = src.width;
    displayCanvas.height = src.height;
    const ctx = displayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, src.width, src.height);
    ctx.drawImage(src.canvas, 0, 0);

    if (res) {
      if (!zoomReset()) {
        drawSpotlightMask(ctx, src.width, src.height, res.corners);
      }

      const c = res.corners;
      const lineW = Math.max(2.5, Math.min(src.width, src.height) * 0.007);
      ctx.save();
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = lineW;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      ctx.lineTo(c[1].x, c[1].y);
      ctx.lineTo(c[2].x, c[2].y);
      ctx.lineTo(c[3].x, c[3].y);
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = 'rgba(16, 185, 129, 0.11)';
      ctx.fill();

      const dotR = Math.max(3.5, lineW * 1.45);
      ctx.fillStyle = '#10B981';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(c[i].x, c[i].y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      if (res.telemetry?.finders) {
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = Math.max(1.8, lineW * 0.7);
        const cross = Math.max(6, dotR * 1.6);
        for (const f of res.telemetry.finders) {
          ctx.beginPath();
          ctx.moveTo(f.x - cross, f.y);
          ctx.lineTo(f.x + cross, f.y);
          ctx.moveTo(f.x, f.y - cross);
          ctx.lineTo(f.x, f.y + cross);
          ctx.stroke();
        }
      }
      ctx.restore();

      window.clearTimeout(pulseTimer);
      setPulseLock(false);
      requestAnimationFrame(() => {
        setPulseLock(true);
        pulseTimer = window.setTimeout(() => setPulseLock(false), 450);
      });
    }
  }

  createEffect(() => {
    drawPreview();
  });

  return (
    <section class="pane stage-pane" aria-label="Image scanner stage">
      <div class="stage-toolbar">
        {props.modeSwitchSlot}

        <div class="action-row">
          <button
            type="button"
            class="btn"
            onClick={props.onPasteClipboardClick}
            aria-busy={props.busy}
          >
            <TbOutlineClipboard size={15} aria-hidden="true" />
            <span>Paste Clipboard</span>
          </button>

          <label
            for="qr-file-input"
            class="btn btn-primary"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputEl?.click();
              }
            }}
          >
            <TbOutlineUpload size={15} aria-hidden="true" />
            <span>Choose File</span>
          </label>
          <input
            ref={fileInputEl}
            id="qr-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            class="file-input-hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) props.onSelectFile(file);
              e.currentTarget.value = '';
            }}
          />

          <Show when={props.activeImage && props.result && !zoomReset()}>
            <button
              type="button"
              class="btn"
              onClick={() => setZoomReset(true)}
              aria-label="Reset zoom"
            >
              <TbOutlineZoomReset size={15} aria-hidden="true" />
              <span>Reset Zoom</span>
            </button>
          </Show>

          <Show when={props.activeImage}>
            <button type="button" class="btn" onClick={props.onClear} aria-label="Clear active image">
              <TbOutlineTrash size={15} aria-hidden="true" />
              <span>Clear</span>
            </button>
          </Show>
        </div>
      </div>

      <div
        class="stage-viewport"
        classList={{
          'is-compact': !props.activeImage,
          'has-image': Boolean(props.activeImage),
          'is-drag-active': draggingLocal() || props.windowDragging,
          'has-lock': props.result !== null,
          'is-lock-flash': pulseLock(),
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!draggingLocal()) {
            setDraggingLocal(true);
            props.onDragHoverChange(true);
          }
        }}
        onDragLeave={() => {
          setDraggingLocal(false);
          props.onDragHoverChange(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDraggingLocal(false);
          props.onDragHoverChange(false);
          const file = e.dataTransfer?.files?.[0];
          if (file) props.onSelectFile(file);
        }}
      >
        <span class="reticle reticle-tl" aria-hidden="true" />
        <span class="reticle reticle-tr" aria-hidden="true" />
        <span class="reticle reticle-bl" aria-hidden="true" />
        <span class="reticle reticle-br" aria-hidden="true" />

        <Show
          when={props.activeImage}
          fallback={
            <div class="stage-empty">
              <div class="stage-empty-icon" aria-hidden="true">
                <TbOutlineQrcode size={20} />
              </div>
              <p class="stage-empty-title">Drop or Paste Image</p>
              <p class="stage-empty-sub">
                Drop PNG, JPEG, or WebP anywhere — or press <kbd class="mono">Ctrl+V</kbd>.
              </p>
            </div>
          }
        >
          {(img) => (
            <div
              ref={(el) => {
                setWrapEl(el);
                onCleanup(() => {
                  if (wrapEl() === el) setWrapEl(null);
                });
              }}
              class="stage-canvas-wrap"
              data-rev={img().revision}
            >
              <div class="stage-zoom-layer" style={{ transform: toZoomCss(zoom()) }}>
                <canvas
                  ref={(el) => {
                    displayCanvas = el;
                    drawPreview();
                  }}
                  class="stage-canvas is-entering"
                  aria-label={`Scanned image ${img().label}`}
                />
              </div>
            </div>
          )}
        </Show>
      </div>

      <div class="stage-footer">
        <div class="sample-strip" role="group" aria-label="Test sample QR codes">
          <span class="sample-heading">
            <TbOutlineFlask size={13} aria-hidden="true" />
            <span>Samples:</span>
          </span>
          <button
            type="button"
            class="keycap-pill"
            onClick={() => props.onSelectSample('clean', 'Clean URL')}
          >
            Clean
          </button>
          <button
            type="button"
            class="keycap-pill"
            onClick={() => props.onSelectSample('skewed', 'Skewed Angle')}
          >
            Skewed
          </button>
          <button
            type="button"
            class="keycap-pill"
            onClick={() => props.onSelectSample('damaged', 'Shadow + Damaged')}
          >
            Damaged
          </button>
          <button
            type="button"
            class="keycap-pill keycap-chaos"
            onClick={() => props.onSelectSample('chaos', 'Chaos Mode')}
          >
            Chaos Mode
          </button>
          <button
            type="button"
            class="keycap-pill"
            onClick={() => props.onSelectSample('wifi', 'Wi-Fi Config')}
          >
            Wi-Fi
          </button>
        </div>

        <div
          class="stage-status mono tabular"
          classList={{
            'is-error': Boolean(props.statusError),
            'is-ok': !props.statusError && props.result !== null,
          }}
          role="status"
        >
          <Show
            when={props.statusError}
            fallback={
              <Show when={props.activeImage} fallback={<span>Standby · 0 frames queued</span>}>
                {(img) => (
                  <>
                    <Show when={props.result}>
                      <TbOutlineCheck size={14} aria-hidden="true" />
                    </Show>
                    <span>
                      {img().width}×{img().height} · {img().label}
                      {props.elapsedMs !== null ? ` · ${props.elapsedMs.toFixed(1)} ms` : ''}
                    </span>
                  </>
                )}
              </Show>
            }
          >
            {(err) => (
              <>
                <TbOutlineAlertTriangle size={14} aria-hidden="true" />
                <span>{err()}</span>
              </>
            )}
          </Show>
        </div>
      </div>
    </section>
  );
}
