// Gamepad / joystick / rudder pedals (phase 2 – usable now, lightly tested).
//
// Chrome only exposes a gamepad after the user presses a button or moves an
// axis well off-centre ("press any button"). Rudder pedals with no buttons
// (e.g. Thrustmaster TFRP) are exposed once an axis is moved far enough.
// Axis values are read every physics tick; the browser updates them at the
// device's polling rate.

const clamp1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

export function getPads() {
  try {
    return Array.from((navigator.getGamepads && navigator.getGamepads()) || []).filter(Boolean);
  } catch {
    return [];
  }
}

/** Snapshot of connected pads for the Hardware page. */
export function listPads(get = getPads) {
  return get().map((p) => ({
    index: p.index,
    id: p.id,
    mapping: p.mapping || '(non-standard)',
    axes: Array.from(p.axes),
    buttons: p.buttons.map((b) => (typeof b === 'object' ? b.value : b)),
  }));
}

/** Find the configured pad: same id first, else same index. */
export function findPad(cfg, get = getPads) {
  const pads = get();
  return pads.find((p) => cfg.id && p.id === cfg.id) || pads.find((p) => p.index === cfg.index) || null;
}

/** Map a raw axis value to [-1, 1] using a min/max calibration, then invert and deadzone. */
export function normAxis(v, { min = -1, max = 1, invert = false, deadzone = 0 } = {}) {
  const span = max - min || 2;
  let x = clamp1(((v - min) / span) * 2 - 1);
  if (invert) x = -x;
  const a = Math.abs(x);
  if (a <= deadzone) return 0;
  return Math.sign(x) * ((a - deadzone) / (1 - deadzone));
}

/** Map a raw axis to [0, 1] (released → 0, pressed → 1) for differential pedals. */
export function normPedal(v, min = -1, max = 1) {
  const span = max - min || 2;
  return Math.min(1, Math.max(0, (v - min) / span));
}

/** Stick from one gamepad axis. cfg = settings.device.stick.pad (read live). */
export class GamepadStick {
  constructor(cfg, get = getPads) {
    this.cfg = cfg;
    this.get = get;
    this.connected = false;
  }
  reset() {}
  advanceTo() {
    const pad = findPad(this.cfg, this.get);
    this.connected = !!pad;
    if (!pad) return 0;
    const v = pad.axes[this.cfg.axis] ?? 0;
    return normAxis(v, this.cfg);
  }
}

/**
 * Pedals from a gamepad: 'single' = one rudder axis (e.g. TFRP rudder),
 * 'differential' = right − left, each axis 0..1 (e.g. two racing pedals or toe brakes).
 */
export class GamepadPedals {
  constructor(cfg, get = getPads) {
    this.cfg = cfg;
    this.get = get;
    this.connected = false;
  }
  reset() {}
  advanceTo() {
    const c = this.cfg;
    const pad = findPad(c, this.get);
    this.connected = !!pad;
    if (!pad) return 0;
    if (c.mode === 'differential') {
      const L = normPedal(pad.axes[c.axisL] ?? c.minL, c.minL, c.maxL);
      const R = normPedal(pad.axes[c.axisR] ?? c.minR, c.minR, c.maxR);
      let x = clamp1(R - L);
      if (c.invert) x = -x;
      const a = Math.abs(x);
      return a <= c.deadzone ? 0 : Math.sign(x) * ((a - c.deadzone) / (1 - c.deadzone));
    }
    return normAxis(pad.axes[c.axis] ?? 0, c);
  }
}
