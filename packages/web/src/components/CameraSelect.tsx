import { TbOutlineCamera, TbOutlineCheck, TbOutlineChevronDown } from 'solid-icons/tb';
import { For, createEffect, createSignal, onCleanup, onMount } from 'solid-js';

export interface CameraOption {
  id: string;
  label: string;
}

export interface CameraSelectProps {
  options: CameraOption[];
  value: string;
  onChange: (deviceId: string) => void;
}

export function CameraSelect(props: CameraSelectProps) {
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);

  let rootEl: HTMLDivElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;
  const listboxId = 'camera-device-listbox';

  const selectedOption = () =>
    props.options.find((opt) => opt.id === props.value) ?? props.options[0];

  createEffect(() => {
    if (open()) {
      const idx = props.options.findIndex((o) => o.id === props.value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  });

  function choose(idx: number): void {
    const opt = props.options[idx];
    if (!opt) return;
    props.onChange(opt.id);
    setOpen(false);
    triggerEl?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open()) {
        setOpen(true);
        return;
      }
      const len = props.options.length;
      if (len === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((prev) => (prev + delta + len) % len);
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (open()) {
        event.preventDefault();
        choose(activeIndex());
      }
    } else if (event.key === 'Escape' && open()) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerEl?.focus();
    } else if (event.key === 'Home' && open()) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && open()) {
      event.preventDefault();
      setActiveIndex(Math.max(0, props.options.length - 1));
    }
  }

  function handleDocPointerDown(event: PointerEvent): void {
    if (!open() || !rootEl) return;
    if (!rootEl.contains(event.target as Node)) {
      setOpen(false);
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleDocPointerDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handleDocPointerDown);
    });
  });

  return (
    <div ref={rootEl} class="camera-select">
      <button
        ref={triggerEl}
        type="button"
        class="btn camera-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={listboxId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <TbOutlineCamera size={15} class="select-lead-icon" aria-hidden="true" />
        <span class="camera-select-label">
          {selectedOption()?.label ?? 'Default Camera'}
        </span>
        <TbOutlineChevronDown
          size={14}
          class={`select-chevron${open() ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>

      <ul
        id={listboxId}
        role="listbox"
        aria-label="Available cameras"
        class="camera-select-menu"
        classList={{ 'is-open': open() }}
        inert={!open()}
      >
        <For each={props.options}>
          {(opt, idx) => {
            const isSelected = () => opt.id === (selectedOption()?.id ?? '');
            const isHighlighted = () => idx() === activeIndex();
            return (
              <li
                role="option"
                aria-selected={isSelected()}
                class="camera-select-option"
                classList={{
                  'is-selected': isSelected(),
                  'is-highlighted': isHighlighted(),
                }}
                onMouseEnter={() => setActiveIndex(idx())}
                onClick={() => choose(idx())}
              >
                <span class="camera-option-text">{opt.label}</span>
                <TbOutlineCheck
                  size={14}
                  class={`option-check${isSelected() ? ' is-visible' : ''}`}
                  aria-hidden="true"
                />
              </li>
            );
          }}
        </For>
      </ul>
    </div>
  );
}
