import { SECTOR_LABELS, dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { HeadlineMsg, Sector } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { useGame } from '../../net/GameProvider.tsx';
import { useLastDay, useMarketStore, useSymbols } from '../../net/marketHooks.ts';
import { useUiMode } from '../../lib/uiMode.ts';
import { useQuickBet } from '../../lib/quickBet.ts';
import './headlines.css';

/**
 * The news desk: this quarter's scheduled beats (day known, direction not) and the live headline
 * feed, newest first. A headline's tag
 * selects its stock (or its sector fund) in the list and chart.
 */
export function HeadlinesPanel({ className }: { className?: string }) {
  const { headlines, briefing, config, phase } = useGame();
  const mode = useUiMode();
  const quick = useQuickBet();
  // One bet function for the whole feed (rows never subscribe to prices themselves).
  const onBet = mode === 'simple' && quick.ready && phase?.phase === 'TRADING' ? quick.bet : null;
  // Latest rate decision this quarter, else the rate the quarter opened with.
  const decided = headlines.find((h) => h.rate !== undefined && briefing !== null && dayToQuarter(config, h.ts) === briefing.quarter)?.rate;
  const current = decided ?? briefing?.rate;
  const rate = current === undefined ? 'live feed' : `interest rate ${(current * 100).toFixed(2)}%`;
  const empty = headlines.length === 0 && briefing === null;

  return (
    <Panel
      title="News"
      aside={mode === 'simple' ? 'good news ▲  bad news ▼' : <span title="Higher rates usually push stocks down; a cut pushes them up.">{rate}</span>}
      className={`news${className ? ` ${className}` : ''}`}
    >
      {empty ? (
        <Placeholder>Breaking news appears here. Good news pushes a price up, bad news pushes it down: be fast!</Placeholder>
      ) : (
        <>
          {mode !== 'simple' && briefing && briefing.beats.length > 0 && <Beats beats={briefing.beats} />}
          {briefing && briefing.regimes.length > 0 && (
            <div className="news__regimes" data-testid="regimes" title="Regimes bend the market until they end">
              In force: {briefing.regimes.join(' · ')}
            </div>
          )}
          {headlines.length < 3 && (
            <div className="news__tip">Tip: good news pushes a price up, bad news pushes it down. Click a tag to see that stock.</div>
          )}
          <ol className="news__feed" data-testid="headlines">
            {headlines.map((h) => (
              <HeadlineRow key={`${h.id}${h.early ? '-early' : ''}`} headline={h} label={`D${dayOfQuarter(config, h.ts)}`} quickBets={mode === 'simple'} onBet={onBet} />
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}

function Beats({ beats }: { beats: { day: number; title: string }[] }) {
  const { config } = useGame();
  const lastDay = useLastDay();
  return (
    <div className="news__beats-row" title="Scheduled this quarter: you know the day, not whether it is good or bad news">
      <span className="news__beats-label">Coming up</span>
      <ul className="news__beats" data-testid="beats">
        {beats.map((b) => (
          <li key={b.day} className={b.day <= lastDay ? 'news__beat news__beat--past' : 'news__beat'}>
            <span className="news__time">day {dayOfQuarter(config, b.day)}</span> {b.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface HeadlineRowProps {
  headline: Omit<HeadlineMsg, 't'>;
  label: string;
  quickBets: boolean;
  /** null = betting is not possible right now. */
  onBet: ((symbol: string, up: boolean) => boolean) | null;
}

function HeadlineRow({ headline, label, quickBets, onBet }: HeadlineRowProps) {
  const market = useMarketStore();
  const symbols = useSymbols();
  const sectorFund = (sector: Sector) => symbols.find((s) => s.kind === 'sector' && s.sector === sector)?.symbol;
  const tag = headline.symbol ?? (headline.sector ? SECTOR_LABELS[headline.sector] : 'MARKET');
  const target = headline.symbol ?? (headline.sector ? sectorFund(headline.sector) : symbols.find((s) => s.kind === 'index')?.symbol);
  return (
    <li
      className={`news__item${headline.early ? ' news__item--early' : ''}${quickBets ? ' news__item--bet' : ''}`}
      data-testid="headline"
      data-symbol={headline.symbol ?? ''}
    >
      <span className="news__time">{label}</span>
      <button type="button" className="ticker-tag" disabled={target === undefined} onClick={() => target && market.select(target)}>
        {tag}
      </button>
      <span className="news__text">
        {headline.early && <strong className="news__early">EARLY </strong>}
        {headline.text}
      </span>
      {quickBets && (
        <span className="news__bet">
          <button
            type="button"
            className="news__bet-btn news__bet-btn--up"
            disabled={target === undefined || onBet === null}
            title={`Quick bet UP on ${tag}`}
            onClick={() => target && onBet && (market.select(target), onBet(target, true))}
            data-testid="headline-up"
          >
            ▲
          </button>
          <button
            type="button"
            className="news__bet-btn news__bet-btn--down"
            disabled={target === undefined || onBet === null}
            title={`Quick bet DOWN on ${tag}`}
            onClick={() => target && onBet && (market.select(target), onBet(target, false))}
            data-testid="headline-down"
          >
            ▼
          </button>
        </span>
      )}
    </li>
  );
}
