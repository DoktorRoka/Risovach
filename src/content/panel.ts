import type { DomainProfile, GhostState } from '../shared/types';
import { clamp } from './geometry';

export interface PanelCallbacks {
  onFile(file: File): void;
  onPickCanvas(): void;
  onToggleLock(): void;
  onToggleVisibility(): void;
  onReset(): void;
  onParentTarget(): void;
  onRebind(): void;
  onGhostChange(patch: Partial<GhostState>): void;
  onProfileChange(patch: Partial<DomainProfile>): void;
}

export interface PanelView {
  root: HTMLElement;
  update(
    state: GhostState,
    profile: DomainProfile,
    targetLabel: string | null,
    locked: boolean,
    syncLabel: string,
  ): void;
  setStatus(text: string): void;
  contains(node: EventTarget | null): boolean;
}

type RangeKey = 'opacity' | 'rotation' | 'brightness' | 'contrast' | 'sensitivity';

const RANGE_DISPLAY = new Map<RangeKey, (value: number) => string>([
  ['opacity', (v) => `${Math.round(v)}%`],
  ['rotation', (v) => `${Math.round(v)}°`],
  ['brightness', (v) => `${Math.round(v)}%`],
  ['contrast', (v) => `${Math.round(v)}%`],
  ['sensitivity', (v) => `${Math.round(v)}%`],
]);

