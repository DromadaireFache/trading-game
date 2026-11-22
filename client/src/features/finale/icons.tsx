/**
 * The finale's icons: simple line drawings in the current text color (24 x 24 grid, 2 px strokes),
 * so they follow the theme instead of an emoji font.
 */
import type { Highlight } from '@tg/shared';

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 24, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z" />
      <path d="M10 21h4" />
      <path d="M12 3v2" />
    </Svg>
  );
}

/** The crown's path, for use inside another SVG (centered on 0,0, about 24 wide). */
export const CROWN_PATH = 'M-11 6 L-12 -6 L-5 0 L0 -9 L5 0 L12 -6 L11 6 Z';

export function CrownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 18 3 7l5 4 4-7 4 7 5-4-1 11Z" fill="currentColor" fillOpacity={0.25} />
      <path d="M4 21h16" />
    </Svg>
  );
}

const HIGHLIGHT_PATHS: Record<Highlight['kind'], React.ReactNode> = {
  crash: (
    <>
      <path d="m3 6 6 6 4-4 8 8" />
      <path d="M21 10v6h-6" />
    </>
  ),
  rally: (
    <>
      <path d="m3 18 6-6 4 4 8-8" />
      <path d="M21 14V8h-6" />
    </>
  ),
  mover: (
    <>
      <path d="M12 3v18" />
      <path d="m6 9 6-6 6 6" />
      <path d="M8 21h8" />
    </>
  ),
  card: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  trade: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9a3 2.5 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2a3 2.5 0 0 1-3-1.5" />
      <path d="M12 6v1.5M12 16.5V18" />
    </>
  ),
  arrests: (
    <>
      <circle cx="7" cy="15" r="4" />
      <circle cx="17" cy="15" r="4" />
      <path d="M11 15h2" />
      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
    </>
  ),
};

export function HighlightIcon({ kind, ...props }: IconProps & { kind: Highlight['kind'] }) {
  return <Svg {...props}>{HIGHLIGHT_PATHS[kind]}</Svg>;
}
