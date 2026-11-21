import { SECTOR_LABELS } from '@tg/shared';
import { useGame } from '../../net/GameProvider.tsx';
import './tape.css';

/** Headlines on the tape, newest first. */
const TAPE_HEADLINES = 6;
/** Scroll speed of the tape, in characters per second. */
const CHARS_PER_SECOND = 14;

/**
 * Projector news ticker: the latest public headlines scrolling along the bottom, newest first.
 * One CSS animation; it restarts only when a new headline arrives (keyed on the newest id), never on
 * a price tick. Its duration follows the length of the text so the speed stays the same.
 */
export function HeadlineTape() {
  const { headlines, phase } = useGame();
  const current = phase?.phase ?? 'LOBBY';
  const shown = headlines.filter((h) => !h.early).slice(0, TAPE_HEADLINES);
  if (current === 'LOBBY' || shown.length === 0) return null;

  const items = shown.map((h, i) => ({
    key: h.id,
    tag: h.symbol ?? (h.sector ? SECTOR_LABELS[h.sector] : 'MARKET'),
    text: h.text,
    fresh: i === 0,
  }));
  const chars = items.reduce((n, it) => n + it.tag.length + it.text.length + 6, 0);
  const seconds = Math.max(12, chars / CHARS_PER_SECOND);
  const row = (copy: number) =>
    items.map((it) => (
      <span key={`${copy}-${it.key}`} className={`tape__item${it.fresh ? ' tape__item--fresh' : ''}`}>
        <span className="tape__tag">{it.tag}</span>
        {it.text}
        <span className="tape__sep" aria-hidden="true">
          ◆
        </span>
      </span>
    ));

  return (
    <div className="tape" data-testid="floor-tape" aria-label="Latest headlines">
      <span className="tape__label">NEWS</span>
      <div className="tape__window">
        {/* Two copies back to back: the track slides by one copy and loops without a gap. */}
        <div key={items[0]!.key} className="tape__track" style={{ animationDuration: `${seconds.toFixed(1)}s` }}>
          <span className="tape__copy">{row(0)}</span>
          <span className="tape__copy" aria-hidden="true">
            {row(1)}
          </span>
        </div>
      </div>
    </div>
  );
}
