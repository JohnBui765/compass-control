// Canvas renderer for the two instruments, laid out like the test-centre
// screenshot: square slate bezel with four screws and a black dial (16 tick
// positions, long ticks at 12/3/6, glossy red target at 9 o'clock, thin blue
// needle from the centre); below it a wide bezel with a dark track, 15 ticks,
// a white centre mark, a red target and the blue ball; a legend strip at the
// bottom with a stick (↕) icon and a pedals icon. Light grey background.
// The static parts are cached in an offscreen canvas; each frame only draws the
// needle, the ball, the timer and optional indicators.

import { BALL_RADIUS_FRAC } from '../sim/scoring.js';

const THEMES = {
  light: { bg: '#d9d9d6', line: '#9c9c99', text: '#3a3a3a', veil: 'rgba(217,217,214,0.78)' },
  dark: { bg: '#26282c', line: '#46494f', text: '#c9c9c9', veil: 'rgba(38,40,44,0.78)' },
};
const PANEL_TOP = '#5e6676';
const PANEL_BOTTOM = '#434a57';
const PANEL_EDGE = '#2a2f37';
export const NEEDLE_BLUE = '#2a45d8';
export const BALL_BLUE = '#2150f2';
const TAU = Math.PI * 2;
const clamp1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

/** Geometry in CSS pixels. S = dial panel height. Proportions measured from the screenshot. */
export function computeLayout(W, H, { strip = true, scale = 1 } = {}) {
  const stripH = strip ? Math.round(Math.min(120, Math.max(56, H * 0.13))) : 0;
  const areaH = H - stripH;
  const fit = Math.min(areaH * 0.557, (W * 0.94) / 1.63);
  const S = Math.max(40, fit * Math.min(1, Math.max(0.5, scale)));
  const dialW = 1.08 * S;
  const gap = 0.064 * S;
  const tpW = 1.63 * S;
  const tpH = 0.44 * S;
  const top = Math.max(6, (areaH - (S + gap + tpH)) / 2);
  const cx = W / 2;
  const dial = { x: cx - dialW / 2, y: top, w: dialW, h: S, cx, cy: top + S / 2, R: 0.4 * S };
  const tp = { x: cx - tpW / 2, y: top + S + gap, w: tpW, h: tpH };
  const tw = 0.83 * tpW;
  const th = 0.334 * tpH;
  const track = { x: cx - tw / 2, y: tp.y + (tpH - th) / 2, w: tw, h: th, cx, cy: tp.y + tpH / 2 };
  track.half = 0.47 * tw; // ball centre travel for eB = ±1
  track.ballR = BALL_RADIUS_FRAC * track.half; // same constant the scorer uses
  return { W, H, S, dial, tp, track, strip: { y: H - stripH, h: stripH } };
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function panel(c, x, y, w, h, r) {
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, PANEL_TOP);
  g.addColorStop(1, PANEL_BOTTOM);
  rr(c, x, y, w, h, r);
  c.fillStyle = g;
  c.fill();
  c.lineWidth = Math.max(1, w * 0.006);
  c.strokeStyle = PANEL_EDGE;
  c.stroke();
  rr(c, x + 2, y + 2, w - 4, h - 4, Math.max(1, r - 2));
  c.lineWidth = 1;
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.stroke();
}

function screw(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r * 1.3, 0, TAU);
  c.fillStyle = '#252930';
  c.fill();
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#f2f4f6');
  g.addColorStop(1, '#9aa0a8');
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = g;
  c.fill();
}

function screws(c, x, y, w, h, inset, r) {
  for (const [sx, sy] of [
    [x + inset, y + inset],
    [x + w - inset, y + inset],
    [x + inset, y + h - inset],
    [x + w - inset, y + h - inset],
  ])
    screw(c, sx, sy, r);
}

function redDot(c, x, y, r) {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
  g.addColorStop(0, '#ffb3aa');
  g.addColorStop(0.3, '#f03a2e');
  g.addColorStop(1, '#a3120b');
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = g;
  c.fill();
}

