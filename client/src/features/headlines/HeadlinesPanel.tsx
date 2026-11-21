import { SECTOR_LABELS, dayOfQuarter, dayToQuarter } from '@tg/shared';
import type { EarningsReport, HeadlineMsg, Sector } from '@tg/shared';
import { Panel, Placeholder } from '../../components/Panel.tsx';
import { changeDirection, formatPercent } from '../../lib/format.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useLastDay, useMarketStore, useSymbols } from '../../net/marketHooks.ts';
import './headlines.css';

/**
 * The news desk: this quarter's scheduled beats (day known, direction not), the earnings reports
 * between EARNINGS and the next BRIEFING, and the live headline feed, newest first. A headline's tag
 * selects its stock (or its sector fund) in the list and chart.
 */
export function HeadlinesPanel({ className }: { className?: string }) {
  const { headlines, briefing, earnings, config } = useGame();
  // Latest rate decision this quarter, else the rate the quarter opened with.
  const decided = headlines.find((h) => h.rate !== undefined && briefing !== null && dayToQuarter(config, h.ts) === briefing.quarter)?.rate;
  const current = decided ?? briefing?.rate;
  const rate = current === undefined ? 'live feed' : `rate ${(current * 100).toFixed(2)}%`;
  const empty = headlines.length === 0 && briefing === null && earnings === null;

  return (
    <Panel title="Headlines" aside={rate} className={`news${className ? ` ${className}` : ''}`}>
      {empty ? (
        <Placeholder>Breaking news appears here once the quarter starts.</Placeholder>
      ) : (
        <>
          {briefing && briefing.beats.length > 0 && <Beats beats={briefing.beats} />}
          {earnings && <Earnings quarter={earnings.quarter} reports={earnings.reports} />}
          <ol className="news__feed" data-testid="headlines">
            {headlines.map((h) => (
              <HeadlineRow key={`${h.id}${h.early ? '-early' : ''}`} headline={h} label={`D${dayOfQuarter(config, h.ts)}`} />
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
    <ul className="news__beats" data-testid="beats" title="Scheduled this quarter: the day is known, the direction is not">
      {beats.map((b) => (
        <li key={b.day} className={b.day <= lastDay ? 'news__beat news__beat--past' : 'news__beat'}>
          <span className="news__time">D{dayOfQuarter(config, b.day)}</span> {b.title}
        </li>
      ))}
    </ul>
  );
}

function Earnings({ quarter, reports }: { quarter: number; reports: EarningsReport[] }) {
  const market = useMarketStore();
  const beats = reports.filter((r) => r.surprise > 0).sort((a, b) => b.surprise - a.surprise).slice(0, 3);
  const misses = reports.filter((r) => r.surprise < 0).sort((a, b) => a.surprise - b.surprise).slice(0, 3);
  const row = (r: EarningsReport) => (
    <li key={r.symbol}>
      <button type="button" className="news__tag" onClick={() => market.select(r.symbol)}>
        {r.symbol}
      </button>{' '}
      <span className={`change--${changeDirection(r.surprise)}`}>{formatPercent(r.surprise)}</span>
      <span className="news__dim"> gap {formatPercent(Math.expm1(r.gap))}</span>
    </li>
  );
  return (
    <div className="news__earnings" data-testid="earnings">
      <div className="news__earnings-title">
        Q{quarter} earnings vs consensus <span className="news__dim">(gaps at the next open)</span>
      </div>
      <div className="news__earnings-cols">
        <ul>{beats.map(row)}</ul>
        <ul>{misses.map(row)}</ul>
      </div>
    </div>
  );
}

function HeadlineRow({ headline, label }: { headline: Omit<HeadlineMsg, 't'>; label: string }) {
  const market = useMarketStore();
  const symbols = useSymbols();
  const sectorFund = (sector: Sector) => symbols.find((s) => s.kind === 'sector' && s.sector === sector)?.symbol;
  const tag = headline.symbol ?? (headline.sector ? SECTOR_LABELS[headline.sector] : 'MARKET');
  const target = headline.symbol ?? (headline.sector ? sectorFund(headline.sector) : symbols.find((s) => s.kind === 'index')?.symbol);
  return (
    <li className={`news__item${headline.early ? ' news__item--early' : ''}`} data-testid="headline" data-symbol={headline.symbol ?? ''}>
      <span className="news__time">{label}</span>
      <button type="button" className="news__tag" disabled={target === undefined} onClick={() => target && market.select(target)}>
        {tag}
      </button>
      <span className="news__text">
        {headline.early && <strong className="news__early">EARLY </strong>}
        {headline.text}
      </span>
    </li>
  );
}
