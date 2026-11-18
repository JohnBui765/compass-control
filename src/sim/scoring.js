// Practice scoring (self-designed; NOT the official COMPASS score). Pure module.
//
// Per channel:  RMS error, time on target (%), and
//   score = 100 × max(0, 1 − RMS_player / RMS_free)
// where RMS_free is the same run (same seed, profile, mode, length) re-simulated
// with zero input: 100 = perfect, 0 = no better than letting go.
// Note: both RMS values grow with drift amplitude, so the ratio is fairly
// insensitive to drift STRENGTH and more sensitive to drift RESTLESSNESS;
// time on target (fixed band) responds directly to difficulty. Show both.

import { Simulator } from './model.js';

/** Ball radius as a fraction of the ball's half travel. Shared with the renderer. */
export const BALL_RADIUS_FRAC = 0.055;

export function tolerances(profile, scoring) {
  return {
    n: scoring.needleTolDeg / profile.maxAngle,
    b: BALL_RADIUS_FRAC * scoring.ballTolRadii,
  };
}

export class Scorer {
  constructor(tol, mode = 'both') {
    this.tol = tol;
    this.mode = mode;
    this.n = 0;
    this.sN = 0;
    this.sB = 0;
    this.cN = 0;
    this.cB = 0;
    this.cBoth = 0;
  }

  add(eN, eB) {
    this.n++;
    this.sN += eN * eN;
    this.sB += eB * eB;
    const inN = Math.abs(eN) <= this.tol.n;
    const inB = Math.abs(eB) <= this.tol.b;
    if (inN) this.cN++;
    if (inB) this.cB++;
    if (inN && inB) this.cBoth++;
  }

  result() {
    const n = Math.max(1, this.n);
    const m = this.mode;
    return {
      samples: this.n,
      rmsN: m === 'ball' ? null : Math.sqrt(this.sN / n),
      rmsB: m === 'needle' ? null : Math.sqrt(this.sB / n),
      totN: m === 'ball' ? null : (100 * this.cN) / n,
      totB: m === 'needle' ? null : (100 * this.cB) / n,
      totBoth: m === 'both' ? (100 * this.cBoth) / n : null,
    };
  }
}

/** Zero-input baseline for the same run. */
export function freeRun({ profile, seed, mode = 'both', ticks, runLength = 0 }) {
  const sim = new Simulator({ profile, seed, mode, runLength });
  let sN = 0;
  let sB = 0;
  for (let i = 0; i < ticks; i++) {
    sim.step(0, 0);
    sN += sim.N.e * sim.N.e;
    sB += sim.B.e * sim.B.e;
  }
  const n = Math.max(1, ticks);
  return { rmsN: Math.sqrt(sN / n), rmsB: Math.sqrt(sB / n) };
}

export function channelScore(rms, rmsFree) {
  if (rms == null) return null;
  if (!(rmsFree > 1e-9)) return rms < 1e-9 ? 100 : 0;
  return 100 * Math.max(0, 1 - rms / rmsFree);
}

/** Combine raw metrics with the zero-input baseline into scores. */
export function scoreRun(metrics, free, mode = 'both') {
  const scoreN = mode === 'ball' ? null : channelScore(metrics.rmsN, free.rmsN);
  const scoreB = mode === 'needle' ? null : channelScore(metrics.rmsB, free.rmsB);
  const act = [scoreN, scoreB].filter((v) => v != null);
  return {
    ...metrics,
    rmsFreeN: mode === 'ball' ? null : free.rmsN,
    rmsFreeB: mode === 'needle' ? null : free.rmsB,
    scoreN,
    scoreB,
    score: act.length ? act.reduce((a, b) => a + b, 0) / act.length : 0,
  };
}

/** Average a list of run results (null-safe). */
export function averageRuns(runs) {
  const keys = ['score', 'scoreN', 'scoreB', 'totN', 'totB', 'totBoth', 'rmsN', 'rmsB'];
  const out = {};
  for (const k of keys) {
    const v = runs.map((r) => r[k]).filter((x) => x != null && Number.isFinite(x));
    out[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  return out;
}
