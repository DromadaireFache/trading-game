/**
 * Synthesized sound effects (WebAudio, no files: the game runs offline on a LAN).
 *
 * Browsers require a user gesture, so the AudioContext is unlocked on a click, tap, or keypress.
 * Until then play() is a no-op. Muting is per browser
 * (localStorage 'tg.muted'). Everything here is best-effort: a failure never reaches the game.
 */

export type SoundName =
  | 'fill' | 'cash' | 'loss' | 'news' | 'whoosh' | 'sting' | 'bell' | 'pop' | 'count' | 'thump' | 'card' | 'secret' | 'siren'
  | 'briefing' | 'earnings' | 'shop' | 'final' | 'ready' | 'reject' | 'betWin' | 'betLoss';

const MUTE_KEY = 'tg.muted';
const MASTER_GAIN = 0.22;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
const listeners = new Set<() => void>();
/** Per-sound minimum gap, so a burst of events does not turn into noise. */
const lastPlayed = new Map<SoundName, number>();
const MIN_GAP_MS: Partial<Record<SoundName, number>> = { count: 35, news: 120, fill: 60, reject: 300, betWin: 300, betLoss: 300 };

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

async function unlock(): Promise<void> {
  try {
    if (!ctx || ctx.state === 'closed') {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const audio = new Ctor();
      const gain = audio.createGain();
      gain.gain.value = muted ? 0 : MASTER_GAIN;
      gain.connect(audio.destination);
      ctx = audio;
      master = gain;
    }
    if (ctx.state !== 'running') await ctx.resume();
  } catch {
    // A later gesture can retry if the browser blocks audio.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('click', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // private mode: the toggle still works for this page
  }
  if (master) master.gain.value = value ? 0 : MASTER_GAIN;
  for (const l of listeners) l();
  if (!value) void unlock().then(() => play('ready'));
}

export function onMuteChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once the page may make sound (after the first click or key press). */
export function soundReady(): boolean {
  return ctx !== null && ctx.state === 'running';
}

interface Tone {
  freq: number;
  to?: number;
  type?: OscillatorType;
  start?: number;
  dur: number;
  gain?: number;
}

