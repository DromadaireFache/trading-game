import { useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, setMuted } from './sound.ts';

/** Speaker on/off switch (a speaker with sound waves, or crossed out when muted), remembered per browser. */
export function SoundToggle() {
  const muted = useSyncExternalStore(onMuteChange, isMuted);
  return (
    <button
      type="button"
      className="sound-toggle"
      data-testid="sound-toggle"
      aria-label={muted ? 'Sound off' : 'Sound on'}
      aria-pressed={!muted}
      title={muted ? 'Enable sound' : 'Mute sound'}
      onClick={() => setMuted(!muted)}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9l5 6M21 9l-5 6" />
        ) : (
          <>
            <path d="M16 9.5a3.5 3.5 0 0 1 0 5" />
            <path d="M18.5 7a7 7 0 0 1 0 10" />
          </>
        )}
      </svg>
    </button>
  );
}
