// Small Canvas 2D charts for the dark UI (no libraries).
// Palette validated with the dataviz validator on surface #1d2026 (dark):
// needle #5b8cff, ball #cc7f26 – lightness band, chroma, CVD ΔE ≈ 29, contrast ≥ 3:1.
// 2 px lines, recessive grid, legend + direct end labels, text in text colours,
// crosshair + tooltip on hover. One y-axis per chart.

const C = { surface: '#1d2026', grid: '#2a2f38', axis: '#3b414c', text: '#e7e9ec', muted: '#9aa3ae', s1: '#5b8cff', s2: '#cc7f26' };
export const SERIES_COLORS = { needle: C.s1, ball: C.s2 };
const FONT = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const W = Math.max(60, r.width);
  const H = Math.max(60, r.height);
  const bw = Math.round(W * dpr);
  const bh = Math.round(H * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = C.surface;
  c.fillRect(0, 0, W, H);
  c.font = FONT;
  return { c, W, H };
}

function hoverable(canvas, redraw) {
  canvas._redraw = redraw;
  if (canvas._hoverBound) return;
  canvas._hoverBound = true;
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    canvas._hx = e.clientX - r.left;
    canvas._redraw();
  });
  canvas.addEventListener('pointerleave', () => {
    canvas._hx = null;
    canvas._redraw();
  });
}

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function legend(c, x, y, items) {
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  for (const it of items) {
    c.fillStyle = it.color;
    c.beginPath();
    c.roundRect ? c.roundRect(x, y - 2, 14, 4, 2) : c.rect(x, y - 2, 14, 4);
    c.fill();
    c.fillStyle = C.text;
    c.fillText(it.name, x + 19, y);
    x += 19 + c.measureText(it.name).width + 16;
  }
}

/** Direct labels at the right end of each line, nudged apart if they collide. */
function endLabels(c, x, items) {
  const sorted = items.filter((i) => Number.isFinite(i.y)).sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].y - sorted[i - 1].y < 14) sorted[i].y = sorted[i - 1].y + 14;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  for (const it of sorted) {
    c.fillStyle = it.color;
    c.beginPath();
    c.arc(x + 4, it.y, 3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = C.text;
    c.fillText(it.name, x + 10, it.y);
  }
}

function tooltip(c, x, y, lines, W, H) {
  const pad = 7;
  const lh = 16;
  const w = Math.max(...lines.map((l) => c.measureText(l.text).width + (l.color ? 14 : 0))) + pad * 2;
  const h = lines.length * lh + pad * 2 - 4;
  let bx = x + 12;
  if (bx + w > W - 4) bx = x - 12 - w;
  const by = Math.min(Math.max(4, y - h / 2), H - h - 4);
  c.fillStyle = 'rgba(14,16,20,0.96)';
  c.strokeStyle = C.axis;
  c.lineWidth = 1;
  c.beginPath();
  c.roundRect ? c.roundRect(bx, by, w, h, 6) : c.rect(bx, by, w, h);
  c.fill();
  c.stroke();
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  lines.forEach((l, i) => {
    const ty = by + pad + i * lh + 5;
    let tx = bx + pad;
    if (l.color) {
      c.fillStyle = l.color;
      c.fillRect(tx, ty - 2, 9, 4);
      tx += 14;
    }
    c.fillStyle = l.muted ? C.muted : C.text;
    c.fillText(l.text, tx, ty);
  });
}

