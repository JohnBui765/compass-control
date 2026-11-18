// Form fields bound to a path inside an object (settings or a profile).
// spec: { path, label, help?, type?: 'number'|'select'|'bool'|'key', min, max, step,
//         scale?: 'lin'|'log', unit?, options?: [[value, label]], allowClear? }

import { h, keyLabel } from './dom.js';
import { getPath, setPath } from '../sim/profile.js';

const toT = (s, v) =>
  s.scale === 'log' ? (Math.log(v) - Math.log(s.min)) / (Math.log(s.max) - Math.log(s.min)) : (v - s.min) / (s.max - s.min);
const fromT = (s, t) => (s.scale === 'log' ? Math.exp(Math.log(s.min) + t * (Math.log(s.max) - Math.log(s.min))) : s.min + t * (s.max - s.min));

function decimals(s) {
  const st = String(s.step ?? 0.01);
  return st.includes('.') ? st.split('.')[1].length : 0;
}
export function roundForSpec(s, v) {
  if (s.scale === 'log') return Number(Number(v).toPrecision(3));
  const st = s.step || 0.01;
  return Number((Math.round(v / st) * st).toFixed(decimals(s)));
}
export function fmtSpec(s, v) {
  if (v == null || !Number.isFinite(Number(v))) return '–';
  const txt = s.scale === 'log' ? String(Number(Number(v).toPrecision(3))) : Number(v).toFixed(decimals(s));
  return s.unit ? `${txt} ${s.unit}` : txt;
}

/**
 * Build one field. Returns an element with .refresh() to re-read the value.
 * @param {object} spec
 * @param {object|function} target  object holding spec.path, or a function returning it
 * @param {(spec, value) => void} [onChange]
 */
export function field(spec, target, onChange) {
  const obj = () => (typeof target === 'function' ? target() : target);
  const get = () => getPath(obj(), spec.path);
  const set = (v) => {
    setPath(obj(), spec.path, v);
    if (onChange) onChange(spec, v);
  };
  const label = h('label', null, spec.label);
  const help = spec.help ? h('div', { class: 'help' }, spec.help) : null;
  let control;
  let valText = h('span', { class: 'val' });
  let refresh;

  if (spec.type === 'select') {
    const sel = h('select', { onchange: () => set(spec.options[sel.selectedIndex][0]) }, spec.options.map(([v, l]) => h('option', { value: String(v) }, l)));
    control = sel;
    valText = h('span', { class: 'val' });
    refresh = () => {
      const i = spec.options.findIndex(([v]) => String(v) === String(get()));
      sel.selectedIndex = Math.max(0, i);
    };
  } else if (spec.type === 'bool') {
    const cb = h('input', { type: 'checkbox', onchange: () => set(cb.checked) });
    control = h('div', null, cb);
    refresh = () => (cb.checked = !!get());
  } else if (spec.type === 'key') {
    let listening = false;
    const btn = h('button', { class: 'btn small', type: 'button' });
    const clearBtn = spec.allowClear ? h('button', { class: 'btn small', type: 'button', onclick: () => (set(''), refresh()) }, 'Clear') : null;
    btn.addEventListener('click', () => {
      if (listening) return;
      listening = true;
      btn.textContent = 'Press a key… (Esc cancels)';
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', onKey, true);
        listening = false;
        if (e.code && e.code !== 'Escape') set(e.code);
        refresh();
      };
      window.addEventListener('keydown', onKey, true);
    });
    control = h('div', { class: 'row' }, btn, clearBtn);
    refresh = () => {
      const c = get();
      btn.textContent = c ? `${keyLabel(c)}  (${c})` : 'Not set';
    };
  } else {
    // numeric: slider + exact number input
    const range = h('input', { type: 'range', min: 0, max: 1000, step: 1 });
    const num = h('input', { type: 'number', min: spec.min, max: spec.max, step: spec.step ?? 'any' });
    const commit = (v) => {
      if (!Number.isFinite(v)) return;
      const c = roundForSpec(spec, Math.min(spec.max, Math.max(spec.min, v)));
      set(c);
      refresh();
    };
    range.addEventListener('input', () => commit(fromT(spec, Number(range.value) / 1000)));
    num.addEventListener('change', () => commit(Number(num.value)));
    control = h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, range);
    valText = h('span', { class: 'val' }, num);
    refresh = () => {
      const v = Number(get());
      range.value = String(Math.round(Math.min(1, Math.max(0, toT(spec, v))) * 1000));
      if (document.activeElement !== num) num.value = String(roundForSpec(spec, v));
    };
  }
  const el = h('div', { class: 'field' }, label, control, valText, help);
  el.refresh = refresh;
  refresh();
  return el;
}

/** A titled group of fields; returns {el, refresh}. */
export function fieldGroup(title, specs, target, onChange) {
  const fields = specs.map((s) => field(s, target, onChange));
  const el = h('div', null, title ? h('h3', null, title) : null, fields);
  return { el, refresh: () => fields.forEach((f) => f.refresh()) };
}
