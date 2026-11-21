import { useCountdown } from '../hooks/useCountdown.ts';
import { PHASE_HINT, PHASE_LABEL } from '../lib/phases.ts';
import { formatQuarter } from '../lib/time.ts';
import { useGame, useGameClient } from '../net/GameProvider.tsx';
import { SoundToggle } from '../features/fx/SoundToggle.tsx';
import { ConnectionBadge } from './ConnectionBadge.tsx';
import { ReadyUp } from './ReadyUp.tsx';

/**
 * Top bar of /play, one slim line: the current phase and what to do now, the quarter (Q3/4), the live
 * countdown, who you are, sound and the connection state.
 */
export function PhaseHeader() {
  const { phase, me, config, game, join } = useGame();
  const client = useGameClient();
  const countdown = useCountdown();
  const current = phase?.phase ?? 'LOBBY';
  const quarter = phase?.quarter ?? 0;
  const totalQuarters = phase?.totalQuarters ?? config.time.quarters;
  const urgent = countdown.ms !== null && countdown.ms <= config.presentation.countdownUrgentMs;
  const canEndGame = me?.role === 'player' && current !== 'LOBBY' && current !== 'FINAL';

  return (
    <header className={`phase-header phase--${current}`}>
      <div className="phase-header__brand">TRADING GAME</div>

      <div className="phase-header__phase">
        <span className="phase-header__name" data-testid="phase" data-phase={current}>
          {PHASE_LABEL[current]}
        </span>
        <span className="phase-header__hint">{PHASE_HINT[current]}</span>
        {current === 'TRADING' && phase?.debugMode && <ReadyUp />}
      </div>

      <div className="phase-header__quarter" data-testid="quarter">
        {formatQuarter(quarter, totalQuarters)}
      </div>

      <div className={`phase-header__countdown${urgent ? ' phase-header__countdown--urgent' : ''}`} data-testid="countdown">
        {countdown.text}
      </div>

      <div className="phase-header__me">
        <div className="phase-header__player-actions">
          {me && <span className="phase-header__player" data-testid="me-name">{me.name}</span>}
          {canEndGame && (
            <button
              type="button"
              className="btn btn--ghost phase-header__end"
              disabled={join !== 'joined'}
              onClick={() => {
                if (window.confirm('End this game for everyone and show the final standings?')) {
                  client.send({ t: 'end_game', game });
                }
              }}
              data-testid="end-game"
            >
              End game
            </button>
          )}
        </div>
        <span className="phase-header__status">
          <SoundToggle />
          <ConnectionBadge />
        </span>
      </div>

      <div className="phase-header__progress" aria-hidden="true">
        <div className="phase-header__progress-bar" style={{ transform: `scaleX(${countdown.progress ?? 0})` }} />
      </div>
    </header>
  );
}
