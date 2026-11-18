// Settings: device layer, session, scoring, training, display – and the full
// parameter list of the active test-feel profile.

import { h, topBar } from './dom.js';
import { fieldGroup } from './fields.js';
import { PARAMS, DEFAULT_PROFILE, clone, normalizeProfile } from '../sim/profile.js';
import { activeProfile, resetSettings } from '../state.js';

const STICK = [
  { path: 'device.stick.source', label: 'Stick device', type: 'select', options: [['mouse', 'Mouse'], ['gamepad', 'Gamepad / joystick (phase 2)']] },
  { path: 'device.stick.mouseMode', label: 'Mouse mode', type: 'select', options: [['lock', 'Pointer lock – raw counts (recommended)'], ['absolute', 'Absolute – cursor height (fallback)']] },
  { path: 'device.stick.travelCm', label: 'Mouse travel for full stick (cm from centre)', min: 0.5, max: 10, step: 0.1, help: 'How far you slide the mouse from centre to reach full forward/back. A desktop stick grip moves roughly 4–6 cm.' },
  { path: 'device.stick.countsPerCm', label: 'Mouse counts per cm', min: 20, max: 4000, step: 1, scale: 'log', help: 'Measured on the Hardware test page (move 10 cm along a ruler). 300 ≈ an 800 DPI mouse.' },
  { path: 'device.stick.spring', label: 'Centring spring', type: 'select', options: [['off', 'Off (recommended)'], ['light', 'Light'], ['medium', 'Medium']], help: 'Off: holding the mouse still holds the stick still, like holding a sprung stick with steady force.' },
  { path: 'device.stick.deadzone', label: 'Deadzone', min: 0, max: 0.2, step: 0.01 },
  { path: 'device.stick.expo', label: 'Response curve (expo)', min: 0, max: 1, step: 0.05, help: '0 = linear. Higher = finer control near centre, same full deflection.' },
  { path: 'device.stick.clickRecentre', label: 'Left click = let go of the stick', type: 'bool', help: 'A click snaps the virtual stick back to centre, like releasing a sprung stick.' },
  { path: 'device.stick.pad.axis', label: 'Gamepad: stick axis number', min: 0, max: 15, step: 1, help: 'Pick it on the Hardware test page. Ignore the twist axis for the stick.' },
  { path: 'device.stick.pad.invert', label: 'Gamepad: invert stick axis', type: 'bool' },
  { path: 'device.stick.pad.deadzone', label: 'Gamepad: stick deadzone', min: 0, max: 0.3, step: 0.01 },
];
const PEDALS = [
  { path: 'device.pedals.source', label: 'Pedal device', type: 'select', options: [['keys', 'Keyboard keys'], ['gamepad', 'Gamepad / rudder pedals (phase 2)']] },
  { path: 'device.pedals.leftKey', label: 'Left pedal key', type: 'key', help: 'Any key works, including F13–F24 from a programmable USB foot switch.' },
  { path: 'device.pedals.rightKey', label: 'Right pedal key', type: 'key' },
  { path: 'device.pedals.leftLightKey', label: 'Left pedal, half-press key (optional)', type: 'key', allowClear: true },
  { path: 'device.pedals.rightLightKey', label: 'Right pedal, half-press key (optional)', type: 'key', allowClear: true },
  { path: 'device.pedals.rampUp', label: 'Press: time to full pedal (s)', min: 0.02, max: 1.5, step: 0.01 },
  { path: 'device.pedals.rampDown', label: 'Release: time back to centre (s)', min: 0.02, max: 1.5, step: 0.01 },
  { path: 'device.pedals.instant', label: 'Instant pedals (no ramp, for comparison)', type: 'bool' },
  { path: 'device.pedals.curve', label: 'Ramp curve', min: 1, max: 3, step: 0.1, help: '1 = linear. 2 = short taps give much smaller nudges; long holds still reach full pedal.' },
  { path: 'device.pedals.pad.mode', label: 'Gamepad pedal mode', type: 'select', options: [['single', 'One rudder axis (e.g. rudder pedals)'], ['differential', 'Two pedal axes: right − left (e.g. racing pedals)']] },
  { path: 'device.pedals.pad.axis', label: 'Gamepad: rudder axis number', min: 0, max: 15, step: 1 },
  { path: 'device.pedals.pad.axisL', label: 'Gamepad: left pedal axis (two-axis mode)', min: 0, max: 15, step: 1 },
  { path: 'device.pedals.pad.axisR', label: 'Gamepad: right pedal axis (two-axis mode)', min: 0, max: 15, step: 1 },
  { path: 'device.pedals.pad.invert', label: 'Gamepad: invert pedals', type: 'bool' },
  { path: 'device.pedals.pad.deadzone', label: 'Gamepad: pedal deadzone', min: 0, max: 0.3, step: 0.01 },
];
const SESSION = [
  { path: 'session.mode', label: 'Mode', type: 'select', options: [['both', 'Both (needle + ball)'], ['needle', 'Needle only'], ['ball', 'Ball only']], help: 'Single-channel modes are for fixing a weak side. Most practice should use Both.' },
  { path: 'session.difficulty', label: 'Difficulty (3 = the profile as tuned)', min: 1, max: 5, step: 1, help: 'Scales drift strength (×0.6 … ×1.5) and restlessness (×0.8 … ×1.25).' },
  { path: 'session.practiceSec', label: 'Practice length (s, not scored)', min: 0, max: 300, step: 5 },
  { path: 'session.runSec', label: 'Run length (s)', min: 10, max: 600, step: 5 },
  { path: 'session.runs', label: 'Number of runs', min: 1, max: 10, step: 1 },
  { path: 'session.breakSec', label: 'Break between runs (s)', min: 0, max: 120, step: 1 },
  { path: 'session.showTimer', label: 'Show timer', type: 'bool' },
  { path: 'session.fullscreen', label: 'Full screen during sessions', type: 'bool', help: 'Also enables keyboard lock in Chrome/Edge, so Esc and browser shortcuts cannot end a run by accident (hold Esc to leave full screen).' },
  { path: 'session.seedMode', label: 'Drift pattern', type: 'select', options: [['auto', 'New random pattern every run'], ['fixed', 'Fixed seed (repeatable sessions)']] },
  { path: 'session.fixedSeed', label: 'Fixed seed', min: 0, max: 999999, step: 1 },
];
const SCORING = [
  { path: 'scoring.needleTolDeg', label: 'Needle on target within (± degrees)', min: 1, max: 20, step: 0.5 },
  { path: 'scoring.ballTolRadii', label: 'Ball on target within (× ball radius)', min: 0.25, max: 4, step: 0.25 },
];
const TRAINING = [
  { path: 'training.examLook', label: 'Exam look – hide all training aids', type: 'bool', help: 'The test screen looks like the real test: static pictures, no indicators, no error bars. Use it for your last practice sessions.' },
  { path: 'training.inputFeedback', label: 'Light up the stick and pedal pictures when you use them', type: 'bool', help: 'The pedal you press lights up at once and fills as it goes down (the ball follows the fill); the stick arrow lights up the way you push.' },
  { path: 'training.varyFeel', label: 'Vary feel each run', type: 'bool', help: 'Learn to recalibrate quickly instead of memorising one feel. Directions never change.' },
  { path: 'training.varyMode', label: 'What varies', type: 'select', options: [['brief', 'Response speed and mouse travel (± range)'], ['uncertainty', 'Everything you tuned, within your own uncertainty bands']] },
  { path: 'training.varyRange', label: 'Vary range (±)', min: 0, max: 0.6, step: 0.05 },
  { path: 'training.stickIndicator', label: 'Show stick position (legend strip)', type: 'bool', help: 'Stands in for the feel of a sprung stick\'s centre, which a mouse cannot give.' },
  { path: 'training.pedalIndicator', label: 'Show pedal position (legend strip)', type: 'bool' },
  { path: 'training.errorBars', label: 'Show live error bars', type: 'bool' },
];
const DISPLAY = [
  { path: 'display.background', label: 'Test screen background', type: 'select', options: [['light', 'Light grey (like the real test)'], ['dark', 'Dark']] },
  { path: 'display.instrumentScale', label: 'Instrument size', min: 0.5, max: 1, step: 0.05 },
];

