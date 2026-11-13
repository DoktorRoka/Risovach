import type { CommandName, ContentMessage, ContentResponse } from '../shared/messages';
import { currentHost, debounce, getProfile, getSettings, saveProfile, saveSettings } from '../shared/storage';
import {
  cloneGhost,
  createDefaultProfile,
  DEFAULT_GHOST,
  type DomainProfile,
  type GhostState,
  type Rect,
} from '../shared/types';
import { CanvasTracker } from './canvasTracker';
import { buildEdges, loadImage, normalizeImage } from './filters';
import { clamp, cssSelector, describeElement, fromRel, toRel } from './geometry';
import { GestureSync } from './gestureSync';
import { Overlay } from './overlay';
import { adapterForHost, setAdapterAnchor, setBridgeView, type SiteAdapter } from './siteAdapter';
import { artToView, viewToArt, viewsEqual, type ViewState } from './viewSync';

const HOLD_KEY = 'Backquote';
const GLOBAL_KEY = '__risovachInjected';

class App {
  private host = 'unknown';
  private profile: DomainProfile = createDefaultProfile();
  private state: GhostState = cloneGhost(DEFAULT_GHOST);
  private base = { width: 0, height: 0 };
  private imageDataUrl: string | null = null;
  private edgesUrl: string | null = null;
  private edgesToken = 0;
  private enabled = true;
  private locked = false;
  private panelHover = false;
  private restoreVisible: boolean | null = null;
  private statusTimer = 0;

  private adapter: SiteAdapter | undefined;
  private activeSource: 'none' | 'rect' | 'adapter' | 'gesture' = 'none';
  private viewRaf = 0;
  private lastView: ViewState | null = null;
  private readonly gesture = new GestureSync(() => this.handleGestureView());

  private overlay!: Overlay;
  private readonly tracker = new CanvasTracker(
    (rect) => this.handleCanvasRect(rect),
    () => this.handleTargetLost(),
  );
  private readonly scheduleSave = debounce(() => {
    void this.saveNow();
  }, 700);

  async init(): Promise<void> {
    this.host = currentHost();
    const [settings, profile] = await Promise.all([getSettings(), getProfile(this.host)]);
    this.enabled = settings.enabled;
    this.profile = profile;
    this.state = cloneGhost(profile.ghost ?? DEFAULT_GHOST);
    this.adapter = adapterForHost(this.host);
    setAdapterAnchor(this.profile.anchor);
    this.gesture.sensitivity = this.profile.zoomSensitivity;

    const isTop = window.top === window.self;
    const hasSaved = Boolean(profile.selector || profile.image);
    if (!isTop && !hasSaved && !document.querySelector('canvas')) return;

    this.overlay = new Overlay({
      onFile: (file) => void this.setImageFromBlob(file),
      onPickCanvas: () => void this.pickCanvas(),
      onToggleLock: () => this.toggleLock(),
      onToggleVisibility: () => this.toggleVisibility(),
      onReset: () => this.reset(),
      onParentTarget: () => this.useParentTarget(),
      onRebind: () => this.rebind(),
      onGhostChange: (patch) => this.applyGhostPatch(patch),
      onProfileChange: (patch) => this.applyProfilePatch(patch),
      onGhostRect: (rect) => this.applyGhostRect(rect),
    });
    this.overlay.mount();
    this.overlay.setVisible(this.enabled);
    this.overlay.panel.root.addEventListener('pointerenter', () => {
      this.panelHover = true;
    });
    this.overlay.panel.root.addEventListener('pointerleave', () => {
      this.panelHover = false;
    });

    if (profile.selector) {
      this.tracker.setTarget(this.resolveSelector(profile.selector), profile.selector);
    } else if (this.adapter) {
      const auto = this.adapter.findCanvas(document);
      if (auto) {
        this.profile.selector = cssSelector(auto);
        this.tracker.setTarget(auto, this.profile.selector);
      }
    }

    if (profile.image) {
      try {
        const img = await loadImage(profile.image);
        await this.adoptImage(profile.image, img.naturalWidth, img.naturalHeight, !profile.ghost);
      } catch {
        this.panelStatus('Сохранённая картинка не читается');
      }
    }

    if (this.state.art && this.adapter && (this.profile.syncMode === 'auto' || this.profile.syncMode === 'siteAdapter')) {
      this.locked = true;
      this.activeSource = 'adapter';
      this.lastView = this.adapter.read(document);
      if (this.enabled) this.startViewLoop();
    } else if (this.state.art && this.profile.syncMode === 'gestureSync') {
      this.locked = true;
      this.activeSource = 'gesture';
      this.state.art = { ...this.state.rect };
      if (this.enabled) this.gesture.start();
    } else if (this.state.rel && this.targetElement()) {
      this.locked = true;
      this.activeSource = 'rect';
      if (this.enabled) this.tracker.start();
    } else {
      this.state.rel = null;
      this.state.art = null;
    }

    this.installGlobalListeners();
    if (this.enabled) this.adapter?.attach?.();
    this.refreshUi();
  }

