// Hardware test page: check mouse, keys, joysticks and rudder pedals before
// (and after) buying them. Live raw values, mouse calibration, key-event log
// with hold durations (foot switches), gamepad axes/buttons with quick assign.

import { h, fmt, keyLabel, topBar, valueBar } from './dom.js';
import { MouseStick } from '../input/mouse-stick.js';
import { KeyPedals } from '../input/keyboard-pedals.js';
import { listPads } from '../input/gamepad.js';

export function mount(root, ctx) {
  const S = ctx.state.settings;
  const save = () => ctx.saveSettings();
  const card = (title, ...kids) => h('div', { class: 'card' }, h('h2', null, title), ...kids);
  const kv = (label, el) => h('div', { class: 'row', style: { justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '4px 0' } }, h('span', { class: 'muted' }, label), el);
  const mono = () => h('span', { class: 'mono' }, '–');

  // ---------------- mouse ----------------
  const lockBox = h('div', { tabindex: 0, style: { border: '2px dashed var(--line)', borderRadius: '10px', padding: '26px 12px', textAlign: 'center', cursor: 'pointer', userSelect: 'none', margin: '8px 0' } }, 'Click here to capture the mouse · Esc releases it');
  const ms = new MouseStick(S.device.stick);
  ms.attach(lockBox);
  const M = { ev: mono(), rate: mono(), dy: mono(), sumY: mono(), sumX: mono(), outl: mono(), raw: mono(), val: mono() };
  const stickBar = valueBar(true);
  lockBox.addEventListener('click', async () => {
    const r = await ms.lock();
    if (!r.ok) ctx.toast(r.error || 'Pointer lock was refused – click again.');
  });

  // calibration
  const cal = { active: false, startY: 0, result: null };
  const calText = h('p', { class: 'small' });
  const calBtns = h('div', { class: 'row' });
  const calLive = h('div', { class: 'mono', style: { fontSize: '22px' } });
  function calIdle() {
    calText.replaceChildren(`Current: ${fmt(S.device.stick.countsPerCm, 1)} counts/cm ${S.device.stick.calibrated ? `(calibrated ${S.device.stick.calibratedAt ? new Date(S.device.stick.calibratedAt).toLocaleDateString() : ''}${S.device.stick.calibratedRaw === false ? ', without raw input' : ''})` : '(default, not calibrated)'}. Full stick = ${S.device.stick.travelCm} cm = ${fmt(S.device.stick.countsPerCm * S.device.stick.travelCm, 0)} counts.`);
    calBtns.replaceChildren(h('button', { class: 'btn primary', onclick: calStart }, 'Start calibration'));
    calLive.textContent = '';
  }
  async function calStart() {
    cal.active = true;
    cal.startY = ms.sumDy;
    const r = await ms.lock();
    if (!r.ok) {
      cal.active = false;
      ctx.toast(r.error || 'Pointer lock was refused – click again.');
      return;
    }
    cal.startY = ms.sumDy;
    calText.replaceChildren(h('b', null, 'Lay a ruler beside the mouse. Move the mouse exactly 10 cm along it (forward or back), then click.'), ' Lift and re-place the mouse is fine – lifted movement is not counted.');
    calBtns.replaceChildren();
  }
  const onCalDown = (e) => {
    if (!cal.active || !ms.isLocked() || e.button !== 0) return;
    cal.active = false;
    const counts = Math.abs(ms.sumDy - cal.startY);
    document.exitPointerLock();
    const cpc = Math.round((counts / 10) * 10) / 10;
    calText.replaceChildren(`Measured ${counts} counts over 10 cm → ${cpc} counts/cm (≈ ${Math.round(cpc * 2.54)} DPI). `, counts < 50 ? h('b', null, 'That is very small – did you move the full 10 cm?') : '', ms.rawGranted === false ? h('div', { class: 'notice' }, 'Raw input was not granted, so Windows acceleration may have changed the count. Turn off "Enhance pointer precision" (Settings → Bluetooth & devices → Mouse → Additional mouse settings → Pointer Options) and calibrate in the same browser you practise in.') : '');
    calBtns.replaceChildren(
      h('button', {
        class: 'btn primary',
        disabled: counts < 10,
        onclick: () => {
          Object.assign(S.device.stick, { countsPerCm: cpc, calibrated: true, calibratedRaw: ms.rawGranted, calibratedAt: new Date().toISOString() });
          save();
          ctx.toast('Calibration saved.');
          calIdle();
        },
      }, 'Save'),
      h('button', { class: 'btn', onclick: calStart }, 'Retry'),
      h('button', { class: 'btn', onclick: calIdle }, 'Cancel'),
    );
  };
  document.addEventListener('mousedown', onCalDown);
  calIdle();

  // ---------------- keys ----------------
  const kp = new KeyPedals(S.device.pedals);
  kp.attach();
  const pedalBar = valueBar(true);
  const pedalVal = mono();
  const imeNote = h('div', { class: 'notice', hidden: true }, 'A Vietnamese input method (Unikey / EVKey / Windows Telex) seems active: in Telex, keys like A, D, S, F, R, X, J and W become letter/tone edits and the input method can swallow or garble pedal presses. Switch it to English (E) before practising.');
  const logBody = h('tbody');
  let t0 = null;
  kp.onLog = () => {
    if (kp.imeSuspected) imeNote.hidden = false;
    const rows = kp.log.slice(-20).reverse();
    if (t0 == null && rows.length) t0 = rows[rows.length - 1].t;
    logBody.replaceChildren(
      ...rows.map((e) =>
        h('tr', null, h('td', null, e.type), h('td', { class: 'mono' }, e.code || '(none)'), h('td', { class: 'mono' }, JSON.stringify(e.key)), h('td', null, fmt(e.t - t0, 0)), h('td', null, e.hold != null ? fmt(e.hold, 0) : ''), h('td', null, e.repeat ? 'yes' : ''), h('td', null, e.ime ? 'yes' : ''), h('td', null, e.mapped ? (e.code === S.device.pedals.leftKey || e.code === S.device.pedals.leftLightKey ? 'left' : 'right') : '')),
      ),
    );
  };

  // ---------------- gamepads ----------------
  const padStatus = h('p', { class: 'small muted' }, 'Press any button on your joystick or pedals, or move an axis all the way – Chrome only shows a device after that. Rudder pedals without buttons appear once you push a pedal fully.');
  const padsBox = h('div');
  let padSig = '';
  const padBars = [];
  const onPad = (e) => (padStatus.textContent = `${e.type === 'gamepadconnected' ? 'Connected' : 'Disconnected'}: ${e.gamepad.id}`);
  window.addEventListener('gamepadconnected', onPad);
  window.addEventListener('gamepaddisconnected', onPad);
  const sourceLine = h('p', { class: 'small' });
  function updateSourceLine() {
    const st = S.device.stick;
    const pd = S.device.pedals;
    sourceLine.replaceChildren(
      `Stick: ${st.source === 'gamepad' ? `gamepad axis ${st.pad.axis}${st.pad.invert ? ' (inverted)' : ''}` : 'mouse'} · Pedals: ${pd.source === 'gamepad' ? (pd.pad.mode === 'differential' ? `gamepad axes ${pd.pad.axisL} (L) / ${pd.pad.axisR} (R)` : `gamepad axis ${pd.pad.axis}`) : 'keys'} `,
      st.source === 'gamepad' ? h('button', { class: 'btn small', onclick: () => ((st.source = 'mouse'), save(), updateSourceLine()) }, 'Use mouse for stick') : null,
      ' ',
      pd.source === 'gamepad' ? h('button', { class: 'btn small', onclick: () => ((pd.source = 'keys'), save(), updateSourceLine()) }, 'Use keys for pedals') : null,
    );
  }
  updateSourceLine();
  function assign(kind, pad, axis) {
    const target = kind === 'stick' ? S.device.stick : S.device.pedals;
    target.source = 'gamepad';
    Object.assign(target.pad, { id: pad.id, index: pad.index, axis, min: -1, max: 1 });
    if (kind === 'stick') target.pad.invert = true; // most sticks report forward as −1
    else target.pad.mode = 'single';
    save();
    updateSourceLine();
    ctx.toast(`Axis ${axis} of "${pad.id}" now drives the ${kind === 'stick' ? 'stick' : 'pedals'}. Use "Calibrate range" next.`);
  }
  let calRange = null; // {kind, axis, padIndex, min, max, until}
  function startRange(kind, pad, axis) {
    calRange = { kind, axis, padIndex: pad.index, min: Infinity, max: -Infinity, until: performance.now() + 5000 };
    padStatus.textContent = `Move axis ${axis} through its whole range (both ends) for 5 seconds…`;
  }
  function buildPads(pads) {
    padBars.length = 0;
    padsBox.replaceChildren(
      ...pads.map((p) => {
        const axes = p.axes.map((v, i) => {
          const bar = valueBar(true);
          const val = h('span', { class: 'mono', style: { width: '56px', display: 'inline-block', textAlign: 'right' } });
          padBars.push({ pad: p.index, kind: 'axis', i, bar, val });
          return h('div', { class: 'row', style: { flexWrap: 'nowrap', padding: '3px 0' } }, h('span', { style: { width: '54px' } }, `Axis ${i}`), h('div', { style: { flex: 1 } }, bar), val,
            h('button', { class: 'btn small', onclick: () => assign('stick', p, i) }, 'Use as stick'),
            h('button', { class: 'btn small', onclick: () => assign('pedals', p, i) }, 'Use as pedals'),
            h('button', { class: 'btn small', onclick: () => startRange('axis', p, i) }, 'Calibrate range'));
        });
        const buttons = h('div', { class: 'row' }, p.buttons.map((b, i) => {
          const el = h('span', { class: 'badge' }, `B${i}`);
          padBars.push({ pad: p.index, kind: 'button', i, el });
          return el;
        }));
        return h('div', { style: { borderTop: '1px solid var(--line)', paddingTop: '8px', marginTop: '8px' } }, h('div', null, h('b', null, `#${p.index} ${p.id}`), h('span', { class: 'muted small' }, ` · mapping: ${p.mapping}`)), axes, h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Buttons'), buttons);
      }),
    );
  }

  // ---------------- page ----------------
  root.append(
    h('div', { class: 'page' },
      topBar('Hardware test', ctx),
      card('Mouse as stick', lockBox,
        h('div', { class: 'grid' },
          h('div', null, kv('Event type', M.ev), kv('Events per second', M.rate), kv('Last movementY (counts)', M.dy), kv('Σ Y counts', M.sumY), kv('Σ X counts (ignored)', M.sumX), kv('Bogus jumps dropped', M.outl), kv('Raw input (no OS acceleration)', M.raw)),
          h('div', null, h('p', { class: 'small muted' }, 'Stick value (forward = right of centre here):'), stickBar, h('p', null, M.val), h('button', { class: 'btn small', onclick: () => ms.reset() }, 'Re-centre'),
            h('p', { class: 'small muted' }, '"pointerrawupdate" means the browser delivers every mouse report (lowest latency). Sideways movement is counted only to prove it is ignored.')))),
      card('Mouse calibration', calText, calLive, calBtns),
      card('Keys as pedals', h('div', { class: 'row' }, h('span', null, `Left: ${keyLabel(S.device.pedals.leftKey)} · Right: ${keyLabel(S.device.pedals.rightKey)}`), h('a', { href: '#/settings' }, 'change')),
        h('div', { class: 'row', style: { flexWrap: 'nowrap', margin: '8px 0' } }, h('div', { style: { flex: 1 } }, pedalBar), pedalVal),
        imeNote,
        h('p', { class: 'small muted' }, 'Press keys or a USB foot switch. A good foot switch sends key-up when released, so "hold" matches how long you held it. Auto-repeat shows as repeat = yes and is ignored by the app.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Event'), h('th', null, 'code'), h('th', null, 'key'), h('th', null, 'Time (ms)'), h('th', null, 'Hold (ms)'), h('th', null, 'Repeat'), h('th', null, 'IME'), h('th', null, 'Pedal'))), logBody))),
      card('Joysticks and rudder pedals (gamepad API)', padStatus, sourceLine, padsBox),
      card('Windows tips',
        h('ul', { class: 'small' },
          h('li', null, 'Turn off the Sticky Keys shortcut: Settings → Accessibility → Keyboard → Sticky keys → keyboard shortcut off.'),
          h('li', null, 'If "Raw input" shows no: turn off "Enhance pointer precision" (Settings → Bluetooth & devices → Mouse → Additional mouse settings → Pointer Options), then recalibrate.'),
          h('li', null, 'Use Chrome or Edge. Firefox has no raw mouse input and no keyboard lock.'),
          h('li', null, 'Vietnamese typing: switch Unikey / EVKey to English (E) before practising.'))),
    ),
  );

  // ---------------- live loop ----------------
  let raf = 0;
  let last = performance.now();
  let rateT = last;
  let rateN = ms.events;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const v = ms.advanceTo(now, dt);
    stickBar.set(v);
    M.val.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;
    M.ev.textContent = ms.eventName || '–';
    M.dy.textContent = String(ms.lastDy);
    M.sumY.textContent = String(ms.sumDy);
    M.sumX.textContent = String(ms.sumDx);
    M.outl.textContent = String(ms.outliers);
    M.raw.textContent = ms.rawGranted == null ? 'not locked yet' : ms.rawGranted ? 'yes' : 'no';
    if (now - rateT >= 1000) {
      M.rate.textContent = String(Math.round(((ms.events - rateN) * 1000) / (now - rateT)));
      rateT = now;
      rateN = ms.events;
    }
    if (cal.active && ms.isLocked()) calLive.textContent = `${Math.abs(ms.sumDy - cal.startY)} counts`;
    const pv = kp.advanceTo(now, dt);
    pedalBar.set(pv);
    pedalVal.textContent = `${pv >= 0 ? '+' : ''}${pv.toFixed(2)}`;
    const pads = listPads();
    const sig = pads.map((p) => `${p.index}:${p.id}:${p.axes.length}:${p.buttons.length}`).join('|');
    if (sig !== padSig) {
      padSig = sig;
      buildPads(pads);
    }
    for (const b of padBars) {
      const p = pads.find((x) => x.index === b.pad);
      if (!p) continue;
      if (b.kind === 'axis') {
        const val = p.axes[b.i];
        b.bar.set(val);
        b.val.textContent = val.toFixed(3);
      } else b.el.className = p.buttons[b.i] > 0.5 ? 'badge ok' : 'badge';
    }
    if (calRange) {
      const p = pads.find((x) => x.index === calRange.padIndex);
      if (p) {
        const val = p.axes[calRange.axis];
        calRange.min = Math.min(calRange.min, val);
        calRange.max = Math.max(calRange.max, val);
      }
      if (now > calRange.until) {
        const { axis, min, max } = calRange;
        calRange = null;
        if (!(max - min > 0.2)) padStatus.textContent = 'The axis hardly moved – try again and move it fully both ways.';
        else {
          const st = S.device.stick;
          const pd = S.device.pedals;
          const done = [];
          if (st.source === 'gamepad' && st.pad.axis === axis) Object.assign(st.pad, { min, max }), done.push('stick');
          if (pd.source === 'gamepad') {
            if (pd.pad.mode === 'differential' && pd.pad.axisL === axis) Object.assign(pd.pad, { minL: min, maxL: max }), done.push('left pedal');
            else if (pd.pad.mode === 'differential' && pd.pad.axisR === axis) Object.assign(pd.pad, { minR: min, maxR: max }), done.push('right pedal');
            else if (pd.pad.axis === axis) Object.assign(pd.pad, { min, max }), done.push('pedals');
          }
          save();
          padStatus.textContent = `Axis ${axis}: range ${min.toFixed(3)} … ${max.toFixed(3)}${done.length ? ` – saved for ${done.join(', ')}` : ' (assign the axis first to save it)'}.`;
        }
      }
    }
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('mousedown', onCalDown);
    window.removeEventListener('gamepadconnected', onPad);
    window.removeEventListener('gamepaddisconnected', onPad);
    ms.detach();
    kp.detach();
    if (document.pointerLockElement) document.exitPointerLock();
  };
}
