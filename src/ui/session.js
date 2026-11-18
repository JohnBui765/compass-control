// The test screen: full session (practice → runs with breaks → results),
// free practice (no limit, live tuning hotkeys) and replays of recorded runs.
//
// Pointer lock + fullscreen are requested from a click. Losing pointer lock,
// fullscreen or window focus, or pressing Esc, pauses the run; paused time is
// excluded (the simulation clock simply stops).

import { h, fmt, pct, keyLabel } from './dom.js';
import { field, fmtSpec } from './fields.js';
import { controlsCheatSheet, controlsOneLiner } from './help.js';
import { Instruments } from '../render/instruments.js';
import { RunEngine, arraySource } from '../sim/engine.js';
import { tolerances, freeRun, scoreRun, averageRuns } from '../sim/scoring.js';
import { withDifficulty, varyProfile, clone, KEY_PARAMS, paramName, getPath, setPath, nudgeParam } from '../sim/profile.js';
import { mulberry32, randomSeed } from '../sim/prng.js';
import { createInputs } from '../input/index.js';
import { activeProfile, newId } from '../state.js';
import { requestPersistence } from '../storage.js';
import { APP_VERSION } from '../config.js';

export const clock = (sec) => {
  if (!Number.isFinite(sec)) return '';
  const s = Math.max(0, Math.ceil(sec - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const toArr = (f32) => Array.from(f32, (v) => Math.round(v * 1e4) / 1e4);
const traceArrays = (t) => (t ? { eN: toArr(t.eN), eB: toArr(t.eB), stick: toArr(t.stick), pedal: toArr(t.pedal) } : null);

/** Deep-assign src into dst, keeping dst's object identity (a running sim reads dst live). */
function assignDeep(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') assignDeep(dst[k], v);
    else dst[k] = v;
  }
}

export function mount(root, ctx, params, route) {
  if (route === 'replay') return mountReplay(root, ctx, params);
  return mountRunner(root, ctx, route === 'free' ? 'free' : 'session');
}

// =========================================================================
function mountRunner(root, ctx, kind) {
  const S = ctx.state.settings;
  const ss = S.session;
  const mode = ss.mode;
  const base = activeProfile(ctx.state); // live object: free-practice tuning edits it
  const tol = tolerances(base, S.scoring);
  const inputs = createInputs(S);

  const canvas = h('canvas', { 'aria-label': 'Needle and ball instruments' });
  const overlay = h('div', { class: 'overlay' });
  const tuneHud = h('div', { class: 'tune-hud', hidden: true });
  const stage = h('div', { class: `stage${S.display.background === 'dark' ? ' dark' : ''}`, oncontextmenu: (e) => e.preventDefault() }, canvas, tuneHud, overlay);
  root.append(stage);
  document.body.style.overflow = 'hidden';
  const inst = new Instruments(canvas, { theme: S.display.background, scale: S.display.instrumentScale, strip: true });
  if (inputs.mouse) inputs.mouse.attach(canvas);
  if (inputs.keys) inputs.keys.attach();

  // ---- plan ----
  const plan = [];
  if (kind === 'session') {
    if (ss.practiceSec > 0) plan.push({ type: 'practice', sec: ss.practiceSec });
    for (let i = 0; i < ss.runs; i++) {
      if (i > 0 && ss.breakSec > 0) plan.push({ type: 'break', sec: ss.breakSec, next: i });
      plan.push({ type: 'run', index: i, sec: ss.runSec });
    }
  } else plan.push({ type: 'free', sec: 0 });

  const sessionId = newId('s');
  const fixedBase = ss.seedMode === 'fixed' ? Number(ss.fixedSeed) >>> 0 : null;
  let seg = -1;
  let phase = 'intro'; // intro | countdown | active | resumecd | break | paused | paused-cd | needclick | done
  let engine = null;
  let eff = withDifficulty(base, ss.difficulty);
  let segInfo = null;
  let cdEnd = 0;
  let breakEnd = 0;
  let resumeEnd = 0;
  let fullscreenOn = false;
  let rawInfo = null;
  let practice = null;
  const runs = [];
  const replays = [];
  let raf = 0;
  let lastFrame = performance.now();
  const tuneList = KEY_PARAMS.filter((p) => mode === 'both' || p.ch === mode);
  let tuneSel = 0;
  let tuneUntil = 0;
  let saveTimer = 0;

  // ---- overlay helpers ----
  let errorLine = null;
  function show(content, clearBg = false) {
    overlay.replaceChildren();
    overlay.className = `overlay${clearBg ? ' clear' : ''}`;
    overlay.hidden = !content;
    errorLine = h('div', { class: 'notice', hidden: true });
    if (content) overlay.append(content);
    if (content && content.classList && content.classList.contains('card')) content.append(errorLine);
  }
  function showError(msg) {
    if (errorLine) {
      errorLine.textContent = msg;
      errorLine.hidden = false;
    }
  }
  const cdNum = h('div', { class: 'countdown' });
  const cdBox = h('div', { style: { textAlign: 'center' } }, cdNum, h('div', { class: 'cd-hint' }, controlsOneLiner(S)));
  function showCountdown() {
    show(cdBox, true);
  }

  function deviceNotices() {
    const out = [];
    const st = S.device.stick;
    if (inputs.mouse && st.mouseMode === 'lock' && !st.calibrated)
      out.push(h('div', { class: 'notice' }, 'Mouse not calibrated: full stick assumes ~800 DPI. Calibrate on the Hardware test page for a true ', `${st.travelCm} cm`, ' travel.'));
    if (inputs.keys && inputs.keys.imeSuspected)
      out.push(h('div', { class: 'notice' }, 'A Vietnamese input method (Unikey / EVKey / Telex) seems active. Switch it to English (E): it can swallow or garble pedal key presses.'));
    return out;
  }

  function showIntro() {
    const list = [
      kind === 'session'
        ? h('li', null, `${ss.practiceSec ? `${ss.practiceSec} s practice (not scored), then ` : ''}${ss.runs} run${ss.runs > 1 ? 's' : ''} of ${ss.runSec} s${ss.runs > 1 && ss.breakSec ? ` with ${ss.breakSec} s breaks` : ''}.`)
        : h('li', null, 'No time limit. Tuning keys: [ and ] choose a setting, − and = change it (saved to your profile).'),
      h('li', null, 'Esc pauses. Paused time is not scored.' + (kind === 'free' ? ' Stop is on the pause screen.' : '')),
    ];
    if (mode !== 'both') list.unshift(h('li', null, h('b', null, `Part-task mode: ${mode} only.`)));
    const startBtn = h('button', { class: 'btn primary', onclick: startClick }, kind === 'session' ? 'Start' : 'Start free practice');
    const card = h(
      'div',
      { class: 'card' },
      h('h2', null, kind === 'session' ? 'Control – practice session' : 'Free practice'),
      h('p', { class: 'small muted', style: { margin: '0' } }, 'Keep the blue needle and the blue ball on their red dots, both at once:'),
      controlsCheatSheet(S, base),
      h('ul', { class: 'small' }, list),
      h('p', { class: 'muted small' }, `Profile "${base.name}", difficulty ${ss.difficulty}${S.training.varyFeel ? ', feel varies each run' : ''}. ${ss.fullscreen ? 'The screen goes full screen and the mouse is captured.' : 'The mouse is captured.'}`),
      deviceNotices(),
      h('div', { class: 'row' }, startBtn, h('button', { class: 'btn', onclick: () => ctx.navigate('home') }, 'Back'), h('button', { class: 'btn', onclick: () => ctx.navigate('help', 'controls') }, '? How to use')),
    );
    show(card);
    startBtn.focus();
  }

  // Must run inside a click handler: pointer lock and fullscreen need a user gesture.
  function acquire() {
    const lockP = inputs.needsPointerLock ? inputs.mouse.lock() : Promise.resolve({ ok: true, raw: null });
    let fsP = Promise.resolve(false);
    if (ss.fullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      fsP = document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(
        () => true,
        () => false,
      );
    }
    return Promise.all([lockP, fsP]).then(([lr]) => {
      if (document.fullscreenElement) {
        fullscreenOn = true;
        try {
          if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {});
        } catch {
          /* keyboard lock unsupported */
        }
      }
      if (!lr.ok) {
        showError(lr.error || 'Could not capture the mouse – click again.');
        return false;
      }
      if (lr.raw != null) rawInfo = lr.raw;
      return true;
    });
  }

  async function startClick() {
    const ok = await acquire();
    if (ok) next(performance.now());
  }

  async function resumeClick() {
    const ok = await acquire();
    if (!ok) return;
    const now = performance.now();
    if (phase === 'paused') {
      phase = 'resumecd';
      resumeEnd = now + 3000;
      showCountdown();
    } else if (phase === 'paused-cd' || phase === 'needclick') {
      startCountdown(now, 3000);
    }
  }

  const ready = () => !inputs.needsPointerLock || inputs.mouse.isLocked();

  function segSeed(p) {
    if (fixedBase == null) return randomSeed();
    return p.type === 'run' ? (fixedBase + 1 + p.index) >>> 0 : fixedBase;
  }

  function prepareSegment() {
    const p = plan[seg];
    const seed = segSeed(p);
    let prof = clone(base);
    let varied = {};
    let travelFactor = 1;
    if (p.type === 'run' && S.training.varyFeel) {
      const v = varyProfile(prof, S.training, mulberry32(seed ^ 0x5eed));
      prof = v.profile;
      varied = v.varied;
      travelFactor = v.travelFactor;
    }
    eff = withDifficulty(prof, ss.difficulty);
    if (inputs.mouse) inputs.mouse.travelFactor = travelFactor;
    segInfo = { p, seed, varied, travelFactor };
  }

  function next(now) {
    seg++;
    if (seg >= plan.length) return finish(false);
    const p = plan[seg];
    if (p.type === 'break') {
      phase = 'break';
      breakEnd = now + p.sec * 1000;
      breakNum.textContent = '';
      show(h('div', { class: 'card', style: { textAlign: 'center' } }, h('h2', null, 'Break'), h('p', null, `Run ${p.next + 1} of ${ss.runs} starts in`), breakNum), false);
      return;
    }
    prepareSegment();
    const afterBreak = seg > 0 && plan[seg - 1].type === 'break';
    startCountdown(now, afterBreak ? 0 : 3000);
  }
  const breakNum = h('div', { class: 'countdown', style: { fontSize: '72px', color: 'var(--text)', textShadow: 'none' } });

  function startCountdown(now, ms) {
    if (!ready()) {
      phase = 'needclick';
      show(h('div', { class: 'card' }, h('h2', null, 'Ready?'), h('p', null, 'Click to capture the mouse and continue.'), h('button', { class: 'btn primary', onclick: resumeClick }, 'Continue')));
      return;
    }
    if (ms <= 0) return beginSegment(now);
    phase = 'countdown';
    cdEnd = now + ms;
    cdNum.textContent = String(Math.ceil(ms / 1000));
    showCountdown();
  }

  function beginSegment(now) {
    const p = segInfo.p;
    if (inputs.mouse) inputs.mouse.reset(); // stick starts centred
    if (inputs.keys) {
      inputs.keys.advanceTo(now, 0);
      inputs.keys.p = 0;
    }
    engine = new RunEngine({ profile: eff, seed: segInfo.seed, mode, durationSec: p.sec, stick: inputs.stick, pedal: inputs.pedal, tol, record: p.type !== 'free' });
    engine.start(now);
    phase = 'active';
    show(null);
  }

  function endSegment(now) {
    const p = segInfo.p;
    const res = engine.scorer.result();
    const common = {
      seed: segInfo.seed,
      durationSec: p.sec,
      stalls: engine.stalls,
      pausedMs: Math.round(engine.pausedMs),
      imeSuspected: !!(inputs.keys && inputs.keys.imeSuspected),
      effectiveProfile: clone(eff),
    };
    if (p.type === 'practice') {
      practice = { ...common, metrics: res, trace: traceArrays(engine.trace) };
      replays.push({ key: 'practice', stick: engine.recStick, pedal: engine.recPedal });
    } else if (p.type === 'run') {
      const free = freeRun({ profile: eff, seed: segInfo.seed, mode, ticks: engine.endTick, runLength: p.sec });
      runs.push({ index: p.index, ...common, varied: segInfo.varied, travelFactor: segInfo.travelFactor, metrics: scoreRun(res, free, mode), trace: traceArrays(engine.trace) });
      replays.push({ key: String(p.index), stick: engine.recStick, pedal: engine.recPedal });
    }
    engine = null;
    next(now);
  }

  function pause(reason) {
    const now = performance.now();
    if (phase === 'active') {
      engine.pause(now);
      phase = 'paused';
    } else if (phase === 'resumecd') phase = 'paused';
    else if (phase === 'countdown') phase = 'paused-cd';
    else return;
    if (inputs.mouse) inputs.mouse.unlock();
    showPaused(reason);
  }

  function showPaused(reason) {
    const btns = [h('button', { class: 'btn primary', onclick: resumeClick }, 'Resume')];
    if (kind === 'session') {
      if (segInfo && segInfo.p.type !== 'break')
        btns.push(
          h('button', {
            class: 'btn',
            onclick: () => {
              engine = null;
              phase = 'paused-cd';
              resumeClick();
            },
          }, 'Restart this run'),
        );
      btns.push(
        h('button', {
          class: 'btn danger',
          onclick: () => {
            if (runs.length) finish(true);
            else if (confirm('End the session? Nothing has been scored yet.')) ctx.navigate('home');
          },
        }, runs.length ? `End session (save ${runs.length} run${runs.length > 1 ? 's' : ''})` : 'End session'),
      );
    } else {
      btns.push(h('button', { class: 'btn danger', onclick: stopFree }, 'Stop'));
    }
    const card = h('div', { class: 'card' }, h('h2', null, 'Paused'), h('p', null, reason, ' Paused time is not scored.'), h('div', { class: 'row' }, btns));
    if (kind === 'free') card.append(tuningDrawer());
    show(card);
  }

  // ---- free practice: live tuning ----
  function syncEff() {
    assignDeep(eff, withDifficulty(base, ss.difficulty));
    base.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.saveProfiles(), 400);
  }
  function tuningDrawer() {
    const wrap = h('div', null, h('h3', null, `Tune "${base.name}" live`), h('p', { class: 'muted small' }, 'Changes apply immediately and are saved to the profile. During the run: [ ] choose, − = change.'));
    for (const spec of tuneList) wrap.append(field({ ...spec, label: paramName(spec) }, base, syncEff));
    return wrap;
  }
  function handleTuneKey(e) {
    if (inputs.keys && inputs.keys.isMapped(e.code)) return;
    const k = e.code;
    let changed = false;
    if (k === 'BracketLeft' || k === 'BracketRight') {
      tuneSel = (tuneSel + (k === 'BracketRight' ? 1 : -1) + tuneList.length) % tuneList.length;
      changed = true;
    } else if (k === 'Minus' || k === 'Equal' || k === 'NumpadSubtract' || k === 'NumpadAdd') {
      const spec = tuneList[tuneSel];
      const dir = k === 'Minus' || k === 'NumpadSubtract' ? -1 : 1;
      setPath(base, spec.path, nudgeParam(spec, getPath(base, spec.path), dir));
      syncEff();
      changed = true;
    }
    if (changed) {
      e.preventDefault();
      const spec = tuneList[tuneSel];
      tuneHud.textContent = `${paramName(spec)}: ${fmtSpec(spec, getPath(base, spec.path))}   ·   [ ] choose   − = change`;
      tuneHud.hidden = false;
      tuneUntil = performance.now() + 4000;
    }
  }

  function stopFree() {
    const res = engine ? engine.scorer.result() : null;
    const secs = engine ? engine.elapsedSec : 0;
    engine = null;
    phase = 'done';
    releaseAll();
    const rows = [];
    if (res && res.samples) {
      if (mode !== 'ball') rows.push(h('tr', null, h('td', null, 'Needle'), h('td', null, pct(res.totN)), h('td', null, fmt(res.rmsN, 3))));
      if (mode !== 'needle') rows.push(h('tr', null, h('td', null, 'Ball'), h('td', null, pct(res.totB)), h('td', null, fmt(res.rmsB, 3))));
      if (mode === 'both') rows.push(h('tr', null, h('td', null, 'Both at once'), h('td', null, pct(res.totBoth)), h('td', null, '')));
    }
    show(
      h(
        'div',
        { class: 'card' },
        h('h2', null, `Free practice – ${clock(secs)}`),
        rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('tr', null, h('th', null, ''), h('th', null, 'On target'), h('th', null, 'RMS error')), rows)) : h('p', { class: 'muted' }, 'Nothing recorded.'),
        h('p', { class: 'muted small' }, 'Free practice is not saved to History.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => ctx.navigate('free') }, 'Again'), h('button', { class: 'btn', onclick: () => ctx.navigate('tuning') }, 'Tuning Lab'), h('button', { class: 'btn', onclick: () => ctx.navigate('home') }, 'Home')),
      ),
    );
  }

  async function finish(early) {
    phase = 'done';
    releaseAll();
    if (kind !== 'session') return;
    if (!runs.length) return ctx.navigate('home');
    show(h('div', { class: 'card' }, h('h2', null, 'Saving…')));
    const rec = {
      id: sessionId,
      date: new Date().toISOString(),
      appVersion: APP_VERSION,
      kind: 'session',
      complete: !early,
      mode,
      difficulty: ss.difficulty,
      profileId: base.id,
      profileName: base.name,
      profile: clone(base),
      device: clone(S.device),
      sessionSettings: clone(ss),
      scoring: clone(S.scoring),
      training: clone(S.training),
      tol,
      rawInput: rawInfo,
      practice,
      runs,
      summary: averageRuns(runs.map((r) => r.metrics)),
    };
    ctx.memory.lastSession = rec;
    try {
      await ctx.db.putSession(rec);
      for (const r of replays) await ctx.db.putReplay(`${sessionId}#${r.key}`, { stick: r.stick, pedal: r.pedal });
      ctx.db.pruneReplays(30).catch(() => {});
      requestPersistence();
    } catch (e) {
      ctx.toast(`Could not save to History: ${e.message}`);
    }
    ctx.navigate('results', sessionId);
  }

  function releaseAll() {
    try {
      if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
    } catch {
      /* ignore */
    }
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    fullscreenOn = false;
  }

  // ---- listeners ----
  const onLockChange = () => {
    if (inputs.needsPointerLock && !inputs.mouse.isLocked()) pause('The mouse was released.');
  };
  const onFsChange = () => {
    if (!document.fullscreenElement && fullscreenOn) {
      fullscreenOn = false;
      pause('Full screen was closed.');
    }
  };
  const onKey = (e) => {
    if (e.code === 'Escape' && (phase === 'active' || phase === 'countdown' || phase === 'resumecd')) {
      e.preventDefault();
      pause('Paused (Esc).');
      return;
    }
    if (kind === 'free' && phase === 'active') handleTuneKey(e);
  };
  const onBlur = () => pause('The window lost focus.');
  const onVis = () => {
    if (document.visibilityState === 'hidden') pause('The window was hidden.');
  };
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('fullscreenchange', onFsChange);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);

  // ---- input feedback for the stick/pedal pictures ----
  const pd = S.device.pedals;
  const keyL = inputs.keys ? keyLabel(pd.leftKey) : 'L';
  const keyR = inputs.keys ? keyLabel(pd.rightKey) : 'R';
  /** How hard each pedal key is held right now (1 full, 0.5 half key, 0 none); gamepads: from the value. */
  function pedalActivity(pv) {
    if (!inputs.keys) return { L: pv < -0.02 ? 1 : 0, R: pv > 0.02 ? 1 : 0 };
    const held = inputs.keys.held;
    const lvl = (full, light) => (held.has(full) ? 1 : light && held.has(light) ? 0.5 : 0);
    return { L: lvl(pd.leftKey, pd.leftLightKey), R: lvl(pd.rightKey, pd.rightLightKey) };
  }

  // ---- main loop ----
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dtF = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (phase === 'countdown' || phase === 'resumecd') {
      const left = (phase === 'countdown' ? cdEnd : resumeEnd) - now;
      if (left <= 0) {
        if (phase === 'countdown') beginSegment(now);
        else {
          engine.resume(now);
          phase = 'active';
          show(null);
        }
      } else cdNum.textContent = String(Math.ceil(left / 1000));
    } else if (phase === 'break') {
      const left = breakEnd - now;
      if (left <= 0) next(now);
      else breakNum.textContent = String(Math.ceil(left / 1000));
    }
    let stickV = 0;
    let pedalV = 0;
    if (phase === 'active' && engine) {
      engine.frame(now);
      stickV = engine.stickVal;
      pedalV = engine.pedalVal;
      if (engine.finished) endSegment(now);
    } else if (phase !== 'done') {
      stickV = inputs.stick.advanceTo(now, dtF); // live preview while waiting
      pedalV = inputs.pedal.advanceTo(now, dtF);
    }
    if (!tuneHud.hidden && now > tuneUntil) tuneHud.hidden = true;
    const p = plan[Math.max(0, seg)];
    let timer = null;
    if (ss.showTimer && p && p.type !== 'break') {
      if (engine) timer = p.type === 'free' ? clock(engine.elapsedSec) : clock(engine.remainingSec);
      else if (p.type !== 'free' && phase !== 'done') timer = clock(p.sec);
    }
    const aids = !S.training.examLook;
    const act = pedalActivity(pedalV);
    const label = !p || phase === 'intro' || phase === 'done' ? '' : p.type === 'practice' ? 'Practice' : p.type === 'run' ? `Run ${p.index + 1} of ${ss.runs}` : p.type === 'free' ? 'Free practice' : '';
    inst.draw({
      eN: engine ? engine.eN : 0,
      eB: engine ? engine.eB : 0,
      maxAngle: eff.maxAngle,
      mode,
      timer,
      label,
      stick: stickV,
      pedal: pedalV,
      showStick: aids && S.training.stickIndicator,
      showPedal: aids && S.training.pedalIndicator,
      errorBars: aids && S.training.errorBars,
      feedback: aids && S.training.inputFeedback,
      actL: act.L,
      actR: act.R,
      keyL,
      keyR,
      tol,
    });
  }

  showIntro();
  raf = requestAnimationFrame(loop);

  return () => {
    phase = 'done';
    cancelAnimationFrame(raf);
    clearTimeout(saveTimer);
    if (saveTimer) ctx.saveProfiles();
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('fullscreenchange', onFsChange);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
    if (inputs.mouse) inputs.mouse.detach();
    if (inputs.keys) inputs.keys.detach();
    inst.destroy();
    releaseAll();
    document.body.style.overflow = '';
  };
}

