// "How to use": a short guide built from the CURRENT settings, so the keys and
// directions it shows are always the ones the app will really use.

import { h, keyLabel, topBar } from './dom.js';
import { activeProfile } from '../state.js';

const kbd = (label) => h('span', { class: 'kbd big' }, label);

const DIAL_SVG = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
<rect x="1" y="1" width="62" height="62" rx="9" fill="#525a69"/>
<circle cx="30" cy="32" r="23" fill="#0c0d0f" stroke="#8c96a3" stroke-width="2"/>
<circle cx="12" cy="32" r="4.2" fill="#e3241b"/>
<line x1="30" y1="32" x2="12.5" y2="25" stroke="#5b7dff" stroke-width="2.6" stroke-linecap="round"/>
<path d="M57 12l5 7h-10z M57 52l5-7h-10z" fill="#e7e9ec"/><rect x="56" y="19" width="2" height="26" fill="#e7e9ec"/></svg>`;
const TRACK_SVG = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
<rect x="1" y="14" width="62" height="36" rx="7" fill="#525a69"/>
<rect x="6" y="25" width="52" height="14" rx="3" fill="#121316"/>
<line x1="32" y1="26" x2="32" y2="38" stroke="#f4f4f4" stroke-width="1.2"/>
<circle cx="32" cy="32" r="4.4" fill="#e3241b"/><circle cx="45" cy="32" r="4" fill="#3d63ff"/>
<path d="M4 7l7-4v8z M60 7l-7-4v8z" fill="#e7e9ec"/><rect x="10" y="6" width="44" height="2" fill="#e7e9ec"/></svg>`;

/** Visual "what to press" card for the needle and the ball, from the current settings. */
export function controlsCheatSheet(S, profile) {
  const st = S.device.stick;
  const pd = S.device.pedals;
  const inverted = profile.directions.stick === 'inverted';
  const pushBall = profile.directions.pedal === 'push';
  let fwd;
  let back;
  let note;
  if (st.source === 'gamepad') {
    fwd = 'push the joystick forward';
    back = 'pull the joystick back';
    note = 'Only forward/back counts.';
  } else if (st.mouseMode === 'absolute') {
    fwd = 'move the mouse up';
    back = 'move the mouse down';
    note = 'Absolute mode: the cursor height is the stick.';
  } else {
    fwd = 'slide the mouse forward (away from you)';
    back = 'slide the mouse back (toward you)';
    note = `Sideways does nothing. ${st.travelCm} cm from centre = full stick.`;
  }
  const L = pd.source === 'gamepad' ? 'the left pedal' : kbd(keyLabel(pd.leftKey));
  const R = pd.source === 'gamepad' ? 'the right pedal' : kbd(keyLabel(pd.rightKey));
  return h(
    'div',
    { class: 'cheat' },
    h('div', { class: 'box' }, h('span', { html: DIAL_SVG }),
      h('div', null,
        h('h4', null, 'Needle → stick'),
        h('div', { class: 'rule' }, 'Needle too ', h('b', null, 'high'), ' → ', inverted ? back : fwd),
        h('div', { class: 'rule' }, 'Needle too ', h('b', null, 'low'), ' → ', inverted ? fwd : back),
        h('div', { class: 'muted small' }, note))),
    h('div', { class: 'box' }, h('span', { html: TRACK_SVG }),
      h('div', null,
        h('h4', null, 'Ball → pedals'),
        h('div', { class: 'rule' }, 'Ball on the ', h('b', null, 'right'), ' → press ', pushBall ? L : R),
        h('div', { class: 'rule' }, 'Ball on the ', h('b', null, 'left'), ' → press ', pushBall ? R : L),
        h('div', { class: 'muted small' }, pd.source === 'gamepad' ? 'Press gently for small corrections.' : `Tap = small nudge, hold = bigger push.${pushBall ? '' : ' Rule: press the key on the ball’s side.'}`))),
  );
}

/** One-line reminder for the countdown screen. */
export function controlsOneLiner(S) {
  const st = S.device.stick;
  const pd = S.device.pedals;
  const stick = st.source === 'gamepad' ? 'joystick fwd/back' : st.mouseMode === 'absolute' ? 'mouse up/down' : 'mouse forward/back';
  const ped = pd.source === 'gamepad' ? 'pedals' : `${keyLabel(pd.leftKey)} / ${keyLabel(pd.rightKey)}`;
  return `Needle: ${stick}  ·  Ball: ${ped}  ·  Esc: pause`;
}

