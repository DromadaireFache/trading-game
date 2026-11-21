import type { ReactNode } from 'react';
import type { Sector } from '@tg/shared';

/**
 * Newspaper-style line drawings, one per sector plus one for market-wide news. Ink on newsprint:
 * strokes and fills use currentColor, the paper shows through; a dot screen gives the halftone look.
 * They say what the story is about, never which way the price goes.
 */
export function NewsDrawing({ scope }: { scope: Sector | 'market' }) {
  return (
    <svg viewBox="0 0 120 84" className="news-art" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <pattern id="news-dots" width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="currentColor" stroke="none" opacity="0.55" />
        </pattern>
        <pattern id="news-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" strokeWidth={1} opacity="0.7" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="118" height="82" strokeWidth={1.5} />
      {DRAWINGS[scope]}
    </svg>
  );
}

const ground = <path d="M6 72 H114" strokeWidth={1.5} />;

const DRAWINGS: Record<Sector | 'market', ReactNode> = {
  // A chip on a circuit board.
  tech: (
    <>
      <rect x="4" y="4" width="112" height="76" fill="url(#news-dots)" stroke="none" opacity="0.35" />
      <path d="M10 20 H36 M10 62 H36 M84 20 H110 M84 62 H110 M60 6 V22 M60 62 V78" strokeWidth={1.5} />
      <rect x="36" y="22" width="48" height="40" rx="3" fill="url(#news-hatch)" />
      <rect x="46" y="31" width="28" height="22" rx="2" />
      {[28, 36, 44, 52].map((y) => (
        <path key={`l${y}`} d={`M30 ${y} H36 M84 ${y} H90`} />
      ))}
      <circle cx="10" cy="20" r="2.5" fill="currentColor" />
      <circle cx="110" cy="62" r="2.5" fill="currentColor" />
    </>
  ),
  // An oil derrick next to a power pylon.
  energy: (
    <>
      <rect x="4" y="52" width="112" height="20" fill="url(#news-dots)" stroke="none" opacity="0.4" />
      <path d="M22 72 L36 14 L50 72 M26 56 H46 M30 38 H42 M33 26 H39 M26 56 L42 38 M46 56 L30 38" />
      <path d="M36 14 V8" />
      <path d="M76 72 L86 20 L96 72 M80 52 H92 M83 36 H89 M70 28 H102 M72 40 H100" />
      <path d="M104 12 L96 26 H104 L94 42" strokeWidth={2.5} />
      {ground}
    </>
  ),
  // A shield with a star, crossed by a radar sweep.
  defense: (
    <>
      <circle cx="60" cy="42" r="34" fill="url(#news-dots)" stroke="none" opacity="0.35" />
      <path d="M60 10 L86 20 V42 C86 58 74 68 60 74 C46 68 34 58 34 42 V20 Z" fill="url(#news-hatch)" />
      <path d="M60 28 L64 38 H74 L66 44 L69 55 L60 48 L51 55 L54 44 L46 38 H56 Z" fill="currentColor" />
      <path d="M14 70 A46 46 0 0 1 14 14" strokeWidth={1.5} strokeDasharray="3 4" />
      <path d="M106 14 A46 46 0 0 1 106 70" strokeWidth={1.5} strokeDasharray="3 4" />
    </>
  ),
  // A jet over clouds.
  airlines: (
    <>
      <path d="M8 66 C14 56 26 58 28 62 C32 52 48 54 50 62 C56 58 64 62 62 68 H8 Z" fill="url(#news-dots)" />
      <path d="M70 70 C74 64 84 64 86 68 C90 62 102 64 102 70 Z" fill="url(#news-dots)" />
      <path d="M20 34 L96 26 C104 25 110 28 108 31 C106 34 100 34 96 35 L22 40 Z" fill="url(#news-hatch)" />
      <path d="M58 30 L44 8 H52 L74 29 M62 37 L50 54 H58 L76 36 M24 34 L18 22 H24 L32 33" />
      <path d="M100 29 H104" />
    </>
  ),
  // A bank: pediment, columns, steps.
  finance: (
    <>
      <path d="M14 26 L60 6 L106 26 Z" fill="url(#news-hatch)" />
      <path d="M18 26 H102 V31 H18 Z" />
      {[26, 42, 58, 74, 90].map((x) => (
        <path key={x} d={`M${x} 33 V62 M${x + 4} 33 V62`} />
      ))}
      <rect x="14" y="62" width="92" height="5" />
      <rect x="8" y="67" width="104" height="6" fill="url(#news-dots)" />
      <text x="60" y="22" textAnchor="middle" fontSize="11" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="Georgia, serif">
        $
      </text>
    </>
  ),
  // A pill capsule and a medical cross.
  health: (
    <>
      <circle cx="40" cy="42" r="28" fill="url(#news-dots)" stroke="none" opacity="0.35" />
      <path d="M30 24 H46 V36 H58 V52 H46 V64 H30 V52 H18 V36 H30 Z" fill="url(#news-hatch)" />
      <g transform="rotate(-35 88 44)">
        <rect x="70" y="34" width="38" height="18" rx="9" />
        <path d="M89 34 V52" />
        <path d="M89 34 H99 A9 9 0 0 1 99 52 H89 Z" fill="currentColor" />
      </g>
      <path d="M84 70 H112" strokeWidth={1.5} />
    </>
  ),
  // A city skyline under a ticker chart.
  market: (
    <>
      <path d="M6 30 L22 24 L34 30 L48 16 L62 22 L76 12 L90 20 L104 8 L114 12" strokeWidth={2.5} />
      <path d="M8 72 V52 H20 V44 H30 V58 H40 V38 H54 V60 H62 V48 H76 V34 H88 V56 H98 V46 H112 V72 Z" fill="url(#news-hatch)" />
      {[44, 50].map((y) => (
        <path key={y} d={`M43 ${y} H51 M79 ${y - 6} H85`} strokeWidth={1.5} />
      ))}
      {ground}
    </>
  ),
};
