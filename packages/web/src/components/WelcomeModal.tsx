import { TbFillHeart, TbOutlineQrcode, TbOutlineSparkles, TbOutlineX } from 'solid-icons/tb';
import { createEffect, onCleanup, onMount } from 'solid-js';
import { GITHUB_USERNAME } from './CreatorBadge.tsx';

export interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

export function WelcomeModal(props: WelcomeModalProps) {
  let confirmBtnEl: HTMLButtonElement | undefined;
  let lastFocused: HTMLElement | null = null;

  createEffect(() => {
    if (props.open) {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => {
        confirmBtnEl?.focus();
      });
    } else if (lastFocused) {
      lastFocused.focus();
      lastFocused = null;
    }
  });

  function onKeyDown(event: KeyboardEvent): void {
    if (props.open && event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  return (
    <div
      class="welcome-backdrop"
      classList={{ 'is-open': props.open }}
      inert={!props.open}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div
        class="welcome-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        <div class="welcome-top">
          <div class="welcome-badge" aria-hidden="true">
            <TbOutlineQrcode size={18} class="welcome-qr-icon" />
            <TbOutlineSparkles size={13} class="welcome-sparkle" />
          </div>

          <button
            type="button"
            class="welcome-close"
            aria-label="Close welcome message"
            onClick={props.onClose}
          >
            <TbOutlineX size={16} aria-hidden="true" />
          </button>
        </div>

        <h2 id="welcome-title" class="welcome-title">
          <span>hi there! welcome to qr-scan</span>
          <TbFillHeart size={15} class="welcome-heart" aria-hidden="true" />
        </h2>

        <p class="welcome-copy">
          Everything runs locally in your browser via a custom zero-dependency ISO/IEC 18004 engine — zero uploads, pure math from scratch.
        </p>
        <p class="welcome-copy">
          Press <kbd class="mono">Ctrl+V</kbd> anywhere to paste an image, drop a file, try a sample below, or switch to your live camera.
        </p>

        <div class="welcome-foot">
          <span class="welcome-by mono">by @{GITHUB_USERNAME}</span>
          <button
            ref={confirmBtnEl}
            type="button"
            class="btn btn-primary"
            onClick={props.onClose}
          >
            Got it, let&apos;s scan
          </button>
        </div>
      </div>
    </div>
  );
}
