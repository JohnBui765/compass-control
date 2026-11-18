// Simulation, scoring and input-core tests. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulator, DT, mapInputs } from '../src/sim/model.js';
import { Drift } from '../src/sim/disturbance.js';
import { Scorer, freeRun, scoreRun, tolerances, BALL_RADIUS_FRAC } from '../src/sim/scoring.js';
import { RunEngine, scriptedSource, arraySource, TICK_MS } from '../src/sim/engine.js';
import { DEFAULT_PROFILE, normalizeProfile, withDifficulty, varyProfile, clone } from '../src/sim/profile.js';
import { leaveTime, solveStrength, fullInputTime } from '../src/sim/feel.js';
import { mulberry32 } from '../src/sim/prng.js';
import { MouseStick } from '../src/input/mouse-stick.js';
import { KeyPedals, rampStep } from '../src/input/keyboard-pedals.js';
import { deriveAppId } from '../src/config.js';

const SCORING = { needleTolDeg: 5, ballTolRadii: 1 };
const profile = () => normalizeProfile(clone(DEFAULT_PROFILE));
const RUN_TICKS = Math.round(120 / DT);

function runEngine({ prof = profile(), seed = 42, mode = 'both', durationSec = 120, stick, pedal }) {
  const eng = new RunEngine({ profile: prof, seed, mode, durationSec, stick, pedal, tol: tolerances(prof, SCORING), record: true });
  eng.start(0);
  eng.runToEnd();
  const free = freeRun({ profile: prof, seed, mode, ticks: eng.endTick, runLength: durationSec });
  return { eng, res: scoreRun(eng.scorer.result(), free, mode) };
}

/** Proportional controller u = −g·e applied to the MAPPED input, converted back to device values. */
function pController(eng, g = 2) {
  const p = eng.o.profile;
  const sS = p.directions.stick === 'inverted' ? 1 : -1;
  const sP = p.directions.pedal === 'push' ? 1 : -1;
  const c = (x) => Math.max(-1, Math.min(1, x));
  return {
    stick: { advanceTo: () => c((-g * eng.sim.N.e) / sS) },
    pedal: { advanceTo: () => c((-g * eng.sim.B.e) / sP) },
  };
}

