import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent } from 'react';
import { useGameClient } from '../../net/GameProvider.tsx';
import { useLivePortfolio } from '../../net/portfolioHooks.ts';
import { fx, anchorOf } from '../fx/fx.ts';
import { play } from '../fx/sound.ts';
import './mayhem.css';

/**
 * A Mayhem challenge on top of the desk (Are You Human?, MonkeyType): the player cannot trade until
 * they pass it (the server refuses their orders meanwhile). It comes from the portfolio, so a reload
 * shows it again; passing it sends solve_challenge. The seed picks the grid or the sentence.
 */
export function ChallengeModal() {
  const live = useLivePortfolio();
  const client = useGameClient();
  const challenge = live?.portfolio.challenge;
  if (!challenge) return null;
  const solved = () => {
    play('ready');
    fx.popup({ text: 'HUMAN CONFIRMED', tone: 'up', ...anchorOf('.desk__order'), size: 1.4 });
    client.send({ t: 'solve_challenge', challengeId: challenge.id });
  };
  return (
    <div className="challenge" role="dialog" aria-modal="true" aria-label="Challenge" data-testid="challenge">
      <div className="challenge__card">
        {challenge.kind === 'captcha' ? (
          <Captcha key={challenge.id} seed={challenge.seed} onSolved={solved} />
        ) : (
          <Typing key={challenge.id} seed={challenge.seed} onSolved={solved} />
        )}
      </div>
    </div>
  );
}

/** Small seeded generator (mulberry32): the same seed always draws the same grid or sentence. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 3x3 captcha

interface Tile {
  up: boolean;
  /** Closes of a little 6-candle chart, 0..1. */
  closes: number[];
}

/** Nine tiles, 2 to 6 of them rising (the rest falling); each a different little chart. */
function grid(seed: number): Tile[] {
  const r = rng(seed);
  const ups = 2 + Math.floor(r() * 5);
  const flags = Array.from({ length: 9 }, (_, i) => i < ups);
  for (let i = flags.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [flags[i], flags[j]] = [flags[j]!, flags[i]!];
  }
  return flags.map((up) => {
    const closes: number[] = [];
    let v = up ? 0.2 + r() * 0.15 : 0.65 + r() * 0.15;
    for (let k = 0; k < 6; k++) {
      v += (up ? 1 : -1) * (0.05 + r() * 0.08) + (r() - 0.5) * 0.12;
      closes.push(Math.min(0.95, Math.max(0.05, v)));
    }
    // Make sure the trend reads: the last close clearly above (or below) the first.
    if (up && closes[5]! <= closes[0]! + 0.15) closes[5] = Math.min(0.95, closes[0]! + 0.25);
    if (!up && closes[5]! >= closes[0]! - 0.15) closes[5] = Math.max(0.05, closes[0]! - 0.25);
    return { up, closes };
  });
}

