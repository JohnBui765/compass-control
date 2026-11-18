// Tiny DOM helpers shared by all screens.

/**
 * h('div', {class: 'card', onclick: fn, style: {color: 'red'}}, 'text', child, [more])
 * Props starting with "on" become listeners; `class`, `style` (object), `dataset`,
 * `html` (innerHTML) are special; everything else is set as a property when it
 * exists on the element, otherwise as an attribute.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof el[k] !== 'function' && !k.includes('-')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Number formatting; '–' for null/NaN. */
export function fmt(x, d = 1) {
  return x == null || !Number.isFinite(x) ? '–' : Number(x).toFixed(d);
}
export function pct(x, d = 0) {
  return x == null || !Number.isFinite(x) ? '–' : `${Number(x).toFixed(d)} %`;
}

/** Human label for a KeyboardEvent.code. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const map = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=' };
  return map[code] || code;
}

export function download(filename, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open a file picker; resolves to the chosen File or null. */
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(input.files && input.files[0] ? input.files[0] : null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

let toastTimer = 0;
export function toast(msg, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/** Standard page header with a Home button. */
const HELP_SECTION = { 'Tuning Lab': 'tuning', 'Hardware test': 'start', Results: 'results', History: 'results', Settings: 'controls' };
export function topBar(title, ctx, ...extra) {
  const sec = HELP_SECTION[title];
  const help = title === 'How to use' ? null : h('button', { class: 'btn small', onclick: () => (sec ? ctx.navigate('help', sec) : ctx.navigate('help')) }, '? How to use');
  return h('header', { class: 'topbar' }, h('button', { class: 'btn small', onclick: () => ctx.navigate('home') }, '← Home'), h('h1', null, title), ...extra, help);
}

/** Horizontal bar for a value in [-1, 1] (centre-zero) or [0, 1]. */
export function valueBar(centre = true) {
  const fill = h('i');
  const el = h('div', { class: centre ? 'bar center' : 'bar' }, fill);
  el.set = (v) => {
    const x = Math.max(-1, Math.min(1, Number(v) || 0));
    if (centre) {
      fill.style.left = `${50 + Math.min(0, x) * 50}%`;
      fill.style.width = `${Math.abs(x) * 50}%`;
    } else {
      fill.style.left = '0%';
      fill.style.width = `${Math.max(0, x) * 100}%`;
    }
  };
  el.set(0);
  return el;
}
