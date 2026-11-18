// Needle-and-ball plant dynamics. Pure module: no DOM, deterministic.
//
// Sign conventions (brief §5.2):
//   eN ∈ [-1, 1]  0 = needle on the red dot (9 o'clock); +1 = tip maxAngle ABOVE the dot.
//   eB ∈ [-1, 1]  0 = ball on the centre dot; -1 = left end, +1 = right end.
//   stick ∈ [-1, 1]  +1 = full forward (push).   pedal ∈ [-1, 1]  +1 = full right pedal.
//
// Per channel, order 1 (rate control, default):
//   u_d  = u(t − deadTime) + coupling
//   vCmd = topSpeed·u_d + drift(t)
//   v   += (vCmd − v)·(1 − e^(−dt/lag))        first-order lag ("heaviness")
//   e   += (v + runaway·e)·dt, clamped to ±1    runaway > 0: error grows on its own
//                                               runaway < 0: drifts back to centre
// Order 0 (position control): e = gain0·lag(u_d) + P(t), where P is the drift
// integrated (with a slow leak so it stays centred) – the hands-off motion
// therefore looks the same in both orders.

import { Drift } from './disturbance.js';

export const DT = 1 / 120; // fixed physics step (s)
export const MAX_DEAD_TIME = 0.5; // s
const BUF = Math.round(MAX_DEAD_TIME / DT) + 1;
export const ORDER0_LEAK = 0.05; // 1/s

export const clamp = (x, lo = -1, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

export class Channel {
  constructor(seed, id, opt = {}) {
    this.drift = new Drift(seed, id, opt);
    this.e = 0; // error (what is drawn)
    this.v = 0; // velocity (order 1)
    this.P = 0; // integrated drift (order 0)
    this.uf = 0; // lagged input (order 0)
    this.buf = new Float64Array(BUF);
    this.bi = 0;
  }

  /**
   * @param {number} u      control input in channel units (+1 drives the error toward +1)
   * @param {object} cp     channel profile (read live)
   * @param {number} extra  coupled input from the other channel
   * @param {number} dt
   */
  step(u, cp, extra, dt) {
    this.buf[this.bi] = u;
    const n = Math.min(BUF - 1, Math.max(0, Math.round(cp.deadTime / dt)));
    const ud = this.buf[(this.bi - n + BUF) % BUF] + extra;
    this.bi = (this.bi + 1) % BUF;

    const d = this.drift.step(dt, cp.drift);
    const a = cp.lag > 1e-4 ? 1 - Math.exp(-dt / cp.lag) : 1;

    if (cp.order === 0) {
      this.P = clamp(this.P + (d - ORDER0_LEAK * this.P) * dt, -1.5, 1.5);
      this.uf += (ud - this.uf) * a;
      this.e = clamp(cp.gain0 * this.uf + this.P);
      this.v = 0;
    } else {
      this.v += (cp.topSpeed * ud + d - this.v) * a;
      let e = this.e + (this.v + cp.runaway * this.e) * dt;
      if (e >= 1) {
        e = 1;
        if (this.v > 0) this.v = 0; // stops at the end stop
      } else if (e <= -1) {
        e = -1;
        if (this.v < 0) this.v = 0;
      }
      this.e = e;
    }
  }
}

/** Map device values to channel inputs using the profile's direction settings. */
export function mapInputs(profile, stick, pedal) {
  const uN = (profile.directions.stick === 'inverted' ? 1 : -1) * stick; // aviation: push → needle down
  const uB = (profile.directions.pedal === 'push' ? 1 : -1) * pedal; // step on the ball: right → ball left
  return { uN, uB };
}

export class Simulator {
  /**
   * @param {{profile: object, seed: number, mode?: 'both'|'needle'|'ball', runLength?: number, fadeIn?: boolean}} o
   * The profile object is read live (Tuning Lab edits apply immediately).
   */
  constructor(o) {
    this.profile = o.profile;
    this.seed = o.seed >>> 0;
    this.mode = o.mode || 'both';
    this.tick = 0;
    const opt = { runLength: o.runLength || 0, fadeIn: o.fadeIn !== false };
    this.N = new Channel(this.seed, 1, opt);
    this.B = new Channel(this.seed, 2, opt);
    this.nOn = this.mode !== 'ball';
    this.bOn = this.mode !== 'needle';
  }

  get t() {
    return this.tick * DT;
  }

  step(stick, pedal) {
    const p = this.profile;
    const { uN, uB } = mapInputs(p, stick, pedal);
    const c = p.coupling || {};
    if (this.nOn) this.N.step(uN, p.needle, (c.pedalToNeedle || 0) * uB, DT);
    if (this.bOn) this.B.step(uB, p.ball, (c.stickToBall || 0) * uN, DT);
    this.tick++;
  }
}
