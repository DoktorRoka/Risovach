export interface LoadedImage {
  /** Normalized (static) image as a data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_STORED_SIDE = 2048;
const MAX_EDGE_SIDE = 1600;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = src;
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

/**
 * Normalizes any supported input into a static PNG data URL. GIFs are decoded
 * to their first frame, which is exactly what a drawing reference needs.
 */
export async function normalizeImage(input: string | Blob): Promise<LoadedImage> {
  const blob = typeof input === 'string' ? await dataUrlToBlob(input) : input;
  let width = 0;
  let height = 0;
  let source: ImageBitmap | HTMLImageElement;

  try {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
    source = bitmap;
  } catch {
    const url = typeof input === 'string' ? input : URL.createObjectURL(blob);
    const img = await loadImage(url);
    width = img.naturalWidth;
    height = img.naturalHeight;
    source = img;
    if (typeof input !== 'string') URL.revokeObjectURL(url);
  }

  if (!width || !height) throw new Error('Пустое изображение');

  const scale = Math.min(1, MAX_STORED_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D недоступен');
  ctx.drawImage(source, 0, 0, w, h);
  if ('close' in source && typeof source.close === 'function') source.close();

  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/**
 * Sobel edge detection. Runs once per parameter change, never during zoom.
 * Returns a blob URL with black contours on a transparent background.
 * TODO(v0.4): move to a worker to keep long frames off the main thread.
 */
export async function buildEdges(dataUrl: string, maxSide = MAX_EDGE_SIDE): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D недоступен');
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h).data;

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.length; i += 4, p += 1) {
    gray[p] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  }

  const out = ctx.createImageData(w, h);
  const dst = out.data;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const magnitude = Math.min(255, Math.hypot(gx, gy) * 1.5);
      const o = i * 4;
      dst[o] = 0;
      dst[o + 1] = 0;
      dst[o + 2] = 0;
      dst[o + 3] = magnitude;
    }
  }
  ctx.putImageData(out, 0, 0);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return URL.createObjectURL(blob);
}