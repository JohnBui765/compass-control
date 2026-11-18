// History: score over time, list of sessions, JSON/CSV export and JSON import.

import { h, fmt, pct, topBar, download, pickFile } from './dom.js';
import { drawScoreHistory } from '../render/charts.js';
import { APP_ID } from '../config.js';

const f32ToB64 = (f) => {
  const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64ToF32 = (b) => {
  const s = atob(b);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
};
const sessionTot = (s) => {
  const m = s.summary || {};
  if (m.totBoth != null) return m.totBoth;
  const v = [m.totN, m.totB].filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const today = () => new Date().toISOString().slice(0, 10);
const runKeys = (s) => [...(s.practice ? ['practice'] : []), ...s.runs.map((r) => String(r.index))];

export function mount(root, ctx) {
  const chart = h('canvas', { class: 'chart tall' });
  const tableBox = h('div', { class: 'table-wrap' });
  const withRec = h('input', { type: 'checkbox' });
  let sessions = [];
  const draw = () => drawScoreHistory(chart, sessions.map((s) => ({ t: Date.parse(s.date), score: s.summary ? s.summary.score : null, tot: sessionTot(s) })));

  root.append(
    h('div', { class: 'page' },
      topBar('History', ctx),
      h('div', { class: 'card' }, h('h2', null, 'Practice score over time'), h('p', { class: 'muted small' }, 'Practice score – not the official COMPASS score. 100 = perfect, 0 = no better than letting go.'), chart),
      h('div', { class: 'card' }, h('h2', null, 'Sessions'), tableBox),
      h('div', { class: 'card' }, h('h2', null, 'Backup'),
        h('p', { class: 'small muted' }, 'History lives only in this browser. Chrome\'s "Clear site data", or the "also clear data" box when uninstalling the app, wipes the whole johnbui765.github.io origin – every app on it – so export regularly.'),
        h('div', { class: 'row' },
          h('label', { class: 'row small' }, withRec, 'include full input recordings (larger file, needed for replays)'),
        ),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn', onclick: exportJson }, 'Export JSON'),
          h('button', { class: 'btn', onclick: exportCsv }, 'Export CSV'),
          h('button', { class: 'btn', onclick: importJson }, 'Import JSON'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn danger', onclick: clearAll }, 'Delete all history'))),
    ),
  );

  async function load() {
    try {
      sessions = await ctx.db.listSessions();
    } catch (e) {
      sessions = [];
      tableBox.replaceChildren(h('div', { class: 'notice' }, `Could not open the history database: ${e.message}`));
      draw();
      return;
    }
    draw();
    if (!sessions.length) {
      tableBox.replaceChildren(h('p', { class: 'muted' }, 'No sessions yet.'));
      return;
    }
    tableBox.replaceChildren(
      h('table', { class: 'data' },
        h('tr', null, h('th', null, 'Date'), h('th', null, 'Mode'), h('th', null, 'Difficulty'), h('th', null, 'Profile'), h('th', null, 'Score'), h('th', null, 'On target'), h('th', null, 'Runs'), h('th', null, '')),
        [...sessions].reverse().map((s) =>
          h('tr', null,
            h('td', null, new Date(s.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })),
            h('td', null, s.mode),
            h('td', null, String(s.difficulty)),
            h('td', null, s.profileName || ''),
            h('td', null, fmt(s.summary && s.summary.score, 0)),
            h('td', null, pct(sessionTot(s))),
            h('td', null, `${s.runs.length}${s.complete === false ? '*' : ''}`),
            h('td', null, h('div', { class: 'row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
              h('button', { class: 'btn small', onclick: () => ctx.navigate('results', s.id) }, 'View'),
              h('button', {
                class: 'btn small danger',
                onclick: async () => {
                  if (!confirm('Delete this session?')) return;
                  await ctx.db.deleteSession(s.id);
                  load();
                },
              }, 'Delete'))))),
      ),
    );
  }

  async function exportJson() {
    const out = { app: APP_ID, version: 1, exported: new Date().toISOString(), sessions };
    if (withRec.checked) {
      out.replays = {};
      for (const s of sessions)
        for (const k of runKeys(s)) {
          const r = await ctx.db.getReplay(`${s.id}#${k}`).catch(() => null);
          if (r && r.stick) out.replays[`${s.id}#${k}`] = { stick: f32ToB64(r.stick), pedal: f32ToB64(r.pedal) };
        }
    }
    download(`${APP_ID}-history-${today()}.json`, JSON.stringify(out));
  }

  function exportCsv() {
    const cols = ['date', 'sessionId', 'run', 'mode', 'difficulty', 'profile', 'seed', 'score', 'scoreN', 'scoreB', 'totN', 'totB', 'totBoth', 'rmsN', 'rmsB'];
    const num = (v) => (v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 1e4) / 1e4));
    const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [cols.join(',')];
    for (const s of sessions)
      for (const r of s.runs) {
        const m = r.metrics || {};
        lines.push([s.date, s.id, r.index + 1, s.mode, s.difficulty, esc(s.profileName || ''), r.seed, num(m.score), num(m.scoreN), num(m.scoreB), num(m.totN), num(m.totB), num(m.totBoth), num(m.rmsN), num(m.rmsB)].join(','));
      }
    download(`${APP_ID}-history-${today()}.csv`, lines.join('\n'), 'text/csv');
  }

  async function importJson() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const list = Array.isArray(j) ? j : j.sessions;
      if (!Array.isArray(list)) throw new Error('no "sessions" list in the file');
      const valid = list.filter((s) => s && typeof s.id === 'string' && typeof s.date === 'string' && Array.isArray(s.runs));
      const have = new Set(sessions.map((s) => s.id));
      const dupes = valid.filter((s) => have.has(s.id)).length;
      const replace = dupes > 0 && confirm(`${dupes} session(s) already exist. Replace them with the imported copies? (Cancel = keep the existing ones)`);
      let added = 0;
      for (const s of valid) {
        if (have.has(s.id) && !replace) continue;
        await ctx.db.putSession(s);
        added++;
        if (j.replays)
          for (const k of runKeys(s)) {
            const r = j.replays[`${s.id}#${k}`];
            if (r && r.stick) await ctx.db.putReplay(`${s.id}#${k}`, { stick: b64ToF32(r.stick), pedal: b64ToF32(r.pedal) });
          }
      }
      ctx.toast(`Imported ${added} session(s)${valid.length < list.length ? `, skipped ${list.length - valid.length} invalid` : ''}.`);
      load();
    } catch (e) {
      ctx.toast(`Import failed: ${e.message}`);
    }
  }

  async function clearAll() {
    if (!confirm('Delete ALL sessions and recordings from this browser?')) return;
    if (!confirm('Really delete everything? Export first if you want a backup.')) return;
    await ctx.db.clearAll();
    load();
  }

  window.addEventListener('resize', draw);
  load();
  return () => window.removeEventListener('resize', draw);
}
