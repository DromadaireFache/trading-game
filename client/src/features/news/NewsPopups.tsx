import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { SECTOR_LABELS, dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { HeadlineMsg, Sector, SymbolInfo } from '@tg/shared';
import { useGame } from '../../net/GameProvider.tsx';
import { useMarketStore, useSymbols } from '../../net/marketHooks.ts';
import { sectorColor } from '../../lib/sectorColor.ts';
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
 * Nothing on a paper links to the stock: read the ticker, then find it in the stock list yourself.
 * A paper can be dragged out of the way and dismissed with its x (Escape dismisses the front one);
 * otherwise it stays up until the price has had time to move (news.leadMaxMs + news.rampMs), then
 * goes. Replayed headlines after a reconnect (older than that) never pop up. The pile itself ignores
 * the mouse, so only the papers block clicks underneath.
 */
export function NewsPopups({ className }: { className?: string }) {
  const { headlines, config } = useGame();
  const market = useMarketStore();
  const symbols = useSymbols();
  const [pops, setPops] = useState<Pop[]>([]);
  const seen = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());
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
      timers.current.set(pop.key, window.setTimeout(() => dismiss(pop.key), lifeMs));
    }
  }, [headlines, config, market, lifeMs]);

  const dismiss = useCallback((key: string) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setPops((current) => current.filter((p) => p.key !== key));
  }, []);

  // Escape dismisses the paper on top of the pile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setPops((current) => {
        const top = current.at(-1);
        if (top === undefined) return current;
        window.clearTimeout(timers.current.get(top.key));
        timers.current.delete(top.key);
        return current.slice(0, -1);
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div className={`news-pops${className ? ` ${className}` : ''}`} aria-live="polite" data-testid="news-pops">
      {pops.map((pop, i) => (
        <Paper key={pop.key} headline={pop.headline} depth={pops.length - 1 - i} symbols={symbols} onDismiss={() => dismiss(pop.key)} />
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

interface PaperProps {
  headline: Headline;
  depth: number;
  symbols: readonly SymbolInfo[];
  onDismiss: () => void;
}

function Paper({ headline, depth, symbols, onDismiss }: PaperProps) {
  const { config } = useGame();
  // Dragging: the offset from where the pile put the paper.
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const grab = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { pointerX: e.clientX, pointerY: e.clientY, x: drag.x, y: drag.y };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = grab.current;
    if (g !== null) setDrag({ x: g.x + e.clientX - g.pointerX, y: g.y + e.clientY - g.pointerY });
  };
  const onPointerUp = () => {
    grab.current = null;
    setDragging(false);
  };
  const ticker = tickerOf(headline, symbols);
  const scope: Sector | 'market' = headline.sector ?? 'market';
  const quarter = dayToQuarter(config, headline.ts);
  const day = dayOfQuarter(config, headline.ts);
  const sectorName = scope === 'market' ? 'Whole market' : SECTOR_LABELS[scope];
  const company = headline.symbol ? symbols.find((s) => s.symbol === headline.symbol)?.name : undefined;
  const style = {
    '--pop-tilt': `${tilt(headline.id)}deg`,
    '--pop-depth': depth,
    '--drag-x': `${drag.x}px`,
    '--drag-y': `${drag.y}px`,
    '--sector': sectorColor(scope),
  } as CSSProperties;
  return (
    <article
      className={`paper${headline.early ? ' paper--early' : ''}${depth > 0 ? ' paper--behind' : ''}${dragging ? ' paper--dragging' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="news-pop"
      data-ticker={ticker}
      data-sector={scope}
    >
      <header className="paper__mast">
        <span className="paper__name">{headline.early ? 'Psst… Insider Wire' : 'The Daily Ticker'}</span>
        <span className="paper__date">
          Q{quarter} · Day {day}
        </span>
        <button type="button" className="paper__close" onClick={onDismiss} title="Dismiss (Esc)" aria-label="Dismiss this headline" data-testid="news-pop-close">
          ×
        </button>
      </header>
      <div className="paper__body">
        <h3 className="paper__headline">{headline.text}</h3>
        <figure className="paper__art">
          <NewsDrawing scope={scope} />
          <figcaption className="paper__sector" data-testid="news-pop-sector">
            {sectorName}
          </figcaption>
        </figure>
      </div>
      <footer className="paper__foot">
        <span className="paper__note">{headline.early ? 'Only you can see this. Not public yet.' : 'Find it in your list: the price moves in seconds.'}</span>
        <span className="paper__stock">
          {company && <span className="paper__company">{company}</span>}
          <span className="paper__ticker" data-testid="news-pop-ticker">
            {ticker}
          </span>
        </span>
      </footer>
    </article>
  );
}
