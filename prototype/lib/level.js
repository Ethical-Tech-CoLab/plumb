/**
 * level.js — pose sensing, smoothing, and capture readiness.
 *
 * Three problems this solves, all reported from real handheld use:
 *
 * 1. THE OLD GATE WAS WRONG. It demanded pitch and roll within 3 degrees. A
 *    homography corrects any perspective exactly, so tilt does not bias a
 *    measurement at all — it only costs precision, through foreshortening of
 *    the target (its projected size shrinks by cos t, so corner-localisation
 *    error grows by 1/cos t). Working that through:
 *
 *        3 deg  -> corner precision 0.501 mm
 *       15 deg  -> corner precision 0.518 mm
 *
 *    a difference of 0.017 mm, against an operator tap error of 1-3 mm. The
 *    gate was buying an error term ~100x below the dominant one, and charging
 *    a great deal of usability for it. Tolerances here are far more generous
 *    and, more importantly, GRADED rather than binary.
 *
 * 2. ROLL IS NOT PITCH. Roll rotates the image about the optical axis. It
 *    changes nothing whatsoever about the plane geometry — zero metrological
 *    cost. It matters only for the archival record shot looking straight. So
 *    roll is advisory here, and pitch carries the real tolerance.
 *
 * 3. RAW SENSOR DATA IS UNREADABLE. Device orientation arrives at ~60 Hz and
 *    jitters by a degree or so at rest. Displaying that to one decimal place
 *    produces flickering digits nobody can act on. Everything below is
 *    smoothed, dead-banded and throttled before it reaches a human.
 */

// Pitch tolerance bands, in degrees from the ideal. Graded, not pass/fail.
export const PITCH_BANDS = [
  { max: 5,   grade: 'excellent', label: 'Square on',    colour: '#2f9e44' },
  { max: 15,  grade: 'good',      label: 'Good',         colour: '#2f9e44' },
  { max: 30,  grade: 'fair',      label: 'Slight angle', colour: '#f08c00' },
  { max: 45,  grade: 'poor',      label: 'Steep angle',  colour: '#f08c00' },
  { max: 180, grade: 'bad',       label: 'Too steep',    colour: '#d6336c' },
];

// Roll is cosmetic. Wide bands, and never blocks anything.
export const ROLL_BANDS = [
  { max: 3,   grade: 'excellent', label: 'Level',   colour: '#2f9e44' },
  { max: 10,  grade: 'good',      label: 'Level',   colour: '#2f9e44' },
  { max: 25,  grade: 'fair',      label: 'Tilted',  colour: '#f08c00' },
  { max: 180, grade: 'poor',      label: 'Tilted',  colour: '#f08c00' },
];

/** What the phone should be doing, depending on what you're photographing. */
export const SUBJECT_MODES = {
  wall:   { id: 'wall',   label: 'Wall / facade', idealPitch: 90, hint: 'Hold the phone upright, facing the wall' },
  ground: { id: 'ground', label: 'Ground / paving', idealPitch: 0, hint: 'Point the phone down at the ground' },
  free:   { id: 'free',   label: 'Any angle', idealPitch: null, hint: 'Levelling guidance off' },
};

function band(bands, value) {
  const v = Math.abs(value);
  return bands.find((b) => v <= b.max) ?? bands[bands.length - 1];
}

/** Exponential moving average with a dead-band, so small jitter is ignored. */
class Smoothed {
  constructor({ alpha = 0.18, deadband = 0.35 } = {}) {
    this.alpha = alpha;
    this.deadband = deadband;
    this.value = null;
    this.reported = null;
  }

  push(raw) {
    if (raw == null || Number.isNaN(raw)) return this.reported;
    this.value = this.value == null ? raw : this.value + this.alpha * (raw - this.value);
    // Only move the reported value once the smoothed one has drifted enough.
    if (this.reported == null || Math.abs(this.value - this.reported) > this.deadband) {
      this.reported = this.value;
    }
    return this.reported;
  }

  reset() {
    this.value = null;
    this.reported = null;
  }
}

/**
 * Tracks how still the phone is. Handheld capture is mostly ruined by movement
 * at the moment of the shutter, not by a couple of degrees of tilt, so this is
 * arguably the more useful signal of the two.
 */
class Steadiness {
  constructor(window = 12) {
    this.window = window;
    this.samples = [];
  }

  push(pitch, roll) {
    this.samples.push({ pitch, roll, t: performance.now() });
    if (this.samples.length > this.window) this.samples.shift();
  }

  /** Peak-to-peak movement in degrees over the window. */
  movement() {
    if (this.samples.length < 4) return Infinity;
    const p = this.samples.map((s) => s.pitch);
    const r = this.samples.map((s) => s.roll);
    return Math.max(
      Math.max(...p) - Math.min(...p),
      Math.max(...r) - Math.min(...r)
    );
  }

  isSteady(threshold = 1.5) {
    return this.movement() <= threshold;
  }

  reset() {
    this.samples = [];
  }
}