function drawDialStatic(c, L) {
  const d = L.dial;
  const S = L.S;
  panel(c, d.x, d.y, d.w, d.h, 0.06 * S);
  screws(c, d.x, d.y, d.w, d.h, 0.055 * S, 0.03 * S);
  const { cx, cy, R } = d;
  c.beginPath();
  c.arc(cx, cy, R * 1.11, 0, TAU);
  c.fillStyle = '#1b1e23';
  c.fill();
  c.lineWidth = R * 0.03;
  c.beginPath();
  c.arc(cx, cy, R * 1.045, 0, TAU);
  c.strokeStyle = '#8c96a3';
  c.stroke();
  c.beginPath();
  c.arc(cx, cy, R * 1.045, -Math.PI * 0.5, -Math.PI * 0.04);
  c.strokeStyle = '#e6ebf0';
  c.stroke();
  // face with a glass reflection (lower half lighter, as in the photo)
  c.save();
  c.beginPath();
  c.arc(cx, cy, R, 0, TAU);
  c.clip();
  c.fillStyle = '#0b0c0e';
  c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  const gy = cy + 0.07 * R;
  const g = c.createLinearGradient(0, gy, 0, cy + R);
  g.addColorStop(0, '#3b3e43');
  g.addColorStop(1, '#16181b');
  c.fillStyle = g;
  c.fillRect(cx - R, gy, 2 * R, R);
  const g2 = c.createLinearGradient(0, cy - R, 0, cy);
  g2.addColorStop(0, 'rgba(255,255,255,0.07)');
  g2.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g2;
  c.fillRect(cx - R, cy - R, 2 * R, R);
  c.restore();
  // 16 tick positions every 22.5°; long ticks at 12, 3 and 6; 9 o'clock holds the red dot
  c.lineCap = 'butt';
  for (let i = 0; i < 16; i++) {
    const deg = i * 22.5;
    if (deg === 270) continue;
    const major = deg % 90 === 0;
    const a = ((deg - 90) * Math.PI) / 180;
    const r0 = (major ? 0.65 : 0.71) * R;
    const r1 = (major ? 0.835 : 0.82) * R;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    c.lineWidth = (major ? 0.034 : 0.02) * R;
    c.strokeStyle = major ? '#f2f2f2' : '#d2d2d2';
    c.stroke();
  }
  redDot(c, cx - 0.856 * R, cy, 0.103 * R);
}

function drawTrackStatic(c, L) {
  const { tp, track: t, S } = L;
  panel(c, tp.x, tp.y, tp.w, tp.h, 0.05 * S);
  screws(c, tp.x, tp.y, tp.w, tp.h, 0.045 * S, 0.03 * S);
  rr(c, t.x, t.y, t.w, t.h, t.h * 0.12);
  const g = c.createLinearGradient(0, t.y, 0, t.y + t.h);
  g.addColorStop(0, '#0e0f11');
  g.addColorStop(0.55, '#25282c');
  g.addColorStop(1, '#141618');
  c.fillStyle = g;
  c.fill();
  c.lineWidth = Math.max(1, 0.006 * S);
  c.strokeStyle = '#111215';
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.fillRect(t.x + t.h * 0.12, t.y + t.h - 1, t.w - t.h * 0.24, 1);
  // 15 ticks at eB = k/7; the end ticks are a little longer
  c.strokeStyle = '#c8c8c8';
  c.lineWidth = Math.max(1, 0.006 * S);
  for (let k = -7; k <= 7; k++) {
    if (k === 0) continue;
    const x = t.cx + (k / 7) * t.half;
    const end = Math.abs(k) === 7;
    c.beginPath();
    c.moveTo(x, t.y + t.h * (end ? 0.17 : 0.25));
    c.lineTo(x, t.y + t.h * (end ? 0.83 : 0.73));
    c.stroke();
  }
  c.strokeStyle = '#f4f4f4';
  c.lineWidth = Math.max(1.5, 0.008 * S);
  c.beginPath();
  c.moveTo(t.cx, t.y + t.h * 0.06);
  c.lineTo(t.cx, t.y + t.h * 0.94);
  c.stroke();
  redDot(c, t.cx, t.cy, t.ballR * 1.18);
}

// ---- legend strip: stick + pedal pictures, redrawn every frame so they can react ----
const LIT = '#2a55f0';
const LIT_GLOW = 'rgba(42, 85, 240, 0.75)';

function drawStripLine(c, L, theme) {
  if (!L.strip.h) return;
  c.fillStyle = theme.line;
  c.fillRect(0, L.strip.y, L.W, 1);
}

function poly(c, P, pts) {
  c.beginPath();
  pts.forEach(([a, b], i) => (i ? c.lineTo(...P(a, b)) : c.moveTo(...P(a, b))));
  c.closePath();
}

