// Test-feel profiles: what the needle and ball do (the "test" layer).
// Device settings (mouse, keys, gamepad) live separately in state.js, so a
// profile tuned now carries over unchanged when real hardware arrives.
// Pure module: no DOM.

export const DRIFT_DEFAULT = Object.freeze({
  strength: 0.17, // RMS drift rate (FS/s). 0.17 = the brief's level 3 (A = 0.5 peak-normalised)
  speed: 1.0, // restlessness: multiplies all wander frequencies
  gustSize: 0, // shoves, × strength (brief "bouncy" ≈ 4–5)
  gustMin: 3,
  gustMax: 8,
  pushSize: 0, // steady pushes, × strength
  pushMin: 2,
  pushMax: 6,
  busy: 0, // busy/calm swell depth 0–1
  busyPeriod: 20,
  ramp: 0, // gets harder during a run (0–1)
});

const channel = (lag) => ({
  order: 1,
  topSpeed: 1.0, // FS/s at full input (brief G = 1.0 /s)
  gain0: 1.0, // order-0 gain
  lag, // s
  deadTime: 0, // s
  runaway: 0, // 1/s
  drift: { ...DRIFT_DEFAULT },
});

export const DEFAULT_PROFILE = Object.freeze({
  id: 'default',
  name: 'Default (brief)',
  notes: 'Brief defaults: rate control, medium smooth drift, aviation directions.',
  directions: { stick: 'aviation', pedal: 'step' },
  maxAngle: 75,
  needle: channel(0.1),
  ball: channel(0.15),
  coupling: { pedalToNeedle: 0, stickToBall: 0 },
  uncertainty: {}, // path → [lo, hi] from the Compare tool or questionnaire
  answers: {}, // questionnaire answers kept with the profile
  updated: 0,
});

// Difficulty 1–5 scales the drift of the profile (level 3 = the profile as tuned).
export const DIFFICULTY = Object.freeze({
  strength: [0.6, 0.8, 1.0, 1.25, 1.5],
  speed: [0.8, 0.9, 1.0, 1.1, 1.25],
});

// ---------------------------------------------------------------- parameters
const chParams = (ch) => {
  const C = ch === 'needle' ? 'Needle' : 'Ball';
  return [
    { path: `${ch}.drift.strength`, group: 'Drift', label: 'Drift strength', min: 0.02, max: 1.2, step: 0.01, scale: 'log', ab: 'watch', help: `How hard the ${ch} is pushed off the dot (RMS drift rate, full scale per second).` },
    { path: `${ch}.drift.speed`, group: 'Drift', label: 'Drift restlessness', min: 0.3, max: 3, step: 0.05, scale: 'log', ab: 'watch', help: 'How often the drift changes direction. Higher = twitchier, shorter excursions.' },
    { path: `${ch}.drift.gustSize`, group: 'Drift', label: 'Shoves (size)', min: 0, max: 8, step: 0.1, scale: 'lin', ab: 'watch', help: 'Sudden short kicks. 0 = smooth. About 4 = the brief\'s "bouncy".' },
    { path: `${ch}.drift.gustMin`, group: 'Drift', label: 'Shoves: shortest gap (s)', min: 0.5, max: 20, step: 0.5, scale: 'lin' },
    { path: `${ch}.drift.gustMax`, group: 'Drift', label: 'Shoves: longest gap (s)', min: 0.5, max: 30, step: 0.5, scale: 'lin' },
    { path: `${ch}.drift.pushSize`, group: 'Drift', label: 'Steady push (size)', min: 0, max: 3, step: 0.05, scale: 'lin', ab: 'watch', help: 'A bias that lasts a few seconds, so you must hold a steady correction.' },
    { path: `${ch}.drift.pushMin`, group: 'Drift', label: 'Steady push: shortest hold (s)', min: 0.5, max: 20, step: 0.5, scale: 'lin' },
    { path: `${ch}.drift.pushMax`, group: 'Drift', label: 'Steady push: longest hold (s)', min: 0.5, max: 30, step: 0.5, scale: 'lin' },
    { path: `${ch}.drift.busy`, group: 'Drift', label: 'Busy/calm swings', min: 0, max: 1, step: 0.05, scale: 'lin', ab: 'watch', help: 'Calm stretches alternating with busy ones.' },
    { path: `${ch}.drift.busyPeriod`, group: 'Drift', label: 'Busy/calm cycle (s)', min: 5, max: 60, step: 1, scale: 'lin' },
    { path: `${ch}.drift.ramp`, group: 'Drift', label: 'Gets harder during a run', min: 0, max: 1, step: 0.05, scale: 'lin', help: '0 = constant. 0.5 = drift goes from 75 % to 125 % across a run.' },
    { path: `${ch}.order`, group: 'Response', label: 'Control type', type: 'select', options: [[1, 'Rate: stick sets how fast it moves'], [0, 'Position: stick sets where it is']] },
    { path: `${ch}.topSpeed`, group: 'Response', label: 'Response speed', min: 0.2, max: 4, step: 0.05, scale: 'log', ab: 'response', help: 'How fast it moves at full stick/pedal (full scale per second). Rate type only.' },
    { path: `${ch}.gain0`, group: 'Response', label: 'Position gain', min: 0.3, max: 3, step: 0.05, scale: 'log', help: 'Position type only: how far full input moves it.' },
    { path: `${ch}.lag`, group: 'Response', label: 'Heaviness (lag, s)', min: 0, max: 1.5, step: 0.01, scale: 'lin', ab: 'response', help: 'How long it takes to pick up speed, and keeps sliding after you centre.' },
    { path: `${ch}.deadTime`, group: 'Response', label: 'Delay before it reacts (s)', min: 0, max: 0.5, step: 0.01, scale: 'lin', ab: 'response', help: 'Nothing happens for this long, then it moves.' },
    { path: `${ch}.runaway`, group: 'Response', label: 'Runaway (+) / self-centring (−)', min: -2, max: 2, step: 0.05, scale: 'lin', ab: 'response', help: '+ : the further off, the faster it runs away. − : it drifts back by itself. Rate type only.' },
  ].map((p) => ({ ...p, ch, chLabel: C }));
};

