import type { DecodeResult, Point } from '@qr-scan/core';
import {
  TbOutlineAlertTriangle,
  TbOutlineCamera,
  TbOutlinePlayerPause,
  TbOutlinePlayerPlay,
  TbOutlineSwitchHorizontal,
} from 'solid-icons/tb';
import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { CameraSelect, type CameraOption } from './CameraSelect.tsx';

export interface CameraProps {
  debug: boolean;
  decodeFrame: (
    imageData: ImageData,
    debug: boolean,
    opts?: { maxTimeMs?: number; maxWindows?: number; dropIfBusy?: boolean }
  ) => Promise<{ result: DecodeResult | null; elapsedMs: number }>;
  onDecode: (result: DecodeResult, elapsedMs: number, sourceLabel: string) => void;
  modeSwitchSlot: JSX.Element;
}

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';

export function Camera(props: CameraProps) {
  const [status, setStatus] = createSignal<CameraStatus>('idle');
  const [facing, setFacing] = createSignal<'environment' | 'user'>('environment');
  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string>('');
  const [frozen, setFrozen] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');
  const [fps, setFps] = createSignal(0);
  const [hasLock, setHasLock] = createSignal(false);
  const [lockPulse, setLockPulse] = createSignal(false);

  let videoEl: HTMLVideoElement | undefined;
  let overlayEl: HTMLCanvasElement | undefined;
  let captureCanvas: HTMLCanvasElement | undefined;
  let stream: MediaStream | null = null;
  let rafId = 0;
  let inFlight = false;
  let lastOverlayCorners: [Point, Point, Point, Point] | null = null;
  let lastFinders: [Point, Point, Point] | null = null;
  let lastCapW = 0;
  let lastCapH = 0;
  let lastSeenAt = 0;
  let frameCounter = 0;
  let fpsTimer = 0;
  let lastLockedText = '';
  let pulseTimer: number | undefined;

  const cameraOptions = createMemo<CameraOption[]>(() =>
    devices().map((d, idx) => ({
      id: d.deviceId,
      label: d.label || `Camera ${idx + 1}`,
    }))
  );

  async function refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list.filter((d) => d.kind === 'videoinput');
      setDevices(cams);
      if (cams.length > 0 && !selectedDeviceId()) {
        const activeTrack = stream?.getVideoTracks()[0];
        const currentId = activeTrack?.getSettings().deviceId;
        if (currentId) setSelectedDeviceId(currentId);
      }
    } catch {
      // Ignore enumerate failure on restricted contexts
    }
  }

  function stopStream(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
    lastOverlayCorners = null;
    lastFinders = null;
    lastLockedText = '';
    setHasLock(false);
    setFrozen(false);
    inFlight = false;
  }

  async function startCamera(deviceIdOverride?: string): Promise<void> {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setErrorMsg('Camera capture requires a modern browser over HTTPS or localhost.');
      return;
    }

    setStatus('requesting');
    setErrorMsg('');

    const targetId = deviceIdOverride ?? selectedDeviceId();
    const videoConstraint: MediaTrackConstraints = targetId
      ? { deviceId: { exact: targetId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: facing() }, width: { ideal: 1280 }, height: { ideal: 720 } };

    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      if (!videoEl) {
        stopStream();
        return;
      }

      videoEl.srcObject = stream;
      await videoEl.play();
      setStatus('active');
      await refreshDevices();
      fpsTimer = performance.now();
      frameCounter = 0;
      loop();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setStatus('denied');
        setErrorMsg('Camera permission denied. Allow access in browser site settings and retry.');
      } else {
        setStatus('unavailable');
        setErrorMsg(err instanceof Error ? err.message : 'Unable to open camera device.');
      }
    }
  }

  function toggleFacing(): void {
    setSelectedDeviceId('');
    setFacing((prev) => (prev === 'environment' ? 'user' : 'environment'));
    if (status() === 'active') {
      void startCamera('');
    }
  }

  function toggleFreeze(): void {
    if (!videoEl || status() !== 'active') return;
    const next = !frozen();
    setFrozen(next);
    if (next) {
      videoEl.pause();
    } else {
      void videoEl.play();
    }
  }

  function drawOverlay(): void {
    if (!overlayEl || !videoEl) return;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const ow = overlayEl.clientWidth;
    const oh = overlayEl.clientHeight;
    if (vw <= 0 || vh <= 0 || ow <= 0 || oh <= 0) return;

    if (overlayEl.width !== ow || overlayEl.height !== oh) {
      overlayEl.width = ow;
      overlayEl.height = oh;
    }

    const ctx = overlayEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ow, oh);

    const now = performance.now();
    const visible = lastOverlayCorners && (frozen() || now - lastSeenAt < 400);
    setHasLock(Boolean(visible));

    if (!visible || !lastOverlayCorners || lastCapW <= 0 || lastCapH <= 0) return;

    const containScale = Math.min(ow / vw, oh / vh);
    const offsetX = (ow - vw * containScale) * 0.5;
    const offsetY = (oh - vh * containScale) * 0.5;
    const mapX = (cx: number) => offsetX + (cx * vw / lastCapW) * containScale;
    const mapY = (cy: number) => offsetY + (cy * vh / lastCapH) * containScale;

    ctx.save();
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mapX(lastOverlayCorners[0].x), mapY(lastOverlayCorners[0].y));
    ctx.lineTo(mapX(lastOverlayCorners[1].x), mapY(lastOverlayCorners[1].y));
    ctx.lineTo(mapX(lastOverlayCorners[2].x), mapY(lastOverlayCorners[2].y));
    ctx.lineTo(mapX(lastOverlayCorners[3].x), mapY(lastOverlayCorners[3].y));
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
    ctx.fill();

    ctx.fillStyle = '#10B981';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(mapX(lastOverlayCorners[i].x), mapY(lastOverlayCorners[i].y), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (lastFinders) {
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.75;
      for (const f of lastFinders) {
        const fx = mapX(f.x);
        const fy = mapY(f.y);
        ctx.beginPath();
        ctx.moveTo(fx - 7, fy);
        ctx.lineTo(fx + 7, fy);
        ctx.moveTo(fx, fy - 7);
        ctx.lineTo(fx, fy + 7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function loop(): void {
    if (status() !== 'active') return;
    rafId = requestAnimationFrame(loop);

    frameCounter++;
    const now = performance.now();
    if (now - fpsTimer >= 1000) {
      setFps(frameCounter);
      frameCounter = 0;
      fpsTimer = now;
    }

    drawOverlay();

    if (frozen() || inFlight || !videoEl || videoEl.readyState < 2) return;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (vw <= 0 || vh <= 0) return;

    const scale = Math.min(1, 720 / Math.max(vw, vh));
    const cw = Math.max(1, Math.round(vw * scale));
    const ch = Math.max(1, Math.round(vh * scale));

    if (!captureCanvas) captureCanvas = document.createElement('canvas');
    if (captureCanvas.width !== cw || captureCanvas.height !== ch) {
      captureCanvas.width = cw;
      captureCanvas.height = ch;
    }

    const capCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    if (!capCtx) return;

    capCtx.drawImage(videoEl, 0, 0, cw, ch);
    const frameData = capCtx.getImageData(0, 0, cw, ch);

    inFlight = true;
    void props
      .decodeFrame(frameData, props.debug, { maxTimeMs: 120, dropIfBusy: true })
      .then(({ result, elapsedMs }) => {
        if (result) {
          lastOverlayCorners = result.corners;
          lastFinders = result.telemetry?.finders ?? null;
          lastCapW = cw;
          lastCapH = ch;
          lastSeenAt = performance.now();
          if (result.text !== lastLockedText) {
            lastLockedText = result.text;
            window.clearTimeout(pulseTimer);
            setLockPulse(false);
            requestAnimationFrame(() => {
              setLockPulse(true);
              pulseTimer = window.setTimeout(() => setLockPulse(false), 450);
            });
          }
          props.onDecode(result, elapsedMs, 'Live Camera');
        }
      })
      .finally(() => {
        inFlight = false;
      });
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || status() !== 'active') return;
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') {
      return;
    }
    event.preventDefault();
    toggleFreeze();
  }

  onMount(() => {
    window.addEventListener('keydown', onWindowKeyDown);
    void startCamera();
  });

  onCleanup(() => {
    window.removeEventListener('keydown', onWindowKeyDown);
    window.clearTimeout(pulseTimer);
    stopStream();
  });

  return (
    <section class="pane stage-pane" aria-label="Live camera scanner">
      <div class="stage-toolbar">
        {props.modeSwitchSlot}

        <div class="action-row">
          <Show when={cameraOptions().length > 1}>
            <CameraSelect
              options={cameraOptions()}
              value={selectedDeviceId()}
              onChange={(id) => {
                setSelectedDeviceId(id);
                void startCamera(id);
              }}
            />
          </Show>

          <button type="button" class="btn" onClick={toggleFacing}>
            <TbOutlineSwitchHorizontal size={15} aria-hidden="true" />
            <span>{facing() === 'environment' ? 'Back' : 'Front'}</span>
          </button>

          <button
            type="button"
            class="btn"
            disabled={status() !== 'active'}
            aria-pressed={frozen()}
            onClick={toggleFreeze}
            title="Freeze or resume frame (Space)"
          >
            <Show
              when={frozen()}
              fallback={<TbOutlinePlayerPause size={15} aria-hidden="true" />}
            >
              <TbOutlinePlayerPlay size={15} aria-hidden="true" />
            </Show>
            <span>{frozen() ? 'Resume' : 'Freeze'}</span>
          </button>

          <Show
            when={status() === 'active'}
            fallback={
              <button type="button" class="btn btn-primary" onClick={() => void startCamera()}>
                <TbOutlineCamera size={15} aria-hidden="true" />
                <span>Start Camera</span>
              </button>
            }
          >
            <button
              type="button"
              class="btn"
              onClick={() => {
                stopStream();
                setStatus('idle');
              }}
            >
              <span>Stop</span>
            </button>
          </Show>
        </div>
      </div>

      <div
        class="stage-viewport has-camera"
        classList={{ 'has-lock': hasLock(), 'is-lock-flash': lockPulse() }}
      >
        <span class="reticle reticle-tl" aria-hidden="true" />
        <span class="reticle reticle-tr" aria-hidden="true" />
        <span class="reticle reticle-bl" aria-hidden="true" />
        <span class="reticle reticle-br" aria-hidden="true" />

        <div class="camera-box">
          <video
            ref={videoEl}
            class="camera-video"
            muted
            playsinline
            aria-label="Live camera viewfinder"
          />
          <canvas ref={overlayEl} class="camera-overlay" aria-hidden="true" />

          <Show when={status() !== 'active'}>
            <div class="camera-fallback" role="status">
              <Show when={status() === 'requesting'}>
                <p>Requesting camera permission…</p>
              </Show>
              <Show when={status() === 'idle'}>
                <p>Camera feed paused. Press Start Camera to resume optical tracking.</p>
              </Show>
              <Show when={status() === 'denied' || status() === 'unavailable'}>
                <TbOutlineAlertTriangle size={22} class="is-error" aria-hidden="true" />
                <p class="is-error">{errorMsg()}</p>
                <button type="button" class="btn btn-primary" onClick={() => void startCamera()}>
                  Retry Camera
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="stage-footer">
        <div class="stage-status mono tabular">
          <span>
            {status() === 'active'
              ? frozen()
                ? 'Frame Frozen · Space to resume'
                : `${fps()} FPS · Space to freeze`
              : 'Camera Standby'}
          </span>
        </div>
        <div class="stage-status mono tabular">
          <span>{hasLock() ? 'Quad Lock Active' : 'Searching 1:1:3:1:1'}</span>
        </div>
      </div>
    </section>
  );
}
