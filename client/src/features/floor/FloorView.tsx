import { ConnectionBadge } from '../../components/ConnectionBadge.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { Roster } from '../../components/Roster.tsx';
import { SeatTaken } from '../../components/SeatTaken.tsx';
import { useCountdown } from '../../hooks/useCountdown.ts';
import { PHASE_HINT, PHASE_LABEL } from '../../lib/phases.ts';
import { formatQuarter } from '../../lib/time.ts';
import { useGame } from '../../net/GameProvider.tsx';

/**
 * Projector view: big phase, countdown and roster, readable from the back of the room.
 * Later: index chart, ticker tape, leaderboard and full-screen BREAKING moments slot into floor__main.
 */
export function FloorView() {
  const { phase, lobby, config, joinUrls, replaced } = useGame();
  const countdown = useCountdown();
  const current = phase?.phase ?? 'LOBBY';
  const totalQuarters = phase?.totalQuarters ?? config.time.quarters;
  const urgent = countdown.ms !== null && countdown.ms <= config.presentation.countdownUrgentMs;
  // Opened on the host through localhost, this page's own address is no use to the other laptops.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const playUrl = (isLoopback ? joinUrls[0] : undefined) ?? `${location.origin}/play`;
  const players = lobby?.players.length ?? 0;

  if (replaced) return <SeatTaken />;

  return (
    <div className={`floor phase--${current}`} data-testid="floor">
      <header className="floor__top">
        <span className="floor__brand">TRADING GAME</span>
        <span className="floor__quarter" data-testid="quarter">
          {formatQuarter(phase?.quarter ?? 0, totalQuarters)}
        </span>
        <ConnectionBadge />
      </header>

      <main className="floor__main">
        <div className="floor__phase" data-testid="phase" data-phase={current}>
          {PHASE_LABEL[current]}
        </div>
        <div
          className={`floor__countdown${urgent ? ' floor__countdown--urgent' : ''}${countdown.ms === null ? ' floor__countdown--idle' : ''}`}
          data-testid="countdown"
        >
          {countdown.text}
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
          <div className="floor__progress-bar" style={{ width: `${(countdown.progress ?? 0) * 100}%` }} />
        </div>
        <ErrorBanner />
      </main>

      <aside className="floor__side">
        <h2 className="floor__side-title">
          Traders <span className="floor__side-count">{players}/{lobby?.maxPlayers ?? config.lobby.maxPlayers}</span>
        </h2>
        <Roster lobby={lobby} showEmptySeats={current === 'LOBBY'} />
      </aside>
    </div>
  );
}
