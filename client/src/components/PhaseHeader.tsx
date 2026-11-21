import { FINAL_QUARTER_PHASES, QUARTER_PHASES } from '@tg/shared';
import { useCountdown } from '../hooks/useCountdown.ts';
import { PHASE_HINT, PHASE_LABEL } from '../lib/phases.ts';
import { formatQuarter } from '../lib/time.ts';
import { useGame } from '../net/GameProvider.tsx';
import { SoundToggle } from '../features/fx/SoundToggle.tsx';
import { ConnectionBadge } from './ConnectionBadge.tsx';
import { ModeToggle } from './ModeToggle.tsx';
import { ReadyUp } from './ReadyUp.tsx';

/**
 * Top bar of /play: always shows the current phase, the quarter (Q3/4) and the live countdown,
 * plus who you are and the connection state.
 */
export function PhaseHeader() {
  const { phase, me, config } = useGame();
  const countdown = useCountdown();
  const current = phase?.phase ?? 'LOBBY';
  const quarter = phase?.quarter ?? 0;
  const totalQuarters = phase?.totalQuarters ?? config.time.quarters;
  const phases = quarter < totalQuarters ? QUARTER_PHASES : FINAL_QUARTER_PHASES;
  const urgent = countdown.ms !== null && countdown.ms <= config.presentation.countdownUrgentMs;

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

      <ol className="phase-strip" aria-label="Phases of the quarter">
        {phases.map((p) => (
          <li key={p} className={`phase-strip__step${p === current ? ' phase-strip__step--current' : ''}`}>
            {PHASE_LABEL[p]}
          </li>
        ))}
      </ol>

      <div className="phase-header__quarter" data-testid="quarter">
        {formatQuarter(quarter, totalQuarters)}
      </div>

      <div className={`phase-header__countdown${urgent ? ' phase-header__countdown--urgent' : ''}`} data-testid="countdown">
        {countdown.text}
      </div>

      <div className="phase-header__me">
        {me && <span className="phase-header__player" data-testid="me-name">{me.name}</span>}
        <span className="phase-header__status">
          <ModeToggle />
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