function Captcha({ seed, onSolved }: { seed: number; onSolved: () => void }) {
  const [round, setRound] = useState(0);
  const tiles = useMemo(() => grid(seed + round * 7919), [seed, round]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState(false);
  const verify = () => {
    const ok = tiles.every((t, i) => t.up === picked.has(i));
    if (ok) return onSolved();
    play('reject');
    setWrong(true);
    setPicked(new Set());
    setRound((n) => n + 1);
  };
  return (
    <>
      <header className="challenge__head challenge__head--captcha">
        <span className="challenge__small">Select all squares with</span>
        <span className="challenge__big">stocks going UP</span>
        <span className="challenge__small">Click verify once there are none left.</span>
      </header>
      <div className={`captcha${wrong ? ' captcha--wrong' : ''}`} onAnimationEnd={() => setWrong(false)} data-testid="captcha">
        {tiles.map((t, i) => (
          <button
            key={`${round}-${i}`}
            type="button"
            className={`captcha__tile${picked.has(i) ? ' captcha__tile--on' : ''}`}
            aria-pressed={picked.has(i)}
            onClick={() => setPicked((s) => {
              const next = new Set(s);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              return next;
            })}
            data-testid="captcha-tile"
            data-up={t.up}
          >
            <MiniChart closes={t.closes} />
          </button>
        ))}
      </div>
      <footer className="challenge__foot">
        <span className="challenge__brand">reCAPITAL</span>
        <button type="button" className="challenge__verify" onClick={verify} data-testid="captcha-verify">
          Verify
        </button>
      </footer>
    </>
  );
}

function MiniChart({ closes }: { closes: number[] }) {
  const w = 72;
  const h = 56;
  const step = w / closes.length;
  let open = closes[0]! + (closes[0]! > 0.5 ? 0.06 : -0.06);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" aria-hidden="true">
      {closes.map((c, k) => {
        const o = open;
        open = c;
        const up = c >= o;
        const y = (v: number) => h - 4 - v * (h - 8);
        const top = y(Math.max(o, c));
        const body = Math.max(2, Math.abs(y(o) - y(c)));
        const x = k * step + step / 2;
        return (
          <g key={k} className={up ? 'mini-up' : 'mini-down'}>
            <line x1={x} x2={x} y1={top - 4} y2={top + body + 4} strokeWidth={1.5} />
            <rect x={x - step * 0.3} y={top} width={step * 0.6} height={body} rx={1} />
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- MonkeyType

const SENTENCES = [
  'stonks only go up',
  'buy high and sell low like a true professional',
  'diamond hands never sell',
  'this is not financial advice',
  'i like the stock',
  'to the moon and back to my mom basement',
  'the market can stay irrational longer than i can stay solvent',
  'my portfolio is down but my spirit is up',
  'number go up technology',
  'sir this is a casino',
  'apes together strong',
  'i put my lunch money on a meme stock',
  'it is just a dip until it is a crater',
  'the chart is a straight line if you squint',
  'past performance does not guarantee future gains',
  'my financial advisor is a goldfish',
  'bears are just bulls who lost their glasses',
  'leverage is free money until it is not',
  'hold the line the short squeeze is coming',
  'a candle a day keeps the margin call away',
];

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function Typing({ seed, onSolved }: { seed: number; onSolved: () => void }) {
  const sentence = SENTENCES[Math.floor(rng(seed)() * SENTENCES.length)]!;
  const [typed, setTyped] = useState('');
  const done = normalize(typed) === normalize(sentence);
  // Report once, however often the parent re-renders.
  const sent = useRef(false);
  useEffect(() => {
    if (done && !sent.current) {
      sent.current = true;
      onSolved();
    }
  }, [done, onSolved]);
  const noPaste = (e: ClipboardEvent | DragEvent) => e.preventDefault();
  // The box takes the keyboard the moment the challenge opens (the bare autoFocus lost to whatever
  // button the player had just clicked) and keeps it: a click anywhere, or a stray blur, puts the
  // caret back, so they can just start typing. The challenge is a blocking modal, so nothing else
  // on the page needs focus meanwhile.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => input.current?.focus();
    focus();
    const raf = requestAnimationFrame(focus);
    const keep = (e: MouseEvent) => {
      if (e.target === input.current) return;
      e.preventDefault();
      focus();
    };
    document.addEventListener('mousedown', keep);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', keep);
    };
  }, []);
  return (
    <>
      <header className="challenge__head challenge__head--typing">
        <span className="challenge__big">MonkeyType</span>
        <span className="challenge__small">Type it. No pasting.</span>
      </header>
      <p className="typing__target" data-testid="typing-sentence" data-sentence={sentence}>
        {[...sentence].map((ch, i) => {
          const got = typed[i];
          const state = got === undefined ? (i === typed.length ? 'caret' : 'todo') : got.toLowerCase() === ch ? 'ok' : 'bad';
          return (
            <span key={i} className={`typing__ch typing__ch--${state}`}>
              {ch}
            </span>
          );
        })}
      </p>
      <input
        ref={input}
        className="typing__input"
        autoFocus
        onBlur={() => setTimeout(() => input.current?.focus(), 0)}
        value={typed}
        onChange={(e) => setTyped(e.target.value.slice(0, sentence.length + 5))}
        onPaste={noPaste}
        onDrop={noPaste}
        spellCheck={false}
        autoComplete="off"
        aria-label="Type the sentence"
        data-testid="typing-input"
      />
      <footer className="challenge__foot">
        <span className="challenge__brand">
          {Math.min(typed.length, sentence.length)}/{sentence.length}
        </span>
      </footer>
    </>
  );
}
