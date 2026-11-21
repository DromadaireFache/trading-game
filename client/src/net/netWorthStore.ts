import type { NetWorthMsg, NetWorthSample } from '@tg/shared';

/** Projector data stays outside GameState so live equity does not rerender the whole screen. */
export class NetWorthStore {
  private samples: readonly NetWorthSample[] = [];
  private readonly listeners = new Set<(msg: NetWorthMsg) => void>();

  getSamples = (): readonly NetWorthSample[] => this.samples;

  subscribe = (listener: (msg: NetWorthMsg) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  apply(msg: NetWorthMsg): void {
    if (msg.reset) {
      this.samples = msg.samples;
    } else {
      if (msg.samples.length === 0) return;
      // Tick zero is the opening balance. Corrections reuse their tick, including during the shop.
      const updated = this.samples.slice();
      for (const sample of msg.samples) updated[sample.tick] = sample;
      this.samples = updated;
    }
    for (const listener of this.listeners) listener(msg);
  }
}