test('prng is deterministic', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('wander drift has RMS ≈ strength', () => {
  const d = new Drift(123, 1, { fadeIn: false });
  const p = { ...DEFAULT_PROFILE.needle.drift, strength: 0.2 };
  let s = 0;
  const n = Math.round(600 / DT);
  for (let i = 0; i < n; i++) s += d.step(DT, p) ** 2;
  const rms = Math.sqrt(s / n);
  assert.ok(Math.abs(rms - 0.2) < 0.03, `rms ${rms}`);
});

test('simulator is deterministic per seed and differs between seeds', () => {
  const run = (seed) => {
    const sim = new Simulator({ profile: profile(), seed });
    for (let i = 0; i < 2000; i++) sim.step(0, 0);
    return [sim.N.e, sim.B.e];
  };
  assert.deepEqual(run(5), run(5));
  assert.notDeepEqual(run(5), run(6));
});

test('direction mappings: aviation push → needle down, step-on-ball right → ball left', () => {
  const p = profile();
  assert.ok(mapInputs(p, 1, 0).uN < 0);
  assert.ok(mapInputs(p, 0, 1).uB < 0);
  p.directions.stick = 'inverted';
  p.directions.pedal = 'push';
  assert.ok(mapInputs(p, 1, 0).uN > 0);
  assert.ok(mapInputs(p, 0, 1).uB > 0);
  // and through the dynamics (no drift): push forward for 0.5 s → needle below the dot
  const q = profile();
  q.needle.drift.strength = 0;
  q.ball.drift.strength = 0;
  const sim = new Simulator({ profile: q, seed: 1 });
  for (let i = 0; i < 60; i++) sim.step(1, 1);
  assert.ok(sim.N.e < -0.2 && sim.B.e < -0.2);
});

test('zero input scores 0; proportional controller scores high', () => {
  const zero = scriptedSource(() => 0);
  const { res: z } = runEngine({ stick: zero, pedal: zero });
  assert.equal(z.score, 0);

  const prof = profile();
  const eng = new RunEngine({ profile: prof, seed: 42, mode: 'both', durationSec: 120, stick: null, pedal: null, tol: tolerances(prof, SCORING), record: true });
  Object.assign(eng.o, pController(eng, 2));
  eng.start(0);
  eng.runToEnd();
  const free = freeRun({ profile: prof, seed: 42, mode: 'both', ticks: eng.endTick, runLength: 120 });
  const r = scoreRun(eng.scorer.result(), free, 'both');
  assert.ok(r.score > 70, `score ${r.score}`);
  assert.ok(r.scoreN > 70 && r.scoreB > 70);
});

test('part-task mode scores only the active channel', () => {
  const zero = scriptedSource(() => 0);
  const { eng, res } = runEngine({ mode: 'needle', stick: zero, pedal: zero });
  assert.equal(res.scoreB, null);
  assert.equal(res.totB, null);
  assert.equal(res.totBoth, null);
  assert.equal(eng.sim.B.e, 0);
  assert.equal(res.score, res.scoreN);
});

test('run length is exactly N ticks; replay from the recording is bit-exact', () => {
  const s = scriptedSource((k) => Math.sin(k / 50) * 0.6);
  const p = scriptedSource((k) => (Math.floor(k / 90) % 3) - 1);
  const { eng, res } = runEngine({ stick: s, pedal: p });
  assert.equal(eng.sim.tick, RUN_TICKS);
  const { res: replay } = runEngine({ stick: arraySource(eng.recStick), pedal: arraySource(eng.recPedal) });
  assert.deepEqual(replay, res);
});

// ---- frame-rate independence with timestamped device events -------------
function scriptedEvents() {
  // 1000 Hz mouse movement + key presses, timestamps in ms from run start (wall0 = 1000)
  const ev = [];
  for (let t = 0; t < 120000; t += 1) ev.push({ ts: 1000 + t + 0.37, kind: 'm', dy: Math.round(3 * Math.sin(t / 700) + 2 * Math.sin(t / 113)) });
  for (let t = 500; t < 120000; t += 1300) {
    const code = (t / 1300) % 2 < 1 ? 'KeyA' : 'KeyD';
    ev.push({ ts: 1000 + t, kind: 'k', code, down: true });
    ev.push({ ts: 1000 + t + 180 + (t % 7) * 23, kind: 'k', code, down: false });
  }
  return ev.sort((a, b) => a.ts - b.ts);
}

function runAtFps(fps, events) {
  const prof = profile();
  const settings = { travelCm: 3, countsPerCm: 300, spring: 'off', deadzone: 0.02, expo: 0, mouseMode: 'lock' };
  const pedals = { leftKey: 'KeyA', rightKey: 'KeyD', rampUp: 0.35, rampDown: 0.25, instant: false, curve: 1 };
  const ms = new MouseStick(settings);
  const kp = new KeyPedals(pedals);
  const eng = new RunEngine({ profile: prof, seed: 99, mode: 'both', durationSec: 120, stick: ms, pedal: kp, tol: tolerances(prof, SCORING), record: true });
  const wall0 = 1000;
  eng.start(wall0);
  let i = 0;
  const frameMs = 1000 / fps;
  for (let f = 1; !eng.finished; f++) {
    const now = wall0 + f * frameMs;
    while (i < events.length && events[i].ts <= now) {
      const e = events[i++];
      if (e.kind === 'm') ms.pushMove(e.ts, e.dy);
      else kp.pushKey(e.ts, e.code, e.down);
    }
    eng.frame(now);
  }
  return { metrics: eng.scorer.result(), last: [eng.sim.N.e, eng.sim.B.e], ticks: eng.sim.tick };
}

test('frame-rate independence: identical results at 30, 60 and 144 fps', () => {
  const ev = scriptedEvents();
  const a = runAtFps(30, ev);
  const b = runAtFps(60, ev);
  const c = runAtFps(144, ev);
  assert.equal(a.ticks, RUN_TICKS);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test('pause: paused wall time is excluded and does not change the result', () => {
  const s = scriptedSource((k) => Math.sin(k / 70) * 0.5);
  const p = scriptedSource(() => 0);
  const prof = profile();
  const mk = () => new RunEngine({ profile: prof, seed: 3, mode: 'both', durationSec: 10, stick: s, pedal: p, tol: tolerances(prof, SCORING) });
  const a = mk();
  a.start(0);
  for (let t = 16; !a.finished; t += 16) a.frame(t);
  const b = mk();
  b.start(0);
  let t = 0;
  for (; t < 4000; t += 16) b.frame(t);
  b.pause(t);
  const pausedTicks = b.sim.tick;
  for (let k = 0; k < 300; k++) b.frame(t + k * 16); // paused: nothing happens
  assert.equal(b.sim.tick, pausedTicks);
  t += 5000;
  b.resume(t);
  for (; !b.finished; t += 16) b.frame(t);
  assert.deepEqual(b.scorer.result(), a.scorer.result());
  assert.equal(b.sim.tick, Math.round(10 / DT));
});

// ---- mouse ---------------------------------------------------------------
test('mouse: calibrated full travel gives stick = ±1; deadzone; outliers ignored', () => {
  const cfg = { travelCm: 3, countsPerCm: 300, spring: 'off', deadzone: 0.02, expo: 0, mouseMode: 'lock' };
  const ms = new MouseStick(cfg);
  for (let i = 0; i < 90; i++) ms.pushMove(i, -10); // 900 counts away from you = 3 cm
  assert.equal(ms.advanceTo(1000, DT), 1);
  for (let i = 0; i < 180; i++) ms.pushMove(2000 + i, 10); // 6 cm back
  assert.equal(ms.advanceTo(3000, DT), -1);
  ms.reset();
  ms.pushMove(1, -5); // tiny: inside the 2 % deadzone (5/900 = 0.56 %)
  assert.equal(ms.advanceTo(2, DT), 0);
  ms.pushMove(3, -5000); // > 2.5 cm in one event → ignored
  assert.equal(ms.advanceTo(4, DT), 0);
  assert.equal(ms.outliers, 1);
});

test('mouse: only events up to the tick time are applied (timestamps honoured)', () => {
  const ms = new MouseStick({ travelCm: 1, countsPerCm: 100, spring: 'off', deadzone: 0, expo: 0, mouseMode: 'lock' });
  ms.pushMove(10, -50);
  ms.pushMove(20, -50);
  assert.equal(ms.advanceTo(15, DT), 0.5);
  assert.equal(ms.advanceTo(25, DT), 1);
});

test('mouse: spring decays toward centre', () => {
  const ms = new MouseStick({ travelCm: 1, countsPerCm: 100, spring: 'medium', deadzone: 0, expo: 0, mouseMode: 'lock' });
  ms.pushMove(0, -100);
  let v = ms.advanceTo(0, DT);
  for (let i = 0; i < 120; i++) v = ms.advanceTo(0, DT);
  assert.ok(v < 0.1 && v > 0);
});

// ---- pedals --------------------------------------------------------------
const pedalCfg = () => ({ leftKey: 'KeyA', rightKey: 'KeyD', leftLightKey: '', rightLightKey: '', rampUp: 0.35, rampDown: 0.25, instant: false, curve: 1 });
const ticksTo = (kp, start, pred, max = 400) => {
  for (let n = 1; n <= max; n++) if (pred(kp.advanceTo(start + n * TICK_MS, DT))) return n;
  return -1;
};

test('pedals: full deflection in the ramp time, back to 0 in the release time', () => {
  const kp = new KeyPedals(pedalCfg());
  kp.pushKey(0, 'KeyD', true);
  const up = ticksTo(kp, 0, (v) => v >= 1);
  assert.ok(Math.abs(up * DT - 0.35) <= DT + 1e-9, `up ${up * DT}`);
  kp.pushKey(1000, 'KeyD', false);
  kp.advanceTo(999, DT);
  const down = ticksTo(kp, 999, (v) => v === 0);
  assert.ok(Math.abs(down * DT - 0.25) <= 2 * DT, `down ${down * DT}`);
});

test('pedals: both keys → 0; release-all (blur) leaves nothing stuck; reversing passes through 0', () => {
  const kp = new KeyPedals({ ...pedalCfg(), instant: true });
  kp.pushKey(0, 'KeyA', true);
  assert.equal(kp.advanceTo(1, DT), -1);
  kp.pushKey(2, 'KeyD', true);
  assert.equal(kp.advanceTo(3, DT), 0);
  kp.pushReleaseAll(4);
  assert.equal(kp.advanceTo(5, DT), 0);
  assert.equal(kp.held.size, 0);
  // ramp reversal never jumps across zero
  let p = 1;
  const seen = [];
  for (let i = 0; i < 100; i++) seen.push((p = rampStep(p, -1, DT / 0.35, DT / 0.25)));
  assert.ok(seen.includes(0));
  assert.equal(p, -1);
});

test('pedals: auto-repeat keydowns change nothing; unmapped keys are not prevented', () => {
  const kp = new KeyPedals(pedalCfg());
  const ev = (code, repeat = false) => ({ code, key: code.slice(3).toLowerCase(), repeat, timeStamp: 5, keyCode: 65, prevented: false, preventDefault() { this.prevented = true; } });
  const first = ev('KeyD');
  kp.handle(first, true);
  assert.equal(kp.queue.length, 1);
  assert.ok(first.prevented);
  kp.handle(ev('KeyD', true), true);
  kp.handle(ev('KeyD', true), true);
  assert.equal(kp.queue.length, 1);
  const other = ev('KeyQ');
  kp.handle(other, true);
  assert.equal(other.prevented, false);
  assert.equal(kp.queue.length, 1);
  // IME-looking event is flagged
  kp.handle({ code: '', key: 'đ', repeat: false, timeStamp: 6, keyCode: 0, preventDefault() {} }, true);
  assert.equal(kp.imeSuspected, true);
});

// ---- profiles, readouts --------------------------------------------------
test('difficulty and vary-feel never change directions', () => {
  const p = profile();
  const d5 = withDifficulty(p, 5);
  assert.ok(d5.needle.drift.strength > p.needle.drift.strength);
  const rng = mulberry32(1);
  for (const mode of ['brief', 'uncertainty']) {
    const q = profile();
    q.uncertainty = { 'needle.lag': [0.05, 0.3] };
    const v = varyProfile(q, { varyMode: mode, varyRange: 0.25 }, rng);
    assert.deepEqual(v.profile.directions, q.directions);
    assert.ok(v.travelFactor >= 0.75 && v.travelFactor <= 1.25);
    if (mode === 'uncertainty') assert.ok(v.profile.needle.lag >= 0.05 && v.profile.needle.lag <= 0.3);
  }
});

test('feel readouts: stronger drift leaves the dot sooner; solver hits its target', () => {
  const tol = 5 / 75;
  const cp = profile().needle;
  const weak = leaveTime({ ...cp, drift: { ...cp.drift, strength: 0.08 } }, tol);
  const strong = leaveTime({ ...cp, drift: { ...cp.drift, strength: 0.4 } }, tol);
  assert.ok(strong < weak, `${strong} < ${weak}`);
  const s = solveStrength(cp, tol, 2);
  const t = leaveTime({ ...cp, drift: { ...cp.drift, strength: s } }, tol);
  assert.ok(Math.abs(t - 2) < 0.6, `leave ${t}`);
  const full = fullInputTime(cp);
  assert.ok(full > 0.9 && full < 1.4, `full ${full}`);
});

test('tolerances and app id derivation', () => {
  const tol = tolerances(profile(), SCORING);
  assert.ok(Math.abs(tol.n - 5 / 75) < 1e-12);
  assert.equal(tol.b, BALL_RADIUS_FRAC);
  assert.equal(deriveAppId('/compass-control/'), 'compass-control');
  assert.equal(deriveAppId('/'), 'compass-control');
  assert.equal(deriveAppId('/a/Flight-Compass-Plain-Test-1/'), 'flight-compass-plain-test-1');
});

test('Scorer counts time on target', () => {
  const s = new Scorer({ n: 0.1, b: 0.1 });
  s.add(0, 0);
  s.add(0.5, 0);
  const r = s.result();
  assert.equal(r.totN, 50);
  assert.equal(r.totB, 100);
  assert.equal(r.totBoth, 50);
});