// =========================================================================
// Replay of a recorded run: re-simulates it from the seed and the recorded
// per-tick inputs (bit-exact), at 1×, 2× or 4×.
function mountReplay(root, ctx, params) {
  const [sid, idx] = params;
  const S = ctx.state.settings;
  const canvas = h('canvas');
  const info = h('span', { class: 'small', style: { color: '#333', background: 'rgba(255,255,255,.7)', padding: '4px 8px', borderRadius: '6px' } });
  const bar = h('div', { class: 'row', style: { position: 'absolute', top: '10px', right: '12px', left: '12px', justifyContent: 'flex-end' } });
  const overlay = h('div', { class: 'overlay', hidden: true });
  const stage = h('div', { class: `stage${S.display.background === 'dark' ? ' dark' : ''}` }, canvas, bar, overlay);
  root.append(stage);
  document.body.style.overflow = 'hidden';
  const inst = new Instruments(canvas, { theme: S.display.background, scale: S.display.instrumentScale, strip: true });
  let raf = 0;
  let disposed = false;
  const back = () => ctx.navigate('results', sid);
  const fail = (msg) => {
    overlay.hidden = false;
    overlay.replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Replay not available'), h('p', null, msg), h('button', { class: 'btn', onclick: back }, 'Back to results')));
  };

  (async () => {
    let rec = ctx.memory.lastSession && ctx.memory.lastSession.id === sid ? ctx.memory.lastSession : null;
    if (!rec) rec = await ctx.db.getSession(sid).catch(() => null);
    if (disposed) return;
    if (!rec) return fail('Session not found.');
    const run = idx === 'practice' ? rec.practice && { ...rec.practice, index: 'practice' } : rec.runs.find((r) => String(r.index) === String(idx));
    const rep = await ctx.db.getReplay(`${sid}#${idx}`).catch(() => null);
    if (disposed) return;
    if (!run || !rep || !rep.stick) return fail('The full input recording for this run is not stored (only the newest 30 sessions keep them).');
    const title = idx === 'practice' ? 'Practice' : `Run ${Number(idx) + 1}`;
    const rp = rec.device && rec.device.pedals;
    const keyL = rp && rp.source === 'keys' ? keyLabel(rp.leftKey) : 'L';
    const keyR = rp && rp.source === 'keys' ? keyLabel(rp.rightKey) : 'R';
    let engine;
    let vt = 0;
    let speed = 1;
    let playing = true;
    let last = performance.now();
    let checked = false;
    const restart = () => {
      engine = new RunEngine({ profile: clone(run.effectiveProfile), seed: run.seed, mode: rec.mode, durationSec: run.durationSec, stick: arraySource(rep.stick), pedal: arraySource(rep.pedal), tol: rec.tol, record: false });
      engine.start(0);
      vt = 0;
      checked = false;
      info.textContent = '';
    };
    restart();
    const playBtn = h('button', { class: 'btn small', onclick: () => ((playing = !playing), (playBtn.textContent = playing ? 'Pause' : 'Play')) }, 'Pause');
    const speedBtn = h('button', { class: 'btn small', onclick: () => ((speed = speed === 4 ? 1 : speed * 2), (speedBtn.textContent = `${speed}×`)) }, '1×');
    bar.append(info, playBtn, speedBtn, h('button', { class: 'btn small', onclick: restart }, 'Restart'), h('button', { class: 'btn small', onclick: back }, 'Close'));
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (playing && !engine.finished) vt += (now - last) * speed;
      last = now;
      engine.frame(vt);
      if (engine.finished && !checked) {
        checked = true;
        const r = engine.scorer.result();
        const m = run.metrics;
        const same = ['rmsN', 'rmsB'].every((k) => m[k] == null || Math.abs((r[k] ?? 0) - m[k]) < 1e-9);
        info.textContent = same ? 'Replay finished – matches the stored result ✓' : 'Replay finished – differs from the stored result';
      }
      inst.draw({
        eN: engine.eN,
        eB: engine.eB,
        maxAngle: run.effectiveProfile.maxAngle,
        mode: rec.mode,
        timer: `${clock(engine.elapsedSec)} / ${clock(run.durationSec)}`,
        label: `Replay · ${title}`,
        stick: engine.stickVal,
        pedal: engine.pedalVal,
        showStick: true,
        showPedal: true,
        errorBars: true,
        feedback: true, // replays light a pedal while its recorded value is non-zero
        actL: engine.pedalVal < -0.02 ? 1 : 0,
        actR: engine.pedalVal > 0.02 ? 1 : 0,
        keyL,
        keyR,
        tol: rec.tol,
      });
    };
    raf = requestAnimationFrame(loop);
  })();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    inst.destroy();
    document.body.style.overflow = '';
  };
}
