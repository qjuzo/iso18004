import type { DecodeResult } from '@qr-scan/core';
import {
  TbOutlineCamera,
  TbOutlineDeviceDesktop,
  TbOutlineHelpCircle,
  TbOutlineMoon,
  TbOutlinePhoto,
  TbOutlineQrcode,
  TbOutlineSparkles,
  TbOutlineSun,
  TbOutlineVolume,
  TbOutlineVolumeOff,
} from 'solid-icons/tb';
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Camera } from './components/Camera.tsx';
import { CreatorBadge } from './components/CreatorBadge.tsx';
import { Dropzone, type ActiveImageSource } from './components/Dropzone.tsx';
import { Inspector } from './components/Inspector.tsx';
import { ResultBar, type RecentScan } from './components/ResultBar.tsx';
import { WelcomeModal } from './components/WelcomeModal.tsx';
import { buildSampleImageData, type SamplePreset } from './sample-qr.ts';
import type { DecodeWorkerResponse } from './worker.ts';

type InputMode = 'image' | 'camera';
type ThemePref = 'dark' | 'light' | 'system';

const THEME_STORAGE_KEY = 'qr-scan-theme';
const WELCOMED_STORAGE_KEY = 'qr-scan:welcomed';
const SOUND_STORAGE_KEY = 'qr-scan:sound';

function readStoredTheme(): ThemePref {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'dark' || val === 'light' || val === 'system') return val;
  } catch {
    // Ignore storage restriction
  }
  return 'dark';
}

function readWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function readSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref;
}