function tone(t0: number, { freq, to, type = 'sine', start = 0, dur, gain = 1 }: Tone): void {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  const at = t0 + start;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.012, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(master!);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noise(t0: number, { start = 0, dur, from, to, gain = 1, q = 1.2 }: { start?: number; dur: number; from: number; to: number; gain?: number; q?: number }): void {
  const c = ctx!;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  const at = t0 + start;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(master!);
  src.start(at);
}

/** `pitch` shifts the sound up (1 = as designed); used to climb during count-ups. */
export function play(name: SoundName, pitch = 1): void {
  if (muted || !ctx || !master || ctx.state !== 'running') return;
  const nowMs = performance.now();
  const gap = MIN_GAP_MS[name] ?? 0;
  if (gap > 0 && nowMs - (lastPlayed.get(name) ?? -Infinity) < gap) return;
  lastPlayed.set(name, nowMs);
  try {
    const t = ctx.currentTime;
    const p = pitch;
    switch (name) {
      case 'fill': // a chip clacking on felt
        tone(t, { freq: 1400 * p, to: 900 * p, type: 'square', dur: 0.04, gain: 0.35 });
        tone(t, { freq: 2100 * p, to: 1500 * p, type: 'triangle', start: 0.035, dur: 0.06, gain: 0.3 });
        break;
      case 'cash': // rising arpeggio
        [523, 659, 784, 1047].forEach((f, i) => tone(t, { freq: f * p, type: 'triangle', start: i * 0.055, dur: 0.16, gain: 0.45 }));
        tone(t, { freq: 2093 * p, type: 'sine', start: 0.22, dur: 0.35, gain: 0.25 });
        break;
      case 'loss':
        tone(t, { freq: 330 * p, to: 110 * p, type: 'sawtooth', dur: 0.45, gain: 0.3 });
        tone(t, { freq: 247 * p, to: 82 * p, type: 'square', start: 0.05, dur: 0.4, gain: 0.15 });
        break;
      case 'news':
        tone(t, { freq: 1320 * p, type: 'square', dur: 0.045, gain: 0.2 });
        tone(t, { freq: 1760 * p, type: 'square', start: 0.06, dur: 0.05, gain: 0.18 });
        break;
      case 'whoosh':
        noise(t, { dur: 0.55, from: 300, to: 3200, gain: 0.5 });
        tone(t, { freq: 90, to: 45, type: 'sine', dur: 0.4, gain: 0.5 });
        break;
      case 'sting': // BREAKING: brass stab + hit
        noise(t, { dur: 0.3, from: 2000, to: 400, gain: 0.6, q: 0.7 });
        for (const f of [196, 247, 294, 392]) tone(t, { freq: f, type: 'sawtooth', start: 0.02, dur: 0.75, gain: 0.18 });
        for (const f of [208, 262, 311, 415]) tone(t, { freq: f, type: 'sawtooth', start: 0.42, dur: 0.9, gain: 0.16 });
        tone(t, { freq: 60, to: 35, type: 'sine', dur: 0.5, gain: 0.8 });
        break;
      case 'bell':
        tone(t, { freq: 880, type: 'sine', dur: 1.1, gain: 0.45 });
        tone(t, { freq: 1320, type: 'sine', dur: 0.7, gain: 0.2 });
        tone(t, { freq: 2640, type: 'sine', dur: 0.3, gain: 0.08 });
        break;
      case 'briefing': // a short news bulletin lead-in
        for (const [i, freq] of [392, 494, 587].entries()) {
          tone(t, { freq, type: 'triangle', start: i * 0.08, dur: 0.18, gain: 0.34 });
        }
        break;
      case 'earnings': // report hits the desk, then two alert notes
        noise(t, { dur: 0.14, from: 4200, to: 1300, gain: 0.5 });
        tone(t, { freq: 784, type: 'triangle', start: 0.06, dur: 0.16, gain: 0.42 });
        tone(t, { freq: 1175, type: 'triangle', start: 0.17, dur: 0.3, gain: 0.38 });
        break;
      case 'shop': // cash drawer and a bright chime
        noise(t, { dur: 0.08, from: 1300, to: 5000, gain: 0.48 });
        tone(t, { freq: 1568, start: 0.06, dur: 0.35, gain: 0.35 });
        tone(t, { freq: 2349, start: 0.14, dur: 0.32, gain: 0.22 });
        break;
      case 'final':
        for (const [i, freq] of [392, 523, 659, 784, 1047].entries()) {
          tone(t, { freq, type: 'triangle', start: i * 0.115, dur: 0.32, gain: 0.34 });
        }
        tone(t, { freq: 262, start: 0.46, dur: 0.65, gain: 0.4 });
        break;
      case 'ready':
        tone(t, { freq: 622, dur: 0.09, gain: 0.44 });
        tone(t, { freq: 932, start: 0.07, dur: 0.14, gain: 0.36 });
        break;
      case 'reject':
        tone(t, { freq: 235, to: 175, type: 'triangle', dur: 0.17, gain: 0.55 });
        tone(t, { freq: 147, type: 'triangle', start: 0.09, dur: 0.17, gain: 0.32 });
        break;
      case 'betWin':
        tone(t, { freq: 659 * p, type: 'triangle', dur: 0.16, gain: 0.44 });
        tone(t, { freq: 988 * p, start: 0.08, dur: 0.24, gain: 0.43 });
        noise(t, { start: 0.09, dur: 0.14, from: 5200, to: 6800, gain: 0.35 });
        break;
      case 'betLoss':
        tone(t, { freq: 392, to: 294, type: 'triangle', dur: 0.16, gain: 0.46 });
        tone(t, { freq: 247, to: 185, type: 'triangle', start: 0.11, dur: 0.23, gain: 0.36 });
        break;
      case 'pop':
        tone(t, { freq: 420 * p, to: 980 * p, type: 'sine', dur: 0.09, gain: 0.5 });
        break;
      case 'count':
        tone(t, { freq: 1500 * p, type: 'triangle', dur: 0.025, gain: 0.18 });
        break;
      case 'thump':
        tone(t, { freq: 110, to: 40, type: 'sine', dur: 0.22, gain: 0.9 });
        break;
      case 'card': // a card flicked onto the table
        noise(t, { dur: 0.09, from: 6000, to: 2500, gain: 0.5, q: 0.8 });
        tone(t, { freq: 700 * p, to: 1100 * p, type: 'triangle', start: 0.02, dur: 0.07, gain: 0.25 });
        break;
      case 'secret': // a whispered tip: two soft bells, a fifth apart
        tone(t, { freq: 988, type: 'sine', dur: 0.5, gain: 0.3 });
        tone(t, { freq: 1480, type: 'sine', start: 0.12, dur: 0.6, gain: 0.25 });
        tone(t, { freq: 2960, type: 'sine', start: 0.12, dur: 0.25, gain: 0.06 });
        break;
      case 'siren': // busted
        tone(t, { freq: 660, to: 990, type: 'square', dur: 0.25, gain: 0.2 });
        tone(t, { freq: 990, to: 660, type: 'square', start: 0.25, dur: 0.25, gain: 0.2 });
        tone(t, { freq: 660, to: 990, type: 'square', start: 0.5, dur: 0.25, gain: 0.2 });
        break;
    }
  } catch {
    // never let a sound break the game
  }
}
