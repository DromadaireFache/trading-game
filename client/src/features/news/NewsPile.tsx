import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { dayOfQuarter, dayToQuarter } from '@tg/shared';
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
  /** When it landed (ms, performance.now()). */
  at: number;
  /** Thrown out (right click): flying off screen in this direction, then removed. */
  thrown?: { x: number; y: number; spin: number };
}

/** At most this many papers on the pile; the oldest falls off when a new one lands. */
const PILE = 4;
/** Only headlines this fresh land on the pile: a reload or a late join does not dump old news on it. */
const FRESH_MS = 4_000;
const THROW_MS = 520;
/** An insider tip stays on top this long: headlines that land meanwhile slide under it. */
const INSIDER_TOP_MS = 5_000;

/**
 * Headlines land as newspaper clippings (julien's paper look) on a pile at the bottom right, over your
 * cards, newest on top, each with its own slight tilt. A paper can be moved (drag it) or removed (its
 * x, or a right click, throws it off screen), and its ticker opens the stock (or the sector fund, or the
 * index for market-wide news); nothing else on it reacts. Otherwise it stays until PILE newer papers
 * bury it.
 */
export function NewsPile({ className }: { className?: string }) {
  const { headlines, config } = useGame();
  const market = useMarketStore();
  const symbols = useSymbols();
  const [pops, setPops] = useState<Pop[]>([]);
  const seen = useRef(new Set<string>());
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const msPerDay = config.time.tickMs * config.time.ticksPerCandle;
    const today = market.getLastDay();
    // No market data yet (a reload replays the news first): wait, or every replayed headline looks new.
    if (today < 0) return;
    const fresh: Pop[] = [];
    // Newest first in state: walk backwards so the pile gets them in publication order.
    for (const headline of [...headlines].reverse()) {
      const key = `${headline.id}${headline.early ? '-early' : ''}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if ((today - headline.ts) * msPerDay > FRESH_MS) continue;
      fresh.push({ key, headline, at: performance.now() });
    }
    if (fresh.length > 0) {
      setPops((current) => {
        const pile = current.filter((p) => !p.thrown);
        for (const pop of fresh) {
          // A fresh insider tip keeps the top for INSIDER_TOP_MS: anything else lands under it.
          const guard = pop.headline.early ? -1 : pile.findIndex((p) => p.headline.early && pop.at - p.at < INSIDER_TOP_MS);
          if (guard >= 0) pile.splice(guard, 0, pop);
          else pile.push(pop);
        }
        return pile.slice(-PILE).concat(current.filter((p) => p.thrown));
      });
    }
  }, [headlines, config, market]);

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => window.clearTimeout(t));
  }, []);

  /** Right click: the paper flies off screen in a random direction, then leaves the pile. */
  const throwOut = useCallback((key: string) => {
    const angle = Math.random() * 2 * Math.PI;
    const reach = Math.max(window.innerWidth, window.innerHeight) * 1.3;
    const thrown = { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, spin: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 360) };
    setPops((current) => current.map((p) => (p.key === key ? { ...p, thrown } : p)));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setPops((current) => current.filter((p) => p.key !== key));
    }, THROW_MS);
    timers.current.add(timer);
  }, []);

  /** A grabbed paper comes to the top of the pile. */
  const raise = useCallback((key: string) => {
    setPops((current) => {
      const pop = current.find((p) => p.key === key);
      return pop === undefined || current.at(-1)?.key === key ? current : [...current.filter((p) => p.key !== key), pop];
    });
  }, []);

  const resting = pops.filter((p) => !p.thrown);
  return (
    <section className={`news-pile${className ? ` ${className}` : ''}`} aria-live="polite" aria-label="Latest headlines" data-testid="news-pile">
      {pops.map((pop) => (
        <Paper
          key={pop.key}
          pop={pop}
          depth={pop.thrown ? -1 : resting.length - 1 - resting.indexOf(pop)}
          symbols={symbols}
          onOpen={(symbol) => market.select(symbol)}
          onThrow={() => throwOut(pop.key)}
          onGrab={() => raise(pop.key)}
        />
      ))}
    </section>
  );
}

function tickerOf(headline: Headline, symbols: readonly SymbolInfo[]): string {
  if (headline.symbol) return headline.symbol;
  if (headline.sector) return symbols.find((s) => s.kind === 'sector' && s.sector === headline.sector)?.symbol ?? headline.sector.toUpperCase();
  return symbols.find((s) => s.kind === 'index')?.symbol ?? 'MARKET';
}

/** A small stable hash: the same headline always lands at the same angle. */
function hash(id: string, salt: number): number {
  let h = salt;
  for (const c of id) h = (Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0) ^ (h >>> 13);
  return (h >>> 0) / 4294967296;
}

interface PaperProps {
  pop: Pop;
  /** 0 = on top; -1 = being thrown out. */
  depth: number;
  symbols: readonly SymbolInfo[];
  onThrow: () => void;
  onGrab: () => void;
  /** The ticker was clicked: open that stock. */
  onOpen: (symbol: string) => void;
}

function Paper({ pop, depth, symbols, onThrow, onGrab, onOpen }: PaperProps) {
  const { config } = useGame();
  const { headline, thrown } = pop;
  const ticker = tickerOf(headline, symbols);
  const scope: Sector | 'market' = headline.sector ?? 'market';
  const quarter = dayToQuarter(config, headline.ts);
  const day = dayOfQuarter(config, headline.ts);

  // Dragging: the offset from where the pile put the paper.
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const grab = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    // The x and the ticker are buttons of their own (they also stop the press): never a drag.
    if (e.button !== 0 || thrown || (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { pointerX: e.clientX, pointerY: e.clientY, x: drag.x, y: drag.y };
    setDragging(true);
    onGrab();
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = grab.current;
    if (g !== null) setDrag({ x: g.x + e.clientX - g.pointerX, y: g.y + e.clientY - g.pointerY });
  };
  const onPointerUp = () => {
    grab.current = null;
    setDragging(false);
  };
  const throwOut = () => {
    if (!thrown) onThrow();
  };
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    throwOut();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      throwOut();
    }
  };

  const style = {
    '--pop-tilt': `${(hash(headline.id, 1) * 2 - 1) * 4}deg`,
    '--drag-x': `${drag.x}px`,
    '--drag-y': `${drag.y}px`,
    '--sector': sectorColor(scope),
    ...(thrown ? { '--throw-x': `${thrown.x}px`, '--throw-y': `${thrown.y}px`, '--throw-spin': `${thrown.spin}deg` } : {}),
  } as CSSProperties;
  return (
    <article
      className={`paper${headline.early ? ' paper--early' : ''}${depth > 0 ? ' paper--behind' : ''}${dragging ? ' paper--dragging' : ''}${thrown ? ' paper--thrown' : ''}`}
      style={style}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        grab.current = null;
        setDragging(false);
      }}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
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
        <button
          type="button"
          className="paper__close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={throwOut}
          aria-label="Throw this headline away"
          data-testid="headline-close"
        >
          ×
        </button>
      </header>
      <div className="paper__body">
        <h3 className="paper__headline" data-testid="headline-text">
          {headline.text}
        </h3>
        <div className="paper__side">
          <figure className="paper__art" aria-hidden="true">
            <NewsDrawing scope={scope} />
          </figure>
          <button
          type="button"
          className="paper__ticker"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (symbols.some((s) => s.symbol === ticker)) onOpen(ticker);
          }}
          data-testid="headline-ticker"
        >
            {ticker}
          </button>
        </div>
      </div>
    </article>
  );
}