export function App() {
  const [themePref, setThemePref] = createSignal<ThemePref>(readStoredTheme());
  const [soundEnabled, setSoundEnabled] = createSignal<boolean>(readSoundPref());
  const [welcomeOpen, setWelcomeOpen] = createSignal<boolean>(!readWelcomed());
  const [mode, setMode] = createSignal<InputMode>('image');
  const [result, setResult] = createSignal<DecodeResult | null>(null);
  const [elapsedMs, setElapsedMs] = createSignal<number | null>(null);
  const [statusError, setStatusError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [activeImage, setActiveImage] = createSignal<ActiveImageSource | null>(null);
  const [recentScans, setRecentScans] = createSignal<RecentScan[]>([]);
  const [activeScanId, setActiveScanId] = createSignal<number | null>(null);
  const [windowDragging, setWindowDragging] = createSignal(false);
  const [stageHoverDrag, setStageHoverDrag] = createSignal(false);
  const [inspectorOpen, setInspectorOpen] = createSignal(false);
  const [crtMode, setCrtMode] = createSignal(false);
  const [achievementToast, setAchievementToast] = createSignal('');

  let worker: Worker | null = null;
  let audioCtx: AudioContext | null = null;
  let nextReqId = 1;
  let nextScanId = 1;
  let nextImageRev = 1;
  let dragDepth = 0;
  let secretTapCount = 0;
  let secretTimer: number | undefined;
  let toastTimer: number | undefined;
  let lastCameraFeedbackText = '';
  const pending = new Map<number, (resp: DecodeWorkerResponse) => void>();

  createEffect(() => {
    const pref = themePref();
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // Ignore storage restriction
    }
    document.documentElement.dataset.theme = resolveTheme(pref);
  });

  createEffect(() => {
    document.documentElement.dataset.crt = crtMode() ? 'on' : 'off';
  });

  createEffect(() => {
    const enabled = soundEnabled();
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // Ignore storage restriction
    }
  });

  const mascot = createMemo<{ face: string; text: string; tone: 'idle' | 'drag' | 'busy' | 'error' | 'warn' | 'lock' }>(() => {
    if (windowDragging() || stageHoverDrag()) {
      return { face: '( O_O )', text: 'ooh, an image!', tone: 'drag' };
    }
    if (busy()) {
      return { face: '( ⊙_⊙ )', text: 'crunching polynomials…', tone: 'busy' };
    }
    if (statusError()) {
      return { face: '( x_x )', text: 'no qr symbol in frame', tone: 'error' };
    }
    const res = result();
    if (res) {
      const fixed = res.telemetry?.correctedErrors ?? 0;
      if (fixed > 0) {
        return { face: '( •̀_•́ )ง', text: `rescued ${fixed}B from the void`, tone: 'warn' };
      }
      return { face: '( ^‿^ )✧', text: 'locked!', tone: 'lock' };
    }
    return { face: '( •_•)', text: 'ready for pixels', tone: 'idle' };
  });

  function registerSecretTap(): void {
    window.clearTimeout(secretTimer);
    secretTapCount++;
    if (secretTapCount >= 5) {
      secretTapCount = 0;
      const next = !crtMode();
      setCrtMode(next);
      window.clearTimeout(toastTimer);
      setAchievementToast(
        next
          ? 'Achievement unlocked: Pixel Whisperer (Reed-Solomon approves)'
          : 'CRT Overdrive disengaged — back to Field Optics'
      );
      toastTimer = window.setTimeout(() => setAchievementToast(''), 4000);
    } else {
      secretTimer = window.setTimeout(() => {
        secretTapCount = 0;
      }, 1500);
    }
  }

  function dismissWelcome(): void {
    setWelcomeOpen(false);
    try {
      localStorage.setItem(WELCOMED_STORAGE_KEY, '1');
    } catch {
      // Ignore storage restriction
    }
  }

  function triggerLockFeedback(): void {
    try {
      navigator.vibrate?.(15);
    } catch {
      // Ignore unsupported vibrate
    }
    if (!soundEnabled()) return;
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(920, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1240, audioCtx.currentTime + 0.03);
      gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.045);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.05);
    } catch {
      // Ignore audio policy errors
    }
  }

  function pushRecentScan(
    res: DecodeResult,
    ms: number,
    sourceLabel: string,
    image: ActiveImageSource | null
  ): void {
    const scanId = nextScanId++;
    setActiveScanId(scanId);
    setRecentScans((prev) => {
      const deduped = prev.filter((item) => item.result.text !== res.text);
      return [{ id: scanId, result: res, elapsedMs: ms, sourceLabel, image }, ...deduped].slice(0, 5);
    });
  }

  function decodeFrame(
    imageData: ImageData,
    debug: boolean
  ): Promise<{ result: DecodeResult | null; elapsedMs: number }> {
    if (!worker) return Promise.resolve({ result: null, elapsedMs: 0 });
    const id = nextReqId++;
    const buffer = imageData.data.buffer;
    return new Promise((resolve) => {
      pending.set(id, (resp) => resolve({ result: resp.result, elapsedMs: resp.elapsedMs }));
      worker!.postMessage(
        { id, buffer, width: imageData.width, height: imageData.height, debug },
        [buffer]
      );
    });
  }

  async function processBlob(blob: Blob, sourceLabel: string): Promise<void> {
    setMode('image');
    setBusy(true);
    setStatusError('');
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const imgSrc: ActiveImageSource = {
        canvas,
        width: canvas.width,
        height: canvas.height,
        label: sourceLabel,
        revision: nextImageRev++,
      };
      setActiveImage(imgSrc);

      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { result: res, elapsedMs: ms } = await decodeFrame(frame, true);
      setResult(res);
      setElapsedMs(ms);
      if (res) {
        triggerLockFeedback();
        pushRecentScan(res, ms, sourceLabel, imgSrc);
      } else {
        setActiveScanId(null);
        setStatusError(`No QR symbol found (${ms.toFixed(1)} ms)`);
      }
    } catch (err) {
      setResult(null);
      setStatusError(err instanceof Error ? err.message : 'Unable to decode image');
    } finally {
      setBusy(false);
    }
  }

  async function processSample(preset: SamplePreset, label: string): Promise<void> {
    setMode('image');
    setBusy(true);
    setStatusError('');
    try {
      const sample = buildSampleImageData(preset);
      const canvas = document.createElement('canvas');
      canvas.width = sample.width;
      canvas.height = sample.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.putImageData(sample, 0, 0);

      const imgSrc: ActiveImageSource = {
        canvas,
        width: sample.width,
        height: sample.height,
        label,
        revision: nextImageRev++,
      };
      setActiveImage(imgSrc);

      const frame = ctx.getImageData(0, 0, sample.width, sample.height);
      const { result: res, elapsedMs: ms } = await decodeFrame(frame, true);
      setResult(res);
      setElapsedMs(ms);
      if (res) {
        triggerLockFeedback();
        pushRecentScan(res, ms, label, imgSrc);
      } else {
        setActiveScanId(null);
        setStatusError(`No QR symbol found (${ms.toFixed(1)} ms)`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleClipboardButton(): Promise<void> {
    setStatusError('');
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      setStatusError('Clipboard read API unavailable. Press Ctrl+V / Cmd+V directly.');
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const mime = item.types.find((t) => t.startsWith('image/'));
        if (mime) {
          const blob = await item.getType(mime);
          await processBlob(blob, 'Clipboard');
          return;
        }
      }
      setStatusError('No image found in clipboard.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setStatusError('Clipboard permission denied. Press Ctrl+V / Cmd+V directly.');
      } else {
        setStatusError('Clipboard read failed. Press Ctrl+V / Cmd+V directly.');
      }
    }
  }

  function handleWindowPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          void processBlob(file, 'Ctrl+V Paste');
          return;
        }
      }
    }
  }

  function handleWindowDragEnter(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      dragDepth++;
      setWindowDragging(true);
    }
  }

  function handleWindowDragLeave(): void {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setWindowDragging(false);
  }

  function handleWindowDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
    }
  }

  function handleWindowDrop(event: DragEvent): void {
    dragDepth = 0;
    setWindowDragging(false);
    setStageHoverDrag(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      event.preventDefault();
      void processBlob(file, file.name);
    }
  }

  onMount(() => {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<DecodeWorkerResponse>) => {
      const resolver = pending.get(event.data.id);
      if (resolver) {
        pending.delete(event.data.id);
        resolver(event.data);
      }
    });

    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onSchemeChange = () => {
      if (themePref() === 'system') {
        document.documentElement.dataset.theme = resolveTheme('system');
      }
    };
    mql.addEventListener('change', onSchemeChange);

    window.addEventListener('paste', handleWindowPaste);
    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);

    onCleanup(() => {
      mql.removeEventListener('change', onSchemeChange);
      window.removeEventListener('paste', handleWindowPaste);
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
      window.clearTimeout(secretTimer);
      window.clearTimeout(toastTimer);
      for (const resolver of pending.values()) {
        resolver({ id: -1, result: null, elapsedMs: 0 });
      }
      pending.clear();
      worker?.terminate();
      worker = null;
      void audioCtx?.close();
    });
  });

  const modeSwitcher = () => (
    <div class="segmented" role="group" aria-label="Scanner mode">
      <span
        class="seg-slider"
        classList={{ 'is-camera': mode() === 'camera' }}
        aria-hidden="true"
      />
      <button
        type="button"
        class="seg-btn"
        aria-pressed={mode() === 'image'}
        onClick={() => setMode('image')}
      >
        <TbOutlinePhoto size={15} class="seg-icon" aria-hidden="true" />
        <span>Image / Paste</span>
      </button>
      <button
        type="button"
        class="seg-btn"
        aria-pressed={mode() === 'camera'}
        onClick={() => setMode('camera')}
      >
        <TbOutlineCamera size={15} class="seg-icon" aria-hidden="true" />
        <span>Scan Camera</span>
      </button>
    </div>
  );

  return (
    <div class="workbench-shell">
      <header class="topbar">
        <div class="topbar-left">
          <button
            type="button"
            class="brand-btn"
            aria-label="qr-scan optical badge"
            onClick={registerSecretTap}
          >
            <TbOutlineQrcode size={19} class="brand-icon" aria-hidden="true" />
            <h1 class="brand-name">qr-scan</h1>
          </button>
          <span class="spec-pill mono">ISO 18004 · zero-dep</span>
        </div>

        <div class="topbar-right">
          <button
            type="button"
            class={`mascot-pill mono tone-${mascot().tone}`}
            onClick={registerSecretTap}
            title="Optical scanner status"
          >
            <span class="mascot-face">{mascot().face}</span>
            <span class="mascot-text">{mascot().text}</span>
          </button>

          <button
            type="button"
            class="icon-pill-btn"
            aria-pressed={soundEnabled()}
            aria-label={soundEnabled() ? 'Mute scan sound' : 'Enable scan sound'}
            title={soundEnabled() ? 'Lock sound on' : 'Lock sound off'}
            onClick={() => setSoundEnabled((v) => !v)}
          >
            <Show
              when={soundEnabled()}
              fallback={<TbOutlineVolumeOff size={15} aria-hidden="true" />}
            >
              <TbOutlineVolume size={15} aria-hidden="true" />
            </Show>
          </button>

          <button
            type="button"
            class="icon-pill-btn"
            aria-label="About qr-scan"
            title="About qr-scan"
            onClick={() => setWelcomeOpen(true)}
          >
            <TbOutlineHelpCircle size={15} aria-hidden="true" />
          </button>

          <div class="theme-group" role="group" aria-label="Color theme">
            <button
              type="button"
              class="theme-btn"
              aria-pressed={themePref() === 'dark'}
              aria-label="Dark theme"
              onClick={() => setThemePref('dark')}
            >
              <TbOutlineMoon size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="theme-btn"
              aria-pressed={themePref() === 'light'}
              aria-label="Light theme"
              onClick={() => setThemePref('light')}
            >
              <TbOutlineSun size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="theme-btn"
              aria-pressed={themePref() === 'system'}
              aria-label="System theme"
              onClick={() => setThemePref('system')}
            >
              <TbOutlineDeviceDesktop size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <Show when={achievementToast()}>
        {(msg) => (
          <div class="achievement-toast mono" role="status">
            <TbOutlineSparkles size={14} class="toast-icon" aria-hidden="true" />
            <span>{msg()}</span>
          </div>
        )}
      </Show>

      <main class="deck-canvas">
        <div class="optical-deck">
          <Show
            when={mode() === 'image'}
            fallback={
              <Camera
                debug={true}
                decodeFrame={decodeFrame}
                onDecode={(res, ms, label) => {
                  setResult(res);
                  setElapsedMs(ms);
                  setStatusError('');
                  if (res.text !== lastCameraFeedbackText) {
                    lastCameraFeedbackText = res.text;
                    triggerLockFeedback();
                  }
                  pushRecentScan(res, ms, label, null);
                }}
                modeSwitchSlot={modeSwitcher()}
              />
            }
          >
            <Dropzone
              activeImage={activeImage()}
              result={result()}
              elapsedMs={elapsedMs()}
              statusError={statusError()}
              busy={busy()}
              windowDragging={windowDragging()}
              onDragHoverChange={setStageHoverDrag}
              onSelectFile={(file) => void processBlob(file, file.name)}
              onPasteClipboardClick={() => void handleClipboardButton()}
              onSelectSample={(preset, label) => void processSample(preset, label)}
              onClear={() => {
                setActiveImage(null);
                setResult(null);
                setElapsedMs(null);
                setStatusError('');
                setActiveScanId(null);
              }}
              modeSwitchSlot={modeSwitcher()}
            />
          </Show>

          <ResultBar
            result={result()}
            recentScans={recentScans()}
            activeScanId={activeScanId()}
            onSelectRecent={(scan) => {
              if (scan.image) {
                setMode('image');
                setActiveImage(scan.image);
              }
              setResult(scan.result);
              setElapsedMs(scan.elapsedMs);
              setActiveScanId(scan.id);
              setStatusError('');
            }}
          />

          <Inspector
            open={inspectorOpen()}
            onToggle={() => setInspectorOpen((v) => !v)}
            telemetry={result()?.telemetry ?? null}
            elapsedMs={elapsedMs()}
          />
        </div>
      </main>

      <footer class="status-rail">
        <div class="engine-meta mono">
          <span class="engine-dot" aria-hidden="true" />
          <span>TypedArray Worker · Zero Uploads</span>
          <span class="trademark-note">· QR Code is a trademark of DENSO WAVE INCORPORATED</span>
        </div>

        <CreatorBadge onSecretTap={registerSecretTap} />
      </footer>

      <WelcomeModal open={welcomeOpen()} onClose={dismissWelcome} />
    </div>
  );
}
