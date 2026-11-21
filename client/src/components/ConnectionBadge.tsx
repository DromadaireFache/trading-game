import { useGame } from '../net/GameProvider.tsx';
import type { ConnectionStatus } from '../net/state.ts';

const LABEL: Record<ConnectionStatus, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  open: 'Connected',
  reconnecting: 'Reconnecting',
  closed: 'Offline',
};

/** Small status light + label; always visible so a dropped connection is never a mystery. */
export function ConnectionBadge() {
  const { connection } = useGame();
  return (
    <span className={`conn conn--${connection}`} data-testid="connection" data-status={connection}>
      <span className="conn__dot" aria-hidden="true" />
      {LABEL[connection]}
    </span>
  );
}
