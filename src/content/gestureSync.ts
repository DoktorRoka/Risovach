import type { ViewState } from './viewSync';
import { clamp } from './geometry';

/**
 * Fallback for editors whose zoom is not readable anywhere in the DOM: mirror
 * the user's own gestures. Wheel zooms about the cursor, the middle button pans.
 * The result is an artwork->screen transform just like a SiteAdapter produces.
 */
export class GestureSync {
  private active = false;
  private panPointer: number | null = null;
  private panStart: { x: number; y: number } | null = null;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  sensitivity = 1;
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  get view(): ViewState {
    return { scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY };
  }

  reset(): void {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.onChange();
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: true });
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerUp, true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.panPointer = null;
    this.panStart = null;
    window.removeEventListener('wheel', this.onWheel, { capture: true });
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerUp, true);
  }

  private readonly onWheel = (event: WheelEvent): void => {
    const factor = Math.exp(-event.deltaY * 0.0015 * this.sensitivity);
    const next = clamp(this.scale * factor, 0.05, 40);
    const applied = next / this.scale;
    // Keep the artwork point under the cursor fixed.
    this.offsetX = event.clientX - (event.clientX - this.offsetX) * applied;
    this.offsetY = event.clientY - (event.clientY - this.offsetY) * applied;
    this.scale = next;
    this.onChange();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 1) return;
    this.panPointer = event.pointerId;
    this.panStart = { x: event.clientX, y: event.clientY };
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.panPointer !== event.pointerId || !this.panStart) return;
    this.offsetX += event.clientX - this.panStart.x;
    this.offsetY += event.clientY - this.panStart.y;
    this.panStart = { x: event.clientX, y: event.clientY };
    this.onChange();
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.panPointer !== event.pointerId) return;
    this.panPointer = null;
    this.panStart = null;
  };
}
