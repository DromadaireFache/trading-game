import { useState } from 'react';
import type { FormEvent } from 'react';
import { ConnectionBadge } from '../../components/ConnectionBadge.tsx';
import { ErrorBanner } from '../../components/ErrorBanner.tsx';
import { useGame, useGameClient } from '../../net/GameProvider.tsx';

/** Name entry: the first screen of /play. */
export function JoinForm() {
  const { config, join, connection } = useGame();
  const client = useGameClient();
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
        <div className="join-card__brand">TRADING GAME</div>
        <p className="join-card__tagline">Fake companies. Real panic.</p>

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

        <div className="join-card__foot">
          <ConnectionBadge />
        </div>
      </form>
    </main>
  );
}
