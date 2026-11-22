import { canReadyUp } from '@tg/shared';
import { play } from '../features/fx/sound.ts';
import { PHASE_LABEL } from '../lib/phases.ts';
import { useGame, useGameClient } from '../net/GameProvider.tsx';

/**
 * Shows how many players are ready. After a player readies up, the count stays visible.
 */
export function ReadyUp() {
  const { phase, readyPlayerIds, lobby, me, join } = useGame();
  const client = useGameClient();
  if (!phase || me?.role !== 'player') return null;
  const { phase: current, quarter, debugMode } = phase;
  if (!canReadyUp(current, debugMode)) return null;

  const ready = readyPlayerIds.includes(me.playerId);
  const label = debugMode ? `Skip ${PHASE_LABEL[current]}` : ready ? 'Ready!' : 'Ready up';
  const total = lobby?.players.length ?? 0;
  return (
    <div className="phase-ready">
      <button
        type="button"
        className={`ready-btn${ready ? ' ready-btn--ready' : ''}`}
        disabled={ready || join !== 'joined'}
        onClick={() => {
          if (client.send({ t: 'ready_up', phase: current, quarter })) play('ready');
        }}
        title={debugMode ? undefined : `${readyPlayerIds.length} of ${total} players ready`}
        data-testid="ready-up"
      >
        <span className="ready-btn__label">{label}</span>
        {!debugMode && (
          <span className="ready-btn__count" role="status" data-testid="ready-count">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
              <circle cx="8" cy="4.5" r="3" />
              <path d="M2 15c0-3.6 2.7-6 6-6s6 2.4 6 6z" />
            </svg>
            {readyPlayerIds.length}/{total}
          </span>
        )}
      </button>
    </div>
  );
}
