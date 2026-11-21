import { useEffect } from 'react';
import { useGame, useGameClient } from '../net/GameProvider.tsx';

/** Shows the last server error (rejected order, name taken, ...) and auto-dismisses it. */
export function ErrorBanner() {
  const { error, config } = useGame();
  const visibleMs = config.presentation.errorVisibleMs;
  const client = useGameClient();

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => client.dismissError(), visibleMs);
    return () => clearTimeout(id);
  }, [error, client, visibleMs]);

  if (!error) return null;
  return (
    <div className="error-banner" role="alert" data-testid="error" data-code={error.code}>
      <span>{error.message}</span>
      <button type="button" className="btn btn--ghost" onClick={() => client.dismissError()} aria-label="Dismiss">
        x
      </button>
    </div>
  );
}
