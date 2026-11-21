import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { HeadlineMsg, Sector, SymbolInfo } from '@tg/shared';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore, useSymbols } from '../../net/marketHooks.ts';
import { NewsDrawing } from './NewsDrawing.tsx';
import './news.css';

type Headline = Omit<HeadlineMsg, 't'>;

interface Pop {
  key: string;
  headline: Headline;
}

/** At most this many papers on the pile; the oldest goes first. */
const MAX_POPS = 3;

/**
 * Headlines land on the desk as newspaper clippings: masthead, headline, a drawing and the ticker.
 * They cannot be clicked (pointer-events: none): read the ticker, then find it in the stock list
 * yourself. A paper stays up until the price has had time to move (news.leadMaxMs + news.rampMs),
 * then slides away. Replayed headlines after a reconnect (older than that) never pop up.
 */
export function NewsPopups({ className }: { className?: string }) {
  const { headlines, config } = useGame();
  const market = useMarketStore();
  const symbols = useSymbols();
  const [pops, setPops] = useState<Pop[]>([]);
  const seen = useRef(new Set<string>());
  const timers = useRef(new Set<number>());
  const lifeMs = config.news.leadMaxMs + config.news.rampMs + 1_500;

  useEffect(() => {
    const msPerDay = config.time.tickMs * config.time.ticksPerCandle;
    const today = market.getLastDay();
    const fresh: Pop[] = [];
    // Newest first in state: walk backwards so the pile gets them in publication order.
    for (const headline of [...headlines].reverse()) {
      const key = `${headline.id}${headline.early ? '-early' : ''}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if ((today - headline.ts) * msPerDay > lifeMs) continue;
      fresh.push({ key, headline });
    }
    if (fresh.length === 0) return;
    setPops((current) => [...current, ...fresh].slice(-MAX_POPS));
    for (const pop of fresh) {
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setPops((current) => current.filter((p) => p.key !== pop.key));
      }, lifeMs);
      timers.current.add(timer);
    }
  }, [headlines, config, market, lifeMs]);

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div className={`news-pops${className ? ` ${className}` : ''}`} aria-live="polite" data-testid="news-pops">
      {pops.map((pop, i) => (
        <Paper key={pop.key} headline={pop.headline} depth={pops.length - 1 - i} symbols={symbols} />
      ))}
    </div>
  );
}

function tickerOf(headline: Headline, symbols: readonly SymbolInfo[]): string {
  if (headline.symbol) return headline.symbol;
  if (headline.sector) return symbols.find((s) => s.kind === 'sector' && s.sector === headline.sector)?.symbol ?? headline.sector.toUpperCase();
  return symbols.find((s) => s.kind === 'index')?.symbol ?? 'MARKET';
}

/** A tiny stable hash: the same headline always tilts the same way. */
function tilt(id: string): number {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 7) - 3) * 0.6;
}

function Paper({ headline, depth, symbols }: { headline: Headline; depth: number; symbols: readonly SymbolInfo[] }) {
  const { config } = useGame();
  const ticker = tickerOf(headline, symbols);
  const scope: Sector | 'market' = headline.sector ?? 'market';
  const quarter = dayToQuarter(config, headline.ts);
  const day = dayOfQuarter(config, headline.ts);
  const style = { '--pop-tilt': `${tilt(headline.id)}deg`, '--pop-depth': depth } as CSSProperties;
  return (
    <article
      className={`paper${headline.early ? ' paper--early' : ''}${depth > 0 ? ' paper--behind' : ''}`}
      style={style}
      data-testid="news-pop"
      data-ticker={ticker}
    >
      <header className="paper__mast">
        <span className="paper__name">{headline.early ? 'Psst… Insider Wire' : 'The Daily Ticker'}</span>
        <span className="paper__date">
          Q{quarter} · Day {day}
        </span>
      </header>
      <div className="paper__body">
        <h3 className="paper__headline">{headline.text}</h3>
        <figure className="paper__art" aria-hidden="true">
          <NewsDrawing scope={scope} />
        </figure>
      </div>
      <footer className="paper__foot">
        <span className="paper__note">{headline.early ? 'Only you can see this. Not public yet.' : 'Find it in your list: the price moves in seconds.'}</span>
        <span className="paper__ticker" data-testid="news-pop-ticker">
          {ticker}
        </span>
      </footer>
    </article>
  );
}
