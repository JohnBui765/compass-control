// Mouse as the control stick (fore/aft only).
//
// Pointer-lock mode (default): requestPointerLock({unadjustedMovement:true})
// turns off OS mouse acceleration in Chromium, so movementY is raw counts.
// Only movementY is used – sideways movement is ignored completely.
// Moving the mouse AWAY from you (movementY < 0) pushes the stick forward (+).
// Full deflection = travelCm × countsPerCm counts from centre.
//
// The pure core (pushMove / advanceTo / output) has no DOM access and is unit
// tested in Node. attach()/lock() are the browser glue.

const SPRING = { off: 0, light: 1.5, medium: 3 }; // decay per second
export const DEFAULT_COUNTS_PER_CM = 300; // ≈ 800 DPI until calibrated

const clamp1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

/** Deadzone + expo response curve, applied to the raw stick position. */
export function shapeStick(x, deadzone = 0, expo = 0) {
  const a = Math.abs(x);
  if (a <= deadzone) return 0;
  const y = (a - deadzone) / (1 - deadzone);
  const z = (1 - expo) * y + expo * y * y * y;
  return Math.sign(x) * Math.min(1, z);
}

export class MouseStick {
  /** @param {object} cfg settings.device.stick (read live) */
  constructor(cfg) {
    this.cfg = cfg;
    this.queue = [];
    this.counts = 0; // accumulated counts from centre (exact integers while no spring)
    this.pos = 0; // raw virtual stick position = counts / countsPerFull, before deadzone/expo
    this.travelFactor = 1; // "vary feel each run"
    this.rawGranted = null; // was unadjustedMovement granted? (null = unknown)
    this.outliers = 0;
    this.target = null;
    // live diagnostics for the Hardware page
    this.lastDy = 0;
    this.lastDx = 0;
    this.sumDy = 0;
    this.sumDx = 0;
    this.events = 0;
  }

  countsPerFull() {
    const c = this.cfg.countsPerCm > 0 ? this.cfg.countsPerCm : DEFAULT_COUNTS_PER_CM;
    return c * Math.max(0.2, this.cfg.travelCm * this.travelFactor);
  }

  // ---------------------------------------------------------- pure core
  /** Queue a vertical movement of dy counts (screen down = positive) at time ts (ms). */
  pushMove(ts, dy) {
    const cpc = this.cfg.countsPerCm > 0 ? this.cfg.countsPerCm : DEFAULT_COUNTS_PER_CM;
    const limit = (this.cfg.outlierCm ?? 2.5) * cpc; // ignore bogus jumps (> 2.5 cm in one event)
    if (Math.abs(dy) > limit) {
      this.outliers++;
      return;
    }
    this.queue.push({ ts, dy });
  }
  pushAbsolute(ts, value) {
    this.queue.push({ ts, abs: clamp1(value) });
  }
  pushRecentre(ts) {
    this.queue.push({ ts, recentre: true });
  }
  reset() {
    this.queue.length = 0;
    this.counts = 0;
    this.pos = 0;
  }

  /** Apply all events up to wallMs, then the optional centring spring. Returns the stick value. */
  advanceTo(wallMs, dt) {
    const q = this.queue;
    let i = 0;
    const k = this.countsPerFull();
    while (i < q.length && q[i].ts <= wallMs) {
      const ev = q[i++];
      if (ev.recentre) this.counts = 0;
      else if (ev.abs !== undefined) this.counts = ev.abs * k;
      else this.counts = Math.max(-k, Math.min(k, this.counts - ev.dy)); // away from you (dy < 0) → forward (+)
    }
    if (i) q.splice(0, i);
    const s = SPRING[this.cfg.spring] || 0;
    if (s && this.cfg.mouseMode !== 'absolute') this.counts -= this.counts * s * dt;
    this.pos = clamp1(this.counts / k);
    return this.output();
  }

  output() {
    return shapeStick(this.pos, this.cfg.deadzone || 0, this.cfg.expo || 0);
  }

  // ---------------------------------------------------------- browser glue
  attach(target) {
    this.detach();
    this.target = target;
    const evName = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    this.eventName = evName;
    this._onMove = (e) => {
      if (this.cfg.mouseMode === 'absolute') {
        const r = target.getBoundingClientRect();
        this.pushAbsolute(e.timeStamp, -(e.clientY - (r.top + r.height / 2)) / (r.height * 0.3));
        return;
      }
      if (document.pointerLockElement !== target) return;
      this.lastDy = e.movementY;
      this.lastDx = e.movementX;
      this.sumDy += e.movementY;
      this.sumDx += e.movementX; // shown on the Hardware page only, never used
      this.events++;
      this.pushMove(e.timeStamp, e.movementY);
    };
    this._onDown = (e) => {
      if (this.cfg.clickRecentre && e.button === 0 && document.pointerLockElement === target) this.pushRecentre(e.timeStamp);
    };
    document.addEventListener(evName, this._onMove);
    document.addEventListener('mousedown', this._onDown);
  }

  detach() {
    if (this._onMove) document.removeEventListener(this.eventName, this._onMove);
    if (this._onDown) document.removeEventListener('mousedown', this._onDown);
    this._onMove = this._onDown = null;
  }

  isLocked() {
    return !!this.target && document.pointerLockElement === this.target;
  }

  /**
   * Request pointer lock (call from a click handler). Tries raw input first.
   * @returns {Promise<{ok: boolean, raw: boolean|null, error?: string}>}
   */
  async lock() {
    const t = this.target;
    if (!t) return { ok: false, raw: null, error: 'no target' };
    if (this.cfg.mouseMode === 'absolute') return { ok: true, raw: null };
    if (document.pointerLockElement === t) return { ok: true, raw: this.rawGranted };
    try {
      const p = t.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.then === 'function') {
        await p;
        this.rawGranted = true;
      } else {
        await waitForLock(t); // browsers without the promise API (Firefox): no raw input
        this.rawGranted = false;
      }
    } catch (err) {
      if (err && err.name === 'NotSupportedError') {
        try {
          const p2 = t.requestPointerLock();
          if (p2 && typeof p2.then === 'function') await p2;
          else await waitForLock(t);
          this.rawGranted = false;
        } catch (err2) {
          return { ok: false, raw: false, error: describeLockError(err2) };
        }
      } else {
        return { ok: false, raw: null, error: describeLockError(err) };
      }
    }
    return { ok: document.pointerLockElement === t, raw: this.rawGranted };
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function waitForLock(t) {
  return new Promise((resolve, reject) => {
    const done = (ok) => {
      document.removeEventListener('pointerlockchange', onChange);
      document.removeEventListener('pointerlockerror', onError);
      clearTimeout(timer);
      ok ? resolve() : reject(new Error('Pointer lock was refused'));
    };
    const onChange = () => done(document.pointerLockElement === t);
    const onError = () => done(false);
    const timer = setTimeout(() => done(document.pointerLockElement === t), 1500);
    document.addEventListener('pointerlockchange', onChange);
    document.addEventListener('pointerlockerror', onError);
  });
}

function describeLockError(err) {
  const m = (err && (err.message || err.name)) || 'Pointer lock was refused';
  // Chrome refuses a new lock for ~1 s after the user pressed Esc.
  if (/exited the lock|before this request|too soon/i.test(m)) return 'The browser needs a moment after Esc – click again.';
  return m;
}
