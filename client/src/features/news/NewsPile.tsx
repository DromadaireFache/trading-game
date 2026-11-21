import type { CSSProperties, KeyboardEvent } from 'react';
import { dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { HeadlineMsg, Sector, SymbolInfo } from '@tg/shared';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore, useSymbols } from '../../net/marketHooks.ts';
import { sectorColor } from '../../lib/sectorColor.ts';
import { NewsDrawing } from './NewsDrawing.tsx';
import './news.css';

type Headline = Omit<HeadlineMsg, 't'>;

/** The newest papers on the pile; an older one falls off when a new one lands. */
const PILE = 4;

/**
 * Headlines land as newspaper clippings (julien's paper look) on a messy pile at the bottom right, over
 * your cards: each tilted and shifted its own way, the newest on top. A paper never closes or moves by
 * hand; it is buried by later headlines and falls off the pile after PILE newer ones. Clicking a paper
 * opens its stock (or the sector fund, or the index for market-wide news). While the pointer is over
 * the cards the pile slides down out of the way, so the cards can still be played.
 */
export function NewsPile({ className }: { className?: string }) {
  const { headlines } = useGame();
  const symbols = useSymbols();
  const pile = headlines.slice(0, PILE);
  return (
    <section className={`news-pile${className ? ` ${className}` : ''}`} aria-live="polite" aria-label="Latest headlines" data-testid="news-pile">
      {/* Oldest first in the DOM, so the newest paints on top. */}
      {[...pile].reverse().map((headline) => {
        const depth = pile.indexOf(headline);
        return <Paper key={`${headline.id}${headline.early ? '-early' : ''}`} headline={headline} depth={depth} symbols={symbols} />;
      })}
    </section>
  );
}

function tickerOf(headline: Headline, symbols: readonly SymbolInfo[]): string {
  if (headline.symbol) return headline.symbol;
  if (headline.sector) return symbols.find((s) => s.kind === 'sector' && s.sector === headline.sector)?.symbol ?? headline.sector.toUpperCase();
  return symbols.find((s) => s.kind === 'index')?.symbol ?? 'MARKET';
}

/** A small stable hash: the same headline always lands the same messy way. */
function hash(id: string, salt: number): number {
  let h = salt;
  for (const c of id) h = (Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0) ^ (h >>> 13);
  return (h >>> 0) / 4294967296;
}

function Paper({ headline, depth, symbols }: { headline: Headline; depth: number; symbols: readonly SymbolInfo[] }) {
  const { config } = useGame();
  const market = useMarketStore();
  const ticker = tickerOf(headline, symbols);
  const known = symbols.some((s) => s.symbol === ticker);
  const scope: Sector | 'market' = headline.sector ?? 'market';
  const quarter = dayToQuarter(config, headline.ts);
  const day = dayOfQuarter(config, headline.ts);
  const open = () => {
    if (known) market.select(ticker);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  const style = {
    // Messy: every paper its own tilt and shift; older ones peek out higher up the pile.
    '--pop-tilt': `${(hash(headline.id, 1) * 2 - 1) * 7}deg`,
    '--pop-x': `${-Math.round(hash(headline.id, 2) * 34)}px`,
    '--pop-y': `${-Math.round(hash(headline.id, 3) * 14)}px`,
    '--pop-depth': depth,
    '--sector': sectorColor(scope),
  } as CSSProperties;
  return (
    <article
      className={`paper${headline.early ? ' paper--early' : ''}${depth > 0 ? ' paper--behind' : ''}`}
      style={style}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      title={known ? `Open ${ticker}` : undefined}
      data-testid="headline"
      data-id={headline.id}
      data-depth={depth}
      data-ticker={ticker}
    >
      <header className="paper__mast">
        <span className="paper__name">{headline.early ? 'Psst… Insider Wire' : 'The Daily Ticker'}</span>
        <span className="paper__date">
          Q{quarter} · Day {day}
        </span>
      </header>
      <div className="paper__body">
        <h3 className="paper__headline" data-testid="headline-text">
          {headline.text}
        </h3>
        <figure className="paper__art" aria-hidden="true">
          <NewsDrawing scope={scope} />
        </figure>
      </div>
      <footer className="paper__foot">
        <span className="paper__note">{headline.early ? 'Only you can see this. Not public yet.' : 'Click to open it. The price moves in seconds.'}</span>
        <span className="paper__ticker" data-testid="headline-ticker">
          {ticker}
        </span>
      </footer>
    </article>
  );
}