export function createPanel(callbacks: PanelCallbacks): PanelView {
  const root = document.createElement('div');
  root.className = 'panel';
  root.innerHTML = `
    <div class="panel-head">
      <span class="panel-dot"></span>
      <span class="panel-title">Risovach</span>
      <span class="panel-mode">Свободно</span>
      <button class="icon-btn" data-act="collapse" title="Свернуть">–</button>
    </div>
    <div class="panel-body">
      <div class="row2">
        <label class="file-btn">Картинка<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
        <button class="btn" data-act="pick">Указать холст</button>
      </div>
      <div class="target-line">
        <span class="target-label">Холст не выбран</span>
        <button class="mini" data-act="parent" title="Выбрать родительский элемент">↑ родитель</button>
      </div>
      <div class="sync-line">
        <select class="sel" data-select="syncMode" title="Источник синхронизации">
          <option value="auto">Синхр.: авто</option>
          <option value="siteAdapter">Профиль сайта</option>
          <option value="rectTracking">Прямоугольник</option>
          <option value="gestureSync">Жесты</option>
        </select>
        <select class="sel" data-select="anchor" title="Точка привязки зума">
          <option value="cursor">Курсор</option>
          <option value="center">Центр</option>
          <option value="origin">Угол</option>
        </select>
      </div>
      <div class="sync-source">Синхронизация не активна</div>
      <div class="row2">
        <button class="btn primary" data-act="lock">Зафиксировать</button>
        <button class="btn" data-act="visibility">Скрыть</button>
      </div>
      <button class="btn" data-act="rebind">Перепривязать к холсту</button>
      <label class="slider"><span>Прозрачность</span><input type="range" data-range="opacity" min="0" max="100" step="1" /><output></output></label>
      <label class="slider"><span>Поворот</span><input type="range" data-range="rotation" min="-180" max="180" step="1" /><output></output></label>
      <label class="slider"><span>Яркость</span><input type="range" data-range="brightness" min="20" max="200" step="1" /><output></output></label>
      <label class="slider"><span>Контраст</span><input type="range" data-range="contrast" min="20" max="200" step="1" /><output></output></label>
      <label class="slider"><span>Чувств. зума</span><input type="range" data-range="sensitivity" min="20" max="300" step="1" /><output></output></label>
      <div class="checks">
        <label><input type="checkbox" data-check="grayscale" />Ч/б</label>
        <label><input type="checkbox" data-check="edges" />Контуры</label>
        <label><input type="checkbox" data-check="flipH" />Отразить ↔</label>
        <label><input type="checkbox" data-check="flipV" />Отразить ↕</label>
        <label class="wide"><input type="checkbox" data-check="saveSession" />Сохранять сессию</label>
      </div>
      <div class="status"></div>
      <button class="btn danger" data-act="reset">Сбросить</button>
      <div class="hint">
        <b>+</b>/<b>−</b> прозрачность · стрелки двигают · удерживать <b>\`</b> — скрыть<br />
        <b>Alt+Shift+L</b> — фиксация · <b>Alt+Shift+H</b> — скрыть
      </div>
    </div>
  `;

  const q = <T extends Element>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Panel element not found: ${selector}`);
    return node;
  };

  const panelMode = q<HTMLSpanElement>('.panel-mode');
  const targetLabel = q<HTMLSpanElement>('.target-label');
  const parentBtn = q<HTMLButtonElement>('[data-act="parent"]');
  const lockBtn = q<HTMLButtonElement>('[data-act="lock"]');
  const visibilityBtn = q<HTMLButtonElement>('[data-act="visibility"]');
  const statusEl = q<HTMLDivElement>('.status');
  const fileInput = q<HTMLInputElement>('input[type="file"]');
  const collapseBtn = q<HTMLButtonElement>('[data-act="collapse"]');
  const ranges = new Map<RangeKey, HTMLInputElement>();
  root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
    const key = input.dataset.range as RangeKey;
    ranges.set(key, input);
  });
  const checks = new Map<string, HTMLInputElement>();
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    checks.set(input.dataset.check ?? '', input);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) callbacks.onFile(file);
    fileInput.value = '';
  });

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    switch (action) {
      case 'pick':
        callbacks.onPickCanvas();
        break;
      case 'lock':
        callbacks.onToggleLock();
        break;
      case 'visibility':
        callbacks.onToggleVisibility();
        break;
      case 'reset':
        callbacks.onReset();
        break;
      case 'parent':
        callbacks.onParentTarget();
        break;
      case 'rebind':
        callbacks.onRebind();
        break;
      case 'collapse':
        root.classList.toggle('collapsed');
        collapseBtn.textContent = root.classList.contains('collapsed') ? '+' : '–';
        break;
      default:
        break;
    }
  });

  ranges.forEach((input, key) => {
    input.addEventListener('input', () => {
      const value = Number(input.value);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = RANGE_DISPLAY.get(key)?.(value) ?? String(value);
      switch (key) {
        case 'opacity':
          callbacks.onGhostChange({ opacity: value / 100 });
          break;
        case 'rotation':
          callbacks.onGhostChange({ rotation: value });
          break;
        case 'brightness':
          callbacks.onGhostChange({ brightness: value / 100 });
          break;
        case 'contrast':
          callbacks.onGhostChange({ contrast: value / 100 });
          break;
        case 'sensitivity':
          callbacks.onProfileChange({ zoomSensitivity: value / 100 });
          break;
        default:
          break;
      }
    });
  });

  const checkHandlers: Record<string, (checked: boolean) => void> = {
    grayscale: (checked) => callbacks.onGhostChange({ grayscale: checked }),
    edges: (checked) => callbacks.onGhostChange({ edges: checked }),
    flipH: (checked) => callbacks.onGhostChange({ flipH: checked }),
    flipV: (checked) => callbacks.onGhostChange({ flipV: checked }),
    saveSession: (checked) => callbacks.onProfileChange({ saveSession: checked }),
  };
  checks.forEach((input, key) => {
    input.addEventListener('change', () => checkHandlers[key]?.(input.checked));
  });

  const modeSelect = q<HTMLSelectElement>('[data-select="syncMode"]');
  modeSelect.addEventListener('change', () => {
    callbacks.onProfileChange({ syncMode: modeSelect.value as DomainProfile['syncMode'] });
  });
  const anchorSelect = q<HTMLSelectElement>('[data-select="anchor"]');
  anchorSelect.addEventListener('change', () => {
    callbacks.onProfileChange({ anchor: anchorSelect.value as DomainProfile['anchor'] });
  });
  const syncSourceEl = q<HTMLDivElement>('.sync-source');

  // Drag by the header, keeping the panel inside the stage.
  let drag: { pointerId: number; dx: number; dy: number } | null = null;
  root.querySelector('.panel-head')?.addEventListener('pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if ((pointer.target as HTMLElement).closest('button')) return;
    const rect = root.getBoundingClientRect();
    drag = { pointerId: pointer.pointerId, dx: pointer.clientX - rect.left, dy: pointer.clientY - rect.top };
    (event.currentTarget as HTMLElement).setPointerCapture(pointer.pointerId);
    event.preventDefault();
  });
  root.querySelector('.panel-head')?.addEventListener('pointermove', (event) => {
    if (!drag || (event as PointerEvent).pointerId !== drag.pointerId) return;
    const pointer = event as PointerEvent;
    const left = clamp(pointer.clientX - drag.dx, 0, window.innerWidth - 90);
    const top = clamp(pointer.clientY - drag.dy, 0, window.innerHeight - 40);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = 'auto';
  });
  const endDrag = (event: Event): void => {
    if (drag && (event as PointerEvent).pointerId !== drag.pointerId) return;
    drag = null;
  };
  root.querySelector('.panel-head')?.addEventListener('pointerup', endDrag);
  root.querySelector('.panel-head')?.addEventListener('pointercancel', endDrag);

  return {
    root,
    update(
      state: GhostState,
      profile: DomainProfile,
      target: string | null,
      locked: boolean,
      syncLabel: string,
    ): void {
      root.classList.toggle('locked', locked);
      panelMode.textContent = locked ? 'Зафиксировано' : 'Свободно';
      targetLabel.textContent = target ?? 'Холст не выбран';
      parentBtn.disabled = !target;
      lockBtn.textContent = locked ? 'Редактировать' : 'Зафиксировать';
      visibilityBtn.textContent = state.visible ? 'Скрыть' : 'Показать';
      if (document.activeElement !== modeSelect) modeSelect.value = profile.syncMode;
      if (document.activeElement !== anchorSelect) anchorSelect.value = profile.anchor;
      syncSourceEl.textContent = syncLabel;
      syncSourceEl.dataset.active = locked ? '1' : '0';

      const values: Record<RangeKey, number> = {
        opacity: Math.round(state.opacity * 100),
        rotation: Math.round(state.rotation),
        brightness: Math.round(state.brightness * 100),
        contrast: Math.round(state.contrast * 100),
        sensitivity: Math.round(profile.zoomSensitivity * 100),
      };
      ranges.forEach((input, key) => {
        const value = values[key];
        if (!input.matches(':focus')) input.value = String(value);
        const output = input.parentElement?.querySelector('output');
        if (output) output.textContent = RANGE_DISPLAY.get(key)?.(value) ?? String(value);
      });

      checks.get('grayscale')!.checked = state.grayscale;
      checks.get('edges')!.checked = state.edges;
      checks.get('flipH')!.checked = state.flipH;
      checks.get('flipV')!.checked = state.flipV;
      checks.get('saveSession')!.checked = profile.saveSession;
    },
    setStatus(text: string): void {
      statusEl.textContent = text;
      statusEl.dataset.visible = text ? '1' : '0';
    },
    contains(node: EventTarget | null): boolean {
      return node instanceof Node && root.contains(node);
    },
  };
}