import { memo, useEffect, useMemo, useRef } from 'react';
import type { SymbolId, SymbolInfo } from '@tg/shared';
import { changeDirection, formatPercent, formatPrice } from '../../lib/format.ts';
import { groupSymbols, splitIntoColumns } from '../../lib/symbolGroups.ts';
import { useMarketStore, useSelectedSymbol, useSymbols } from '../../net/marketHooks.ts';
import { quoteChange } from '../../net/marketStore.ts';

const LIST_COLUMNS = 2;

/** Sector-grouped list of all symbols with live prices. Rows subscribe to their own symbol only. */
export function SymbolList() {
  const market = useMarketStore();
  const symbols = useSymbols();
  const selected = useSelectedSymbol();
  const columns = useMemo(() => splitIntoColumns(groupSymbols(symbols), LIST_COLUMNS), [symbols]);
  const decimals = market.getConfig().market.priceDecimals;
  // Stable callback so memo'd rows do not re-render when another row is selected.
  const onSelect = useMemo(() => (symbol: SymbolId) => market.select(symbol), [market]);

  return (
    <div className="sym-list" data-testid="symbol-list">
      {columns.map((groups, i) => (
        <div className="sym-list__column" key={i}>
          {groups.map((group) => (
            <section className="sym-group" key={group.key} data-testid="symbol-group" data-group={group.key}>
              <h3 className="sym-group__title">{group.label}</h3>
              {group.symbols.map((info) => (
                <SymbolRow
                  key={info.symbol}
                  info={info}
                  decimals={decimals}
                  selected={info.symbol === selected}
                  onSelect={onSelect}
                />
              ))}
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}

interface SymbolRowProps {
  info: SymbolInfo;
  decimals: number;
  selected: boolean;
  onSelect: (symbol: SymbolId) => void;
}

/**
 * One row. React renders it once (and again only when it is selected / deselected); price and change
 * are written straight to the DOM from the store subscription. At 10 Hz x 61 rows that keeps React
 * out of the hot path entirely, which matters most in dev mode where creating elements is slow.
 */
const SymbolRow = memo(function SymbolRow({ info, decimals, selected, onSelect }: SymbolRowProps) {
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

    paint();
    return market.subscribeSymbol(symbol, paint);
  }, [market, symbol, decimals]);

  return (
    <button
      type="button"
      className={`sym-row${selected ? ' sym-row--selected' : ''}`}
      data-testid="symbol-row"
      data-symbol={symbol}
      data-kind={info.kind}
      aria-pressed={selected}
      title={info.name}
      onClick={() => onSelect(symbol)}
    >
      <span className="sym-row__ticker">{info.symbol}</span>
      <span className="sym-row__name">{info.name}</span>
      {/* Filled by the effect above; React must not own these text nodes. */}
      <span ref={priceRef} className="sym-row__price" data-testid="symbol-price" />
      <span ref={changeRef} className="sym-row__change" data-testid="symbol-change" />
    </button>
  );
});