function marker(c, x, y, color) {
  c.beginPath();
  c.arc(x, y, 4, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = C.surface;
  c.stroke();
}

/**
 * Needle and ball error over one run.
 * @param {HTMLCanvasElement} canvas
 * @param {{eN:number[], eB:number[], dt?:number, tolN:number, tolB:number, mode?:'both'|'needle'|'ball'}} d
 */
export function drawRunChart(canvas, d) {
  const dt = d.dt || 0.1;
  const series = [];
  if (d.mode !== 'ball' && d.eN && d.eN.length) series.push({ name: 'Needle', color: C.s1, data: d.eN, tol: d.tolN });
  if (d.mode !== 'needle' && d.eB && d.eB.length) series.push({ name: 'Ball', color: C.s2, data: d.eB, tol: d.tolB });
  const draw = () => {
    const { c, W, H } = setup(canvas);
    const m = { l: 34, r: 62, t: 26, b: 22 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const n = Math.max(1, ...series.map((s) => s.data.length));
    const T = Math.max(dt, (n - 1) * dt);
    const X = (t) => m.l + (t / T) * pw;
    const Y = (v) => m.t + (1 - (Math.max(-1, Math.min(1, v)) + 1) / 2) * ph;
    // grid + axes
    c.lineWidth = 1;
    c.textBaseline = 'middle';
    c.textAlign = 'right';
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      c.strokeStyle = v === 0 ? C.axis : C.grid;
      c.beginPath();
      c.moveTo(m.l, Math.round(Y(v)) + 0.5);
      c.lineTo(m.l + pw, Math.round(Y(v)) + 0.5);
      c.stroke();
      c.fillStyle = C.muted;
      c.fillText(v === 0 ? '0' : v > 0 ? `+${v}` : `−${-v}`, m.l - 6, Y(v));
    }
    const step = T > 90 ? 30 : T > 40 ? 10 : 5;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (let t = 0; t <= T + 1e-6; t += step) c.fillText(t === 0 ? '0 s' : String(t), X(t), m.t + ph + 6);
    // tolerance bands (on-target zones)
    for (const s of series) {
      c.fillStyle = alpha(s.color, 0.14);
      c.fillRect(m.l, Y(s.tol), pw, Y(-s.tol) - Y(s.tol));
    }
    // lines
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for (const s of series) {
      c.strokeStyle = s.color;
      c.beginPath();
      s.data.forEach((v, i) => (i ? c.lineTo(X(i * dt), Y(v)) : c.moveTo(X(0), Y(v))));
      c.stroke();
    }
    legend(c, m.l, 12, series.map((s) => ({ name: `${s.name} error`, color: s.color })).concat([{ name: 'shaded = on target', color: alpha('#9aa3ae', 0.35) }]));
    endLabels(c, m.l + pw + 4, series.map((s) => ({ name: s.name, color: s.color, y: Y(s.data[s.data.length - 1]) })));
    // hover
    const hx = canvas._hx;
    if (hx != null && hx >= m.l && hx <= m.l + pw && series.length) {
      const i = Math.max(0, Math.min(n - 1, Math.round(((hx - m.l) / pw) * (T / dt))));
      const x = X(i * dt);
      c.strokeStyle = C.muted;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + 0.5, m.t);
      c.lineTo(x + 0.5, m.t + ph);
      c.stroke();
      const lines = [{ text: `${(i * dt).toFixed(1)} s`, muted: true }];
      for (const s of series) {
        const v = s.data[Math.min(i, s.data.length - 1)];
        marker(c, x, Y(v), s.color);
        lines.push({ text: `${s.name} ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)} ${Math.abs(v) <= s.tol ? 'on target' : 'off'}`, color: s.color });
      }
      tooltip(c, x, m.t + ph / 2, lines, W, H);
    }
  };
  hoverable(canvas, draw);
  draw();
}

/**
 * Practice score history.
 * @param {HTMLCanvasElement} canvas
 * @param {{t:number, score:number, tot:number|null}[]} points oldest first
 */
export function drawScoreHistory(canvas, points) {
  const draw = () => {
    const { c, W, H } = setup(canvas);
    if (!points.length) {
      c.fillStyle = C.muted;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('No sessions yet', W / 2, H / 2);
      return;
    }
    const m = { l: 34, r: 84, t: 26, b: 24 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const n = points.length;
    const X = (i) => (n === 1 ? m.l + pw / 2 : m.l + (i / (n - 1)) * pw);
    const Y = (v) => m.t + (1 - Math.max(0, Math.min(100, v)) / 100) * ph;
    c.lineWidth = 1;
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const v of [0, 25, 50, 75, 100]) {
      c.strokeStyle = v === 0 ? C.axis : C.grid;
      c.beginPath();
      c.moveTo(m.l, Math.round(Y(v)) + 0.5);
      c.lineTo(m.l + pw, Math.round(Y(v)) + 0.5);
      c.stroke();
      c.fillStyle = C.muted;
      c.fillText(String(v), m.l - 6, Y(v));
    }
    const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    c.textAlign = 'center';
    c.textBaseline = 'top';
    const idxs = n === 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    for (const i of idxs) c.fillText(day(points[i].t), X(i), m.t + ph + 6);
    const series = [
      { name: 'Score', color: C.s1, key: 'score' },
      { name: 'On target %', color: C.s2, key: 'tot' },
    ].filter((s) => points.some((p) => Number.isFinite(p[s.key])));
    c.lineWidth = 2;
    c.lineJoin = 'round';
    for (const s of series) {
      c.strokeStyle = s.color;
      c.beginPath();
      let started = false;
      points.forEach((p, i) => {
        if (!Number.isFinite(p[s.key])) return;
        if (started) c.lineTo(X(i), Y(p[s.key]));
        else c.moveTo(X(i), Y(p[s.key]));
        started = true;
      });
      c.stroke();
      if (n <= 60) points.forEach((p, i) => Number.isFinite(p[s.key]) && marker(c, X(i), Y(p[s.key]), s.color));
    }
    legend(c, m.l, 12, series.map((s) => ({ name: s.name === 'Score' ? 'Practice score' : 'Time on target %', color: s.color })));
    const last = points[n - 1];
    endLabels(c, X(n - 1) + 6, series.map((s) => ({ name: s.name, color: s.color, y: Number.isFinite(last[s.key]) ? Y(last[s.key]) : NaN })));
    const hx = canvas._hx;
    if (hx != null && hx >= m.l - 8 && hx <= m.l + pw + 8) {
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((hx - m.l) / pw) * (n - 1))));
      const p = points[i];
      c.strokeStyle = C.muted;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(X(i) + 0.5, m.t);
      c.lineTo(X(i) + 0.5, m.t + ph);
      c.stroke();
      const lines = [{ text: new Date(p.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), muted: true }];
      for (const s of series) if (Number.isFinite(p[s.key])) lines.push({ text: `${s.name} ${p[s.key].toFixed(0)}`, color: s.color });
      tooltip(c, X(i), m.t + ph / 2, lines, W, H);
    }
  };
  hoverable(canvas, draw);
  draw();
}
