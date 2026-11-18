// "Feel readouts": translate parameters into numbers people can remember
// ("hands off, it leaves the dot in about 2 s"). Pure module: no DOM.

import { Channel, DT } from './model.js';

const noDrift = (cp) => ({ ...cp, drift: { ...cp.drift, strength: 0 } });

/**
 * Median time (s) for a hands-off channel, starting on the dot, to leave its
 * on-target band. Uses many independent drift samples.
 */
export function leaveTime(cp, tol, { trials = 31, maxT = 15, seed = 911 } = {}) {
  const times = [];
  const warm = Math.round(1 / DT);
  const max = Math.round(maxT / DT);
  for (let k = 0; k < trials; k++) {
    const ch = new Channel(seed + k * 7919, 1, { fadeIn: false });
    for (let i = 0; i < warm; i++) {
      ch.step(0, cp, 0, DT); // let the drift (and lag) get going, held on the dot
      ch.e = 0;
      ch.P = 0;
    }
    let n = 0;
    while (n < max) {
      ch.step(0, cp, 0, DT);
      n++;
      if (Math.abs(ch.e) > tol) break;
    }
    times.push(n * DT);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1];
}

/** Time (s) for full input to carry the channel from the dot to the end stop (no drift). */
export function fullInputTime(cp) {
  const ch = new Channel(1, 1, { fadeIn: false });
  const p = noDrift(cp);
  const target = cp.order === 0 ? 0.95 * Math.min(1, cp.gain0) : 0.999;
  let n = 0;
  while (n < 10 / DT && ch.e < target) {
    ch.step(1, p, 0, DT);
    n++;
  }
  return n * DT;
}

/**
 * Full input for 0.5 s, then let go: how far it keeps going (FS) and for how
 * long (s). Captures lag + delay ("it kept sliding after I centred").
 */
export function slideAfterRelease(cp) {
  if (cp.order === 0) return { dist: 0, time: cp.deadTime + 3 * cp.lag };
  const p = { ...noDrift(cp), runaway: 0 };
  const ch = new Channel(1, 1, { fadeIn: false });
  ch.e = -0.95;
  for (let i = 0; i < Math.round(0.5 / DT); i++) ch.step(1, p, 0, DT);
  const e0 = ch.e;
  let n = 0;
  const vStop = 0.02 * Math.max(0.05, cp.topSpeed);
  while (n < 5 / DT) {
    ch.step(0, p, 0, DT);
    n++;
    if (n * DT > cp.deadTime && Math.abs(ch.v) < vStop) break;
  }
  return { dist: ch.e - e0, time: n * DT };
}

/** Find the drift strength that gives a target median leave time (bisection). */
export function solveStrength(cp, tol, targetSec) {
  let lo = Math.log(0.01);
  let hi = Math.log(2);
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const t = leaveTime({ ...cp, drift: { ...cp.drift, strength: Math.exp(mid) } }, tol, { trials: 21 });
    if (t > targetSec) lo = mid;
    else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}

/** Bundle of readouts for one channel. unitPerFS: degrees (needle) or "% track" (ball). */
export function describeChannel(cp, tol) {
  return {
    leave: leaveTime(cp, tol),
    full: fullInputTime(cp),
    slide: slideAfterRelease(cp),
  };
}
