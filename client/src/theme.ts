/**
 * THE one place for colors and fonts. Everything else uses the CSS variables (var(--tg-...)).
 * System / monospace font stacks only: no external fonts, the game runs offline on a LAN.
 *
 * Add a color here, then use it as var(--tg-color-<kebab-name>) in CSS (or cssVar.color('name') in TS,
 * e.g. for lightweight-charts options, which need real color strings: use theme.color.<name> there).
 * Translucent variants are made in CSS with color-mix(), never with new hex values.
 */
export const theme = {
  color: {
    /** Page background. */
    bg: '#0b0e11',
    /** Recessed areas: inputs, chart wells, table stripes. */
    bgInset: '#070a0d',
    /** Panel surface. */
    panel: '#12161c',
    /** Raised surface: panel headers, buttons, hover. */
    panelRaised: '#181d25',
    border: '#232a33',
    borderStrong: '#36404d',
    text: '#d7dde5',
    textBright: '#ffffff',
    textDim: '#7d8896',
    /** Brand / primary action. */
    accent: '#f0b90b',
    /** Text on top of an accent-colored surface. */
    onAccent: '#0b0e11',
    up: '#26c281',
    down: '#f6465d',
    warn: '#ff9f1a',
    info: '#4aa3ff',
  },
  font: {
    mono: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "SF Mono", Menlo, monospace',
    sans: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
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
