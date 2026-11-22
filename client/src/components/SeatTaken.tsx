import { ConnectionBadge } from './ConnectionBadge.tsx';
import { GameLogo } from './GameLogo.tsx';

/**
 * Shown instead of the game when another tab took over this session (same token). This tab is
 * disconnected for good, so nothing live-looking may stay on screen; a reload takes the seat back.
 */
export function SeatTaken() {
  return (
    <main className="center-screen" data-testid="seat-taken">
      <div className="join-card" role="alert">
        <div className="join-card__brand"><GameLogo variant="full" /></div>
        <p className="seat-taken__text">
          This seat was opened in another tab or window, so this one is disconnected. Reload to take the seat back here.
        </p>
        <button type="button" className="btn btn--primary btn--wide" data-testid="reload-button" onClick={() => location.reload()}>
          Reload
        </button>
        <div className="join-card__foot">
          <ConnectionBadge />
        </div>
      </div>
    </main>
  );
}
