import type { SymbolId } from '@tg/shared';

/** Delays list-only paints; the market store and its other subscribers remain live. */
export class QuotePaintQueue {
  private readonly painters = new Map<SymbolId, () => void>();
  private readonly pending = new Set<SymbolId>();

  constructor(private readonly random: () => number = Math.random) {}

  register(symbol: SymbolId, paint: () => void): () => void {
    this.painters.set(symbol, paint);
    paint();
    return () => {
      if (this.painters.get(symbol) === paint) {
        this.painters.delete(symbol);
        this.pending.delete(symbol);
      }
    };
  }

  mark(symbol: SymbolId): void {
    if (this.painters.has(symbol)) this.pending.add(symbol);
  }

  flush(): void {
    const candidates = [...this.pending];
    const count = Math.min(candidates.length, Math.ceil(this.painters.size * 0.1));
    for (let i = 0; i < count; i++) {
      const index = i + Math.floor(this.random() * (candidates.length - i));
      [candidates[i], candidates[index]] = [candidates[index]!, candidates[i]!];
      const symbol = candidates[i]!;
      this.pending.delete(symbol);
      this.painters.get(symbol)?.();
    }
  }

  reset(): void {
    this.pending.clear();
    for (const paint of this.painters.values()) paint();
  }
}