export const PARAMS = [
  ...chParams('needle'),
  ...chParams('ball'),
  { path: 'maxAngle', ch: 'needle', chLabel: 'Needle', group: 'Display', label: 'Needle swing at the end stop (°)', min: 30, max: 120, step: 1, scale: 'lin' },
  { path: 'coupling.pedalToNeedle', ch: 'both', chLabel: 'Coupling', group: 'Coupling', label: 'Pedals also move the needle', min: -1, max: 1, step: 0.05, scale: 'lin' },
  { path: 'coupling.stickToBall', ch: 'both', chLabel: 'Coupling', group: 'Coupling', label: 'Stick also moves the ball', min: -1, max: 1, step: 0.05, scale: 'lin' },
  { path: 'directions.stick', ch: 'needle', chLabel: 'Directions', group: 'Directions', label: 'Stick → needle', type: 'select', options: [['aviation', 'Aviation: push forward → needle down'], ['inverted', 'Inverted: push forward → needle up']] },
  { path: 'directions.pedal', ch: 'ball', chLabel: 'Directions', group: 'Directions', label: 'Pedal → ball', type: 'select', options: [['step', 'Step on the ball: right pedal → ball left'], ['push', 'Push the ball: right pedal → ball right']] },
];

/** The handful of parameters that matter most (hotkeys, Compare tool). */
export const KEY_PARAMS = PARAMS.filter((p) => p.ab);

export function paramSpec(path) {
  return PARAMS.find((p) => p.path === path) || null;
}
export function paramName(spec) {
  return `${spec.chLabel} · ${spec.label}`;
}

// ---------------------------------------------------------------- utilities
export function clone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] ??= {};
  o[ks[ks.length - 1]] = value;
}
/** Fill missing keys from defaults (forward compatibility of stored data). */
export function mergeDefaults(def, val) {
  if (val === undefined || val === null) return clone(def);
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return typeof val === typeof def ? val : clone(def);
  const out = {};
  for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], val[k]);
  for (const k of Object.keys(val)) if (!(k in out)) out[k] = val[k]; // keep extra keys (e.g. uncertainty paths)
  return out;
}
export function normalizeProfile(p) {
  const out = mergeDefaults(DEFAULT_PROFILE, p || {});
  out.uncertainty = { ...(p && p.uncertainty) };
  out.answers = { ...(p && p.answers) };
  return out;
}
export function clampParam(spec, v) {
  if (spec.type === 'select') return v;
  const x = Number(v);
  if (!Number.isFinite(x)) return spec.min;
  return Math.min(spec.max, Math.max(spec.min, x));
}
export function nudgeParam(spec, v, dir) {
  if (spec.type === 'select') return v;
  if (spec.scale === 'log') return clampParam(spec, v * Math.pow(1.1, dir));
  return clampParam(spec, Math.round((v + dir * spec.step) / spec.step) * spec.step);
}

// ---------------------------------------------------------------- per-run profile
/** Apply difficulty (1–5) to a profile: returns a new profile. */
export function withDifficulty(profile, level = 3) {
  const i = Math.min(5, Math.max(1, Math.round(level))) - 1;
  const out = clone(profile);
  for (const ch of ['needle', 'ball']) {
    out[ch].drift.strength *= DIFFICULTY.strength[i];
    out[ch].drift.speed *= DIFFICULTY.speed[i];
  }
  return out;
}

/**
 * "Vary feel each run" (brief §5.6, extended). Directions never change.
 *  - mode 'brief': response speed (both channels) and mouse travel × U(1 ± range)
 *  - mode 'uncertainty': every parameter with an uncertainty band is drawn
 *    from inside its band (your own tuning uncertainty); mouse travel ± range.
 * @returns {{profile: object, varied: object, travelFactor: number}}
 */
export function varyProfile(profile, training, rng) {
  const out = clone(profile);
  const varied = {};
  const r = Math.max(0, Math.min(0.6, training.varyRange ?? 0.25));
  const bands = Object.entries(profile.uncertainty || {});
  if (training.varyMode === 'uncertainty' && bands.length) {
    for (const [path, band] of bands) {
      const spec = paramSpec(path);
      if (!spec || !Array.isArray(band)) continue;
      const [lo, hi] = band;
      const u = rng();
      const v = spec.scale === 'log' && lo > 0 && hi > 0 ? Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * u) : lo + (hi - lo) * u;
      setPath(out, path, clampParam(spec, v));
      varied[path] = getPath(out, path);
    }
  } else {
    for (const ch of ['needle', 'ball']) {
      out[ch].topSpeed *= 1 + r * (2 * rng() - 1);
      varied[`${ch}.topSpeed`] = out[ch].topSpeed;
    }
  }
  const travelFactor = 1 + r * (2 * rng() - 1);
  return { profile: out, varied, travelFactor };
}
