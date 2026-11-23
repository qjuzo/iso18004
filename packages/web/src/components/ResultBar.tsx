import type { DecodeResult } from '@qr-scan/core';
import {
  TbOutlineBraces,
  TbOutlineCheck,
  TbOutlineCopy,
  TbOutlineDownload,
  TbOutlineExternalLink,
  TbOutlineFileText,
  TbOutlineKey,
  TbOutlineLink,
  TbOutlineTerminal,
  TbOutlineTicket,
  TbOutlineWifi,
} from 'solid-icons/tb';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { ActiveImageSource } from './Dropzone.tsx';

export interface RecentScan {
  id: number;
  result: DecodeResult;
  elapsedMs: number;
  sourceLabel: string;
  image: ActiveImageSource | null;
}

export interface ResultBarProps {
  result: DecodeResult | null;
  recentScans: RecentScan[];
  activeScanId: number | null;
  onSelectRecent: (scan: RecentScan) => void;
}

interface WifiConfig {
  ssid: string;
  auth: string;
  password: string;
}

type PayloadKind = 'url' | 'wifi' | 'json' | 'text';

function parseHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

function unescapeWifiField(val: string): string {
  return val.replace(/\\([\\;,:"])/g, '$1');
}

function parseWifiPayload(text: string): WifiConfig | null {
  if (!/^WIFI:/i.test(text)) return null;
  const body = text.slice(5);
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const colonIdx = body.indexOf(':', i);
    if (colonIdx < 0) break;
    const key = body.slice(i, colonIdx).toUpperCase();
    i = colonIdx + 1;
    let val = '';
    while (i < body.length) {
      const ch = body[i];
      if (ch === '\\' && i + 1 < body.length) {
        val += body[i] + body[i + 1];
        i += 2;
      } else if (ch === ';') {
        i++;
        break;
      } else {
        val += ch;
        i++;
      }
    }
    fields[key] = unescapeWifiField(val);
  }
  if (!fields.S) return null;
  return {
    ssid: fields.S,
    auth: fields.T || 'Open',
    password: fields.P || '',
  };
}

function isJsonPayload(text: string): boolean {
  const t = text.trim();
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) {
    return false;
  }
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function formatHexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const slice = bytes.subarray(offset, offset + 8);
    const addr = offset.toString(16).padStart(4, '0');
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(23, ' ');
    const ascii = Array.from(slice, (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${addr}: ${hex}  |${ascii}|`);
  }
  return lines.join('\n');
}

function legacyCopy(text: string): boolean {
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

export function ResultBar(props: ResultBarProps) {
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  const [wifiCopied, setWifiCopied] = createSignal(false);
  const [liveMsg, setLiveMsg] = createSignal('');
  const [hexView, setHexView] = createSignal(false);

  let resetTimer: number | undefined;
  let wifiTimer: number | undefined;
  let lastAnnounced = '';

  createEffect(() => {
    props.result;
    window.clearTimeout(resetTimer);
    window.clearTimeout(wifiTimer);
    setCopyState('idle');
    setWifiCopied(false);
    setLiveMsg('');
  });

  const validUrl = createMemo(() => {
    const r = props.result;
    return r ? parseHttpUrl(r.text) : null;
  });

  const wifiInfo = createMemo(() => {
    const r = props.result;
    return r ? parseWifiPayload(r.text) : null;
  });

  const payloadKind = createMemo<PayloadKind>(() => {
    if (wifiInfo()) return 'wifi';
    if (validUrl()) return 'url';
    if (props.result && isJsonPayload(props.result.text)) return 'json';
    return 'text';
  });

  const hexDump = createMemo(() => (props.result ? formatHexDump(props.result.bytes) : ''));

  function announce(msg: string): void {
    let text = msg;
    if (text === lastAnnounced) text += '\u00A0';
    lastAnnounced = text;
    setLiveMsg('');
    requestAnimationFrame(() => setLiveMsg(text));
  }

  function reportCopy(ok: boolean): void {
    window.clearTimeout(resetTimer);
    setCopyState('idle');
    announce(ok ? 'Copied' : 'Copy failed');

    requestAnimationFrame(() => {
      setCopyState(ok ? 'copied' : 'failed');
    });

    resetTimer = window.setTimeout(() => {
      setCopyState('idle');
      setLiveMsg('');
    }, 1800);
  }

  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }

  async function handleCopy(): Promise<void> {
    const res = props.result;
    if (!res) return;
    const text = hexView() ? hexDump() : res.text;
    const ok = await writeClipboard(text);
    reportCopy(ok);
  }

  async function handleCopyWifiPass(): Promise<void> {
    const pass = wifiInfo()?.password;
    if (!pass) return;
    const ok = await writeClipboard(pass);
    window.clearTimeout(wifiTimer);
    setWifiCopied(ok);
    announce(ok ? 'Wi-Fi password copied' : 'Copy failed');
    wifiTimer = window.setTimeout(() => setWifiCopied(false), 1800);
  }

  function handleSaveTxt(): void {
    const res = props.result;
    if (!res) return;
    const blob = new Blob([res.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-v${res.version}-payload.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  onCleanup(() => {
    window.clearTimeout(resetTimer);
    window.clearTimeout(wifiTimer);
  });

  return (
    <section
      class="receipt-card"
      classList={{ 'is-locked': props.result !== null }}
      aria-labelledby="payload-heading"
    >
      <div class="receipt-head">
        <div class="card-title-wrap">
          <TbOutlineTicket size={15} class="receipt-icon" aria-hidden="true" />
          <h2 id="payload-heading" class="receipt-title mono">
            OPTICAL READOUT
          </h2>
          <Show when={props.result}>
            <span class="kind-badge mono">
              <Show when={payloadKind() === 'url'}>
                <TbOutlineLink size={12} aria-hidden="true" />
                <span>URL</span>
              </Show>
              <Show when={payloadKind() === 'wifi'}>
                <TbOutlineWifi size={12} aria-hidden="true" />
                <span>Wi-Fi</span>
              </Show>
              <Show when={payloadKind() === 'json'}>
                <TbOutlineBraces size={12} aria-hidden="true" />
                <span>JSON</span>
              </Show>
              <Show when={payloadKind() === 'text'}>
                <TbOutlineFileText size={12} aria-hidden="true" />
                <span>TEXT</span>
              </Show>
            </span>
          </Show>
        </div>

        <Show when={props.result} fallback={<span class="stat-pill mono tabular">STANDBY</span>}>
          {(res) => (
            <span class="stat-pill is-locked mono tabular">
              {res().text.length} chars · {res().bytes.length} B
            </span>
          )}
        </Show>
      </div>

      <Show when={wifiInfo()}>
        {(wifi) => (
          <div class="wifi-banner">
            <div class="wifi-meta">
              <TbOutlineWifi size={15} class="wifi-icon" aria-hidden="true" />
              <div class="wifi-details">
                <span class="wifi-ssid">{wifi().ssid}</span>
                <span class="wifi-auth mono">{wifi().auth}</span>
              </div>
            </div>
            <Show when={wifi().password}>
              <button type="button" class="btn btn-compact" onClick={() => void handleCopyWifiPass()}>
                <Show when={wifiCopied()} fallback={<TbOutlineKey size={14} aria-hidden="true" />}>
                  <TbOutlineCheck size={14} aria-hidden="true" />
                </Show>
                <span>{wifiCopied() ? 'Copied Password' : 'Copy Password'}</span>
              </button>
            </Show>
          </div>
        )}
      </Show>

      <div class="payload-box mono" classList={{ 'is-empty': !props.result }} aria-live="polite">
        <Show when={props.result} fallback={<span>Awaiting optical lock or image input…</span>}>
          {(res) => <span>{hexView() ? hexDump() : res().text}</span>}
        </Show>
      </div>

      <div class="receipt-perf" aria-hidden="true" />

      <div class="payload-actions">
        <button
          type="button"
          class="btn btn-primary btn-copy"
          disabled={!props.result}
          attr:data-copied={copyState() === 'copied' ? '' : undefined}
          attr:data-failed={copyState() === 'failed' ? '' : undefined}
          onClick={() => void handleCopy()}
        >
          <Show when={copyState() === 'copied'} fallback={<TbOutlineCopy size={15} aria-hidden="true" />}>
            <TbOutlineCheck size={15} aria-hidden="true" />
          </Show>
          <span>
            {copyState() === 'copied'
              ? 'Copied'
              : copyState() === 'failed'
                ? 'Failed'
                : 'Copy Text'}
          </span>
        </button>
        <span class="visually-hidden" role="status">
          {liveMsg()}
        </span>

        <Show when={validUrl()}>
          {(href) => (
            <a href={href()} target="_blank" rel="noopener noreferrer" class="btn">
              <TbOutlineExternalLink size={15} aria-hidden="true" />
              <span>Open Link</span>
            </a>
          )}
        </Show>

        <button type="button" class="btn" disabled={!props.result} onClick={handleSaveTxt}>
          <TbOutlineDownload size={15} aria-hidden="true" />
          <span>Save .txt</span>
        </button>

        <button
          type="button"
          class="btn"
          disabled={!props.result}
          aria-pressed={hexView()}
          onClick={() => setHexView((v) => !v)}
          title="Toggle raw byte hex dump"
        >
          <TbOutlineTerminal size={15} aria-hidden="true" />
          <span>{hexView() ? 'Text' : 'Hex'}</span>
        </button>
      </div>

      <Show when={props.recentScans.length > 0}>
        <div class="recent-strip">
          <span class="recent-label mono">Recent ({props.recentScans.length}/5)</span>
          <div class="recent-list">
            <For each={props.recentScans}>
              {(scan) => (
                <button
                  type="button"
                  class="recent-chip mono tabular"
                  classList={{ 'is-active': props.activeScanId === scan.id }}
                  onClick={() => props.onSelectRecent(scan)}
                  title={scan.result.text}
                >
                  <span class="recent-chip-tag">V{scan.result.version}</span>
                  <span class="recent-chip-text">{scan.result.text}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
}
