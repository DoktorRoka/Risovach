/**
 * Main-world companion (manifest content script with "world": "MAIN").
 *
 * Content scripts live in an isolated world and cannot see page globals such
 * as `window.sketch`. This script runs in the page's own world, reads the
 * editor's view transform and forwards it to the content script via
 * `postMessage`. It only posts when the transform actually changed, so an idle
 * page costs almost no CPU.
 */
interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const HOST = location.hostname;
const CHANNEL = '__risovach_view';

function largestCanvas(): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const el of Array.from(document.querySelectorAll('canvas'))) {
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

interface SketchDocLike {
  orient?: { zoom?: { value?: number } };
  viewport?: { x?: number; y?: number };
}

/**
 * Sketchpad / Sketch.io. Verified: scale is the document zoom and the offset
 * is the canvas rect plus the document's own `viewport` origin.
 */
function sketchpadView(): ViewState | null {
  const doc = (window as unknown as { sketch?: { doc?: SketchDocLike } }).sketch?.doc;
  const zoom = doc?.orient?.zoom?.value;
  const vp = doc?.viewport;
  if (typeof zoom !== 'number' || !isFinite(zoom) || zoom <= 0) return null;
  if (typeof vp?.x !== 'number' || typeof vp?.y !== 'number') return null;
  const canvas = largestCanvas();
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  return { scale: zoom, offsetX: r.left + vp.x, offsetY: r.top + vp.y };
}

const readers: { match: RegExp; read: () => ViewState | null }[] = [
  { match: /(^|\.)sketchpad\.app$/, read: sketchpadView },
  { match: /(^|\.)sketch\.io$/, read: sketchpadView },
];

const reader = readers.find((entry) => entry.match.test(HOST));

if (reader) {
  let lastKey = '\u0000';
  const tick = (): void => {
    let view: ViewState | null = null;
    try {
      view = reader.read();
    } catch {
      view = null;
    }
    const key = view ? `${view.scale}|${view.offsetX}|${view.offsetY}` : '';
    if (key !== lastKey) {
      lastKey = key;
      window.postMessage({ [CHANNEL]: true, host: HOST, view }, '*');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
