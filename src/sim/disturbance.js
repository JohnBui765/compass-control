// Drift (disturbance) for one channel. Pure module: no DOM.
//
// The drift is a velocity in full-scale units per second (FS/s; 1 FS = needle
// at maxAngle, or ball at the end of the track). It is the sum of:
//   1. "wander"  – five sines at 0.06–0.53 Hz (brief §5.5), each ±10 % per run,
//                  random phases. Normalised to RMS = 1, then × strength.
//                  Five or more sines are unpredictable to a human tracker.
//   2. "shoves"  – optional 0.3 s half-sine velocity pulses every gustMin–gustMax s
//                  (the brief's "bouncy" style), size × strength.
//   3. "pushes"  – optional steady bias that changes every pushMin–pushMax s,
//                  forcing you to hold a steady correction, size × strength.
//   4. busy/calm – optional slow swell of the wander amplitude.
//   5. ramp      – optional rise in intensity across a run (mean unchanged).
// Settings are read live on every step, so the Tuning Lab can change them
// mid-run. Phases are accumulated, so changing "restlessness" never jumps.

import { stream } from './prng.js';

export const WANDER_FREQS = [0.06, 0.11, 0.19, 0.31, 0.53]; // Hz
export const WANDER_WEIGHTS = [1.0, 0.8, 0.6, 0.45, 0.3];
const WANDER_RMS = Math.sqrt(WANDER_WEIGHTS.reduce((s, w) => s + w * w, 0) / 2);
export const GUST_DUR = 0.3; // s
export const PUSH_BLEND = 0.6; // s, smooth change from one steady push to the next
export const FADE_IN = 1.5; // s, the drift eases in at the start of a run

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const uni = (r, a, b) => Math.min(a, b) + Math.abs(b - a) * r();

export class Drift {
  /**
   * @param {number} seed     run seed
   * @param {number} channel  1 = needle, 2 = ball
   * @param {{runLength?: number, fadeIn?: boolean}} [opt]
   */
  constructor(seed, channel, opt = {}) {
    const base = channel * 16;
    const rw = stream(seed, base + 1);
    this.freq = WANDER_FREQS.map((f) => f * (0.9 + 0.2 * rw()));
    this.phase = WANDER_FREQS.map(() => 2 * Math.PI * rw());
    this.rGust = stream(seed, base + 2);
    this.rPush = stream(seed, base + 3);
    this.busyPhase = 2 * Math.PI * stream(seed, base + 4)();
    this.runLength = opt.runLength || 0;
    this.fadeIn = opt.fadeIn !== false;
    this.t = 0;
    this.gustNext = -1;
    this.gustT0 = -1e9;
    this.gustAmp = 0;
    this.pushNext = -1;
    this.pushFrom = 0;
    this.pushTo = 0;
    this.pushT0 = 0;
  }

  pushAt(t) {
    return this.pushFrom + (this.pushTo - this.pushFrom) * smooth((t - this.pushT0) / PUSH_BLEND);
  }

  /** Advance by dt and return the drift velocity at the new time. p = channel.drift settings. */
  step(dt, p) {
    const t = (this.t += dt);

    // 1. wander
    const k = 2 * Math.PI * p.speed * dt;
    let w = 0;
    for (let i = 0; i < 5; i++) {
      this.phase[i] += k * this.freq[i];
      w += WANDER_WEIGHTS[i] * Math.sin(this.phase[i]);
    }
    w /= WANDER_RMS;
    if (p.busy > 0) {
      const m = 1 + p.busy * Math.sin((2 * Math.PI * t) / Math.max(1, p.busyPeriod) + this.busyPhase);
      w *= m / Math.sqrt(1 + (p.busy * p.busy) / 2);
    }

    // 2. shoves – the schedule always advances, so their timing is identical
    //    whatever their size (or whether they are switched on).
    if (this.gustNext < 0) this.gustNext = t + uni(this.rGust, p.gustMin, p.gustMax);
    if (t >= this.gustNext) {
      this.gustT0 = t;
      this.gustAmp = (this.rGust() < 0.5 ? -1 : 1) * (0.7 + 0.3 * this.rGust());
      this.gustNext = t + GUST_DUR + uni(this.rGust, p.gustMin, p.gustMax);
    }
    const gt = t - this.gustT0;
    const g = gt < GUST_DUR ? this.gustAmp * Math.sin((Math.PI * gt) / GUST_DUR) : 0;

    // 3. steady pushes
    if (this.pushNext < 0) {
      this.pushTo = 2 * this.rPush() - 1;
      this.pushT0 = t;
      this.pushNext = t + uni(this.rPush, p.pushMin, p.pushMax);
    } else if (t >= this.pushNext) {
      this.pushFrom = this.pushAt(t);
      this.pushTo = 2 * this.rPush() - 1;
      this.pushT0 = t;
      this.pushNext = t + uni(this.rPush, p.pushMin, p.pushMax);
    }
    const push = this.pushAt(t);

    let d = p.strength * (w + p.gustSize * g + p.pushSize * push);
    if (p.ramp > 0 && this.runLength > 0) d *= 1 + p.ramp * (Math.min(t / this.runLength, 1) - 0.5);
    if (this.fadeIn) d *= smooth(t / FADE_IN);
    return d;
  }
}
