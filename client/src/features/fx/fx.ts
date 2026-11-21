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

type FxEvent = { kind: 'shake'; strength: 1 | 2 | 3 } | ({ kind: 'popup' } & PopupFx) | ({ kind: 'burst' } & BurstFx);

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
  shake: (strength: 1 | 2 | 3 = 1) => emit({ kind: 'shake', strength }),
  popup: (p: PopupFx) => emit({ kind: 'popup', ...p }),
  burst: (b: BurstFx) => emit({ kind: 'burst', ...b }),
};

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
