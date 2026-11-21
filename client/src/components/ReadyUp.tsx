import { canReadyUp } from '@tg/shared';
import { useGame, useGameClient } from '../net/GameProvider.tsx';

export function ReadyUp() {
  const { phase, readyPlayerIds, lobby, me, join } = useGame();
  const client = useGameClient();
  if (!phase || me?.role !== 'player') return null;
  const { phase: current, quarter, debugMode } = phase;
  if (!canReadyUp(current, debugMode)) return null;

  const ready = readyPlayerIds.includes(me.playerId);
  return (
    <div className="phase-ready">
      <button
        type="button"
        className="btn btn--primary"
        disabled={ready || join !== 'joined'}
        onClick={() => client.send({ t: 'ready_up', phase: current, quarter })}
        data-testid="ready-up"
      >
        {ready ? 'Ready' : 'Ready Up'}
      </button>
      <span role="status" data-testid="ready-count">
        {readyPlayerIds.length}/{lobby?.players.length ?? 0} players ready
      </span>
    </div>
  );
}
