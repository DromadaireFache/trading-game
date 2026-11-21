import { ConnectionBadge } from '../../components/ConnectionBadge.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Roster } from '../../components/Roster.tsx';
import { SeatTaken } from '../../components/SeatTaken.tsx';
import { useCountdown } from '../../hooks/useCountdown.ts';
import { PHASE_HINT, PHASE_LABEL } from '../../lib/phases.ts';
import { formatQuarter } from '../../lib/time.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { useSymbols } from '../../net/marketHooks.ts';
import { CandleChart } from '../market/CandleChart.tsx';
import { SymbolHeader } from '../market/SymbolHeader.tsx';
import { FloorResults, MomentBanner } from '../results/FloorResults.tsx';
import { SoundToggle } from '../fx/SoundToggle.tsx';
import '../market/market.css';

/**
 * Projector view: phase, countdown and roster, readable from the back of the room. In the lobby the
 * phase and the join address fill the screen; once the game runs they shrink to a status line and
 * the index fund chart takes the space.
 * Between quarters and at the end the standings replace the chart (FloorResults); a `moment` shows a
 * full-screen BREAKING banner over everything (MomentBanner).
 */
export function FloorView() {
  const { phase, lobby, config, joinUrls, replaced, results } = useGame();
  const countdown = useCountdown();
  const current = phase?.phase ?? 'LOBBY';
  const totalQuarters = phase?.totalQuarters ?? config.time.quarters;
  const urgent = countdown.ms !== null && countdown.ms <= config.presentation.countdownUrgentMs;
  // Opened on the host through localhost, this page's own address is no use to the other laptops.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const playUrl = (isLoopback ? joinUrls[0] : undefined) ?? `${location.origin}/play`;
  const players = lobby?.players.length ?? 0;
  // The index fund is the market on the projector.
  const index = useSymbols().find((s) => s.kind === 'index')?.symbol ?? null;
  const showMarket = current !== 'LOBBY' && index !== null;
  // RESULTS and FINAL: the standings take the chart's place. SHOP goes back to the market.
  const showResults = (current === 'RESULTS' ? results?.final !== true : current === 'FINAL' ? results?.final === true : false) && results !== null;

  if (replaced) return <SeatTaken />;

  return (
    <div className={`floor phase--${current}`} data-testid="floor">
      <header className="floor__top">
        <span className="floor__brand">TRADING GAME</span>
        <span className="floor__quarter" data-testid="quarter">
          {formatQuarter(phase?.quarter ?? 0, totalQuarters)}
        </span>
        <span className="floor__status-line">
          <SoundToggle />
          <ConnectionBadge />
        </span>
      </header>

      <main className={`floor__main${showMarket ? ' floor__main--market' : ''}`}>
        <div className="floor__status">
          <div className="floor__phase" data-testid="phase" data-phase={current}>
            {PHASE_LABEL[current]}
          </div>
          <div
            className={`floor__countdown${urgent ? ' floor__countdown--urgent' : ''}${countdown.ms === null ? ' floor__countdown--idle' : ''}`}
            data-testid="countdown"
          >
            {countdown.text}
          </div>
        </div>
        <div className="floor__hint">
          {current === 'LOBBY' ? (
            <>
              Join at <span className="floor__url">{playUrl}</span>
            </>
          ) : (
            PHASE_HINT[current]
          )}
        </div>
        <div className="floor__progress" aria-hidden="true">
          <div className="floor__progress-bar" style={{ transform: `scaleX(${countdown.progress ?? 0})` }} />
        </div>
        {showResults ? (
          <FloorResults />
        ) : showMarket && (
          <section className="floor__market" data-testid="floor-market">
            <SymbolHeader symbol={index} size="large" />
            <CandleChart symbol={index} size="large" />
          </section>
        )}
        <ErrorBanner />
      </main>
      <MomentBanner />

      <aside className="floor__side">
        <h2 className="floor__side-title">
          Traders <span className="floor__side-count">{players}/{lobby?.maxPlayers ?? config.lobby.maxPlayers}</span>
        </h2>
        <Roster lobby={lobby} showEmptySeats={current === 'LOBBY'} />
      </aside>
    </div>
  );
}
