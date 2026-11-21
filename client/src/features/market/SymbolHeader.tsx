import { SECTOR_LABELS } from '@tg/shared';
import type { SymbolId, SymbolInfo } from '@tg/shared';
import { changeDirection, formatMoneyShort, formatPercent, formatPrice } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore, useQuote, useSymbols } from '../../net/marketHooks.ts';
import { quoteChange } from '../../net/marketStore.ts';

/** "Technology", "Technology sector fund", "Index fund". */
export function symbolGroupLabel(info: SymbolInfo): string {
  if (info.kind === 'index') return 'Index fund';
  const sector = info.sector ? SECTOR_LABELS[info.sector] : '';
  return info.kind === 'sector' ? `${sector} sector fund` : sector;
}

interface SymbolHeaderProps {
  symbol: SymbolId | null;
  /** large = projector. */
  size?: 'normal' | 'large';
}

/**
 * Name, sector, market cap and live price of one symbol. The static part renders on selection only;
 * the price lives in HeaderQuote so a 10 Hz tick re-renders two spans, not the whole header
 * (in React dev mode every element costs, and dev mode is how the game is run).
 */
export function SymbolHeader({ symbol, size = 'normal' }: SymbolHeaderProps) {
  const market = useMarketStore();
  useSymbols(); // re-read the info when a new snapshot arrives
  const { briefing } = useGame();
  const info = symbol === null ? undefined : market.getInfo(symbol);
  if (!info) return null;
  const eps = info.kind === 'stock' ? briefing?.consensus?.[info.symbol] : undefined;

  return (
    <div className={`sym-head sym-head--${size}`} data-testid="selected-symbol" data-symbol={info.symbol}>
      <div className="sym-head__id">
        <span className="sym-head__ticker" data-testid="selected-ticker">{info.symbol}</span>
        <span className="sym-head__name" data-testid="selected-name">{info.name}</span>
      </div>
      <dl className="sym-head__facts">
        <div className="sym-head__fact">
          <dt>Sector</dt>
          <dd data-testid="selected-sector">{symbolGroupLabel(info)}</dd>
        </div>
        <div className="sym-head__fact">
          <dt title="Total value of the company">{info.kind === 'stock' ? 'Company size' : 'Fund size'}</dt>
          <dd data-testid="selected-cap">{formatMoneyShort(info.marketCap)}</dd>
        </div>
        {eps !== undefined && (
          <div className="sym-head__fact" title="Expected earnings per share this quarter. The earnings report shows how the company did against this estimate.">
            <dt>Profit est.</dt>
            <dd data-testid="selected-eps">${eps.toFixed(2)}</dd>
          </div>
        )}
        {info.ceo && (
          <div className="sym-head__fact sym-head__fact--optional">
            <dt>CEO</dt>
            <dd>{info.ceo}</dd>
          </div>
        )}
        {info.members && (
          <div className="sym-head__fact sym-head__fact--optional">
            <dt>Holdings</dt>
            <dd>{info.members.length} stocks</dd>
          </div>
        )}
      </dl>
      <HeaderQuote symbol={info.symbol} />
    </div>
  );
}

/** Live price and change since the quarter opened; the only part of the header that follows the ticks. */
function HeaderQuote({ symbol }: { symbol: SymbolId }) {
  const market = useMarketStore();
  const quote = useQuote(symbol);
  const decimals = market.getConfig().market.priceDecimals;
  const change = quote ? quoteChange(quote) : 0;
  return (
    <div className="sym-head__quote">
      <span className="sym-head__price" data-testid="selected-price">
        {quote ? formatPrice(quote.price, decimals) : '--'}
      </span>
      <span className={`sym-head__change change--${changeDirection(change)}`} data-testid="selected-change" title="Change since the quarter opened">
        {formatPercent(change)} <span className="sym-head__change-label">this quarter</span>
      </span>
    </div>
  );
}
