// Two (optionally four) keys as rudder pedals.
//
// Keys are stored as event.code (physical key), so any code works – including
// F13–F24 sent by programmable USB foot switches. Target: left → −1, right → +1,
// both or neither → 0 (linked pedals cancel). Optional "light" keys target ±0.5.
// The pedal value ramps toward its target (simulated foot pressure): moving
// away from zero uses rampUp (s for full travel), moving toward zero uses
// rampDown, so switching sides passes smoothly through 0. `curve` > 1 eases the
// output in, so short taps give finer nudges.
//
// The pure core (pushKey / advanceTo) has no DOM access and is unit tested.

const clamp1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

/** One ramp step from p toward target. up/down = fraction of full travel this tick. */
export function rampStep(p, target, up, down) {
  if (p === target) return p;
  if (p !== 0 && (Math.sign(target) !== Math.sign(p) || Math.abs(target) < Math.abs(p))) {
    // releasing (or reversing): head back toward zero / the smaller target
    const goal = Math.sign(target) === Math.sign(p) ? target : 0;
    const d = Math.abs(p - goal);
    return down >= d ? goal : p - Math.sign(p) * down;
  }
  const d = Math.abs(target - p);
  return up >= d ? target : p + Math.sign(target - p) * up;
}

/** True when a key event looks like it came through a Vietnamese/other IME (Unikey, EVKey, Telex). */
export function looksLikeIme(e) {
  return e.key === 'Process' || e.keyCode === 229 || e.code === '' || (typeof e.key === 'string' && e.key.length === 1 && /[^\x00-\x7f]/.test(e.key));
}

export class KeyPedals {
  /** @param {object} cfg settings.device.pedals (read live) */
  constructor(cfg) {
    this.cfg = cfg;
    this.queue = [];
    this.held = new Set();
    this.p = 0;
    this.imeSuspected = false;
    this.log = []; // last key events, for the Hardware page
    this.downAt = new Map();
    this.onLog = null;
  }

  roles() {
    const c = this.cfg;
    return { leftFull: c.leftKey, rightFull: c.rightKey, leftLight: c.leftLightKey, rightLight: c.rightLightKey };
  }
  isMapped(code) {
    if (!code) return false;
    const c = this.cfg;
    return code === c.leftKey || code === c.rightKey || code === c.leftLightKey || code === c.rightLightKey;
  }

  // ---------------------------------------------------------- pure core
  pushKey(ts, code, down) {
    this.queue.push({ ts, code, down });
  }
  pushReleaseAll(ts) {
    this.queue.push({ ts, releaseAll: true });
  }
  reset() {
    this.queue.length = 0;
    this.held.clear();
    this.p = 0;
  }

  target() {
    const c = this.cfg;
    const h = this.held;
    const L = h.has(c.leftKey) ? 1 : c.leftLightKey && h.has(c.leftLightKey) ? 0.5 : 0;
    const R = h.has(c.rightKey) ? 1 : c.rightLightKey && h.has(c.rightLightKey) ? 0.5 : 0;
    if (L > 0 && R > 0) return 0;
    return R - L;
  }

  advanceTo(wallMs, dt) {
    const q = this.queue;
    let i = 0;
    while (i < q.length && q[i].ts <= wallMs) {
      const ev = q[i++];
      if (ev.releaseAll) this.held.clear();
      else if (ev.down) this.held.add(ev.code);
      else this.held.delete(ev.code);
    }
    if (i) q.splice(0, i);
    const tgt = this.target();
    const c = this.cfg;
    if (c.instant) this.p = tgt;
    else this.p = rampStep(this.p, tgt, dt / Math.max(0.01, c.rampUp), dt / Math.max(0.01, c.rampDown));
    return this.output();
  }

  output() {
    const k = this.cfg.curve > 0 ? this.cfg.curve : 1;
    return clamp1(Math.sign(this.p) * Math.pow(Math.abs(this.p), k));
  }

  // ---------------------------------------------------------- browser glue
  attach() {
    this.detach();
    this._down = (e) => this.handle(e, true);
    this._up = (e) => this.handle(e, false);
    this._blur = (e) => this.pushReleaseAll(e.timeStamp || performance.now());
    this._vis = (e) => {
      if (document.visibilityState === 'hidden') this.pushReleaseAll(e.timeStamp || performance.now());
    };
    window.addEventListener('keydown', this._down, true);
    window.addEventListener('keyup', this._up, true);
    window.addEventListener('blur', this._blur);
    document.addEventListener('visibilitychange', this._vis);
  }

  detach() {
    if (!this._down) return;
    window.removeEventListener('keydown', this._down, true);
    window.removeEventListener('keyup', this._up, true);
    window.removeEventListener('blur', this._blur);
    document.removeEventListener('visibilitychange', this._vis);
    this._down = this._up = this._blur = this._vis = null;
  }

  handle(e, down) {
    const ime = looksLikeIme(e);
    if (ime) this.imeSuspected = true;
    const now = e.timeStamp;
    let hold = null;
    if (down && !e.repeat) this.downAt.set(e.code, now);
    if (!down && this.downAt.has(e.code)) {
      hold = now - this.downAt.get(e.code);
      this.downAt.delete(e.code);
    }
    const entry = { type: down ? 'down' : 'up', code: e.code, key: e.key, t: now, hold, repeat: !!e.repeat, ime, mapped: this.isMapped(e.code) };
    this.log.push(entry);
    if (this.log.length > 50) this.log.shift();
    if (this.onLog) this.onLog(entry);
    if (!this.isMapped(e.code)) return;
    e.preventDefault(); // mapped keys only
    if (e.repeat) return; // auto-repeat changes nothing
    this.pushKey(now, e.code, down);
  }
}
