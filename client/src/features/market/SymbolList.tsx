import type { CSSProperties } from 'react';
import { symbolColor } from '../../lib/sectorColor.ts';
import { memo, useEffect, useMemo, useRef } from 'react';
import type { SymbolId, SymbolInfo } from '@tg/shared';
import { changeDirection, formatPercent, formatPrice } from '../../lib/format.ts';
import { groupSymbols } from '../../lib/symbolGroups.ts';
import { useMarketStore, useSelectedSymbol, useSymbols } from '../../net/marketHooks.ts';
import { quoteChange } from '../../net/marketStore.ts';
import { QuotePaintQueue } from './quotePaintQueue.ts';

/**
 * Sector-grouped list of all symbols with live prices, tickers only (a headline names the company and
 * its ticker; finding it here is part of the game). Groups flow in a grid of blocks. Rows subscribe to
 * their own symbol only.
 */
export function SymbolList() {
  const market = useMarketStore();
  const symbols = useSymbols();
  const selected = useSelectedSymbol();
  const groups = useMemo(() => groupSymbols(symbols), [symbols]);
  const decimals = market.getConfig().market.priceDecimals;
  const paintQueue = useMemo(() => new QuotePaintQueue(), [market]);
  useEffect(() => {
    const timer = window.setInterval(() => paintQueue.flush(), market.getConfig().time.tickMs);
    const unsubscribe = market.subscribeFeed((event) => {
      if (event.kind === 'reset') paintQueue.reset();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [market, paintQueue]);
  // Stable callback so memo'd rows do not re-render when another row is selected.
  const onSelect = useMemo(() => (symbol: SymbolId) => market.select(symbol), [market]);

  return (
    <div className="sym-list" data-testid="symbol-list">
      {groups.map((group) => (
        <section
          className={`sym-group${group.key === 'index' ? ' sym-group--index' : ''}`}
          key={group.key}
          data-testid="symbol-group"
          data-group={group.key}
          aria-label={group.label}
        >
          <h3 className="sym-group__title">{group.label}</h3>
          {group.symbols.map((info) => (
            <SymbolRow
              key={info.symbol}
              info={info}
              decimals={decimals}
              selected={info.symbol === selected}
              onSelect={onSelect}
              paintQueue={paintQueue}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

interface SymbolRowProps {
  info: SymbolInfo;
  decimals: number;
  selected: boolean;
  onSelect: (symbol: SymbolId) => void;
  paintQueue: QuotePaintQueue;
}

/**
 * One row. Store changes mark it dirty; the list paints a random tenth of its rows each tick.
 * Other market consumers still receive every update directly from the store.
 */
const SymbolRow = memo(function SymbolRow({ info, decimals, selected, onSelect, paintQueue }: SymbolRowProps) {
  const market = useMarketStore();
  const priceRef = useRef<HTMLSpanElement>(null);
  const changeRef = useRef<HTMLSpanElement>(null);
  const symbol = info.symbol;

  useEffect(() => {
    const priceEl = priceRef.current;
    const changeEl = changeRef.current;
    if (!priceEl || !changeEl) return;
    let lastPrice: number | undefined;
    let tint = '';

    const paint = () => {
      const quote = market.getQuote(symbol);
      const change = quote ? quoteChange(quote) : 0;
      priceEl.textContent = quote ? formatPrice(quote.price, decimals) : '--';
      changeEl.textContent = formatPercent(change);
      changeEl.className = `sym-row__change change--${changeDirection(change)}`;
      // Tint by the direction of the last move; the class is only touched when the direction flips.
      if (quote && lastPrice !== undefined && quote.price !== lastPrice) {
        const next = quote.price > lastPrice ? 'up' : 'down';
        if (next !== tint) {
          tint = next;
          priceEl.className = `sym-row__price sym-row__price--${tint}`;
        }
      }
      lastPrice = quote?.price;
    };

    const unregister = paintQueue.register(symbol, paint);
    const unsubscribe = market.subscribeSymbol(symbol, () => paintQueue.mark(symbol));
    return () => {
      unsubscribe();
      unregister();
    };
  }, [market, symbol, decimals, paintQueue]);

  return (
    <button
      type="button"
      className={`sym-row${selected ? ' sym-row--selected' : ''}`}
      style={{ '--sector': symbolColor(info) } as CSSProperties}
      data-testid="symbol-row"
      data-symbol={symbol}
      data-kind={info.kind}
      aria-pressed={selected}
      onClick={() => onSelect(symbol)}
    >
      <span className="sym-row__ticker">{info.symbol}</span>
      {/* Filled by the effect above; React must not own these text nodes. */}
      <span ref={priceRef} className="sym-row__price" data-testid="symbol-price" />
      <span ref={changeRef} className="sym-row__change" data-testid="symbol-change" />
    </button>
  );
});
