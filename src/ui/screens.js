// Home and About screens.

import { h, keyLabel } from './dom.js';
import { activeProfile } from '../state.js';
import { APP_ID, APP_VERSION, DB_NAME, LS_PREFIX, EXPECTED_MANIFEST_ID } from '../config.js';

function menuButton(title, sub, onclick, primary = false) {
  return h('button', { class: `btn${primary ? ' primary' : ''}`, onclick }, h('b', null, title), h('span', null, sub));
}

export const home = {
  mount(root, ctx) {
    const s = ctx.state.settings;
    const prof = activeProfile(ctx.state);
    const ss = s.session;
    const notices = [];
    if (!s.ui.stickyTipDismissed) {
      const n = h(
        'div',
        { class: 'notice info' },
        h('b', null, 'Windows tip: '),
        'turn off the Sticky Keys keyboard shortcut (Settings → Accessibility → Keyboard → Sticky keys). Pressing Shift five times otherwise opens a dialog that steals focus in the middle of a run. If you type Vietnamese with Unikey / EVKey / Telex, switch it to English (E) before practising. ',
        h('button', {
          class: 'btn small',
          onclick: () => {
            s.ui.stickyTipDismissed = true;
            ctx.saveSettings();
            n.remove();
          },
        }, 'Got it'),
      );
      notices.push(n);
    }
    if (s.device.stick.source === 'mouse' && s.device.stick.mouseMode === 'lock' && !s.device.stick.calibrated) {
      notices.push(
        h('div', { class: 'notice' }, 'Your mouse is not calibrated yet, so full stick assumes an 800 DPI mouse. ', h('a', { href: '#/hardware' }, 'Calibrate it on the Hardware test page'), ' (move the mouse 10 cm along a ruler).'),
      );
    }
    const runsTxt = `${ss.practiceSec ? `${ss.practiceSec} s practice + ` : ''}${ss.runs} × ${ss.runSec} s`;
    const pedalTxt = s.device.pedals.source === 'keys' ? `${keyLabel(s.device.pedals.leftKey)} / ${keyLabel(s.device.pedals.rightKey)}` : 'gamepad';
    root.append(
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'home-hero' }, h('img', { src: 'icons/icon-192.png', width: 56, height: 56, alt: '', style: { borderRadius: '12px' } }), h('div', null, h('h1', null, 'Control Trainer'), h('div', { class: 'muted' }, 'Needle-and-ball tracking practice in the style of the COMPASS Control module'))),
        notices,
        h(
          'div',
          { class: 'home-menu' },
          menuButton('Start session', runsTxt, () => ctx.navigate('session'), true),
          menuButton('Free practice', 'No time limit · live tuning keys', () => ctx.navigate('free')),
          menuButton('Tuning Lab', 'Match the feel to the real test', () => ctx.navigate('tuning')),
          menuButton('Hardware test', 'Mouse, keys, joystick, pedals', () => ctx.navigate('hardware')),
          menuButton('Settings', 'Device, session, scoring, display', () => ctx.navigate('settings')),
          menuButton('History', 'Past sessions, charts, export', () => ctx.navigate('history')),
          menuButton('About', 'Disclaimer, sources, privacy', () => ctx.navigate('about')),
        ),
        h(
          'p',
          { class: 'muted small', style: { marginTop: '18px' } },
          `Profile: ${prof.name} · difficulty ${ss.difficulty} · mode ${ss.mode} · stick: ${s.device.stick.source === 'mouse' ? `mouse (${s.device.stick.travelCm} cm)` : 'gamepad'} · pedals: ${pedalTxt}. `,
          'Scores here are practice scores, not the official COMPASS score.',
        ),
      ),
    );
  },
};

