// Fixed-timestep run engine. Pure module: no DOM (the UI feeds it frame
// timestamps, so tests can drive it at any frame rate).
//
// Timing: physics runs at 120 Hz. Each tick k has a nominal wall time
//   tickWall(k) = wall0 + pausedMs + (k + 1) · 8.333 ms
// and the input sources are asked for their value AT that wall time, so each
// mouse/key event is applied at the tick in which it happened – not at the next
// frame. Results (sim AND input timing) are therefore independent of the
// display refresh rate. A run always lasts exactly N ticks.

import { Simulator, DT } from './model.js';
import { Scorer } from './scoring.js';

export const TICK_MS = DT * 1000;
const MAX_CATCHUP = 30; // ticks; a longer stall (tab hiccup) is treated as paused time
export const TRACE_EVERY = 12; // 120 Hz / 12 = 10 Hz traces

/** Input source driven by a function of the tick index (tests, A/B "watch" mode). */
export function scriptedSource(fn) {
  return { advanceTo: (_wall, _dt, k) => fn(k), reset() {} };
}
/** Input source replaying a recorded per-tick array. */
export function arraySource(arr) {
  return { advanceTo: (_wall, _dt, k) => (k < arr.length ? arr[k] : 0), reset() {} };
}
export const zeroSource = () => scriptedSource(() => 0);

export class RunEngine {
  /**
   * @param {object} o
   * @param {object} o.profile     effective test profile (read live)
   * @param {number} o.seed
   * @param {'both'|'needle'|'ball'} [o.mode]
   * @param {number} [o.durationSec]  0 = unlimited (free practice)
   * @param {{advanceTo(wallMs:number, dt:number, tick:number):number}} o.stick
   * @param {{advanceTo(wallMs:number, dt:number, tick:number):number}} o.pedal
   * @param {{n:number, b:number}} o.tol   on-target tolerances
   * @param {boolean} [o.record]     keep per-tick inputs + 10 Hz traces
   */
  constructor(o) {
    this.o = o;
    this.mode = o.mode || 'both';
    this.durationSec = o.durationSec || 0;
    this.sim = new Simulator({ profile: o.profile, seed: o.seed, mode: this.mode, runLength: this.durationSec, fadeIn: o.fadeIn });
    this.scorer = new Scorer(o.tol, this.mode);
    this.endTick = this.durationSec ? Math.round(this.durationSec / DT) : 0;
    this.stickVal = 0;
    this.pedalVal = 0;
    this.running = false;
    this.paused = false;
    this.finished = false;
    this.stalls = 0;
    this.wall0 = 0;
    this.pausedMs = 0;
    if (o.record && this.endTick) {
      this.recStick = new Float32Array(this.endTick);
      this.recPedal = new Float32Array(this.endTick);
      const n = Math.ceil(this.endTick / TRACE_EVERY);
      this.trace = { eN: new Float32Array(n), eB: new Float32Array(n), stick: new Float32Array(n), pedal: new Float32Array(n) };
    }
  }

  get eN() {
    return this.sim.N.e;
  }
  get eB() {
    return this.sim.B.e;
  }
  get elapsedSec() {
    return this.sim.tick * DT;
  }
  get remainingSec() {
    return this.endTick ? (this.endTick - this.sim.tick) * DT : Infinity;
  }

  start(nowMs) {
    this.wall0 = nowMs;
    this.pausedMs = 0;
    this.running = true;
    this.paused = false;
  }
  pause(nowMs) {
    if (this.running && !this.paused) {
      this.paused = true;
      this.pauseAt = nowMs;
    }
  }
  resume(nowMs) {
    if (this.paused) {
      this.pausedMs += nowMs - this.pauseAt;
      this.paused = false;
    }
  }

  /** Call once per animation frame. Returns the number of physics steps taken. */
  frame(nowMs) {
    if (!this.running || this.paused || this.finished) return 0;
    let target = Math.floor((nowMs - this.wall0 - this.pausedMs) / TICK_MS);
    const behind = target - this.sim.tick;
    if (behind > MAX_CATCHUP) {
      const skip = behind - MAX_CATCHUP;
      this.pausedMs += skip * TICK_MS;
      target -= skip;
      this.stalls++;
    }
    if (this.endTick && target > this.endTick) target = this.endTick;
    let steps = 0;
    while (this.sim.tick < target) {
      this.stepOnce();
      steps++;
    }
    if (this.endTick && this.sim.tick >= this.endTick) {
      this.finished = true;
      this.running = false;
    }
    return steps;
  }

  stepOnce() {
    const k = this.sim.tick;
    const tickWall = this.wall0 + this.pausedMs + (k + 1) * TICK_MS;
    // Math.fround: inputs are stored as Float32 for replays, so the live run
    // uses exactly the values a replay will read back (bit-exact replays).
    const s = Math.fround(this.o.stick.advanceTo(tickWall, DT, k));
    const p = Math.fround(this.o.pedal.advanceTo(tickWall, DT, k));
    this.stickVal = s;
    this.pedalVal = p;
    this.sim.step(s, p);
    const eN = this.sim.N.e;
    const eB = this.sim.B.e;
    this.scorer.add(eN, eB);
    if (this.recStick && k < this.endTick) {
      this.recStick[k] = s;
      this.recPedal[k] = p;
      if (k % TRACE_EVERY === 0) {
        const j = k / TRACE_EVERY;
        this.trace.eN[j] = eN;
        this.trace.eB[j] = eB;
        this.trace.stick[j] = s;
        this.trace.pedal[j] = p;
      }
    }
  }

  /** Run synchronously to the end (scripted/replayed inputs only). */
  runToEnd() {
    if (!this.endTick) throw new Error('runToEnd needs a finite duration');
    while (this.sim.tick < this.endTick) this.stepOnce();
    this.finished = true;
    this.running = false;
  }
}
