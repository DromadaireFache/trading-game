import { ConnectionBadge } from '../../components/ConnectionBadge.tsx';
import { GameLogo } from '../../components/GameLogo.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Roster } from '../../components/Roster.tsx';
import { SeatTaken } from '../../components/SeatTaken.tsx';
import { useCountdown } from '../../hooks/useCountdown.ts';
import { PHASE_LABEL } from '../../lib/phases.ts';
import { formatQuarter } from '../../lib/time.ts';
import { useGame } from '../../net/GameProvider.tsx';
import { FloorResults, MomentBanner, useVisibleMoment } from '../results/FloorResults.tsx';
import { SoundToggle } from '../fx/SoundToggle.tsx';
import { HeadlineTape } from './HeadlineTape.tsx';
import { NetWorthChart, NetWorthStandings } from './NetWorthChart.tsx';

/**
 * Projector view: phase, countdown and roster, readable from the back of the room. In the lobby the
 * phase and the join address fill the screen; once the game runs they shrink to a status line and
 * the players' net-worth chart takes the space.
 * Between quarters and at the end the standings replace the chart (FloorResults); a `moment` shows a
 * full-screen BREAKING banner over everything (MomentBanner).
 */
export function FloorView() {
  const { phase, lobby, config, joinUrls, replaced } = useGame();
  const countdown = useCountdown();
  const moment = useVisibleMoment();
  const current = phase?.phase ?? 'LOBBY';
  const totalQuarters = phase?.totalQuarters ?? config.time.quarters;
  const urgent = countdown.ms !== null && countdown.ms <= config.presentation.countdownUrgentMs;
  // Opened on the host through localhost, this page's own address is no use to the other laptops.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const playUrl = (isLoopback ? joinUrls[0] : undefined) ?? `${location.origin}/play`;
  const inLobby = current === 'LOBBY';
  const isResults = current === 'RESULTS' || current === 'FINAL';
  const showChart = !inLobby && !isResults && lobby !== null;

  if (replaced) return <SeatTaken />;

  return (
    <div className={`floor phase--${current}`} data-testid="floor">
      <header className="floor__top">
        <span className="floor__brand"><GameLogo /></span>
        <span className="floor__quarter" data-testid="quarter">
          {formatQuarter(phase?.quarter ?? 0, totalQuarters)}
        </span>
        <span className="floor__status-line">
          <SoundToggle />
          <ConnectionBadge />
        </span>
      </header>

      <main className={`floor__main${inLobby ? '' : ' floor__main--playing'}`}>
        {inLobby && <h1 className="floor__lobby-brand"><GameLogo variant="full" /></h1>}
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
        {current === 'LOBBY' && (
          <div className="floor__hint">
            Join at <span className="floor__url">{playUrl}</span>
          </div>
        )}
        <div className="floor__progress" aria-hidden="true">
          <div className="floor__progress-bar" style={{ transform: `scaleX(${countdown.progress ?? 0})` }} />
        </div>
        {isResults && <FloorResults pauseReplay={moment !== null} />}
        {showChart && <NetWorthChart players={lobby.players} config={config} />}
        <ErrorBanner />
      </main>
      {current !== 'FINAL' && moment && <MomentBanner moment={moment} />}

      <aside className="floor__side">
        <h2 className="floor__side-title">
          Traders <span className="floor__side-count">{lobby?.players.length ?? 0}/{lobby?.maxPlayers ?? config.lobby.maxPlayers}</span>
        </h2>
        {showChart ? <NetWorthStandings players={lobby.players} /> : <Roster lobby={lobby} showEmptySeats={inLobby} />}
      </aside>
      {!isResults && <HeadlineTape />}
    </div>
  );
}