/**
 * Stick and pedal pictures (60-unit-high box at ox, oy; u = CSS px per unit) plus the
 * optional indicators. With s.feedback they react to your input:
 *  - stick: the ↑ or ↓ arrow lights in the direction you push, the grip moves with it;
 *  - pedals: a pedal lights up the moment its key is pressed (s.actL / s.actR), and fills
 *    and sinks as the pedal value builds up – the ball follows the fill, not the key.
 *    Both keys held: both light up, neither fills (linked pedals cancel).
 * Without s.feedback the pictures are static, like the real test.
 */
export function drawLegend(c, ox, oy, u, s, theme) {
  const P = (px, py) => [ox + px * u, oy + py * u];
  const fb = !!s.feedback;
  const stick = clamp1(s.stick || 0);
  const pedal = clamp1(s.pedal || 0);
  const moving = fb && Math.abs(stick) > 0.02;

  // up/down arrow: the half you push toward lights up, brighter for a bigger push
  const up = [[6, 10], [13, 19], [8.5, 19], [8.5, 26], [3.5, 26], [3.5, 19], [-1, 19]];
  const down = [[6, 42], [13, 33], [8.5, 33], [8.5, 26], [3.5, 26], [3.5, 33], [-1, 33]];
  for (const [pts, on] of [[up, stick > 0.02], [down, stick < -0.02]]) {
    poly(c, P, pts);
    c.fillStyle = '#a3a3a3';
    c.fill();
    if (fb && on) {
      c.globalAlpha = 0.4 + 0.6 * Math.min(1, Math.abs(stick) * 1.5);
      c.fillStyle = LIT;
      c.fill();
      c.globalAlpha = 1;
    }
  }
  // stick: shaft, collar, grip (the grip moves up = forward, down = back)
  const gy = fb ? -stick * 3.5 : 0;
  c.fillStyle = '#2d2e30';
  c.fillRect(...P(23, 17 + gy), 3 * u, (25 - gy) * u);
  poly(c, P, [[20, 44], [29, 44], [26.5, 40], [22.5, 40]]);
  c.fill();
  if (moving) {
    c.shadowColor = LIT_GLOW;
    c.shadowBlur = 6 * u;
  }
  c.fillStyle = moving ? '#1f3fb8' : '#3a3b3d';
  rr(c, ...P(16, 7 + gy), 17 * u, 10 * u, 3 * u);
  c.fill();
  c.shadowBlur = 0;
  c.fillStyle = '#f2f2f2';
  for (const [a, b] of [[20, 11], [24.5, 9.5], [29, 11]]) {
    c.beginPath();
    c.arc(...P(a, b + gy), 1.3 * u, 0, TAU);
    c.fill();
  }
  c.fillStyle = '#8a8a8a';
  c.fillRect(...P(19.5, 47), 10 * u, 9 * u);

  // pedals: base, linking bar, two pedals (with their key letters), dark bar below
  c.lineWidth = Math.max(1, u);
  c.strokeStyle = '#8c8c8c';
  c.fillStyle = '#ececec';
  poly(c, P, [[46, 49], [86, 49], [82, 33], [50, 33]]);
  c.fill();
  c.stroke();
  c.fillStyle = '#9a9a9a';
  c.fillRect(...P(58, 25), 16 * u, 2.5 * u);
  const sides = [
    { x: 53, act: s.actL || 0, defl: Math.max(0, -pedal), key: s.keyL || 'L' },
    { x: 70, act: s.actR || 0, defl: Math.max(0, pedal), key: s.keyR || 'R' },
  ];
  for (const sd of sides) {
    const lit = fb && sd.act > 0;
    const d = fb ? sd.defl : 0;
    const x = sd.x;
    const y = 15 + d * 2.5; // the pedal sinks as it is pressed
    poly(c, P, [[x + 4.5, 2], [x + 9, 8], [x + 6.5, 8], [x + 6.5, 12], [x + 2.5, 12], [x + 2.5, 8], [x, 8]]);
    c.fillStyle = lit ? LIT : '#b4b4b4';
    c.fill();
    if (lit) {
      c.shadowColor = LIT_GLOW;
      c.shadowBlur = 7 * u;
    }
    rr(c, ...P(x, y), 9 * u, 24 * u, 3 * u);
    c.fillStyle = '#dddddd';
    c.fill();
    c.shadowBlur = 0;
    if (d > 0.001) {
      c.save();
      rr(c, ...P(x, y), 9 * u, 24 * u, 3 * u);
      c.clip();
      c.fillStyle = LIT;
      c.fillRect(...P(x, y + 24 * (1 - d)), 9 * u, 24 * d * u);
      c.restore();
    }
    rr(c, ...P(x, y), 9 * u, 24 * u, 3 * u);
    c.lineWidth = lit ? Math.max(1.5, 1.6 * u) : Math.max(1, u);
    c.strokeStyle = lit ? LIT : '#8c8c8c';
    c.stroke();
    if (fb) {
      c.font = `700 ${Math.max(9, Math.round(8 * u))}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = d > 0.62 ? '#ffffff' : lit ? LIT : '#6d6d6d';
      c.fillText(sd.key, ...P(x + 4.5, y + 8));
    }
  }
  c.lineWidth = Math.max(1, u);
  c.fillStyle = '#5a5a5a';
  c.fillRect(...P(52, 52), 28 * u, 4 * u);

  // optional indicators
  if (s.showStick) {
    const x = ox + 37 * u;
    const y0 = oy + 8 * u;
    const y1 = oy + 52 * u;
    c.fillStyle = '#b9b9b9';
    c.fillRect(x, y0, 3 * u, y1 - y0);
    c.fillStyle = '#7d7d7d';
    c.fillRect(x - 2 * u, (y0 + y1) / 2 - 0.5, 7 * u, 1);
    const ym = (y0 + y1) / 2 - stick * ((y1 - y0) / 2); // forward = up
    c.fillStyle = NEEDLE_BLUE;
    c.fillRect(x - 3 * u, ym - 1.5 * u, 9 * u, 3 * u);
  }
  if (s.showPedal) {
    const x0 = ox + 92 * u;
    const x1 = ox + 142 * u;
    const y = oy + 30 * u;
    c.fillStyle = '#b9b9b9';
    c.fillRect(x0, y - 1.5 * u, x1 - x0, 3 * u);
    c.fillStyle = '#7d7d7d';
    c.fillRect((x0 + x1) / 2 - 0.5, y - 4 * u, 1, 8 * u);
    const xm = (x0 + x1) / 2 + pedal * ((x1 - x0) / 2);
    c.fillStyle = BALL_BLUE;
    c.fillRect(xm - 1.5 * u, y - 4.5 * u, 3 * u, 9 * u);
  }
  if (s.errorBars && s.tol) {
    const x0 = ox + 160 * u;
    const rows = [];
    if (s.mode !== 'ball') rows.push(['Needle', Math.abs(s.eN || 0) / s.tol.n]);
    if (s.mode !== 'needle') rows.push(['Ball', Math.abs(s.eB || 0) / s.tol.b]);
    c.font = `500 ${Math.round(11 * u)}px system-ui, sans-serif`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    rows.forEach(([name, r], i) => {
      const y = oy + (20 + i * 20) * u;
      c.fillStyle = theme.text;
      c.fillText(name, x0, y);
      c.fillStyle = '#bdbdbd';
      c.fillRect(x0 + 44 * u, y - 3 * u, 60 * u, 6 * u);
      c.fillStyle = r <= 1 ? '#2e9e5b' : '#d9822b';
      c.fillRect(x0 + 44 * u, y - 3 * u, Math.min(60, (r / 3) * 60) * u, 6 * u);
      c.fillStyle = '#555';
      c.fillRect(x0 + 64 * u, y - 5 * u, 1, 10 * u); // tolerance mark at 1/3
    });
  }
}

/** Stand-alone stick + pedal pictures (Hardware test page), centred and larger. */
export class LegendView {
  constructor(canvas, theme = 'light') {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.theme = THEMES[theme] || THEMES.light;
  }
  draw(s) {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const W = Math.max(1, r.width);
    const H = Math.max(1, r.height);
    const bw = Math.round(W * dpr);
    const bh = Math.round(H * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    const c = this.c;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = this.theme.bg;
    c.fillRect(0, 0, W, H);
    const spanU = s.showPedal ? 145 : 92;
    const u = Math.max(0.5, Math.min((H - 12) / 60, (W - 24) / spanU));
    const ox = (W - spanU * u) / 2 + u;
    const oy = (H - 60 * u) / 2;
    this.canvas.dataset.geom = JSON.stringify({ ox, oy, u, dpr });
    drawLegend(c, ox, oy, u, s, this.theme);
  }
}

export class Instruments {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{strip?: boolean, theme?: 'light'|'dark', scale?: number}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.opts = { strip: true, theme: 'light', scale: 1, ...opts };
    this.dirty = true;
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (this.dirty = true)) : null;
    if (this.ro) this.ro.observe(canvas);
  }

  setOptions(o) {
    Object.assign(this.opts, o);
    this.dirty = true;
  }

  destroy() {
    if (this.ro) this.ro.disconnect();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const W = Math.max(1, r.width);
    const H = Math.max(1, r.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.L = computeLayout(W, H, this.opts);
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const oc = off.getContext('2d');
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = THEMES[this.opts.theme] || THEMES.light;
    oc.fillStyle = theme.bg;
    oc.fillRect(0, 0, W, H);
    drawDialStatic(oc, this.L);
    drawTrackStatic(oc, this.L);
    if (this.opts.strip) drawStripLine(oc, this.L, theme);
    this.staticLayer = off;
    this.dirty = false;
  }

  /**
   * @param {object} s
   * @param {number} s.eN  needle error (−1..1)
   * @param {number} s.eB  ball error (−1..1)
   * @param {number} s.maxAngle  degrees
   * @param {'both'|'needle'|'ball'} [s.mode]
   * @param {string} [s.timer] text top-right    @param {string} [s.label] text top-left
   * @param {number} [s.stick] [s.pedal] input values for the optional indicators
   * @param {boolean} [s.showStick] [s.showPedal] [s.errorBars]   @param {{n:number,b:number}} [s.tol]
   */
  draw(s) {
    if (this.dirty || (window.devicePixelRatio || 1) !== this.dpr) this.resize();
    const c = this.c;
    const L = this.L;
    const theme = THEMES[this.opts.theme] || THEMES.light;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.staticLayer, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // needle: rotated from 9 o'clock; positive eN = tip upward (clockwise on screen)
    const d = L.dial;
    const a = Math.PI + (clamp1(s.eN || 0) * (s.maxAngle || 75) * Math.PI) / 180;
    const len = 0.856 * d.R;
    c.beginPath();
    c.moveTo(d.cx, d.cy);
    c.lineTo(d.cx + Math.cos(a) * len, d.cy + Math.sin(a) * len);
    c.strokeStyle = NEEDLE_BLUE;
    c.lineWidth = Math.max(2, 0.026 * d.R);
    c.lineCap = 'round';
    c.stroke();
    c.beginPath();
    c.arc(d.cx, d.cy, Math.max(2, 0.022 * d.R), 0, TAU);
    c.fillStyle = NEEDLE_BLUE;
    c.fill();

    // ball
    const t = L.track;
    const bx = t.cx + clamp1(s.eB || 0) * t.half;
    const g = c.createRadialGradient(bx - t.ballR * 0.3, t.cy - t.ballR * 0.35, t.ballR * 0.1, bx, t.cy, t.ballR);
    g.addColorStop(0, '#7590ff');
    g.addColorStop(0.45, BALL_BLUE);
    g.addColorStop(1, '#1234b4');
    c.beginPath();
    c.arc(bx, t.cy, t.ballR, 0, TAU);
    c.fillStyle = g;
    c.fill();

    // part-task modes: veil over the inactive instrument
    if (s.mode === 'ball' || s.mode === 'needle') {
      c.fillStyle = theme.veil;
      const p = s.mode === 'ball' ? { x: d.x - 2, y: d.y - 2, w: d.w + 4, h: d.h + 4 } : { x: L.tp.x - 2, y: L.tp.y - 2, w: L.tp.w + 4, h: L.tp.h + 4 };
      c.fillRect(p.x, p.y, p.w, p.h);
    }

    const fs = Math.max(13, Math.round(0.034 * L.S));
    c.fillStyle = theme.text;
    c.textBaseline = 'top';
    if (s.timer) {
      c.font = `600 ${fs}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      c.textAlign = 'right';
      c.fillText(s.timer, L.W - 14, 12);
    }
    if (s.label) {
      c.font = `500 ${Math.round(fs * 0.85)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      c.textAlign = 'left';
      c.fillText(s.label, 14, 12);
    }

    // stick + pedal pictures (react to input when s.feedback) and optional indicators
    if (L.strip.h) drawLegend(c, 12, L.strip.y, L.strip.h / 60, s, theme);
  }
}
