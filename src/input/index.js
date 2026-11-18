// Builds the two input sources the simulation reads: stick ∈ [-1,1] (+1 = full
// forward) and pedal ∈ [-1,1] (+1 = full right). Every source exposes
// advanceTo(wallMs, dt, tick) → value, plus reset(). The simulation never
// knows which device is behind them.

import { MouseStick } from './mouse-stick.js';
import { KeyPedals } from './keyboard-pedals.js';
import { GamepadStick, GamepadPedals } from './gamepad.js';

export function createInputs(settings) {
  const d = settings.device;
  const stick = d.stick.source === 'gamepad' ? new GamepadStick(d.stick.pad) : new MouseStick(d.stick);
  const pedal = d.pedals.source === 'gamepad' ? new GamepadPedals(d.pedals.pad) : new KeyPedals(d.pedals);
  return {
    stick,
    pedal,
    mouse: stick instanceof MouseStick ? stick : null,
    keys: pedal instanceof KeyPedals ? pedal : null,
    needsPointerLock: stick instanceof MouseStick && d.stick.mouseMode !== 'absolute',
  };
}

export { MouseStick, KeyPedals, GamepadStick, GamepadPedals };
