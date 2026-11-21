import { useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, setMuted } from './sound.ts';

/** Small SOUND on/off switch, remembered per browser. */
export function SoundToggle() {
  const muted = useSyncExternalStore(onMuteChange, isMuted);
  return (
    <button
      type="button"
      className="sound-toggle"
      data-testid="sound-toggle"
      aria-label="Sound"
      aria-pressed={!muted}
      title={muted ? 'Enable sound' : 'Mute sound'}
      onClick={() => setMuted(!muted)}
    >
      {muted ? 'SOUND OFF' : 'SOUND ON'}
    </button>
  );
}
