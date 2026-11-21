import { useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, setMuted } from './sound.ts';

/** Small SOUND on/off switch, remembered per browser. */
export function SoundToggle() {
  const muted = useSyncExternalStore(onMuteChange, isMuted);
  return (
    <button
      type="button"
      className={`sound-toggle${muted ? ' sound-toggle--off' : ''}`}
      data-testid="sound-toggle"
      aria-pressed={!muted}
      title={muted ? 'Sound is off' : 'Sound is on (needs one click on the page first)'}
      onClick={() => setMuted(!muted)}
    >
      SOUND
    </button>
  );
}
