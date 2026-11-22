import { useState } from 'react';
import type { FormEvent } from 'react';
import { ConnectionBadge } from '../../components/ConnectionBadge.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { GameLogo } from '../../components/GameLogo.tsx';
import { ViewLink } from '../../components/ViewLink.tsx';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';
import { useNetTarget } from '../../net/NetTarget.tsx';
import { CreditButton } from './CreditButton.tsx';

/** Name entry: the first screen of /play. */
export function JoinForm() {
  const { config, join, connection } = useGame();
  const client = useGameClient();
  const target = useNetTarget();
  const [name, setName] = useState('');

  const trimmed = name.trim();
  const { nameMinLength, nameMaxLength } = config.lobby;
  const valid = trimmed.length >= nameMinLength && trimmed.length <= nameMaxLength;
  const joining = join === 'joining';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !joining) client.join(trimmed);
  };

  return (
    <main className="center-screen">
      <form className="join-card" onSubmit={onSubmit}>
        <div className="join-card__brand"><GameLogo /></div>

        <label className="field">
          <span className="field__label">Trader name</span>
          <input
            className="input"
            data-testid="name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={nameMaxLength}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. Gordon"
          />
        </label>

        <button type="submit" className="btn btn--primary btn--wide" data-testid="join-button" disabled={!valid || joining}>
          {joining ? (connection === 'open' ? 'Joining...' : 'Waiting for server...') : 'Join game'}
        </button>

        <ErrorBanner />

        {target.room !== null && (
          <div className="room-chip" data-testid="room-chip">
            Room <span className="room-chip__code">{target.room}</span>
            <button type="button" className="btn btn--ghost" data-testid="room-leave" onClick={target.leaveRoom}>Change room</button>
          </div>
        )}
        {target.mode === 'lan' && target.canSwitch && (
          <button type="button" className="btn btn--ghost mode-switch" data-testid="mode-online" onClick={() => target.setMode('online')}>
            Playing over the internet? Play online
          </button>
        )}

        <div className="join-card__foot">
          <CreditButton />
          <ViewLink to="floor" />
          <ConnectionBadge />
        </div>
      </form>
    </main>
  );
}
