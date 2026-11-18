// Tuning Lab: make the needle and ball behave like the real test.
// Recognition is easier than recall, so the main tool is "Compare": watch two
// versions that differ in ONE setting (same drift pattern) and pick the one that
// is closer to your memory, like an eye test. Each answer narrows the range;
// the final range becomes that setting's uncertainty band, which "vary feel"
// can train across. "Watch" isolates the drift (hands off) from the response
// (scripted stick steps), so mouse/keyboard quirks never leak into the profile.

import { h, fmt, topBar, download, pickFile } from './dom.js';
import { field, fmtSpec, roundForSpec } from './fields.js';
import { Instruments } from '../render/instruments.js';
import { RunEngine, scriptedSource, zeroSource } from '../sim/engine.js';
import { tolerances } from '../sim/scoring.js';
import { PARAMS, KEY_PARAMS, paramSpec, paramName, getPath, setPath, clone, normalizeProfile, DEFAULT_PROFILE, clampParam } from '../sim/profile.js';
import { describeChannel, solveStrength } from '../sim/feel.js';
import { randomSeed } from '../sim/prng.js';
import { activeProfile, duplicateProfile, newId } from '../state.js';
import { createInputs } from '../input/index.js';
import { APP_ID } from '../config.js';

// Scripted stick/pedal input for "response" views: steps and taps, no drift.
const RESPONSE_SCRIPT = [[0, 0], [1.0, 1], [1.8, 0], [3.8, -1], [4.6, 0], [6.0, 0.35], [6.25, 0], [7.0, -0.35], [7.25, 0]];
const RESPONSE_SEC = 9;
const scriptAt = (t) => RESPONSE_SCRIPT.reduce((v, [ts, val]) => (t >= ts ? val : v), 0);
const VIEW_SEC = { watch: 10, response: RESPONSE_SEC, try: 15 };

function assignDeep(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') assignDeep(dst[k], v);
    else dst[k] = v;
  }
}

/** Profile for a view: drift off for response tests; only the studied channel active. */
function viewProfile(base, view) {
  const p = clone(base);
  if (view === 'response') for (const ch of ['needle', 'ball']) p[ch].drift.strength = 0;
  return p;
}

