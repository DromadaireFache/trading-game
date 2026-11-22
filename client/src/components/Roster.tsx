import type { LobbyState, PlayerId } from '@tg/shared';
import { playerColor } from '../lib/playerColor.ts';

interface RosterProps {
  lobby: LobbyState | null;
  /** Highlights this player's own row. */
  meId?: PlayerId;
  /** Show empty seats up to maxPlayers (lobby) or only the joined players (in game). */
  showEmptySeats?: boolean;
}

/** Player list with connection state. Used by the lobby, the in-game side bar and the projector. */
export function Roster({ lobby, meId, showEmptySeats = false }: RosterProps) {
  const players = lobby?.players ?? [];
  const emptySeats = showEmptySeats && lobby ? Math.max(0, lobby.maxPlayers - players.length) : 0;
  return (
    <ul className="roster" data-testid="roster">
      {players.map((p, i) => (
        <li
          key={p.id}
          className={`roster__row${p.connected ? '' : ' roster__row--offline'}${p.id === meId ? ' roster__row--me' : ''}`}
          data-testid="roster-player"
        >
          <span className="roster__seat" style={{ color: playerColor(i, p.color) }}>P{i + 1}</span>
          <span className="roster__name">{p.name}</span>
          {p.id === meId && <span className="roster__tag">you</span>}
          <span className="roster__state">{p.connected ? 'online' : 'offline'}</span>
        </li>
      ))}
      {Array.from({ length: emptySeats }, (_, i) => (
        <li key={`empty-${i}`} className="roster__row roster__row--empty">
          <span className="roster__seat">P{players.length + i + 1}</span>
          <span className="roster__name">open seat</span>
        </li>
      ))}
    </ul>
  );
}
