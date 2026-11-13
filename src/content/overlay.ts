import type { GhostState, Rect } from '../shared/types';
import { createPanel, type PanelCallbacks, type PanelView } from './panel';
import { clamp, describeElement, ghostFilters } from './geometry';

export interface OverlayCallbacks extends PanelCallbacks {
  onGhostRect(rect: Rect): void;
}

const HOST_ID = 'risovach-root';

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .stage { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }

  .ghost {
    position: absolute; left: 0; top: 0; transform-origin: 0 0;
    will-change: transform; pointer-events: none; display: none;
  }
  .ghost.edit { pointer-events: auto; cursor: move; touch-action: none; }
  .ghost-img {
    width: 100%; height: 100%; display: block;
    user-select: none; -webkit-user-drag: none; pointer-events: none;
  }
  .ghost.edges .ghost-img { image-rendering: pixelated; }
  .ghost.edit .ghost-img { outline: 1px dashed rgba(108, 124, 255, 0.9); outline-offset: 1px; }

  .handle {
    position: absolute; width: 14px; height: 14px;
    background: #ffffff; border: 1.5px solid #4f46e5; border-radius: 3px;
    transform: translate(-50%, -50%) scale(var(--handle-scale, 1));
    display: none; pointer-events: auto;
  }
  .ghost.edit .handle { display: block; }
  .handle[data-corner="nw"] { left: 0; top: 0; cursor: nwse-resize; }
  .handle[data-corner="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
  .handle[data-corner="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
  .handle[data-corner="se"] { left: 100%; top: 100%; cursor: nwse-resize; }

  .badge {
    position: absolute; left: 12px; bottom: 12px; display: none;
    align-items: center; gap: 6px; padding: 5px 10px;
    border-radius: 999px; background: rgba(24, 25, 30, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #e8e9ed; font-size: 11px; font-weight: 600; pointer-events: none;
    backdrop-filter: blur(6px);
  }
  .badge.show { display: inline-flex; }
  .badge[data-mode="locked"] { border-color: rgba(49, 196, 141, 0.6); color: #7ee2b8; }

  .panel {
    position: absolute; top: 16px; right: 16px; width: 274px;
    background: #1e1f24; color: #e8e9ed; border: 1px solid #34373f;
    border-radius: 12px; box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
    pointer-events: auto; font-size: 12px; user-select: none; overflow: hidden;
  }
  .panel.collapsed { width: auto; }
  .panel.collapsed .panel-body { display: none; }
  .panel-head {
    display: flex; align-items: center; gap: 7px; padding: 8px 10px;
    background: #26282f; cursor: move;
  }
  .panel-dot { width: 8px; height: 8px; border-radius: 50%; background: #6c7cff; flex: none; }
  .panel.locked .panel-dot { background: #31c48d; }
  .panel-title { font-weight: 600; font-size: 13px; }
  .panel-mode { margin-left: auto; font-size: 11px; color: #9aa0ad; }
  .panel-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }

  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .btn, .file-btn, .mini, .icon-btn {
    border: 1px solid #3a3d47; border-radius: 7px; background: #2a2d35;
    color: inherit; font: inherit; cursor: pointer; text-align: center;
  }
  .btn { padding: 6px 8px; }
  .btn:hover, .file-btn:hover, .mini:hover, .icon-btn:hover { background: #343843; }
  .btn:disabled, .mini:disabled { opacity: 0.45; cursor: default; }
  .btn.primary { background: #4f46e5; border-color: #4f46e5; }
  .btn.primary:hover { background: #5b52f0; }
  .btn.danger { background: #3a2530; border-color: #5a3040; }
  .btn.danger:hover { background: #4a2b38; }
  .file-btn { padding: 6px 8px; display: block; }
  .file-btn input { display: none; }
  .icon-btn { width: 22px; height: 22px; padding: 0; line-height: 1; flex: none; }
  .mini { padding: 2px 6px; font-size: 10px; }

  .target-line { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #9aa0ad; }
  .target-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .sync-line { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .sel {
    width: 100%; min-width: 0; padding: 4px 6px; font: inherit; font-size: 11px;
    color: inherit; background: #2a2d35; border: 1px solid #3a3d47; border-radius: 6px;
  }
  .sync-source { font-size: 10px; color: #7d8493; line-height: 1.4; }
  .sync-source[data-active="1"] { color: #7ee2b8; }

  .slider { display: grid; grid-template-columns: 78px 1fr 40px; align-items: center; gap: 6px; }
  .slider span { color: #b6bcc8; }
  .slider input { width: 100%; accent-color: #6c7cff; margin: 0; }
  .slider output { font-size: 11px; color: #9aa0ad; text-align: right; font-variant-numeric: tabular-nums; }

  .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
  .checks label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
  .checks .wide { grid-column: 1 / -1; }
  .checks input { accent-color: #6c7cff; margin: 0; }

  .status { display: none; font-size: 11px; color: #ffb020; }
  .status[data-visible="1"] { display: block; }

  .hint { font-size: 10px; color: #7d8493; line-height: 1.55; }
  .hint b { color: #9aa0ad; font-weight: 600; }

  .pick-layer {
    position: absolute; inset: 0; pointer-events: auto; cursor: crosshair;
    background: rgba(10, 12, 20, 0.08);
  }
  .pick-box {
    position: absolute; display: none; border: 2px solid #6c7cff;
    background: rgba(108, 124, 255, 0.14); border-radius: 2px;
  }
  .pick-tip {
    position: absolute; padding: 3px 7px; border-radius: 5px;
    background: rgba(24, 25, 30, 0.94); border: 1px solid rgba(255, 255, 255, 0.16);
    color: #e8e9ed; font-size: 11px; white-space: nowrap; pointer-events: none;
  }
`;

export class Overlay {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly stage: HTMLDivElement;
  private readonly ghost: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly badge: HTMLDivElement;
  readonly panel: PanelView;
  private base = { width: 0, height: 0 };
  private mode: 'edit' | 'locked' = 'edit';

  constructor(callbacks: OverlayCallbacks) {
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${STYLES}</style><div class="stage"><div class="ghost"><img class="ghost-img" alt="" draggable="false" /><div class="handle" data-corner="nw"></div><div class="handle" data-corner="ne"></div><div class="handle" data-corner="sw"></div><div class="handle" data-corner="se"></div></div><div class="badge"></div></div>`;

    const q = <T extends Element>(selector: string): T => {
      const node = this.shadow.querySelector<T>(selector);
      if (!node) throw new Error(`Overlay element not found: ${selector}`);
      return node;
    };
    this.stage = q<HTMLDivElement>('.stage');
    this.ghost = q<HTMLDivElement>('.ghost');
    this.img = q<HTMLImageElement>('.ghost-img');
    this.badge = q<HTMLDivElement>('.badge');

    this.panel = createPanel(callbacks);
    this.stage.appendChild(this.panel.root);

    this.bindDrag(callbacks);
    this.setMode('edit');
  }

  mount(): void {
    (document.documentElement || document.body).appendChild(this.host);
  }

  destroy(): void {
    this.host.remove();
  }

  setVisible(visible: boolean): void {
    this.host.style.display = visible ? '' : 'none';
  }

  setBase(width: number, height: number): void {
    this.base = { width, height };
  }

  setSource(src: string | null): void {
    if (src) this.img.src = src;
    else this.img.removeAttribute('src');
  }

  setEdgesOn(on: boolean): void {
    this.ghost.classList.toggle('edges', on);
  }

  setMode(mode: 'edit' | 'locked'): void {
    this.mode = mode;
    if (this.badge.dataset.mode === mode) return;
    this.ghost.classList.toggle('edit', mode === 'edit');
    this.badge.dataset.mode = mode;
    this.badge.textContent = mode === 'locked' ? '🔒 Зафиксировано' : '✎ Настройка';
  }

  render(state: GhostState): void {
    if (!this.base.width || !this.base.height) {
      this.ghost.style.display = 'none';
      this.badge.classList.remove('show');
      return;
    }
    const w = Math.max(1, state.rect.width);
    const h = Math.max(1, state.rect.height);
    const sx = w / this.base.width;
    const sy = h / this.base.height;
    const fx = state.flipH ? -1 : 1;
    const fy = state.flipV ? -1 : 1;
    const cx = state.rect.x + w / 2;
    const cy = state.rect.y + h / 2;

    this.ghost.style.width = `${this.base.width}px`;
    this.ghost.style.height = `${this.base.height}px`;
    this.ghost.style.transform = `translate3d(${cx}px, ${cy}px, 0) rotate(${state.rotation}deg) scale(${sx * fx}, ${sy * fy}) translate(${-this.base.width / 2}px, ${-this.base.height / 2}px)`;
    this.ghost.style.setProperty('--handle-scale', String(1 / Math.max(0.05, Math.abs(sx))));
    this.ghost.style.display = state.visible ? 'block' : 'none';
    this.lastRect = { ...state.rect };
    this.img.style.opacity = String(clamp(state.opacity, 0, 1));
    this.img.style.filter = ghostFilters(state);
    this.badge.classList.toggle('show', state.visible);
    this.setMode(this.mode);
  }

  /** Picks an element under the cursor; resolves with null on Escape. */
  beginPick(): Promise<Element | null> {
    return new Promise((resolve) => {
      const layer = document.createElement('div');
      layer.className = 'pick-layer';
      const box = document.createElement('div');
      box.className = 'pick-box';
      const tip = document.createElement('div');
      tip.className = 'pick-tip';
      layer.append(box, tip);
      this.stage.appendChild(layer);

      let candidate: Element | null = null;

      const cleanup = (): void => {
        layer.removeEventListener('pointermove', onMove);
        layer.removeEventListener('pointerdown', onDown);
        window.removeEventListener('keydown', onKey, true);
        layer.remove();
      };

      const onMove = (event: PointerEvent): void => {
        candidate = pickTargetAt(event.clientX, event.clientY);
        if (candidate) {
          const rect = candidate.getBoundingClientRect();
          box.style.display = 'block';
          box.style.left = `${rect.left}px`;
          box.style.top = `${rect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          tip.textContent = `${describeElement(candidate)} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
        } else {
          box.style.display = 'none';
          tip.textContent = 'Наведите на холст';
        }
        tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
        tip.style.top = `${Math.min(event.clientY + 14, window.innerHeight - tip.offsetHeight - 8)}px`;
      };

      const onDown = (event: PointerEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        const chosen = pickTargetAt(event.clientX, event.clientY);
        cleanup();
        resolve(chosen);
      };

      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup();
          resolve(null);
        }
      };

      layer.addEventListener('pointermove', onMove);
      layer.addEventListener('pointerdown', onDown);
      window.addEventListener('keydown', onKey, true);
    });
  }

  private bindDrag(callbacks: OverlayCallbacks): void {
    let drag: { pointerId: number; startX: number; startY: number; startRect: Rect } | null = null;
    let resize: { pointerId: number; corner: string; startX: number; startY: number; startRect: Rect } | null = null;

    this.ghost.addEventListener('pointerdown', (event) => {
      if (this.mode !== 'edit') return;
      const pointer = event as PointerEvent;
      const handle = (pointer.target as HTMLElement).closest<HTMLElement>('.handle');
      const startRect = this.lastRect;
      if (!startRect) return;
      pointer.preventDefault();
      pointer.stopPropagation();
      if (handle) {
        resize = {
          pointerId: pointer.pointerId,
          corner: handle.dataset.corner ?? 'se',
          startX: pointer.clientX,
          startY: pointer.clientY,
          startRect,
        };
        handle.setPointerCapture(pointer.pointerId);
      } else {
        drag = { pointerId: pointer.pointerId, startX: pointer.clientX, startY: pointer.clientY, startRect };
        this.ghost.setPointerCapture(pointer.pointerId);
      }
    });

    this.ghost.addEventListener('pointermove', (event) => {
      const pointer = event as PointerEvent;
      if (drag && pointer.pointerId === drag.pointerId) {
        callbacks.onGhostRect({
          ...drag.startRect,
          x: drag.startRect.x + (pointer.clientX - drag.startX),
          y: drag.startRect.y + (pointer.clientY - drag.startY),
        });
      } else if (resize && pointer.pointerId === resize.pointerId) {
        const dx = pointer.clientX - resize.startX;
        const dy = pointer.clientY - resize.startY;
        callbacks.onGhostRect(resizeRect(resize.startRect, resize.corner, dx, dy, pointer.shiftKey));
      }
    });

    const end = (event: Event): void => {
      const pointer = event as PointerEvent;
      if (drag?.pointerId === pointer.pointerId) drag = null;
      if (resize?.pointerId === pointer.pointerId) resize = null;
    };
    this.ghost.addEventListener('pointerup', end);
    this.ghost.addEventListener('pointercancel', end);
  }

  private lastRect: Rect | null = null;
}

function resizeRect(start: Rect, corner: string, dx: number, dy: number, freeAspect: boolean): Rect {
  const min = 24;
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  let width: number;
  let height: number;

  if (freeAspect) {
    width = Math.max(min, west ? start.width - dx : start.width + dx);
    height = Math.max(min, north ? start.height - dy : start.height + dy);
  } else {
    const aspect = start.width / Math.max(1, start.height);
    if (Math.abs(dx) / aspect >= Math.abs(dy)) {
      width = Math.max(min, west ? start.width - dx : start.width + dx);
      height = width / aspect;
    } else {
      height = Math.max(min, north ? start.height - dy : start.height + dy);
      width = height * aspect;
    }
    if (width < min) {
      width = min;
      height = width / aspect;
    }
  }

  const x = west ? start.x + start.width - width : start.x;
  const y = north ? start.y + start.height - height : start.y;
  return { x, y, width, height };
}

function pickTargetAt(x: number, y: number): Element | null {
  const elements = document
    .elementsFromPoint(x, y)
    .filter((el) => el.id !== HOST_ID && el !== document.documentElement && el !== document.body);
  const canvases = elements.filter((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);
  if (canvases.length) {
    return canvases.reduce((best, current) => {
      const a = best.getBoundingClientRect();
      const b = current.getBoundingClientRect();
      return b.width * b.height > a.width * a.height ? current : best;
    });
  }
  return elements[0] ?? null;
}