import type { SymbolId } from '@tg/shared';
import type { GameClient } from '../../net/gameClient.ts';
import { reducedMotion } from './fx.ts';

const PRESS_SCALE = 0.07;
const PRESS_MS = 190;
const MAX_PENDING_ORDERS = 256;

interface ButtonPress {
  rect: DOMRect;
  label: string;
  background: string;
  border: string;
  borderRadius: string;
  color: string;
  font: string;
}

const animations = new WeakMap<Element, Animation>();
const orderButtons = new Map<number, ButtonPress>();

function capture(button: HTMLButtonElement): ButtonPress {
  const { background, border, borderRadius, color, font } = getComputedStyle(button);
  return { rect: button.getBoundingClientRect(), label: button.textContent?.trim() ?? '', background, border, borderRadius, color, font };
}

function pop(element: Element, scale: number, duration: number, fade = false): Animation {
  animations.get(element)?.cancel();
  // Animate scale separately from the button's active or hover transform.
  const animation = element.animate([
    { scale: '0.96' },
    { scale: String(1 + scale), offset: 0.4 },
    { scale: '1', ...(fade ? { opacity: 0 } : {}) },
  ], { duration, easing: 'ease-out' });
  animations.set(element, animation);
  return animation;
}

/** A visual copy can finish its animation after a fill or dismissal removes the real button. */
function popCopy(press: ButtonPress, scale: number, duration: number, win = false): void {
  const { rect, label, ...appearance } = press;
  const copy = document.createElement('span');
  copy.className = win ? 'fx-button-copy fx-button-copy--win' : 'fx-button-copy';
  copy.setAttribute('aria-hidden', 'true');
  copy.textContent = label;
  Object.assign(copy.style, appearance, {
    left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
  });
  document.body.append(copy);
  const animation = pop(copy, scale, duration, true);
  animation.onfinish = animation.oncancel = () => copy.remove();
}

export function pressButton(button: HTMLButtonElement): void {
  if (button.disabled || reducedMotion()) return;
  const press = capture(button);
  pop(button, PRESS_SCALE, PRESS_MS);
  requestAnimationFrame(() => {
    if (!button.isConnected) popCopy(press, PRESS_SCALE, PRESS_MS);
  });
}

export function sendOrder(client: GameClient, button: HTMLButtonElement, symbol: SymbolId, qty: number): boolean {
  // A delayed fill may arrive after a reload or seat takeover.
  const requestId = 1 + Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  if (!client.send({ t: 'order', symbol, qty, requestId })) return false;
  orderButtons.set(requestId, capture(button));
  // A rejected or dropped order never sends a fill. Bound the retained click snapshots.
  if (orderButtons.size > MAX_PENDING_ORDERS) orderButtons.delete(orderButtons.keys().next().value!);
  return true;
}

export function takeOrderButton(requestId: number | undefined): ButtonPress | undefined {
  if (requestId === undefined) return undefined;
  const press = orderButtons.get(requestId);
  orderButtons.delete(requestId);
  return press;
}

export function popWinningButton(press: ButtonPress, strength: number): void {
  if (!reducedMotion()) popCopy(press, PRESS_SCALE + 0.25 * strength, 220 + 200 * strength, true);
}
