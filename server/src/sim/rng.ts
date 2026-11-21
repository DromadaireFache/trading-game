/**
 * Seeded RNG for the sim (mulberry32). The ONLY source of randomness allowed in server/src/sim.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Standard normal (Box-Muller). */
  normal(): number;
  /**
   * Fills `out` with independent standard normals. Uses both outputs of each Box-Muller pair, so it
   * costs half of calling normal() out.length times (the market's hot loop); an odd length drops
   * the last pair's second value. Deterministic like everything else here.
   */
  fillNormal(out: Float64Array): void;
  /** Independent child stream, e.g. one per subsystem so adding draws in one does not shift another. */
  fork(): Rng;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    normal: () => {
      const u = 1 - next(); // (0, 1]
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    fillNormal: (out) => {
      const n = out.length;
      for (let i = 0; i < n; i += 2) {
        const radius = Math.sqrt(-2 * Math.log(1 - next())); // 1 - next() is in (0, 1]
        const angle = 2 * Math.PI * next();
        out[i] = radius * Math.cos(angle);
        if (i + 1 < n) out[i + 1] = radius * Math.sin(angle);
      }
    },
    fork: () => createRng(Math.floor(next() * 4294967296)),
  };
}
