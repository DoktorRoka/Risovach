import type { GhostState, Rect, RelRect } from '../shared/types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rectsEqual(a: Rect | null, b: Rect | null, eps = 0.25): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}

/** Ghost position stored in canvas coordinates. */
export function toRel(ghost: Rect, canvas: Rect): RelRect {
  return {
    x: (ghost.x - canvas.x) / canvas.width,
    y: (ghost.y - canvas.y) / canvas.height,
    w: ghost.width / canvas.width,
    h: ghost.height / canvas.height,
  };
}

/** Canvas coordinates -> viewport rectangle for the current canvas rect. */
export function fromRel(rel: RelRect, canvas: Rect): Rect {
  return {
    x: canvas.x + rel.x * canvas.width,
    y: canvas.y + rel.y * canvas.height,
    width: rel.w * canvas.width,
    height: rel.h * canvas.height,
  };
}

export function ghostFilters(state: GhostState): string {
  const parts: string[] = [];
  if (state.brightness !== 1) parts.push(`brightness(${state.brightness})`);
  if (state.contrast !== 1) parts.push(`contrast(${state.contrast})`);
  if (state.grayscale) parts.push('grayscale(1)');
  return parts.length ? parts.join(' ') : 'none';
}

/** Builds a stable-enough CSS selector for the picked element. */
export function cssSelector(el: Element): string {
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
    if (node === document.documentElement) {
      parts.unshift('html');
      break;
    }
    let part = node.tagName.toLowerCase();
    if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === node!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls =
    !id && typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
  return `${tag}${id}${cls}`;
}