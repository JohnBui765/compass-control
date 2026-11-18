// Persisted app state: settings (device layer, session, training, display)
// and the list of test-feel profiles. Stored under `${APP_ID}:settings` and
// `${APP_ID}:profiles`.

import { ls } from './storage.js';
import { DEFAULT_PROFILE, normalizeProfile, mergeDefaults, clone } from './sim/profile.js';
import { DEFAULT_COUNTS_PER_CM } from './input/mouse-stick.js';

export const DEFAULT_SETTINGS = Object.freeze({
  schema: 1,
  activeProfileId: 'default',
  device: {
    stick: {
      source: 'mouse', // 'mouse' | 'gamepad'
      mouseMode: 'lock', // 'lock' (pointer lock, raw counts) | 'absolute'
      travelCm: 3, // mouse travel from centre to full deflection
      countsPerCm: DEFAULT_COUNTS_PER_CM,
      calibrated: false,
      calibratedRaw: null, // was raw input active during calibration?
      calibratedAt: '',
      spring: 'off', // 'off' | 'light' | 'medium'
      deadzone: 0.02,
      expo: 0,
      outlierCm: 2.5,
      clickRecentre: false, // left click = let go of the stick (snaps to centre)
      pad: { id: '', index: 0, axis: 1, invert: true, deadzone: 0.05, min: -1, max: 1 },
    },
    pedals: {
      source: 'keys', // 'keys' | 'gamepad'
      leftKey: 'KeyA',
      rightKey: 'KeyD',
      leftLightKey: '',
      rightLightKey: '',
      rampUp: 0.35,
      rampDown: 0.25,
      instant: false,
      curve: 1,
      pad: { id: '', index: 0, mode: 'single', axis: 0, axisL: 1, axisR: 2, invert: false, deadzone: 0.05, min: -1, max: 1, minL: -1, maxL: 1, minR: -1, maxR: 1 },
    },
  },
  session: {
    practiceSec: 60,
    runSec: 120,
    runs: 3,
    breakSec: 10,
    mode: 'both', // 'both' | 'needle' | 'ball'
    difficulty: 3,
    showTimer: true,
    fullscreen: true,
    seedMode: 'auto', // 'auto' | 'fixed'
    fixedSeed: 12345,
  },
  scoring: { needleTolDeg: 5, ballTolRadii: 1 },
  training: {
    varyFeel: false,
    varyMode: 'brief', // 'brief' | 'uncertainty'
    varyRange: 0.25,
    stickIndicator: true,
    pedalIndicator: false,
    errorBars: false,
  },
  display: { background: 'light', instrumentScale: 1 },
  ui: { stickyTipDismissed: false, imeTipDismissed: false },
});

export function loadState() {
  const settings = mergeDefaults(DEFAULT_SETTINGS, ls.get('settings'));
  let profiles = (ls.get('profiles') || []).map(normalizeProfile);
  if (!profiles.length) profiles = [normalizeProfile(DEFAULT_PROFILE)];
  if (!profiles.some((p) => p.id === settings.activeProfileId)) settings.activeProfileId = profiles[0].id;
  return { settings, profiles };
}

export function saveSettings(state) {
  return ls.set('settings', state.settings);
}

export function saveProfiles(state) {
  return ls.set('profiles', state.profiles);
}

export function activeProfile(state) {
  return state.profiles.find((p) => p.id === state.settings.activeProfileId) || state.profiles[0];
}

export function newId(prefix = 'p') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Copy a profile under a new id and name; returns the copy (not yet saved). */
export function duplicateProfile(state, src, name) {
  const p = normalizeProfile(clone(src));
  p.id = newId('p');
  p.name = name || `${src.name} (copy)`;
  p.updated = Date.now();
  state.profiles.push(p);
  return p;
}

/** Reset to defaults, keeping the active profile and the mouse calibration (a hardware measurement). */
export function resetSettings(state) {
  const keep = state.settings.activeProfileId;
  const st = state.settings.device.stick;
  const cal = { countsPerCm: st.countsPerCm, calibrated: st.calibrated, calibratedRaw: st.calibratedRaw, calibratedAt: st.calibratedAt };
  state.settings = clone(DEFAULT_SETTINGS);
  state.settings.activeProfileId = keep;
  Object.assign(state.settings.device.stick, cal);
}