// ---------------------------------------------------------------- lab player
class LabPlayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.canvas = h('canvas');
    this.banner = h('div', { class: 'banner', hidden: true });
    this.hint = h('div', { class: 'banner', hidden: true, style: { top: 'auto', bottom: '8px', fontWeight: 400, fontSize: '13px' } });
    this.el = h('div', { class: 'lab-stage' }, this.canvas, this.banner, this.hint);
    this.inst = new Instruments(this.canvas, { strip: false, theme: ctx.state.settings.display.background, scale: 0.92 });
    this.engine = null;
    this.inputs = null;
    this.raf = requestAnimationFrame(this.loop);
  }
  ensureInputs() {
    if (this.inputs) return this.inputs;
    this.inputs = createInputs(this.ctx.state.settings);
    if (this.inputs.mouse) this.inputs.mouse.attach(this.canvas);
    if (this.inputs.keys) this.inputs.keys.attach();
    return this.inputs;
  }
  /** Capture the mouse (call from a click). */
  lock() {
    const inp = this.ensureInputs();
    return inp.needsPointerLock ? inp.mouse.lock() : Promise.resolve({ ok: true });
  }
  /**
   * @param {{profile, seed, channel:'needle'|'ball', view:'watch'|'response'|'try', sec?, banner?, onEnd?}} o
   * o.profile is read live (call sync() after editing the base).
   */
  play(o) {
    this.o = o;
    const sec = o.sec ?? VIEW_SEC[o.view];
    const script = scriptedSource((k) => scriptAt(k / 120));
    let stick = zeroSource();
    let pedal = zeroSource();
    if (o.view === 'response') {
      if (o.channel === 'needle') stick = script;
      else pedal = script;
    } else if (o.view === 'try') {
      const inp = this.ensureInputs();
      if (inp.mouse) inp.mouse.reset();
      if (inp.keys) inp.keys.reset();
      stick = inp.stick;
      pedal = inp.pedal;
    }
    this.profile = o.profile;
    const s = this.ctx.state.settings;
    this.engine = new RunEngine({ profile: this.profile, seed: o.seed, mode: o.channel, durationSec: sec, stick, pedal, tol: tolerances(this.profile, s.scoring), fadeIn: o.view !== 'response' });
    this.engine.start(performance.now());
    this.banner.textContent = o.banner || '';
    this.banner.hidden = !o.banner;
  }
  stop() {
    this.engine = null;
    this.banner.hidden = true;
  }
  loop = (now) => {
    this.raf = requestAnimationFrame(this.loop);
    const e = this.engine;
    if (e) {
      e.frame(now);
      if (e.finished) {
        const cb = this.o && this.o.onEnd;
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
        this.engine = null;
        this.banner.hidden = true;
        if (cb) cb();
      }
    }
    const p = this.profile || activeProfile(this.ctx.state);
    this.inst.draw({ eN: e ? e.eN : 0, eB: e ? e.eB : 0, maxAngle: p.maxAngle, mode: this.o ? this.o.channel : 'both', timer: e ? `${Math.ceil(e.remainingSec)} s` : null });
  };
  destroy() {
    cancelAnimationFrame(this.raf);
    this.inst.destroy();
    if (this.inputs) {
      if (this.inputs.mouse) this.inputs.mouse.detach();
      if (this.inputs.keys) this.inputs.keys.detach();
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// ---------------------------------------------------------------- questionnaire
const Q_CH = [
  { id: 'full', q: 'At full stick / full pedal it moved…', opts: [['2.5', 'very fast – it snapped across'], ['1', 'across in about a second'], ['0.5', 'slowly']], apply: (p, ch, v) => (p[ch].topSpeed = Number(v)) },
  { id: 'reversals', q: 'Did it change direction often, or lean one way for a long time?', opts: [['0.6', 'leaned one way for a long time'], ['1', 'in between'], ['1.6', 'changed direction often']], apply: (p, ch, v) => (p[ch].drift.speed = Number(v)) },
  { id: 'shoves', q: 'Was the drift smooth, or were there sudden shoves?', opts: [['0', 'smooth'], ['some', 'some shoves'], ['many', 'lots of shoves']], apply: (p, ch, v) => Object.assign(p[ch].drift, v === '0' ? { gustSize: 0 } : v === 'some' ? { gustSize: 3, gustMin: 4, gustMax: 9 } : { gustSize: 4.5, gustMin: 2.5, gustMax: 6 }) },
  { id: 'push', q: 'Did you have to hold a steady push for several seconds to keep it on the dot?', opts: [['0', 'no'], ['0.8', 'sometimes'], ['1.5', 'often']], apply: (p, ch, v) => Object.assign(p[ch].drift, { pushSize: Number(v), pushMin: 3, pushMax: 7 }) },
  { id: 'runaway', q: 'The further it got from the dot…', opts: [['0.6', '…the faster it ran away'], ['-0.5', '…it came back by itself'], ['0', '…neither']], apply: (p, ch, v) => (p[ch].runaway = Number(v)) },
  { id: 'slide', q: 'After you centred the stick / let go of the pedal, it…', opts: [['0.05', 'stopped at once'], ['0.25', 'slid on a little'], ['0.6', 'slid on a lot']], apply: (p, ch, v) => (p[ch].lag = Number(v)) },
  { id: 'react', q: 'When you moved the stick / pedals, it reacted…', opts: [['now', 'at once'], ['pause', 'after a short pause'], ['slow', 'slowly, building up']], apply: (p, ch, v) => (v === 'now' ? (p[ch].deadTime = 0) : v === 'pause' ? (p[ch].deadTime = 0.25) : (p[ch].lag = Math.max(p[ch].lag, 0.4))) },
  { id: 'leave', q: 'With hands off, how quickly did it leave the red dot?', opts: [['0.7', 'almost at once (under 1 s)'], ['2', 'after 1–3 s'], ['4.5', 'after 3–6 s'], ['8', 'it stayed a long time']], apply: (p, ch, v, tol) => (p[ch].drift.strength = Number(solveStrength(p[ch], tol[ch], Number(v)).toPrecision(3))) },
];
const Q_GLOBAL = [
  { id: 'size', q: 'How big were your stick and pedal movements?', opts: [['small', 'small, fine corrections'], ['medium', 'medium'], ['big', 'big movements']], apply: (p, v) => ['needle', 'ball'].forEach((ch) => (p[ch].topSpeed *= v === 'small' ? 1.3 : v === 'big' ? 0.75 : 1)) },
  { id: 'harder', q: 'Did it get harder during a run?', opts: [['0', 'no'], ['0.3', 'a bit'], ['0.6', 'a lot']], apply: (p, v) => ['needle', 'ball'].forEach((ch) => (p[ch].drift.ramp = Number(v))) },
  { id: 'coupled', q: 'Did the needle and the ball seem to affect each other?', opts: [['0', 'no'], ['0.15', 'yes, a little']], apply: (p, v) => Object.assign(p.coupling, { pedalToNeedle: Number(v), stickToBall: Number(v) }) },
  { id: 'ago', q: 'How long ago did you take the test?', opts: [['0.15', 'less than a month'], ['0.25', '1–6 months'], ['0.35', '6–12 months'], ['0.45', 'more than a year']], apply: null },
];
// order matters: response settings first, then the drift strength is solved for the remembered leave time
const CH_ORDER = ['full', 'reversals', 'shoves', 'push', 'runaway', 'slide', 'react'];

function applyAnswers(src, answers, tol) {
  const p = normalizeProfile(clone(src));
  const changes = [];
  const before = clone(p);
  for (const ch of ['needle', 'ball']) for (const id of CH_ORDER) {
    const v = answers[`${ch}.${id}`];
    if (v) Q_CH.find((q) => q.id === id).apply(p, ch, v);
  }
  for (const q of Q_GLOBAL) if (q.apply && answers[q.id]) q.apply(p, answers[q.id]);
  for (const ch of ['needle', 'ball']) {
    const v = answers[`${ch}.leave`];
    if (v) Q_CH.find((q) => q.id === 'leave').apply(p, ch, v, tol);
  }
  // memory age → uncertainty band on the main settings (used by "vary feel: uncertainty")
  const w = Number(answers.ago || 0.3);
  for (const spec of KEY_PARAMS.filter((s) => /strength|speed|topSpeed|lag$/.test(s.path))) {
    const x = getPath(p, spec.path);
    if (spec.scale === 'log') p.uncertainty[spec.path] = [clampParam(spec, x / (1 + w)), clampParam(spec, x * (1 + w))].map((v) => roundForSpec(spec, v));
    else p.uncertainty[spec.path] = [clampParam(spec, x - w * Math.max(x, 0.1)), clampParam(spec, x + w * Math.max(x, 0.1))].map((v) => roundForSpec(spec, v));
  }
  for (const spec of PARAMS) {
    const a = getPath(before, spec.path);
    const b = getPath(p, spec.path);
    if (typeof b === 'number' && Math.abs(a - b) > 1e-9) setPath(p, spec.path, spec.type === 'select' ? b : roundForSpec(spec, b));
    if (String(getPath(before, spec.path)) !== String(getPath(p, spec.path))) changes.push(`${paramName(spec)}: ${fmtSpec(spec, a)} → ${fmtSpec(spec, getPath(p, spec.path))}`);
  }
  p.answers = { ...answers };
  return { profile: p, changes };
}

// ---------------------------------------------------------------- screen
export function mount(root, ctx, params) {
  const st = ctx.state;
  let tab = params[0] || 'compare';
  let player = null;
  let saveTimer = 0;
  const saveSoon = () => {
    const p = activeProfile(st);
    p.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.saveProfiles(), 300);
  };
  const tol = () => {
    const t = tolerances(activeProfile(st), st.settings.scoring);
    return { needle: t.n, ball: t.b };
  };

  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  const TABS = [['compare', 'Compare (1 or 2?)'], ['watch', 'Watch & adjust'], ['questions', 'Questionnaire'], ['profiles', 'Profiles & readouts']];
  root.append(
    h('div', { class: 'page' },
      topBar('Tuning Lab', ctx, h('button', { class: 'btn small', onclick: () => ctx.navigate('free') }, 'Free practice with live tuning keys')),
      h('p', { class: 'muted small' }, 'Goal: make the needle and the ball behave like the real test. Everything here edits the active profile: ', h('b', null, activeProfile(st).name), '. Tune with your eyes first (Watch, Compare) – those views do not involve the mouse or keys, so device quirks stay out of the profile.'),
      tabs,
      body,
    ),
  );

  function setTab(t) {
    tab = t;
    if (player) {
      player.destroy();
      player = null;
    }
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', { class: `btn small${id === tab ? ' active' : ''}`, onclick: () => setTab(id) }, label)));
    body.replaceChildren();
    ({ compare: renderCompare, watch: renderWatch, questions: renderQuestions, profiles: renderProfiles })[tab]();
  }

  // ---------------- Readouts ----------------
  function readoutTable() {
    const p = activeProfile(st);
    const t = tol();
    const el = h('div', { class: 'table-wrap' });
    const fill = () => {
      const rows = ['needle', 'ball'].map((ch) => {
        const d = describeChannel(p[ch], t[ch]);
        const unit = ch === 'needle' ? (x) => `${fmt(x * p.maxAngle, 1)}°` : (x) => `${fmt(x * 100, 0)} % of half-track`;
        return h('tr', null, h('td', null, ch === 'needle' ? 'Needle' : 'Ball'),
          h('td', null, `${fmt(d.leave, 1)} s`),
          h('td', null, `${fmt(d.full, 2)} s`),
          h('td', null, p[ch].order === 0 ? '–' : `${unit(Math.abs(d.slide.dist))} in ${fmt(d.slide.time, 2)} s`),
          h('td', null, ch === 'needle' ? `${fmt(p[ch].drift.strength * p.maxAngle, 0)} °/s` : `${fmt(p[ch].drift.strength * 100, 0)} %/s`));
      });
      el.replaceChildren(h('table', { class: 'data' }, h('tr', null, h('th', null, 'At difficulty 3'), h('th', null, 'Hands off: leaves the dot after'), h('th', null, 'Full input: dot → end stop'), h('th', null, 'Slides on after letting go'), h('th', null, 'Typical drift speed')), rows));
    };
    fill();
    let tmr = 0;
    el.update = () => {
      clearTimeout(tmr);
      tmr = setTimeout(fill, 250);
    };
    return el;
  }

  // ---------------- Compare ----------------
  function renderCompare() {
    player = new LabPlayer(ctx);
    const p = activeProfile(st);
    const paramSel = h('select', null, KEY_PARAMS.map((s, i) => h('option', { value: i }, `${paramName(s)} (now ${fmtSpec(s, getPath(p, s.path))})`)));
    const trySel = h('select', null, h('option', { value: 'auto' }, 'Just watch (recommended)'), h('option', { value: 'try' }, 'Try with my controls'));
    const status = h('div', { class: 'small muted' });
    const answers = h('div', { class: 'row' });
    const startBtn = h('button', { class: 'btn primary', onclick: () => start() }, 'Start');
    const panel = h('div', null,
      h('h2', null, 'Which version is closer to the real test?'),
      h('p', { class: 'small muted' }, 'You see two versions that differ only in the chosen setting, on the same drift pattern, in random order. Pick the one closer to your memory. About 6 rounds narrow the setting down; "About the same" means your memory cannot tell them apart, which is useful too: it becomes the setting\'s uncertainty range.'),
      h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'Setting'), paramSel),
      h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'How'), trySel),
      h('div', { class: 'row' }, startBtn),
      status,
      answers,
    );
    body.append(h('div', { class: 'lab-cols' }, h('div', null, player.el), h('div', { class: 'card' }, panel)));

    let S = null;
    function start() {
      const spec = KEY_PARAMS[Number(paramSel.value)];
      const view = trySel.value === 'try' ? 'try' : spec.ab;
      const cur = getPath(p, spec.path);
      let lo;
      let hi;
      if (spec.scale === 'log') {
        lo = Math.max(spec.min, cur / 3);
        hi = Math.min(spec.max, cur * 3);
      } else {
        lo = spec.min;
        hi = spec.max;
      }
      const T = spec.scale === 'log' ? { f: Math.log, g: Math.exp } : { f: (x) => x, g: (x) => x };
      S = { spec, view, lo, hi, T, trial: 0, same: 0 };
      startBtn.disabled = true;
      paramSel.disabled = trySel.disabled = true;
      nextTrial();
    }
    function nextTrial() {
      const { T, lo, hi } = S;
      const a = T.g(T.f(lo) + (T.f(hi) - T.f(lo)) / 3);
      const b = T.g(T.f(lo) + (2 * (T.f(hi) - T.f(lo))) / 3);
      const swap = Math.random() < 0.5;
      S.shown = swap ? [b, a] : [a, b];
      S.a = a;
      S.b = b;
      S.seed = randomSeed();
      S.trial++;
      playBoth();
    }
    function variantProfile(v) {
      const vp = viewProfile(p, S.view);
      setPath(vp, S.spec.path, v);
      return vp;
    }
    function playOne(i, then) {
      const go = () => {
        player.play({ profile: variantProfile(S.shown[i]), seed: S.seed, channel: S.spec.ch, view: S.view, banner: `Version ${i + 1}`, onEnd: then });
        status.textContent = `Round ${S.trial}: watching version ${i + 1}…`;
      };
      if (S.view === 'try') {
        answers.replaceChildren(h('button', {
          class: 'btn primary',
          onclick: async () => {
            const r = await player.lock();
            if (!r.ok) return (status.textContent = r.error || 'Click again to capture the mouse.');
            answers.replaceChildren();
            go();
          },
        }, `Start version ${i + 1} (captures the mouse)`));
        status.textContent = `Round ${S.trial}: ready for version ${i + 1}. Keep the ${S.spec.ch} on the dot.`;
      } else go();
    }
    function playBoth() {
      answers.replaceChildren();
      playOne(0, () => playOne(1, ask));
    }
    function ask() {
      if (document.pointerLockElement) document.exitPointerLock();
      const range = `${fmtSpec(S.spec, S.lo)} – ${fmtSpec(S.spec, S.hi)}`;
      status.textContent = `Round ${S.trial}. Current range: ${range}.`;
      answers.replaceChildren(
        h('button', { class: 'btn primary', onclick: () => answer(0) }, '1 was closer'),
        h('button', { class: 'btn primary', onclick: () => answer(1) }, '2 was closer'),
        h('button', { class: 'btn', onclick: () => answer('same') }, 'About the same'),
        h('button', { class: 'btn', onclick: () => answer('neither') }, 'Both wrong'),
        h('button', { class: 'btn', onclick: playBoth }, 'Show again'),
      );
    }
    function answer(c) {
      if (c === 'neither') return finish('Both versions felt wrong. Another setting is probably off – try "Drift strength" or "Response speed" first, then come back to this one.');
      if (c === 'same') {
        // you could not tell these two apart: your memory is uncertain across at least this gap
        if (!S.indist) S.indist = [S.a, S.b];
        S.lo = S.a;
        S.hi = S.b;
        S.same++;
      } else {
        const picked = S.shown[c];
        if (picked === S.a) S.hi = S.b;
        else S.lo = S.a;
        S.same = 0;
      }
      const narrow = S.spec.scale === 'log' ? S.hi / S.lo < 1.15 : S.hi - S.lo < 3 * S.spec.step;
      if (S.trial >= 6 || S.same >= 2 || narrow) finish();
      else nextTrial();
    }
    function finish(msg) {
      startBtn.disabled = false;
      paramSel.disabled = trySel.disabled = false;
      if (msg) {
        status.textContent = msg;
        answers.replaceChildren();
        return;
      }
      const { spec, T } = S;
      const best = roundForSpec(spec, T.g((T.f(S.lo) + T.f(S.hi)) / 2));
      const lo = S.indist ? Math.min(S.indist[0], S.lo) : S.lo;
      const hi = S.indist ? Math.max(S.indist[1], S.hi) : S.hi;
      const band = [roundForSpec(spec, lo), roundForSpec(spec, hi)];
      status.textContent = `Result: ${paramName(spec)} ≈ ${fmtSpec(spec, best)}, uncertainty range ${fmtSpec(spec, band[0])} – ${fmtSpec(spec, band[1])}${S.indist ? ' (wide because some versions looked the same to you)' : ''}. Was ${fmtSpec(spec, getPath(p, spec.path))}.`;
      answers.replaceChildren(
        h('button', {
          class: 'btn primary',
          onclick: () => {
            setPath(p, spec.path, best);
            p.uncertainty[spec.path] = band;
            saveSoon();
            ctx.toast(`Saved to "${p.name}".`);
            setTab('compare');
          },
        }, 'Apply to profile'),
        h('button', { class: 'btn', onclick: () => answers.replaceChildren() }, 'Discard'),
      );
    }
  }

  // ---------------- Watch ----------------
  function renderWatch() {
    player = new LabPlayer(ctx);
    const p = activeProfile(st);
    let channel = 'needle';
    let view = 'watch';
    let seed = randomSeed();
    const chSel = h('select', { onchange: () => ((channel = chSel.value), buildFields()) }, h('option', { value: 'needle' }, 'Needle'), h('option', { value: 'ball' }, 'Ball'));
    const viewSel = h('select', { onchange: () => ((view = viewSel.value), buildFields()) }, h('option', { value: 'watch' }, 'Hands-off drift'), h('option', { value: 'response' }, 'Response test (scripted stick steps, no drift)'), h('option', { value: 'try' }, 'Try it yourself (30 s)'));
    const fieldsBox = h('div');
    const readouts = readoutTable();
    const hint = h('p', { class: 'small muted' });
    let vp = null;
    const sync = () => {
      if (vp) assignDeep(vp, viewProfile(p, view));
      readouts.update();
      saveSoon();
    };
    function buildFields() {
      const group = view === 'watch' ? 'Drift' : view === 'response' ? 'Response' : null;
      const specs = PARAMS.filter((s) => s.ch === channel && (!group || s.group === group) && (group || s.ab || s.path.endsWith('.order')));
      fieldsBox.replaceChildren(...specs.map((s) => field(s, p, sync)));
      hint.textContent =
        view === 'watch'
          ? 'Nobody is touching the controls: this is the drift alone. Adjust until it wanders like the real one.'
          : view === 'response'
            ? 'The same stick/pedal steps are played every time (full input for 0.8 s each way, then two small taps), with the drift off. Adjust until the reaction looks right.'
            : 'Your own controls. Click Play, then the instruments capture the mouse; Esc releases it so you can use the sliders.';
    }
    const play = async (newPattern) => {
      if (newPattern) seed = randomSeed();
      if (view === 'try') {
        const r = await player.lock();
        if (!r.ok) return ctx.toast(r.error || 'Click again to capture the mouse.');
      }
      vp = viewProfile(p, view);
      player.play({ profile: vp, seed, channel, view, sec: view === 'try' ? 30 : view === 'watch' ? 20 : RESPONSE_SEC, banner: null });
    };
    buildFields();
    body.append(
      h('div', { class: 'lab-cols' },
        h('div', null, player.el, h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn primary', onclick: () => play(true) }, 'Play'),
          h('button', { class: 'btn', onclick: () => play(false) }, 'Same pattern again'),
          h('button', { class: 'btn', onclick: () => player.stop() }, 'Stop')), hint),
        h('div', { class: 'card' },
          h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'Instrument'), chSel),
          h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'View'), viewSel),
          fieldsBox),
      ),
      h('div', { class: 'card' }, h('h2', null, 'What these settings mean in seconds'), readouts),
    );
  }

  // ---------------- Questionnaire ----------------
  function renderQuestions() {
    const p = activeProfile(st);
    const answers = { ...(p.answers || {}) };
    const sel = (key, q) => {
      const s = h('select', { onchange: () => (answers[key] = s.value) }, h('option', { value: '' }, 'Not sure'), q.opts.map(([v, l]) => h('option', { value: v, selected: answers[key] === v }, l)));
      return h('div', { class: 'field' }, h('label', null, q.q), s, h('span'));
    };
    const out = h('div');
    body.append(
      h('div', { class: 'card' },
        h('h2', null, 'What do you remember?'),
        h('p', { class: 'small muted' }, 'Answer only what you are fairly sure of – "Not sure" keeps the current value. The answers create a NEW profile (your current one is kept), which you can then refine with Compare.'),
        h('div', { class: 'grid' },
          h('div', null, h('h3', null, 'Needle (stick)'), Q_CH.map((q) => sel(`needle.${q.id}`, q))),
          h('div', null, h('h3', null, 'Ball (pedals)'), Q_CH.map((q) => sel(`ball.${q.id}`, q)))),
        h('h3', null, 'Both'),
        Q_GLOBAL.map((q) => sel(q.id, q)),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', {
            class: 'btn primary',
            onclick: () => {
              const { profile, changes } = applyAnswers(p, answers, tol());
              profile.id = newId('p');
              profile.name = `From my answers (${new Date().toLocaleDateString()})`;
              profile.notes = 'Created by the Tuning Lab questionnaire.';
              profile.updated = Date.now();
              st.profiles.push(profile);
              st.settings.activeProfileId = profile.id;
              ctx.saveProfiles();
              ctx.saveSettings();
              out.replaceChildren(h('div', { class: 'notice info' }, h('b', null, `New active profile "${profile.name}". `), changes.length ? h('ul', { class: 'small' }, changes.map((c) => h('li', null, c))) : 'No values changed.'));
            },
          }, 'Create profile from my answers')),
        out),
    );
  }

  // ---------------- Profiles ----------------
  function renderProfiles() {
    const p = activeProfile(st);
    const list = h('div', { class: 'table-wrap' },
      h('table', { class: 'data' }, h('tr', null, h('th', null, 'Profile'), h('th', null, 'Last changed'), h('th', null, '')),
        st.profiles.map((q) => h('tr', null,
          h('td', null, q.id === p.id ? h('b', null, `● ${q.name}`) : q.name),
          h('td', null, q.updated ? new Date(q.updated).toLocaleString() : '–'),
          h('td', null, q.id === p.id ? h('span', { class: 'badge ok' }, 'active') : h('button', {
            class: 'btn small',
            onclick: () => {
              st.settings.activeProfileId = q.id;
              ctx.saveSettings();
              setTab('profiles');
            },
          }, 'Use'))))));
    const name = h('input', { type: 'text', value: p.name, onchange: () => ((p.name = name.value.trim() || p.name), saveSoon(), setTab('profiles')) });
    const notes = h('textarea', { rows: 3, value: p.notes || '', onchange: () => ((p.notes = notes.value), saveSoon()) });
    const bands = Object.entries(p.uncertainty || {});
    body.append(
      h('div', { class: 'card' }, h('h2', null, 'Profiles'), list,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn', onclick: () => { const c = duplicateProfile(st, p); st.settings.activeProfileId = c.id; ctx.saveProfiles(); ctx.saveSettings(); setTab('profiles'); } }, 'Duplicate'),
          h('button', { class: 'btn', onclick: () => { const c = duplicateProfile(st, DEFAULT_PROFILE, 'Brief defaults'); st.settings.activeProfileId = c.id; ctx.saveProfiles(); ctx.saveSettings(); setTab('profiles'); } }, 'New from brief defaults'),
          h('button', { class: 'btn', onclick: () => download(`${APP_ID}-profile-${p.name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify({ app: APP_ID, kind: 'profile', profile: p }, null, 2)) }, 'Export'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              const f = await pickFile('.json,application/json');
              if (!f) return;
              try {
                const j = JSON.parse(await f.text());
                const src = j.profile || j;
                if (!src || !src.needle || !src.ball) throw new Error('not a profile file');
                const q = normalizeProfile(src);
                q.id = newId('p');
                q.name = `${q.name || 'Imported'} (imported)`;
                st.profiles.push(q);
                st.settings.activeProfileId = q.id;
                ctx.saveProfiles();
                ctx.saveSettings();
                setTab('profiles');
              } catch (e) {
                ctx.toast(`Import failed: ${e.message}`);
              }
            },
          }, 'Import'),
          st.profiles.length > 1 ? h('button', {
            class: 'btn danger',
            onclick: () => {
              if (!confirm(`Delete profile "${p.name}"?`)) return;
              st.profiles.splice(st.profiles.indexOf(p), 1);
              st.settings.activeProfileId = st.profiles[0].id;
              ctx.saveProfiles();
              ctx.saveSettings();
              setTab('profiles');
            },
          }, 'Delete') : null)),
      h('div', { class: 'card' }, h('h2', null, 'Active profile'),
        h('div', { class: 'field' }, h('label', null, 'Name'), name, h('span')),
        h('div', { class: 'field' }, h('label', null, 'Notes'), notes, h('span')),
        h('p', { class: 'small' }, 'Every value is editable in ', h('a', { href: '#/settings' }, 'Settings → Test feel'), '.')),
      h('div', { class: 'card' }, h('h2', null, 'Readouts'), readoutTable()),
      h('div', { class: 'card' }, h('h2', null, 'Uncertainty ranges'),
        h('p', { class: 'small muted' }, 'From Compare and the questionnaire. With Settings → Training → "Vary feel each run: within your own uncertainty", each run draws these settings from inside their range.'),
        bands.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, bands.map(([path, [lo, hi]]) => {
            const spec = paramSpec(path);
            return h('tr', null, h('td', null, spec ? paramName(spec) : path), h('td', null, spec ? `${fmtSpec(spec, lo)} – ${fmtSpec(spec, hi)}` : `${lo} – ${hi}`),
              h('td', null, h('button', { class: 'btn small', onclick: () => { delete p.uncertainty[path]; saveSoon(); setTab('profiles'); } }, 'Clear')));
          })))
          : h('p', { class: 'muted' }, 'None yet.')),
    );
  }

  setTab(TABS.some(([id]) => id === tab) ? tab : 'compare');

  return () => {
    if (player) player.destroy();
    if (saveTimer) {
      clearTimeout(saveTimer);
      ctx.saveProfiles();
    }
  };
}