function controlsTable(S) {
  const pd = S.device.pedals;
  const st = S.device.stick;
  const row = (what, how) => h('tr', null, h('td', null, what), h('td', null, how));
  const keys = (...ks) => ks.flatMap((k, i) => (i ? [' ', kbd(k)] : [kbd(k)]));
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data help-table' },
      h('tr', null, h('th', null, 'What'), h('th', null, 'How')),
      row('Needle (stick)', st.source === 'gamepad' ? 'Joystick forward / back' : st.mouseMode === 'absolute' ? 'Mouse up / down' : 'Mouse forward / back (sideways does nothing)'),
      row('Ball (pedals)', pd.source === 'gamepad' ? 'Rudder pedals' : [kbd(keyLabel(pd.leftKey)), ' left pedal   ', kbd(keyLabel(pd.rightKey)), ' right pedal (both or none = centre)']),
      row('Half pedal (optional)', pd.leftLightKey || pd.rightLightKey ? [kbd(keyLabel(pd.leftLightKey)), ' left   ', kbd(keyLabel(pd.rightLightKey)), ' right'] : h('span', { class: 'muted' }, 'not set – Settings → Pedals')),
      row('Let go of the stick (snap to centre)', st.clickRecentre ? 'Left click' : h('span', { class: 'muted' }, 'off – Settings → Stick')),
      row('Pause', keys('Esc')),
      row('Leave full screen', ['hold ', kbd('Esc'), ' about 2 seconds']),
      row('Resume after a pause', 'Click “Resume” (then 3-2-1)'),
      row('Free practice: choose a setting to tune', keys('[', ']')),
      row('Free practice: change it', keys('−', '='))));
}

const SECTIONS = ['start', 'controls', 'session', 'results', 'tuning', 'tips', 'trouble'];

