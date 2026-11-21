/** Grouping of the universe for the symbol list. Pure. */
import { SECTOR_LABELS } from '@tg/shared';
import type { SymbolInfo } from '@tg/shared';

export interface SymbolGroup {
  key: string;
  label: string;
  symbols: SymbolInfo[];
}

/** Market index first, then each sector with its fund above its companies. */
export function groupSymbols(symbols: readonly SymbolInfo[]): SymbolGroup[] {
  const index: SymbolGroup = { key: 'index', label: 'Market', symbols: [] };
  const sectors = new Map<string, SymbolGroup>();
  for (const info of symbols) {
    if (info.kind === 'index') {
      index.symbols.push(info);
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
  for (const group of sectors.values()) {
    group.symbols.sort((a, b) => Number(b.kind === 'sector') - Number(a.kind === 'sector'));
  }
  return [...(index.symbols.length > 0 ? [index] : []), ...sectors.values()];
}