  // ----- image ---------------------------------------------------------

  private async setImageFromBlob(blob: Blob): Promise<void> {
    try {
      const loaded = await normalizeImage(blob);
      await this.applyNewImage(loaded.dataUrl, loaded.width, loaded.height);
    } catch (error) {
      this.panelStatus(errorMessage(error));
    }
  }

  private async setImageFromDataUrl(dataUrl: string): Promise<ContentResponse> {
    try {
      const loaded = await normalizeImage(dataUrl);
      await this.applyNewImage(loaded.dataUrl, loaded.width, loaded.height);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async applyNewImage(dataUrl: string, width: number, height: number): Promise<void> {
    this.profile.image = dataUrl;
    this.imageDataUrl = dataUrl;
    this.state.visible = true;
    if (this.state.edges) {
      this.revokeEdges();
      this.edgesUrl = null;
    }
    await this.adoptImage(dataUrl, width, height, true);
    this.panelStatus(`Картинка ${width}×${height}`);
    await this.saveNow();
  }

  private async adoptImage(dataUrl: string, width: number, height: number, resetRect: boolean): Promise<void> {
    this.imageDataUrl = dataUrl;
    this.base = { width, height };
    this.overlay.setBase(width, height);
    this.overlay.setSource(dataUrl);

    if (resetRect) {
      this.state.rect = this.defaultRect(width, height);
      this.state.rel = null;
      this.locked = false;
      this.tracker.stop();
    }

    if (this.state.edges) void this.buildEdgesNow();
    this.refreshUi();
  }

  private defaultRect(imageWidth: number, imageHeight: number): Rect {
    const area =
      this.tracker.readRect() ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const scale = Math.min((area.width * 0.6) / imageWidth, (area.height * 0.6) / imageHeight, 1);
    const width = Math.max(1, imageWidth * scale);
    const height = Math.max(1, imageHeight * scale);
    return {
      x: area.x + (area.width - width) / 2,
      y: area.y + (area.height - height) / 2,
      width,
      height,
    };
  }

  // ----- canvas tracking ----------------------------------------------

  private resolveSelector(selector: string): Element | null {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  private targetElement(): Element | null {
    const current = this.tracker.getTarget();
    if (current?.isConnected) return current;
    if (this.profile.selector) {
      const found = this.resolveSelector(this.profile.selector);
      if (found) {
        this.tracker.setTarget(found, this.profile.selector);
        return found;
      }
    }
    return null;
  }

  private handleCanvasRect(rect: Rect): void {
    if (!this.locked || this.activeSource !== 'rect' || !this.state.rel) return;
    this.state.rect = fromRel(this.state.rel, rect);
    this.overlay.render(this.state);
  }

  private handleTargetLost(): void {
    if (!this.locked) return;
    this.panelStatus('Холст пропал со страницы');
  }

  private async pickCanvas(): Promise<void> {
    const chosen = await this.overlay.beginPick();
    if (!chosen) return;
    const selector = cssSelector(chosen);
    this.profile.selector = selector;
    this.tracker.setTarget(chosen, selector);
    if (this.locked) this.rebind();
    this.panelStatus(`Холст: ${describeElement(chosen)}`);
    this.refreshUi();
    this.scheduleSave();
  }

  private useParentTarget(): void {
    const current = this.targetElement();
    const parent = current?.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) return;
    const selector = cssSelector(parent);
    this.profile.selector = selector;
    this.tracker.setTarget(parent, selector);
    if (this.locked) this.rebind();
    this.panelStatus(`Холст: ${describeElement(parent)}`);
    this.refreshUi();
    this.scheduleSave();
  }

  // ----- modes ---------------------------------------------------------

  private toggleLock(): void {
    if (!this.imageDataUrl) {
      this.panelStatus('Сначала загрузите картинку');
      return;
    }
    if (this.locked) this.unlock();
    else this.lock();
  }

  private effectiveMode(): 'adapter' | 'gesture' | 'rect' {
    switch (this.profile.syncMode) {
      case 'rectTracking':
        return 'rect';
      case 'gestureSync':
        return 'gesture';
      case 'siteAdapter':
        return this.adapter ? 'adapter' : 'gesture';
      default:
        return this.adapter ? 'adapter' : 'rect';
    }
  }

  private lock(): void {
    if (this.locked) return;
    const mode = this.effectiveMode();

    if (mode === 'gesture') {
      this.state.art = { ...this.state.rect };
      this.state.rel = null;
      this.locked = true;
      this.activeSource = 'gesture';
      this.gesture.reset();
      this.gesture.start();
      this.panelStatus('Зафиксировано — жесты: колесо = зум, СКМ = пан');
      this.refreshUi();
      this.scheduleSave();
      return;
    }

    if (mode === 'adapter' && this.adapter) {
      this.adapter.reset?.(document);
      const view = this.adapter.read(document);
      if (view) {
        this.state.art = viewToArt(this.state.rect, view);
        this.state.rel = null;
        this.locked = true;
        this.activeSource = 'adapter';
        this.lastView = view;
        this.startViewLoop();
        this.panelStatus(`Зафиксировано — ${this.adapter.label}`);
        this.refreshUi();
        this.scheduleSave();
        return;
      }
      // Known site but no readable zoom yet: fall back to rectangle tracking.
      this.panelStatus('Профиль сайта недоступен — включён режим «Прямоугольник»');
    }

    const rect = this.tracker.readRect();
    if (!rect) {
      this.panelStatus('Укажите холст кнопкой «Указать холст»');
      return;
    }
    this.state.rel = toRel(this.state.rect, rect);
    this.state.art = null;
    this.locked = true;
    this.activeSource = 'rect';
    this.tracker.start();
    this.panelStatus('Зафиксировано — рисуйте сквозь фантом');
    this.refreshUi();
    this.scheduleSave();
  }

  private unlock(): void {
    this.state.rel = null;
    this.state.art = null;
    this.locked = false;
    this.activeSource = 'none';
    this.tracker.stop();
    this.gesture.stop();
    this.stopViewLoop();
    this.lastView = null;
    this.panelStatus('Режим настройки');
    this.refreshUi();
    this.scheduleSave();
  }

  /** Re-anchors the ghost at its current screen position with the current transform. */
  private rebind(): void {
    if (!this.locked) {
      this.lock();
      return;
    }
    if (this.activeSource === 'adapter' && this.adapter) {
      const view = this.adapter.read(document);
      if (view) {
        this.state.art = viewToArt(this.state.rect, view);
        this.lastView = view;
      }
    } else if (this.activeSource === 'gesture') {
      this.state.art = viewToArt(this.state.rect, this.gesture.view);
    } else if (this.state.rel) {
      const rect = this.tracker.readRect();
      if (rect) this.state.rel = toRel(this.state.rect, rect);
    }
    this.panelStatus('Привязка обновлена');
    this.refreshUi();
    this.scheduleSave();
  }

  private startViewLoop(): void {
    if (this.viewRaf) return;
    this.viewRaf = requestAnimationFrame(this.tickView);
  }

  private stopViewLoop(): void {
    if (this.viewRaf) cancelAnimationFrame(this.viewRaf);
    this.viewRaf = 0;
  }

  private readonly tickView = (): void => {
    if (!this.locked || this.activeSource !== 'adapter' || !this.adapter || !this.state.art) {
      this.viewRaf = 0;
      return;
    }
    const view = this.adapter.read(document);
    if (view && !viewsEqual(view, this.lastView)) {
      this.lastView = view;
      this.state.rect = artToView(this.state.art, view);
      this.overlay.render(this.state);
    }
    this.viewRaf = requestAnimationFrame(this.tickView);
  };

  private handleGestureView(): void {
    if (!this.locked || this.activeSource !== 'gesture' || !this.state.art) return;
    this.state.rect = artToView(this.state.art, this.gesture.view);
    this.overlay.render(this.state);
  }

  private toggleVisibility(): void {
    this.state.visible = !this.state.visible;
    this.refreshUi();
    this.scheduleSave();
  }

  private reset(): void {
    const rect = this.base.width
      ? this.defaultRect(this.base.width, this.base.height)
      : { ...DEFAULT_GHOST.rect };
    this.state = { ...cloneGhost(DEFAULT_GHOST), rect };
    this.locked = false;
    this.activeSource = 'none';
    this.lastView = null;
    this.tracker.stop();
    this.gesture.stop();
    this.stopViewLoop();
    this.edgesToken += 1;
    this.revokeEdges();
    this.edgesUrl = null;
    if (this.imageDataUrl) this.overlay.setSource(this.imageDataUrl);
    this.panelStatus('Сброшено');
    this.refreshUi();
    this.scheduleSave();
  }

  private applyGhostRect(rect: Rect): void {
    if (this.locked) return;
    this.state.rect = {
      x: rect.x,
      y: rect.y,
      width: Math.max(16, rect.width),
      height: Math.max(16, rect.height),
    };
    this.overlay.render(this.state);
    this.scheduleSave();
  }

  private applyGhostPatch(patch: Partial<GhostState>): void {
    Object.assign(this.state, patch);
    if (patch.edges !== undefined) {
      if (patch.edges) void this.buildEdgesNow();
      else {
        this.edgesToken += 1;
        this.revokeEdges();
        this.edgesUrl = null;
        if (this.imageDataUrl) this.overlay.setSource(this.imageDataUrl);
      }
    }
    this.refreshUi();
    this.scheduleSave();
  }

  private applyProfilePatch(patch: Partial<DomainProfile>): void {
    const prevMode = this.profile.syncMode;
    Object.assign(this.profile, patch);
    if (patch.anchor !== undefined) setAdapterAnchor(this.profile.anchor);
    if (patch.zoomSensitivity !== undefined) this.gesture.sensitivity = this.profile.zoomSensitivity;
    if (patch.anchor !== undefined && this.locked && this.activeSource === 'adapter' && this.adapter) {
      const view = this.adapter.read(document);
      if (view) {
        this.state.art = viewToArt(this.state.rect, view);
        this.lastView = view;
      }
    }
    if (patch.syncMode !== undefined && this.locked && patch.syncMode !== prevMode) {
      this.unlock();
      this.lock();
      return;
    }
    this.refreshUi();
    this.scheduleSave();
  }

  // ----- edges ---------------------------------------------------------

  private async buildEdgesNow(): Promise<void> {
    if (!this.imageDataUrl) {
      this.state.edges = false;
      this.panelStatus('Сначала загрузите картинку');
      this.refreshUi();
      return;
    }
    const token = ++this.edgesToken;
    this.overlay.panel.setStatus('Строю контуры…');
    try {
      const url = await buildEdges(this.imageDataUrl);
      if (token !== this.edgesToken) {
        URL.revokeObjectURL(url);
        return;
      }
      this.revokeEdges();
      this.edgesUrl = url;
      this.overlay.setSource(url);
      this.overlay.setEdgesOn(true);
      this.panelStatus('Контуры включены');
    } catch (error) {
      this.state.edges = false;
      this.panelStatus(errorMessage(error));
      this.refreshUi();
    }
  }

  private revokeEdges(): void {
    if (this.edgesUrl) {
      URL.revokeObjectURL(this.edgesUrl);
      this.edgesUrl = null;
    }
  }

  // ----- persistence ---------------------------------------------------

  private async saveNow(): Promise<void> {
    const keep = this.profile.saveSession;
    const toStore: DomainProfile = {
      ...this.profile,
      image: keep ? this.imageDataUrl : null,
      ghost: keep ? cloneGhost(this.state) : null,
    };
    this.profile = { ...this.profile, image: toStore.image, ghost: toStore.ghost };
    await saveProfile(this.host, toStore);
  }

  // ----- UI ------------------------------------------------------------

  private refreshUi(): void {
    if (!this.overlay) return;
    this.overlay.setBase(this.base.width, this.base.height);
    this.overlay.setEdgesOn(this.state.edges);
    this.overlay.setMode(this.locked ? 'locked' : 'edit');
    this.overlay.render(this.state);
    const target = this.targetElement();
    const label = target
      ? describeElement(target)
      : this.profile.selector
        ? `${this.profile.selector} — не найден`
        : null;
    this.overlay.panel.update(this.state, this.profile, label, this.locked, this.syncLabel());
  }

  private syncLabel(): string {
    if (this.locked) {
      switch (this.activeSource) {
        case 'adapter':
          return `Активно: ${this.adapter?.label ?? 'профиль сайта'}`;
        case 'gesture':
          return 'Активно: жесты (колесо / СКМ)';
        case 'rect':
          return 'Активно: прямоугольник холста';
        default:
          return 'Синхронизация не активна';
      }
    }
    if (this.profile.syncMode === 'auto') {
      return this.adapter ? `Авто: профиль «${this.adapter.label}»` : 'Авто: прямоугольник холста';
    }
    return 'Синхронизация не активна';
  }

  private panelStatus(text: string): void {
    if (!this.overlay) return;
    if (this.statusTimer) window.clearTimeout(this.statusTimer);
    this.overlay.panel.setStatus(text);
    if (!text) return;
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = 0;
      this.overlay?.panel.setStatus('');
    }, 2600);
  }

