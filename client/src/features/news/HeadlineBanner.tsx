import type { CSSProperties } from 'react';
import { SECTOR_LABELS, dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { HeadlineMsg, Sector, SymbolInfo } from '@tg/shared';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore, useSymbols } from '../../net/marketHooks.ts';
import { sectorColor } from '../../lib/sectorColor.ts';
import { NewsDrawing } from './NewsDrawing.tsx';
import './news.css';

type Headline = Omit<HeadlineMsg, 't'>;

/**
 * The desk's headline slot: the latest headline (engine news, a player's card, or a private insider
 * tip) as a newspaper strip. It stays until a later headline replaces it. The whole strip is one
 * button: clicking it opens its stock (or the sector fund, or the index for market-wide news) in the
 * list, chart and bet panel. Nothing on it moves or closes.
 */
export function HeadlineBanner({ className }: { className?: string }) {
  const { headlines } = useGame();
  const symbols = useSymbols();
  const latest = headlines[0];
  return (
    <section className={`headline-slot${className ? ` ${className}` : ''}`} aria-live="polite" aria-label="Latest headline" data-testid="headline-slot">
      {latest === undefined ? (
        <div className="headline-slot__empty">No news yet. Headlines land here: click one to open its stock.</div>
      ) : (
        <Strip key={`${latest.id}${latest.early ? '-early' : ''}`} headline={latest} symbols={symbols} />
      )}
    </section>
  );
}

function tickerOf(headline: Headline, symbols: readonly SymbolInfo[]): string {
  if (headline.symbol) return headline.symbol;
  if (headline.sector) return symbols.find((s) => s.kind === 'sector' && s.sector === headline.sector)?.symbol ?? headline.sector.toUpperCase();
  return symbols.find((s) => s.kind === 'index')?.symbol ?? 'MARKET';
}

function Strip({ headline, symbols }: { headline: Headline; symbols: readonly SymbolInfo[] }) {
  const { config } = useGame();
  const market = useMarketStore();
  const ticker = tickerOf(headline, symbols);
  const info = symbols.find((s) => s.symbol === ticker);
  const scope: Sector | 'market' = headline.sector ?? 'market';
  const sectorName = scope === 'market' ? 'Whole market' : SECTOR_LABELS[scope];
  const quarter = dayToQuarter(config, headline.ts);
  const day = dayOfQuarter(config, headline.ts);
  return (
    <button
      type="button"
      className={`headline${headline.early ? ' headline--early' : ''}`}
      style={{ '--sector': sectorColor(scope) } as CSSProperties}
      onClick={() => {
        if (info) market.select(ticker);
      }}
      title={info ? `Open ${info.name}` : undefined}
      data-testid="headline"
      data-id={headline.id}
      data-ticker={ticker}
      data-sector={scope}
    >
      <span className="headline__art" aria-hidden="true">
        <NewsDrawing scope={scope} />
        <span className="headline__sector" data-testid="headline-sector">
          {sectorName}
        </span>
      </span>
      <span className="headline__body">
        <span className="headline__mast">
          <span className="headline__paper">{headline.early ? 'Psst… Insider Wire · only you can see this' : 'The Daily Ticker'}</span>
          <span className="headline__date">
            Q{quarter} · Day {day}
          </span>
        </span>
        <span className="headline__text" data-testid="headline-text">
          {headline.text}
        </span>
      </span>
      <span className="headline__stock">
        {info && info.kind === 'stock' && <span className="headline__company">{info.name}</span>}
        <span className="headline__ticker" data-testid="headline-ticker">
          {ticker}
        </span>
        <span className="headline__open">Open →</span>
      </span>
    </button>
  );
}
