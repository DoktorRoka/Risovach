import type { Rect } from '../shared/types';
import { rectsEqual } from './geometry';

/**
 * Watches a target element (a <canvas> or a container) and reports its
 * viewport rectangle. The rect is re-read every animation frame, but the
 * callback fires only when the rect actually changed, which keeps idle CPU
 * near zero.
 */
export class CanvasTracker {
  private element: Element | null = null;
  private selector: string | null = null;
  private raf = 0;
  private running = false;
  private last: Rect | null = null;
  private readonly onRect: (rect: Rect) => void;
  private readonly onLost: () => void;

  constructor(onRect: (rect: Rect) => void, onLost: () => void) {
    this.onRect = onRect;
    this.onLost = onLost;
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  setTarget(element: Element | null, selector: string | null = null): void {
    this.element = element;
    this.selector = selector;
    this.last = null;
  }

  getTarget(): Element | null {
    return this.element;
  }

  readRect(): Rect | null {
    const el = this.resolve();
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = null;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  private resolve(): Element | null {
    if (this.element?.isConnected) return this.element;
    // The site may have replaced the canvas node; try the stored selector.
    if (this.selector) {
      const found = document.querySelector(this.selector);
      if (found) {
        this.element = found;
        return found;
      }
    }
    if (this.element && !this.element.isConnected) {
      this.element = null;
      this.onLost();
    }
    return this.element;
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    if (!document.hidden) {
      const rect = this.readRect();
      if (rect && !rectsEqual(rect, this.last)) {
        this.last = rect;
        this.onRect(rect);
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private readonly handleVisibility = (): void => {
    if (document.hidden) return;
    this.last = null;
  };
}