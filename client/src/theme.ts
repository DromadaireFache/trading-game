/**
 * THE one place for colors and fonts. Everything else uses the CSS variables (var(--tg-...)).
 * System font stacks only: no external fonts, the game runs offline on a LAN.
 *
 * Look: a game table. Felt-green background, chunky dark panels with a hard drop shadow, gold for what
 * matters, green / red for up / down, and cream "playing card" faces for cards. Readability first:
 * big bold numbers, plain sans-serif text, monospace only where columns of tickers and prices line up.
 *
 * Add a color here, then use it as var(--tg-color-<kebab-name>) in CSS (or cssVar.color('name') in TS,
 * e.g. for lightweight-charts options, which need real color strings: use theme.color.<name> there).
 * Translucent variants are made in CSS with color-mix(), never with new hex values.
 */
export const theme = {
  color: {
    /** Page background: the table felt. */
    bg: '#16352d',
    /** Recessed areas: inputs, chart wells, table stripes. */
    bgInset: '#0b1714',
    /** Panel surface. */
    panel: '#102420',
    /** Raised surface: buttons, hover, header strips. */
    panelRaised: '#1d3d35',
    border: '#2c5248',
    borderStrong: '#4a7a6c',
    /** The hard drop shadow under panels, buttons and cards. */
    shadow: '#050e0b',
    text: '#eef3ea',
    textBright: '#ffffff',
    textDim: '#9fb7ad',
    /** Gold: what matters most (your money, titles, primary actions). */
    accent: '#ffcc33',
    /** Text on top of an accent-colored surface. */
    onAccent: '#1a1300',
    up: '#34d27b',
    down: '#ff5c5c',
    /** Text on top of an up / down colored surface. */
    onUp: '#04210f',
    onDown: '#2a0404',
    warn: '#ff9f40',
    info: '#5ab8ff',
    /** Playing-card face and ink. */
    cardFace: '#f6efdc',
    cardText: '#1d1b16',
  },
  font: {
    mono: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "SF Mono", Menlo, monospace',
    sans: '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif',
    /** Chunky headings and big numbers. */
    display: '"Trebuchet MS", "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif',
    /** Newsprint: the headline popups. */
    serif: 'Georgia, "Times New Roman", Times, serif',
  },
} as const;

export type Theme = typeof theme;
export type ThemeColor = keyof Theme['color'];
export type ThemeFont = keyof Theme['font'];

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** CSS variable references for use in inline styles: cssVar.color('textDim') -> "var(--tg-color-text-dim)". */
export const cssVar = {
  color: (name: ThemeColor): string => `var(--tg-color-${kebab(name)})`,
  font: (name: ThemeFont): string => `var(--tg-font-${kebab(name)})`,
};

/** Writes the theme to :root as --tg-color-<name> and --tg-font-<name> (camelCase -> kebab-case). */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(theme.color)) root.style.setProperty(`--tg-color-${kebab(name)}`, value);
  for (const [name, value] of Object.entries(theme.font)) root.style.setProperty(`--tg-font-${kebab(name)}`, value);
}
