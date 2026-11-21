import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from './fx.ts';
import { play } from './sound.ts';

interface CountUpProps {
  value: number;
  /** Where the count starts (default 0). */
  from?: number;
  format: (n: number) => string;
  /** Wait before counting, e.g. to follow a row being dealt in. */
  delayMs?: number;
  durationMs?: number;
  /** Tick sounds while counting (one page-wide count at a time sounds best). */
  sound?: boolean;
  className?: string;
}

/**
 * A number that tallies up to its value (ease-out), ticking higher and higher, then pops. Runs once
 * per value change, with requestAnimationFrame only while counting. Reduced motion: shows the value.
 */
export function CountUp({ value, from = 0, format, delayMs = 0, durationMs = 900, sound = false, className }: CountUpProps) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : from));
  const [landed, setLanded] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    setLanded(false);
    setShown(from);
    let start: number | null = null;
    let lastStep = -1;
    const timer = window.setTimeout(() => {
      const step = (t: number) => {
        start ??= t;
        const k = Math.min(1, (t - start) / durationMs);
        const eased = 1 - Math.pow(1 - k, 3);
        setShown(from + (value - from) * eased);
        const s = Math.floor(k * 12);
        if (sound && s !== lastStep) {
          lastStep = s;
          play('count', 1 + k * 0.8);
        }
        if (k < 1) frame.current = requestAnimationFrame(step);
        else {
          frame.current = null;
          setLanded(true);
          if (sound) play('pop', 1.2);
        }
      };
      frame.current = requestAnimationFrame(step);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, from, delayMs, durationMs, sound]);

  return <span className={`${className ?? ''}${landed ? ' fx-bump' : ''}`}>{format(shown)}</span>;
}
