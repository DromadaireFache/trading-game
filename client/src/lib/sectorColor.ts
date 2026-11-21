/**
 * The color of a sector (or of market-wide news), as a CSS variable from theme.ts. Stocks and sector
 * funds take their sector's color; the index fund and market news take the market color.
 */
import type { Sector, SymbolInfo } from '@tg/shared';

export function sectorColor(sector: Sector | 'market' | undefined): string {
  return `var(--tg-color-sector-${sector ?? 'market'})`;
}

export function symbolColor(info: Pick<SymbolInfo, 'sector' | 'kind'> | undefined): string {
  return sectorColor(info?.kind === 'index' ? 'market' : info?.sector);
}
