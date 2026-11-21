import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { pressButton, ripple } from './buttonFx.ts';
import { onFx, reducedMotion } from './fx.ts';
import type { FxTone } from './fx.ts';
import './fx.css';

interface Popup {
  id: number;
  text: string;
  tone: FxTone;
  x: number;
  y: number;
  size: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  size: number;
  life: number;
  color: string;
}

const MAX_POPUPS = 12;
/** Popup font size at size 1, px. */
const POPUP_FONT_PX = 22;
const MAX_PARTICLES = 400;
const GRAVITY = 0.35;

/**
 * Wraps a page (/play or /floor) and draws the effects asked for through fx.ts: screen shake on the
 * wrapper, floating popups as DOM, particles on one full-screen canvas. The canvas only animates
 * while particles are alive, so an idle page costs nothing. Fixed-position and clipped, so effects
 * never add scrollbars.
 */
export function FxRoot({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef<number | null>(null);
  const nextId = useRef(1);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [flashes, setFlashes] = useState<{ id: number; tone: FxTone; strength: number }[]>([]);

  useEffect(() => {
    const colorOf = (tone: FxTone) => getComputedStyle(document.documentElement).getPropertyValue(`--tg-color-${tone === 'accent' ? 'accent' : tone}`).trim() || '#ffffff';

    const loop = () => {
      const canvas = canvasRef.current;
      const g = canvas?.getContext('2d');
      if (!canvas || !g) {
        frame.current = null;
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const alive: Particle[] = [];
      for (const p of particles.current) {
        p.vy += GRAVITY;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        p.life -= 1;
        if (p.life <= 0 || p.y > h + 40) continue;
        alive.push(p);
        g.save();
        g.globalAlpha = Math.min(1, p.life / 25);
        g.translate(p.x, p.y);
        g.rotate(p.angle);
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        g.restore();
      }
      particles.current = alive;
      frame.current = alive.length > 0 ? requestAnimationFrame(loop) : null;
      if (alive.length === 0) g.clearRect(0, 0, w, h);
    };

    const stop = onFx((e) => {
      if (e.kind === 'popup') {
        const id = nextId.current++;
        const size = e.size ?? 1;
        // Keep the whole text on screen: half its (approximate) width from each edge.
        const half = Math.min(window.innerWidth / 2, (e.text.length * size * POPUP_FONT_PX * 0.62) / 2 + 8);
        const x = Math.min(window.innerWidth - half, Math.max(half, e.x));
        const y = Math.min(window.innerHeight - 30, Math.max(60, e.y));
        setPopups((list) => [...list.slice(-(MAX_POPUPS - 1)), { id, text: e.text, tone: e.tone, x, y, size }]);
        return;
      }
      if (e.kind === 'flash') {
        const id = nextId.current++;
        setFlashes((list) => [...list.slice(-3), { id, tone: e.tone, strength: e.strength }]);
        return;
      }
      if (reducedMotion()) return;
      if (e.kind === 'chroma' || e.kind === 'punch') {
        const el = rootRef.current?.firstElementChild as HTMLElement | null | undefined;
        if (!el) return;
        if (e.kind === 'chroma') {
          const d = 2 + 5 * e.strength;
          el.animate(
            [
              { filter: `drop-shadow(${d}px 0 0 rgb(255 40 80 / 0.75)) drop-shadow(${-d}px 0 0 rgb(40 220 255 / 0.75))` },
              { filter: `drop-shadow(${-d / 2}px 0 0 rgb(255 40 80 / 0.5)) drop-shadow(${d / 2}px 0 0 rgb(40 220 255 / 0.5))`, offset: 0.5 },
              { filter: 'none' },
            ],
            { duration: 220 + 180 * e.strength, easing: 'ease-out' },
          );
        } else {
          // Freeze (no change for the first part), then a zoom punch that settles.
          const hold = 70 + 90 * e.strength;
          const total = hold + 320;
          const at = hold / total;
          el.animate(
            [
              { scale: '1', filter: 'brightness(1.6) saturate(1.4)' },
              { scale: '1', filter: 'brightness(1.6) saturate(1.4)', offset: at },
              { scale: String(1 + 0.025 * e.strength), filter: 'brightness(1.15)', offset: at + (1 - at) * 0.3 },
              { scale: '1', filter: 'none' },
            ],
            { duration: total, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
          );
        }
        return;
      }
      if (e.kind === 'shake') {
        const el = rootRef.current;
        if (!el) return;
        el.classList.remove('fx-root--shaking');
        el.style.setProperty('--fx-shake', `${e.distance}px`);
        el.style.setProperty('--fx-shake-angle', `${e.distance / 40}deg`);
        el.style.setProperty('--fx-shake-time', `${e.duration}ms`);
        void el.offsetWidth; // restart the animation
        el.classList.add('fx-root--shaking');
        return;
      }
      const color = colorOf(e.tone);
      const count = Math.min(e.count ?? 24, MAX_PARTICLES - particles.current.length);
      const power = e.power ?? 7;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = power * (0.4 + Math.random() * 0.8);
        particles.current.push({
          x: e.x,
          y: e.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - power * 0.6,
          spin: (Math.random() - 0.5) * 0.4,
          angle: Math.random() * Math.PI,
          size: 5 + Math.random() * 6,
          life: 45 + Math.random() * 35,
          color,
        });
      }
      if (frame.current === null) frame.current = requestAnimationFrame(loop);
    });
    return () => {
      stop();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="fx-root"
      onClickCapture={(ev) => {
        const button = ev.target instanceof Element ? ev.target.closest('button') : null;
        if (button) pressButton(button);
      }}
      onPointerDownCapture={(ev) => {
        if (ev.button === 0 && ev.target instanceof Element) ripple(ev.target, ev.clientX, ev.clientY);
      }}
      onAnimationEnd={(ev) => {
        if (ev.animationName === 'fx-shake' && ev.target === rootRef.current?.firstElementChild) {
          rootRef.current?.classList.remove('fx-root--shaking');
        }
      }}
    >
      {children}
      <div className="fx-layer" aria-hidden="true">
        {flashes.map((f) => (
          <span
            key={f.id}
            className={`fx-flash fx-flash--${f.tone}${f.strength >= 0.7 ? ' fx-flash--wash' : ''}`}
            style={{ '--fx-flash': String(0.25 + 0.75 * f.strength) } as CSSProperties}
            onAnimationEnd={() => setFlashes((list) => list.filter((x) => x.id !== f.id))}
          />
        ))}
        <canvas ref={canvasRef} className="fx-canvas" />
        {popups.map((p) => (
          <span
            key={p.id}
            className={`fx-popup fx-popup--${p.tone}`}
            style={{ left: p.x, top: p.y, fontSize: `${(p.size * POPUP_FONT_PX).toFixed(0)}px` }}
            onAnimationEnd={() => setPopups((list) => list.filter((x) => x.id !== p.id))}
          >
            {p.text}
          </span>
        ))}
      </div>
      <div className="fx-crt" aria-hidden="true" />
    </div>
  );
}