export class LevelTracker {
  /**
   * @param {object} opts
   * @param {(state:object)=>void} opts.onUpdate  throttled, smoothed state
   * @param {(state:object)=>void} [opts.onReadyChange] fires only on transitions
   */
  constructor({ onUpdate, onReadyChange, mode = 'wall', uiHz = 8 } = {}) {
    this.onUpdate = onUpdate;
    this.onReadyChange = onReadyChange;
    this.mode = SUBJECT_MODES[mode] ?? SUBJECT_MODES.wall;

    this.pitch = new Smoothed({ alpha: 0.18, deadband: 0.35 });
    this.roll = new Smoothed({ alpha: 0.18, deadband: 0.35 });
    this.heading = new Smoothed({ alpha: 0.12, deadband: 1.5 });
    this.steadiness = new Steadiness();

    this.minInterval = 1000 / uiHz;
    this.lastEmit = 0;
    this.ready = false;
    this.latest = null;
    this._handler = null;
  }

  setMode(id) {
    this.mode = SUBJECT_MODES[id] ?? SUBJECT_MODES.wall;
    this.pitch.reset();
    this.roll.reset();
    this.steadiness.reset();
  }

  /**
   * Hysteresis: become ready at 12 deg, stop being ready only past 18. Without
   * this the indicator flickers maddeningly when you hover on the boundary.
   */
  _computeReady(pitchOff, steady) {
    if (this.mode.idealPitch == null) return steady;
    const enter = 12;
    const leave = 18;
    const threshold = this.ready ? leave : enter;
    return Math.abs(pitchOff) <= threshold && steady;
  }

  handleOrientation(event) {
    const beta = event.beta;    // front-back tilt
    const gamma = event.gamma;  // left-right tilt
    if (beta == null && gamma == null) return;

    const pitch = this.pitch.push(beta);
    const roll = this.roll.push(gamma);
    const heading = this.heading.push(
      event.webkitCompassHeading ?? (event.absolute ? event.alpha : null)
    );
    if (pitch == null || roll == null) return;

    this.steadiness.push(pitch, roll);

    const pitchOff = this.mode.idealPitch == null ? 0 : pitch - this.mode.idealPitch;
    const steady = this.steadiness.isSteady();
    const ready = this._computeReady(pitchOff, steady);

    const state = {
      pitch,
      roll,
      heading,
      pitchOff,
      rollOff: roll,
      pitchBand: band(PITCH_BANDS, pitchOff),
      rollBand: band(ROLL_BANDS, roll),
      steady,
      movement: this.steadiness.movement(),
      ready,
      mode: this.mode,
      // Foreshortening penalty, so the UI can be honest about the real cost.
      precisionPenalty: 1 / Math.cos((Math.min(Math.abs(pitchOff), 80) * Math.PI) / 180),
    };
    this.latest = state;

    if (ready !== this.ready) {
      this.ready = ready;
      this.onReadyChange?.(state);
      // Haptic on transition only. You are looking at the building, not the
      // screen, so a buzz is worth more than any amount of on-screen text.
      if (navigator.vibrate) navigator.vibrate(ready ? [30, 40, 30] : 18);
    }

    const now = performance.now();
    if (now - this.lastEmit >= this.minInterval) {
      this.lastEmit = now;
      this.onUpdate?.(state);
    }
  }

  attach() {
    this._handler = (e) => this.handleOrientation(e);
    window.addEventListener('deviceorientationabsolute', this._handler, true);
    window.addEventListener('deviceorientation', this._handler, true);
  }

  detach() {
    if (!this._handler) return;
    window.removeEventListener('deviceorientationabsolute', this._handler, true);
    window.removeEventListener('deviceorientation', this._handler, true);
    this._handler = null;
  }

  async requestPermission() {
    const Ev = window.DeviceOrientationEvent;
    if (Ev && typeof Ev.requestPermission === 'function') {
      try {
        if ((await Ev.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.attach();
    return true;
  }
}

/**
 * Draw a bullseye spirit level — the bubble metaphor from a tripod head, which
 * needs no explanation and no reading. Numbers are for the record; this is for
 * the hand.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state from LevelTracker
 * @param {object} opts {cx, cy, radius}
 */
export function drawBubbleLevel(ctx, state, { cx, cy, radius = 54 } = {}) {
  if (!state) return;

  // Degrees from centre to the rim of the vial.
  const span = 25;
  const clamp = (v) => Math.max(-span, Math.min(span, v));
  const bx = cx + (clamp(state.rollOff) / span) * radius;
  const by = cy + (clamp(state.pitchOff) / span) * radius;

  const ok = state.ready;
  const colour = ok ? '#2f9e44' : state.pitchBand.colour;

  ctx.save();

  // vial
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(5,8,12,0.55)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();

  // tolerance ring — inside this, you are good
  ctx.beginPath();
  ctx.arc(cx, cy, radius * (12 / span), 0, Math.PI * 2);
  ctx.strokeStyle = ok ? 'rgba(47,158,68,0.95)' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = ok ? 3 : 1.5;
  ctx.setLineDash(ok ? [] : [5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // the bubble
  ctx.beginPath();
  ctx.arc(bx, by, 15, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  // steadiness: a ring that tightens as the phone settles
  if (!state.steady && isFinite(state.movement)) {
    const wobble = Math.min(1, state.movement / 8);
    ctx.beginPath();
    ctx.arc(bx, by, 15 + 10 * wobble, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}
