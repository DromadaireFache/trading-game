import { useState } from 'react';
import type { FormEvent } from 'react';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode } from '@tg/shared';
import type { Role } from '@tg/shared';
import { GameLogo } from '../../components/GameLogo.tsx';
import { useNetTarget } from '../../net/NetTarget.tsx';
import { CreditButton } from './CreditButton.tsx';
import './room.css';

/** Online game, before any room: type the room code, or (a player) host a new room. */
export function RoomEntry({ role, notice, onJoin, onHost }: {
  role: Role;
  notice: string | null;
  onJoin: (code: string) => void;
  /** Absent for the projector: only a player hosts. */
  onHost?: () => void;
}) {
  const target = useNetTarget();
  const [code, setCode] = useState('');
  const valid = normalizeRoomCode(code) !== null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (normalized !== null) onJoin(normalized);
  };

  return (
    <main className="center-screen">
      <form className="join-card" onSubmit={onSubmit}>
        <div className="join-card__brand"><GameLogo /></div>

        <label className="field">
          <span className="field__label">{role === 'spectator' ? 'Projector: room code' : 'Room code'}</span>
          <input
            className="input room-input"
            data-testid="room-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().split('').filter((c) => ROOM_CODE_ALPHABET.includes(c)).join('').slice(0, ROOM_CODE_LENGTH))}
            maxLength={ROOM_CODE_LENGTH}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD"
          />
          <span className="room-hint">Four letters or digits. Codes never use 0, O, 1, I or L.</span>
        </label>

        <button type="submit" className="btn btn--primary btn--wide" data-testid="room-join-button" disabled={!valid}>
          {role === 'spectator' ? 'Show this game' : 'Join game'}
        </button>
        {onHost && (
          <button type="button" className="btn btn--ghost btn--wide" data-testid="room-host-button" onClick={onHost}>
            Host a new game
          </button>
        )}

        {notice && <p className="room-notice" role="alert" data-testid="room-notice">{notice}</p>}

        <div className="join-card__foot">
          <CreditButton />
          {target.canSwitch && (
            <button type="button" className="btn btn--ghost" data-testid="mode-lan" onClick={() => target.setMode('lan')}>
              Use the LAN instead
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
