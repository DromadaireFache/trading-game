/** Grouping of the universe for the symbol list. Pure. */
import { SECTOR_LABELS } from '@tg/shared';
import type { SymbolInfo } from '@tg/shared';

export interface SymbolGroup {
  key: string;
  label: string;
  symbols: SymbolInfo[];
}

/** Funds first (index + sector funds), then one group per sector, in the order the server sent them. */
export function groupSymbols(symbols: readonly SymbolInfo[]): SymbolGroup[] {
  const funds: SymbolGroup = { key: 'funds', label: 'Funds (a whole sector in one)', symbols: [] };
  const sectors = new Map<string, SymbolGroup>();
  for (const info of symbols) {
    if (info.kind !== 'stock') {
      funds.symbols.push(info);
      continue;
    }
    const key = info.sector ?? 'other';
    let group = sectors.get(key);
    if (!group) {
      group = { key, label: info.sector ? SECTOR_LABELS[info.sector] : 'Other', symbols: [] };
      sectors.set(key, group);
    }
    group.symbols.push(info);
  }
  return [...(funds.symbols.length > 0 ? [funds] : []), ...sectors.values()];
}

/**
 * Splits the groups over `columns` columns of about equal height, keeping their order
 * (a group counts its rows plus one for its heading).
 */
export function splitIntoColumns(groups: readonly SymbolGroup[], columns: number): SymbolGroup[][] {
  const rows = (g: SymbolGroup) => g.symbols.length + 1;
  const total = groups.reduce((sum, g) => sum + rows(g), 0);
  const out: SymbolGroup[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  let column = 0;
  let filled = 0;
  for (const group of groups) {
    // Move on once this column holds its share of all rows.
    if (column < out.length - 1 && filled >= (total * (column + 1)) / out.length) column++;
    out[column]!.push(group);
    filled += rows(group);
  }
  return out;
}
