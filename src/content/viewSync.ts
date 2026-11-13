import type { Rect } from '../shared/types';

/**
 * An affine view transform from "artwork" coordinates to viewport (CSS px)
 * coordinates:  screen = offset + artwork * scale.
 *
 * Site editors that zoom inside the canvas (their DOM rect never changes) still
 * have such a transform internally. A SiteAdapter (or GestureSync) reproduces
 * it so the ghost can be anchored in artwork space.
 */
export interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_VIEW: ViewState = { scale: 1, offsetX: 0, offsetY: 0 };

export function viewToArt(rect: Rect, view: ViewState): Rect {
  const s = view.scale || 1;
  return {
    x: (rect.x - view.offsetX) / s,
    y: (rect.y - view.offsetY) / s,
    width: rect.width / s,
    height: rect.height / s,
  };
}

export function artToView(art: Rect, view: ViewState): Rect {
  return {
    x: view.offsetX + art.x * view.scale,
    y: view.offsetY + art.y * view.scale,
    width: art.width * view.scale,
    height: art.height * view.scale,
  };
}

export function viewsEqual(a: ViewState | null, b: ViewState | null, eps = 0.01): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.scale - b.scale) < eps &&
    Math.abs(a.offsetX - b.offsetX) < eps &&
    Math.abs(a.offsetY - b.offsetY) < eps
  );
}
