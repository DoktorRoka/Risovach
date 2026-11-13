import type { AnchorMode } from '../shared/types';
import type { ViewState } from './viewSync';

let anchorMode: AnchorMode = 'center';

export function setAdapterAnchor(mode: AnchorMode): void {
  anchorMode = mode;
}

/**
 * Latest view transform received from the main-world companion script. Content
 * scripts run in an isolated world, so site globals like `window.sketch` are
 * only reachable through that bridge.
 */
let bridgeView: ViewState | null = null;

export function setBridgeView(view: ViewState | null): void {
  bridgeView = view;
}

/**
 * A per-site adapter reproduces the editor's own artwork->screen transform.
 * All reads are defensive: any missing global or markup simply yields null and
 * the caller falls back to rectangle tracking or gesture sync.
 */
export interface SiteAdapter {
  readonly id: string;
  readonly label: string;
  matches(host: string): boolean;
  findCanvas(doc: Document): Element | null;
  /** Current view transform, or null when the site's state is unavailable yet. */
  read(doc: Document): ViewState | null;
  /** Called when the ghost is locked, so a baseline zoom can be captured. */
  reset?(doc: Document): void;
  /** Optional listeners needed to observe gestures the site does not publish. */
  attach?(): void;
  detach?(): void;
}

/** Largest sufficiently visible <canvas> on the page. */
function largestCanvas(doc: Document): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(doc.querySelectorAll('canvas'))) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const area = r.width * r.height;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Sketchpad / Sketch.io. Verified: scale is the document zoom and the offset is
 * the canvas rect plus the document's own `viewport` origin. Both live on page
 * globals, so the values arrive through the MAIN-world bridge.
 */
const sketchpadAdapter: SiteAdapter = {
  id: 'sketchpad',
  label: 'Sketchpad',
  matches: (host) => /(^|\.)sketchpad\.app$/.test(host) || /(^|\.)sketch\.io$/.test(host),
  findCanvas: (doc) => largestCanvas(doc),
  read: () => bridgeView,
};

/**
 * Loneti (/draw). The zoom percentage is published in the DOM and changes in
 * 20% steps, while the zoom is anchored at the cursor (verified by matching the
 * canvas row profile before and after a wheel zoom). The absolute offset is not
 * published, so it is integrated step by step from the wheel position; the
 * offset then cancels out in artwork coordinates.
 */
let lonetiScale = 1;
let lonetiOx = 0;
let lonetiOy = 0;
let lonetiLast: number | null = null;
let lonetiPointer: { x: number; y: number } | null = null;
let lonetiAttached = false;

function onLonetiWheel(event: WheelEvent): void {
  lonetiPointer = { x: event.clientX, y: event.clientY };
}

function lonetiAnchor(rect: DOMRect): { x: number; y: number } {
  if (anchorMode === 'origin') return { x: rect.left, y: rect.top };
  if (anchorMode === 'cursor' && lonetiPointer) return { ...lonetiPointer };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const lonetiAdapter: SiteAdapter = {
  id: 'loneti',
  label: 'Loneti',
  matches: (host) => host === 'loneti.ru' || host.endsWith('.loneti.ru'),
  findCanvas: (doc) => doc.querySelector('.js--work-canvas') ?? largestCanvas(doc),
  attach: () => {
    if (lonetiAttached) return;
    lonetiAttached = true;
    window.addEventListener('wheel', onLonetiWheel, { capture: true, passive: true });
  },
  detach: () => {
    if (!lonetiAttached) return;
    lonetiAttached = false;
    window.removeEventListener('wheel', onLonetiWheel, { capture: true });
  },
  reset: (doc) => {
    const el = doc.querySelector('.cont-zoom__current');
    const pct = parseFloat(el?.textContent ?? '');
    lonetiLast = isFinite(pct) && pct > 0 ? pct / 100 : null;
    lonetiScale = lonetiLast ?? 1;
    lonetiOx = 0;
    lonetiOy = 0;
  },
  read: (doc) => {
    const el = doc.querySelector('.cont-zoom__current');
    const pct = parseFloat(el?.textContent ?? '');
    if (!isFinite(pct) || pct <= 0) return null;
    const scale = pct / 100;
    const canvas = lonetiAdapter.findCanvas(doc);
    if (!canvas) return null;
    if (lonetiLast === null) {
      lonetiLast = scale;
      lonetiScale = scale;
    } else if (Math.abs(scale - lonetiLast) > 1e-6) {
      const a = lonetiAnchor(canvas.getBoundingClientRect());
      const k = scale / lonetiLast;
      lonetiOx = a.x + (lonetiOx - a.x) * k;
      lonetiOy = a.y + (lonetiOy - a.y) * k;
      lonetiLast = scale;
      lonetiScale = scale;
    }
    return { scale: lonetiScale, offsetX: lonetiOx, offsetY: lonetiOy };
  },
};

/**
 * Draw.Chat (the Sketchpad engine). Its URL hash carries the whole view:
 * `p<page>,<panX>,<panY>` and `s<scale>`. Zoom keeps the canvas centre fixed and
 * pan is stored in artwork units, so the transform is
 *   offset = centre * (1 - scale) - pan * scale.
 * Verified against a painted mark across zoom and pan (error < 0.3 px).
 */
function drawChatView(doc: Document): ViewState | null {
  const hash = window.location.hash;
  const scaleMatch = /(?:^|[#,&])s(\d+(?:\.\d+)?)/.exec(hash);
  const panMatch = /(?:^|[#,&])p\d+,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(hash);
  if (!scaleMatch) return null;
  const scale = parseFloat(scaleMatch[1]);
  if (!isFinite(scale) || scale <= 0) return null;
  const panX = panMatch ? parseFloat(panMatch[1]) : 0;
  const panY = panMatch ? parseFloat(panMatch[2]) : 0;
  const canvas = doc.querySelector('#canvas') ?? largestCanvas(doc);
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return {
    scale,
    offsetX: cx * (1 - scale) - panX * scale,
    offsetY: cy * (1 - scale) - panY * scale,
  };
}

const drawChatAdapter: SiteAdapter = {
  id: 'draw-chat',
  label: 'Draw.Chat',
  matches: (host) => host === 'draw.chat' || host.endsWith('.draw.chat'),
  findCanvas: (doc) => doc.querySelector('#canvas') ?? largestCanvas(doc),
  read: (doc) => drawChatView(doc),
};

const adapters: SiteAdapter[] = [sketchpadAdapter, lonetiAdapter, drawChatAdapter];

export function adapterForHost(host: string): SiteAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(host));
}