export function mount(root, ctx) {
  const st = ctx.state;
  const save = () => {
    const p = st.settings.device.pedals;
    if (p.leftKey && p.leftKey === p.rightKey) ctx.toast('Left and right pedal keys are the same – change one.');
    ctx.saveSettings();
  };
  const prof = activeProfile(st);
  const saveProfile = () => {
    prof.updated = Date.now();
    ctx.saveProfiles();
  };
  const card = (title, ...kids) => h('div', { class: 'card' }, h('h2', null, title), ...kids);
  const settingsGroup = (specs) => fieldGroup(null, specs, () => st.settings, save).el;

  const profileSelect = h(
    'select',
    {
      onchange: () => {
        st.settings.activeProfileId = profileSelect.value;
        ctx.saveSettings();
        ctx.navigate('settings');
      },
    },
    st.profiles.map((p) => h('option', { value: p.id, selected: p.id === prof.id }, p.name)),
  );
  const groups = {};
  for (const spec of PARAMS) {
    const g = spec.group === 'Response' || spec.group === 'Drift' ? `${spec.chLabel} – ${spec.group.toLowerCase()}` : spec.group;
    (groups[g] ||= []).push(spec);
  }
  const order = ['Directions', 'Needle – response', 'Needle – drift', 'Ball – response', 'Ball – drift', 'Coupling', 'Display'];

  root.append(
    h(
      'div',
      { class: 'page' },
      topBar('Settings', ctx),
      card(
        'Test feel (what the needle and ball do)',
        h('p', { class: 'muted small' }, 'These belong to the active profile and carry over unchanged when you switch to a real joystick and pedals. The Tuning Lab has guided tools for setting them.'),
        h('div', { class: 'row' }, h('label', null, 'Active profile'), profileSelect, h('button', { class: 'btn small', onclick: () => ctx.navigate('tuning') }, 'Open Tuning Lab')),
        order.filter((g) => groups[g]).map((g) => fieldGroup(g, groups[g], () => prof, saveProfile).el),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', {
            class: 'btn small danger',
            onclick: () => {
              if (!confirm(`Reset every value of "${prof.name}" to the brief defaults?`)) return;
              const fresh = normalizeProfile(clone(DEFAULT_PROFILE));
              Object.assign(prof, { ...fresh, id: prof.id, name: prof.name, notes: prof.notes });
              saveProfile();
              ctx.navigate('settings');
            },
          }, 'Reset this profile to brief defaults')),
      ),
      card('Stick (device)', settingsGroup(STICK), h('p', { class: 'small' }, h('a', { href: '#/hardware' }, 'Calibrate the mouse or pick a joystick axis on the Hardware test page'))),
      card('Pedals (device)', settingsGroup(PEDALS)),
      card('Session', settingsGroup(SESSION)),
      card('Scoring', h('p', { class: 'muted small' }, 'Practice score = 100 × (1 − RMS error ÷ RMS error with no input). Changing the bands changes time on target, so older sessions are not directly comparable.'), settingsGroup(SCORING)),
      card('Training aids', settingsGroup(TRAINING)),
      card('Display', settingsGroup(DISPLAY)),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn danger',
          onclick: () => {
            if (!confirm('Reset all settings (device, session, scoring, training, display) to defaults? Profiles and history are kept.')) return;
            resetSettings(st);
            ctx.saveSettings();
            ctx.navigate('settings');
          },
        }, 'Reset settings to defaults')),
    ),
  );
}
