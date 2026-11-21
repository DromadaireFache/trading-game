import { canReadyUp } from '@tg/shared';
import { play } from '../features/fx/sound.ts';
import { PHASE_LABEL } from '../lib/phases.ts';
import { useGame, useGameClient } from '../net/GameProvider.tsx';

export function ReadyUp() {
  const { phase, readyPlayerIds, lobby, me, join } = useGame();
  const client = useGameClient();
  if (!phase || me?.role !== 'player') return null;
  const { phase: current, quarter, debugMode } = phase;
  if (!canReadyUp(current, debugMode)) return null;

  const ready = readyPlayerIds.includes(me.playerId);
  const label = debugMode ? `Skip ${PHASE_LABEL[current]}` : ready ? 'Ready' : 'Ready Up';
  return (
    <div className="phase-ready">
      <button
        type="button"
        className="btn btn--primary"
        disabled={ready || join !== 'joined'}
        onClick={() => {
          if (client.send({ t: 'ready_up', phase: current, quarter })) play('ready');
        }}
        data-testid="ready-up"
      >
        {label}
      </button>
      {!debugMode && (
        <span role="status" data-testid="ready-count">
          {readyPlayerIds.length}/{lobby?.players.length ?? 0} players ready
        </span>
      )}
    </div>
  );
}
