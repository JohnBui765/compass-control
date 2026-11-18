// Seeded pseudo-random numbers. Pure module: no DOM, no Math.random.
// Every run has a 32-bit seed; each random component (needle wander, ball
// gusts, ...) draws from its own stream so that changing one setting never
// changes the pattern of another (important for fair A/B comparisons).

/** mulberry32: small, fast, good enough for simulation noise. Returns () => [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit integer hash (murmur3 finaliser). */
export function hash32(x) {
  x >>>= 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Independent stream `id` derived from `seed`. */
export function stream(seed, id) {
  return mulberry32(hash32((seed >>> 0) ^ hash32(Math.imul(id + 1, 0x9e3779b9))));
}

/** Fresh random 32-bit seed (uses crypto when available). */
export function randomSeed() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] >>> 0;
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
