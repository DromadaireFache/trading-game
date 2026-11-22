/**
 * The effects bus: anything on the page can ask for a shake, a floating popup or a particle burst;
 * <FxLayer> (mounted once per page) draws them. Fire-and-forget, never throws.
 *
 * Tones map to theme colors: up / down / accent / info / warn.
 */

export type FxTone = 'up' | 'down' | 'accent' | 'info' | 'warn';

export interface PopupFx {
  text: string;
  tone: FxTone;
  /** Viewport point the popup rises from. */
  x: number;
  y: number;
  /** 1 = normal, 2 = big. */
  size?: number;
  /** Money from a trade: drawn as a chip (a tilted tag with an ink outline), Balatro score style. */
  chip?: boolean;
}

export interface BurstFx {
  x: number;
  y: number;
  tone: FxTone;
  /** Number of particles. */
  count?: number;
  /** Spread speed, px per frame at 60 fps. */
  power?: number;
}

export interface FlashFx {
  tone: FxTone;
  /** 0..1: a faint glow at the screen edges at the low end, a full-screen wash at 1. */
  strength: number;
}

type FxEvent =
  | { kind: 'shake'; distance: number; duration: number }
  | ({ kind: 'popup' } & PopupFx)
  | ({ kind: 'burst' } & BurstFx)
  | ({ kind: 'flash' } & FlashFx)
  | { kind: 'chroma'; strength: number }
  | { kind: 'punch'; strength: number };

const SHAKES = {
  1: { distance: 3, duration: 280 },
  2: { distance: 7, duration: 420 },
  3: { distance: 14, duration: 700 },
};

const listeners = new Set<(e: FxEvent) => void>();

function emit(e: FxEvent): void {
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      // an effect must never break the page
    }
  }
}

export function onFx(listener: (e: FxEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type { FxEvent };

export const fx = {
  shake: (strength: 1 | 2 | 3 = 1, scale = 1) => {
    const { distance, duration } = SHAKES[strength];
    emit({ kind: 'shake', distance: distance * scale, duration });
  },
  popup: (p: PopupFx) => emit({ kind: 'popup', ...p }),
  burst: (b: BurstFx) => emit({ kind: 'burst', ...b }),
  /** A colored glow from the screen edges (green for a win, red for a loss). */
  flash: (f: FlashFx) => emit({ kind: 'flash', tone: f.tone, strength: clamp01(f.strength) }),
  /** Chromatic split: the page doubles into red and cyan copies for a moment. */
  chroma: (strength = 1) => emit({ kind: 'chroma', strength: clamp01(strength) }),
  /** Hit-stop: the page freezes for a beat, then punches in and settles. For the biggest moments. */
  punch: (strength = 1) => emit({ kind: 'punch', strength: clamp01(strength) }),
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Center of the first element matching `selector`, or a fallback point. */
export function anchorOf(selector: string, fallback: { x: number; y: number } = { x: window.innerWidth / 2, y: window.innerHeight / 2 }): { x: number; y: number } {
  const el = document.querySelector(selector);
  if (!el) return fallback;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return fallback;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
