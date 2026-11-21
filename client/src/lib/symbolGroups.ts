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
  const funds: SymbolGroup = { key: 'funds', label: 'Funds', symbols: [] };
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