export const about = {
  mount(root, ctx) {
    const manifestCheck = h('span', { class: 'muted' }, 'checking…');
    fetch('manifest.webmanifest')
      .then((r) => r.json())
      .then((m) => {
        const ok = m.id === EXPECTED_MANIFEST_ID;
        manifestCheck.className = ok ? 'badge ok' : 'badge warn';
        manifestCheck.textContent = ok ? `id ${m.id} ✓` : `id is ${m.id}, but this copy is served from ${EXPECTED_MANIFEST_ID} – run tools/set-repo-name.mjs`;
      })
      .catch(() => (manifestCheck.textContent = 'could not read the manifest'));
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    root.append(
      h(
        'div',
        { class: 'page' },
        h('header', { class: 'topbar' }, h('button', { class: 'btn small', onclick: () => ctx.navigate('home') }, '← Home'), h('h1', null, 'About')),
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'Disclaimer'),
          h('p', null, 'This is an independent practice tool. It is not affiliated with COMPASS, EPST or Aviation Focus, and its score is not the official COMPASS score. The real test\'s control dynamics, drift and scoring are not public: everything here is an adjustable estimate.'),
        ),
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'The task'),
          h('p', null, 'Keep the blue needle on the red dot (9 o\'clock) with the stick\'s fore/aft axis – sideways does nothing – and, at the same time, keep the blue ball on the red dot in the middle of the track with the rudder pedals. Both drift randomly. The real session is a 1-minute practice followed by 3 runs of 2 minutes.'),
          h('p', { class: 'muted small' }, 'Here the mouse is the stick (forward/back only) and two keys are the pedals. Defaults follow aviation convention: push forward → needle down; right pedal → ball moves left ("step on the ball"). Both are settings.'),
        ),
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'Sources used for the design'),
          h(
            'ul',
            null,
            h('li', null, 'Test-centre candidate guide (Vietnamese), section "Phần 3: Control" with a screenshot of the screen: dial with a red dot at 9 o\'clock and a blue needle, a track with a red centre dot and a blue ball, stick and pedal icons; random movement above/below and left/right; 3 runs × 2 minutes after 1 minute of practice.'),
            h('li', null, 'Public preparation pages describing the module as compensatory tracking with a joystick and rudder pedals: ', link('https://www.aviationfocus.aero/pilot-selection/how-compass-works/', 'Aviation Focus – How COMPASS works'), ', ', link('https://www.pilotest.com/en/tests/basic_coordination', 'Pilotest – basic coordination'), ', ', link('https://pilotaptitudetest.com/knowledgebase/compass/', 'PilotAptitudeTest.com'), ', ', link('https://www.careerroo.com/magazine/compass-test-for-pilots/', 'Careerroo'), '.'),
            h('li', null, 'Manual-control research for the model structure and adjustable ranges: McRuer & Jex (1967), "A review of quasi-linear pilot models", IEEE Trans. HFE-8 (crossover model: human ≈ gain + 0.1–0.25 s effective delay); Jex, McDonnell & Phatak (1966) critical tracking task (an unstable element becomes uncontrollable near 1/delay). Sums of five or more sines are unpredictable to a human tracker.'),
          ),
        ),
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'Privacy and storage'),
          h('p', null, 'No network calls, no analytics. Everything stays in this browser. This app shares its web origin with other apps, so all its storage is prefixed:'),
          h(
            'ul',
            { class: 'mono small' },
            h('li', null, `app id: ${APP_ID}  (version ${APP_VERSION})`),
            h('li', null, `localStorage keys: ${LS_PREFIX}settings, ${LS_PREFIX}profiles`),
            h('li', null, `IndexedDB: ${DB_NAME}`),
            h('li', null, `caches: ${APP_ID}-v<number> (the service worker deletes only these)`),
            h('li', null, 'manifest: ', manifestCheck),
          ),
          h('p', { class: 'muted small' }, 'Chrome\'s "Clear site data" and the "also clear data" box when uninstalling the app wipe the whole origin – every app on it. Export your history regularly.'),
        ),
      ),
    );
  },
};