export function mount(root, ctx, params) {
  const S = ctx.state.settings;
  const prof = activeProfile(ctx.state);
  if (!S.ui.helpSeen) {
    S.ui.helpSeen = true;
    ctx.saveSettings();
  }
  const sec = (id, title, ...kids) => h('div', { class: 'card', id: `help-${id}` }, h('h2', null, title), ...kids);
  const go = (route, label) => h('button', { class: 'btn small', onclick: () => ctx.navigate(route) }, label);
  const step = (n, title, text, btn) => h('div', { class: 'step' }, h('span', { class: 'num' }, String(n)), h('div', null, h('b', null, title), h('div', { class: 'small muted' }, text)), btn);
  const ss = S.session;

  root.append(
    h('div', { class: 'page' },
      topBar('How to use', ctx),
      h('div', { class: 'tabs' }, [['start', 'Start here'], ['controls', 'Controls'], ['session', 'A session'], ['results', 'Results'], ['tuning', 'Tuning Lab'], ['tips', 'Tips'], ['trouble', 'Problems?']].map(([id, label]) =>
        h('button', { class: 'btn small', onclick: () => document.getElementById(`help-${id}`).scrollIntoView({ behavior: 'smooth' }) }, label))),

      sec('start', 'Start here – 4 steps',
        step(1, 'Check your mouse and keys', 'Hardware test: calibrate the mouse (move it 10 cm along a ruler, then click) and press your pedal keys once.', go('hardware', 'Hardware test')),
        step(2, 'Prepare Windows (once)', 'Turn off the Sticky Keys shortcut (Settings → Accessibility → Keyboard). Switch Unikey / EVKey to English (E). Use Chrome or Edge.', null),
        step(3, 'Warm up', 'Free practice for 2–3 minutes. No time limit, nothing is saved.', go('free', 'Free practice')),
        step(4, 'Do a full session', `${ss.practiceSec ? `${ss.practiceSec} s practice + ` : ''}${ss.runs} runs of ${ss.runSec} s, like the real test.`, go('session', 'Start session'))),

      sec('controls', 'Controls', h('p', { class: 'small muted' }, 'This is exactly what the app uses now (from your settings). Keep both on the red dots.'), controlsCheatSheet(S, prof), controlsTable(S),
        h('p', { class: 'small' }, 'On the test screen, the stick and pedal pictures (bottom left) light up when you use them: the pedal you press lights up at once and fills as it goes down; the stick arrow lights up the way you push. For a screen exactly like the real test, turn on ', h('b', null, 'Exam look'), ' in Settings → Training aids.'),
        h('p', { class: 'small' }, 'Change keys, mouse travel or directions in ', h('a', { href: '#/settings' }, 'Settings'), '.')),

      sec('session', 'What happens in a session',
        h('ol', null,
          h('li', null, 'Click ', h('b', null, 'Start'), '. The screen goes full screen and the mouse pointer disappears – that is normal: the mouse is now the stick.'),
          h('li', null, '3-2-1, then the ', h('b', null, 'practice'), ' (not scored), 3-2-1 again, then the ', h('b', null, 'runs'), ` with ${ss.breakSec} s breaks.`),
          h('li', null, 'Press ', kbd('Esc'), ' to pause. Switching window (Alt+Tab) or clicking outside also pauses. Click ', h('b', null, 'Resume'), ' → 3-2-1 → continue. Paused time is never scored.'),
          h('li', null, 'At the end you see your results; the session is saved in History.'))),

      sec('results', 'Reading your results',
        h('ul', null,
          h('li', null, h('b', null, 'Practice score 0–100'), ': 100 = perfect, 0 = no better than letting go. It is not the official COMPASS score.'),
          h('li', null, h('b', null, 'On target %'), `: how long the needle stayed within ±${S.scoring.needleTolDeg}° of the dot and the ball within ${S.scoring.ballTolRadii} ball radius of the dot. “Both” = both at the same time – the most useful number.`),
          h('li', null, h('b', null, 'RMS error'), ': average distance from the dot. Lower is better.'),
          h('li', null, h('b', null, 'Charts'), ' show where you drifted; ', h('b', null, 'Replay'), ' plays a run back exactly.'),
          h('li', null, 'Goal: “Both on target” going up over the weeks, at difficulty 3 or higher.'))),

      sec('tuning', 'Make it feel like the real test (Tuning Lab)',
        h('ol', null,
          h('li', null, h('b', null, 'Compare'), ': watch version 1 and version 2, click the one closer to the real test. About 6 rounds per setting. Start with ', h('i', null, 'Drift strength'), ', then ', h('i', null, 'Response speed'), '.'),
          h('li', null, h('b', null, 'Watch & adjust'), ': move the sliders while the instruments run; the table shows the result in seconds.'),
          h('li', null, h('b', null, 'Questionnaire'), ': answer only what you remember; it makes a new profile.')),
        h('p', { class: 'small muted' }, 'Everything is saved in the active profile automatically. When you buy a joystick and pedals, the profile stays the same.'),
        go('tuning', 'Open Tuning Lab')),

      sec('tips', 'Tips for good tracking',
        h('ul', null,
          h('li', null, 'Small, smooth, continuous corrections beat big ones. Do not chase.'),
          h('li', null, 'Keep your eyes moving between the needle and the ball; do not stare at one.'),
          h('li', null, 'Correct early, while the error is still small.'),
          h('li', null, 'Use the practice minute to feel how sensitive the controls are today.'))),

      sec('trouble', 'Problems?',
        h('dl', { class: 'faq' },
          h('dt', null, 'Moving the mouse does nothing'), h('dd', null, 'The mouse is not captured. Click Resume (or Start). After Esc, Chrome needs a second before it can capture again – click once more.'),
          h('dt', null, 'The needle or ball moves the wrong way'), h('dd', null, 'Settings → Test feel → Directions (Stick → needle, Pedal → ball).'),
          h('dt', null, 'The pedal keys do nothing or act strangely'), h('dd', null, 'Switch Unikey / EVKey to English (E). Check the keys in Settings → Pedals and on the Hardware test page.'),
          h('dt', null, 'The run paused by itself'), h('dd', null, 'The window lost focus (Alt+Tab, a pop-up, a notification) or the mouse was released. Click Resume.'),
          h('dt', null, 'The needle is too sensitive / too slow'), h('dd', null, 'Calibrate the mouse (Hardware test), then change “Mouse travel for full stick” in Settings → Stick. A bigger number = calmer.'),
          h('dt', null, '“Raw input: no” on the Hardware page'), h('dd', null, 'Use Chrome or Edge, and turn off Windows “Enhance pointer precision”, then calibrate again.'),
          h('dt', null, 'It does not go full screen'), h('dd', null, 'Settings → Session → “Full screen during sessions”.'))),
    ),
  );
  if (params[0] && SECTIONS.includes(params[0])) requestAnimationFrame(() => document.getElementById(`help-${params[0]}`).scrollIntoView());
}
