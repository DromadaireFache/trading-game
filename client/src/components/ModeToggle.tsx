import { UI_MODES, UI_MODE_INFO, setUiMode, useUiMode } from '../lib/uiMode.ts';

/** Simple / Normal / Pro switch. `big` = the lobby's chooser with a line about each mode. */
export function ModeToggle({ big = false }: { big?: boolean }) {
  const mode = useUiMode();
  return (
    <div className={`mode-toggle${big ? ' mode-toggle--big' : ''}`} role="radiogroup" aria-label="How much detail" data-testid="mode-toggle">
      {UI_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={m === mode}
          className={`mode-toggle__btn${m === mode ? ' mode-toggle__btn--on' : ''}`}
          title={UI_MODE_INFO[m].blurb}
          onClick={() => setUiMode(m)}
          data-testid={`mode-${m}`}
        >
          <span className="mode-toggle__label">{UI_MODE_INFO[m].label}</span>
          {big && <span className="mode-toggle__blurb">{UI_MODE_INFO[m].blurb}</span>}
        </button>
      ))}
    </div>
  );
}
