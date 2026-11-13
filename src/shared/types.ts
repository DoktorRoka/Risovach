export type SyncMode = 'auto' | 'rectTracking' | 'gestureSync' | 'siteAdapter';

/** Where a zoom gesture keeps its fixed point, when the site does not expose it. */
export type AnchorMode = 'cursor' | 'center' | 'origin';

/** Viewport-space rectangle (CSS pixels). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fractional position of the ghost inside the canvas rect. */
export interface RelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GhostState {
  /** Unrotated ghost rect in viewport coordinates. */
  rect: Rect;
  /** Set only while locked to a tracked canvas rectangle. */
  rel: RelRect | null;
  /** Set only while locked through a view transform (adapter or gestures). */
  art: Rect | null;
  /** Degrees, clockwise, around the ghost centre. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** 0..1 */
  opacity: number;
  /** 1 = unchanged */
  brightness: number;
  /** 1 = unchanged */
  contrast: number;
  grayscale: boolean;
  edges: boolean;
  visible: boolean;
}

export interface DomainProfile {
  selector: string | null;
  syncMode: SyncMode;
  anchor: AnchorMode;
  zoomSensitivity: number;
  saveSession: boolean;
  ghost: GhostState | null;
  /** data: URL of the reference image. */
  image: string | null;
}

export interface AppSettings {
  enabled: boolean;
}

export const DEFAULT_GHOST: GhostState = {
  rect: { x: 120, y: 120, width: 420, height: 420 },
  rel: null,
  art: null,
  rotation: 0,
  flipH: false,
  flipV: false,
  opacity: 0.6,
  brightness: 1,
  contrast: 1,
  grayscale: false,
  edges: false,
  visible: true,
};

export function createDefaultProfile(): DomainProfile {
  return {
    selector: null,
    syncMode: 'auto',
    anchor: 'cursor',
    zoomSensitivity: 1,
    saveSession: true,
    ghost: null,
    image: null,
  };
}

export function cloneGhost(ghost: GhostState): GhostState {
  return {
    ...ghost,
    rect: { ...ghost.rect },
    rel: ghost.rel ? { ...ghost.rel } : null,
    art: ghost.art ? { ...ghost.art } : null,
  };
}