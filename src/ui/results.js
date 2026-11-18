// Results of one session: per-run table, error charts, settings snapshot, replays.

import { h, fmt, pct, topBar, keyLabel } from './dom.js';
import { drawRunChart } from '../render/charts.js';
import { paramSpec, paramName, getPath } from '../sim/profile.js';
import { fmtSpec } from './fields.js';

const SNAPSHOT_PATHS = ['drift.strength', 'drift.speed', 'drift.gustSize', 'drift.pushSize', 'order', 'topSpeed', 'lag', 'deadTime', 'runaway'];

export function mount(root, ctx, params) {
  const [id] = params;
  const page = h('div', { class: 'page' }, topBar('Results', ctx));
  root.append(page);
  const charts = [];
  const redraw = () => charts.forEach(([cv, d]) => drawRunChart(cv, d));
  let disposed = false;
  (async () => {
    let rec = ctx.memory.lastSession && ctx.memory.lastSession.id === id ? ctx.memory.lastSession : null;
    if (!rec) rec = await ctx.db.getSession(id).catch(() => null);
    if (disposed) return;
    if (!rec) {
      page.append(h('div', { class: 'notice' }, 'Session not found.'), h('button', { class: 'btn', onclick: () => ctx.navigate('history') }, 'History'));
      return;
    }
    render(rec);
    requestAnimationFrame(redraw);
  })();
  window.addEventListener('resize', redraw);

  function render(rec) {
    const sm = rec.summary || {};
    const mode = rec.mode;
    const both = mode === 'both';
    const date = new Date(rec.date);
    const tot = both ? sm.totBoth : mode === 'needle' ? sm.totN : sm.totB;
    page.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '28px' } },
          h('div', null, h('div', { class: 'muted small' }, 'Session practice score'), h('div', { style: { fontSize: '44px', fontWeight: 700, lineHeight: 1 } }, fmt(sm.score, 0))),
          h('div', null, h('div', { class: 'muted small' }, both ? 'Both on target' : 'On target'), h('div', { style: { fontSize: '28px', fontWeight: 600 } }, pct(tot))),
          mode !== 'ball' ? h('div', null, h('div', { class: 'muted small' }, 'Needle on target'), h('div', { style: { fontSize: '20px' } }, pct(sm.totN))) : null,
          mode !== 'needle' ? h('div', null, h('div', { class: 'muted small' }, 'Ball on target'), h('div', { style: { fontSize: '20px' } }, pct(sm.totB))) : null,
        ),
        h('p', { class: 'muted small', style: { marginBottom: 0 } },
          `${date.toLocaleString()} · ${rec.runs.length} run${rec.runs.length > 1 ? 's' : ''}${rec.complete === false ? ' (ended early)' : ''} · mode ${mode} · difficulty ${rec.difficulty} · profile "${rec.profileName}". `,
          'Practice score: 100 = perfect, 0 = no better than letting go. Not the official COMPASS score.'),
      ),
    );

    // notices
    const notes = [];
    if (rec.runs.some((r) => r.imeSuspected) || (rec.practice && rec.practice.imeSuspected))
      notes.push('A Vietnamese input method (Unikey / EVKey / Telex) seemed active: pedal key presses may have been swallowed. Switch it to English (E).');
    const stalls = rec.runs.reduce((a, r) => a + (r.stalls || 0), 0);
    if (stalls) notes.push(`The browser stalled ${stalls} time${stalls > 1 ? 's' : ''} for more than 0.25 s (treated as paused). Close heavy tabs or apps.`);
    if (rec.device && rec.device.stick.source === 'mouse' && rec.device.stick.mouseMode === 'lock') {
      if (rec.rawInput === false) notes.push('Raw mouse input was not available, so Windows mouse acceleration was active. Turn off "Enhance pointer precision" or use Chrome/Edge.');
      if (!rec.device.stick.calibrated) notes.push('The mouse was not calibrated (800 DPI assumed). Calibrate it on the Hardware test page.');
    }
    for (const n of notes) page.append(h('div', { class: 'notice' }, n));

    // runs table
    const head = h('tr', null, h('th', null, 'Run'), h('th', null, 'Score'), mode !== 'ball' && h('th', null, 'Needle score'), mode !== 'needle' && h('th', null, 'Ball score'),
      mode !== 'ball' && h('th', null, 'Needle on target'), mode !== 'needle' && h('th', null, 'Ball on target'), both && h('th', null, 'Both on target'),
      mode !== 'ball' && h('th', null, 'RMS needle'), mode !== 'needle' && h('th', null, 'RMS ball'), h('th', null, ''));
    const row = (label, m, key, scored = true) =>
      h('tr', null, h('td', null, label), h('td', null, scored ? fmt(m.score, 0) : '–'), mode !== 'ball' && h('td', null, scored ? fmt(m.scoreN, 0) : '–'), mode !== 'needle' && h('td', null, scored ? fmt(m.scoreB, 0) : '–'),
        mode !== 'ball' && h('td', null, pct(m.totN)), mode !== 'needle' && h('td', null, pct(m.totB)), both && h('td', null, pct(m.totBoth)),
        mode !== 'ball' && h('td', null, fmt(m.rmsN, 3)), mode !== 'needle' && h('td', null, fmt(m.rmsB, 3)),
        h('td', null, key != null ? h('button', { class: 'btn small', onclick: () => ctx.navigate('replay', rec.id, key) }, 'Replay') : ''));
    const rows = [];
    if (rec.practice) rows.push(row('Practice (not scored)', rec.practice.metrics, 'practice', false));
    rec.runs.forEach((r) => rows.push(row(`Run ${r.index + 1}`, r.metrics, String(r.index))));
    rows.push(h('tr', { style: { fontWeight: 600 } }, ...row('Average', sm, null).children));
    page.append(h('div', { class: 'card' }, h('h2', null, 'Runs'), h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, head, rows))));

    // charts
    const chartCard = h('div', { class: 'card' }, h('h2', null, 'Error over time'), h('p', { class: 'muted small' }, 'Distance from the red dot (full scale = end stop). The shaded bands are the on-target zones. Hover for values.'));
    const addChart = (title, tr) => {
      if (!tr) return;
      const cv = h('canvas', { class: 'chart' });
      chartCard.append(h('h3', null, title), cv);
      charts.push([cv, { eN: tr.eN, eB: tr.eB, dt: 0.1, tolN: rec.tol.n, tolB: rec.tol.b, mode }]);
    };
    if (rec.practice) addChart('Practice', rec.practice.trace);
    rec.runs.forEach((r) => addChart(`Run ${r.index + 1}`, r.trace));
    page.append(chartCard);

    // settings snapshot
    const p = rec.profile;
    const snapRows = SNAPSHOT_PATHS.map((sub) => {
      const specN = paramSpec(`needle.${sub}`);
      const specB = paramSpec(`ball.${sub}`);
      const val = (spec, path) => (spec.type === 'select' ? (spec.options.find(([v]) => String(v) === String(getPath(p, path))) || ['', ''])[1].split(':')[0] : fmtSpec(spec, getPath(p, path)));
      return h('tr', null, h('td', null, specN.label), h('td', null, val(specN, `needle.${sub}`)), h('td', null, val(specB, `ball.${sub}`)));
    });
    const d = rec.device || { stick: {}, pedals: {} };
    const stickTxt = d.stick.source === 'gamepad' ? `gamepad axis ${d.stick.pad.axis}` : `mouse (${d.stick.mouseMode}), ${d.stick.travelCm} cm for full stick, ${d.stick.countsPerCm} counts/cm${d.stick.calibrated ? ' (calibrated)' : ' (default)'}, spring ${d.stick.spring}`;
    const pedTxt = d.pedals.source === 'gamepad' ? `gamepad (${d.pedals.pad.mode})` : `keys ${keyLabel(d.pedals.leftKey)}/${keyLabel(d.pedals.rightKey)}, ${d.pedals.instant ? 'instant' : `ramp ${d.pedals.rampUp} s up / ${d.pedals.rampDown} s down`}`;
    const varyRows = rec.runs
      .filter((r) => r.varied && Object.keys(r.varied).length)
      .map((r) =>
        h('li', null, `Run ${r.index + 1}: `, Object.entries(r.varied).map(([k, v]) => {
          const spec = paramSpec(k);
          return spec ? `${paramName(spec)} ${fmtSpec(spec, v)}; ` : '';
        }), `mouse travel × ${fmt(r.travelFactor, 2)}`),
      );
    page.append(
      h('div', { class: 'card' },
        h('h2', null, 'Settings used'),
        h('p', { class: 'small' }, `Directions: stick ${p.directions.stick === 'inverted' ? 'inverted (push → needle up)' : 'aviation (push → needle down)'}, pedals ${p.directions.pedal === 'push' ? 'push the ball' : 'step on the ball'}. Needle swing ±${p.maxAngle}°. On target: needle ±${rec.scoring.needleTolDeg}°, ball ${rec.scoring.ballTolRadii} ball radius.`),
        h('p', { class: 'small' }, `Stick: ${stickTxt}. Pedals: ${pedTxt}. Seeds: ${rec.runs.map((r) => r.seed).join(', ')}.`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('tr', null, h('th', null, `Profile "${rec.profileName}" (difficulty ${rec.difficulty} applied on top)`), h('th', null, 'Needle'), h('th', null, 'Ball')), snapRows)),
        varyRows.length ? [h('h3', null, 'Vary feel – values used'), h('ul', { class: 'small' }, varyRows)] : null,
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => ctx.navigate('session') }, 'New session'), h('button', { class: 'btn', onclick: () => ctx.navigate('history') }, 'History'), h('button', { class: 'btn', onclick: () => ctx.navigate('home') }, 'Home')),
    );
  }

  return () => {
    disposed = true;
    window.removeEventListener('resize', redraw);
  };
}