  // ----- input ---------------------------------------------------------

  private installGlobalListeners(): void {
    document.addEventListener(
      'paste',
      (event) => {
        if (!this.enabled) return;
        const items = event.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (!item.type.startsWith('image/')) continue;
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            void this.setImageFromBlob(file);
            return;
          }
        }
      },
      true,
    );

    window.addEventListener(
      'dragover',
      (event) => {
        if (!this.enabled) return;
        if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
      },
      true,
    );

    window.addEventListener(
      'drop',
      (event) => {
        if (!this.enabled) return;
        const file = event.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) {
          event.preventDefault();
          void this.setImageFromBlob(file);
        }
      },
      true,
    );

    document.addEventListener('keydown', (event) => this.handleKeyDown(event), true);
    document.addEventListener('keyup', (event) => this.handleKeyUp(event), true);

    // View transform forwarded by the MAIN-world companion script (isolated
    // worlds cannot read page globals such as `window.sketch`).
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data as { __risovach_view?: boolean; host?: string; view?: ViewState | null } | null;
      if (!data || data.__risovach_view !== true) return;
      if (data.host !== this.host) return;
      setBridgeView(data.view ?? null);
    });
    window.addEventListener('pagehide', () => this.scheduleSave.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.scheduleSave.flush();
    });

    chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
      void this.handleMessage(message).then(sendResponse);
      return true;
    });
  }

  private hotkeysActive(): boolean {
    if (this.locked) return true;
    return this.panelHover;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.enabled) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    if (event.code === HOLD_KEY) {
      if (!event.repeat) {
        this.restoreVisible = this.state.visible;
        this.state.visible = false;
        this.overlay.render(this.state);
      }
      return;
    }

    if (!this.hotkeysActive()) return;

    switch (event.key) {
      case '+':
      case '=':
        this.nudgeOpacity(0.05);
        event.preventDefault();
        break;
      case '-':
      case '_':
        this.nudgeOpacity(-0.05);
        event.preventDefault();
        break;
      case 'ArrowLeft':
        if (this.locked) break;
        this.moveGhost(-(event.shiftKey ? 1 : 10), 0);
        event.preventDefault();
        break;
      case 'ArrowRight':
        if (this.locked) break;
        this.moveGhost(event.shiftKey ? 1 : 10, 0);
        event.preventDefault();
        break;
      case 'ArrowUp':
        if (this.locked) break;
        this.moveGhost(0, -(event.shiftKey ? 1 : 10));
        event.preventDefault();
        break;
      case 'ArrowDown':
        if (this.locked) break;
        this.moveGhost(0, event.shiftKey ? 1 : 10);
        event.preventDefault();
        break;
      default:
        break;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (event.code !== HOLD_KEY) return;
    if (this.restoreVisible !== null) {
      this.state.visible = this.restoreVisible;
      this.restoreVisible = null;
      this.overlay.render(this.state);
    }
  }

  private nudgeOpacity(delta: number): void {
    this.state.opacity = clamp(Math.round((this.state.opacity + delta) * 100) / 100, 0, 1);
    this.refreshUi();
    this.scheduleSave();
  }

  private moveGhost(dx: number, dy: number): void {
    if (this.locked) return;
    this.state.rect = { ...this.state.rect, x: this.state.rect.x + dx, y: this.state.rect.y + dy };
    this.overlay.render(this.state);
    this.scheduleSave();
  }

  private async handleMessage(message: ContentMessage): Promise<ContentResponse> {
    switch (message.type) {
      case 'get-state':
        return { ok: true, enabled: this.enabled, hasImage: Boolean(this.imageDataUrl), locked: this.locked };
      case 'set-enabled':
        this.enabled = message.enabled;
        await saveSettings({ enabled: this.enabled });
        this.overlay.setVisible(this.enabled);
        if (!this.enabled) {
          this.tracker.stop();
          this.gesture.stop();
          this.stopViewLoop();
          this.adapter?.detach?.();
        } else {
          this.adapter?.attach?.();
          if (this.locked) {
            if (this.activeSource === 'rect') this.tracker.start();
            else if (this.activeSource === 'gesture') this.gesture.start();
            else if (this.activeSource === 'adapter') this.startViewLoop();
          }
        }
        return { ok: true, enabled: this.enabled };
      case 'set-image': {
        const result = await this.setImageFromDataUrl(message.dataUrl);
        return result.ok
          ? { ok: true, enabled: this.enabled, hasImage: true, locked: this.locked }
          : result;
      }
      case 'command':
        this.runCommand(message.command);
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown message' };
    }
  }

  private runCommand(command: CommandName): void {
    if (!this.enabled) return;
    if (command === 'toggle-lock') this.toggleLock();
    else if (command === 'toggle-visibility') this.toggleVisibility();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const globalWindow = window as unknown as Record<string, unknown>;
if (!globalWindow[GLOBAL_KEY]) {
  globalWindow[GLOBAL_KEY] = true;
  void new App().init();
}