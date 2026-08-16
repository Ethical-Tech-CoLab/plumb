/**
 * Tests for the levelling / capture-readiness logic.
 *
 * These exist because the original implementation failed in the field: a hard
 * 3-degree gate that was almost impossible to satisfy handheld, driven by a raw
 * 60 Hz sensor feed that made the on-screen numbers unreadable.
 *
 * Run: node --test prototype/test/level.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LevelTracker,
  PITCH_BANDS,
  ROLL_BANDS,
  SUBJECT_MODES,
  drawBubbleLevel,
} from '../lib/level.js';

/** Feed a steady pose until the smoothing filters settle. */
function settle(tracker, beta, gamma = 0, n = 60) {
  let last = null;
  const onUpdate = tracker.onUpdate;
  tracker.onUpdate = (s) => { last = s; onUpdate?.(s); };
  for (let i = 0; i < n; i++) tracker.handleOrientation({ beta, gamma, alpha: 0 });
  tracker.onUpdate = onUpdate;
  return last;
}

function makeTracker(opts = {}) {
  return new LevelTracker({ onUpdate: () => {}, uiHz: 100000, ...opts });
}

// ------------------------------------------------------- tolerance policy

test('pitch tolerance is generous enough to be met handheld', () => {
  const t = makeTracker({ mode: 'wall' });

  // Dead level for a wall is beta = 90.
  assert.equal(settle(t, 90).ready, true, 'level must be ready');
  assert.equal(settle(t, 85).ready, true, '5 deg off must be ready');
  assert.equal(settle(t, 80).ready, true, '10 deg off must be ready');

  // The old gate rejected everything past 3 degrees. Prove we no longer do.
  assert.equal(settle(t, 87).ready, true, '3 deg off — the old hard limit');
  assert.equal(settle(t, 86).ready, true, '4 deg off — old code refused this');
});

test('pitch is still refused when foreshortening genuinely bites', () => {
  const t = makeTracker({ mode: 'wall' });
  settle(t, 90);
  assert.equal(settle(t, 65).ready, false, '25 deg off should not be ready');
  assert.equal(settle(t, 50).ready, false, '40 deg off should not be ready');
});

test('roll never blocks capture — it has no metrological cost', () => {
  const t = makeTracker({ mode: 'wall' });
  // 40 degrees of roll is visually dramatic and geometrically irrelevant:
  // rolling the camera just rotates the image, the plane geometry is unchanged.
  const s = settle(t, 90, 40);
  assert.equal(s.ready, true, 'heavy roll must not block a level-pitch capture');
  assert.ok(Math.abs(s.rollOff) > 30, 'roll should still be reported');
  assert.equal(s.rollBand.grade, 'poor', 'and still flagged as cosmetically poor');
});

test('band grading is graded, not binary', () => {
  const grades = PITCH_BANDS.map((b) => b.grade);
  assert.deepEqual(grades, ['excellent', 'good', 'fair', 'poor', 'bad']);
  assert.ok(ROLL_BANDS.length >= 3);
  // Roll's tightest band is looser than pitch's, reflecting that it matters less.
  assert.ok(ROLL_BANDS[1].max >= 10);
});

test('reported precision penalty matches the cos law', () => {
  const t = makeTracker({ mode: 'wall' });
  const s = settle(t, 70); // 20 degrees off
  const expected = 1 / Math.cos((20 * Math.PI) / 180);
  assert.ok(Math.abs(s.precisionPenalty - expected) < 0.02,
    `penalty ${s.precisionPenalty} should be ~${expected.toFixed(3)}`);
  // And it should be a small number — that is the whole argument for relaxing.
  assert.ok(s.precisionPenalty < 1.07, '20 deg costs under 7% of corner precision');
});

// ------------------------------------------------------------ hysteresis

test('readiness has hysteresis so it cannot flicker on the boundary', () => {
  const t = makeTracker({ mode: 'wall' });

  // Drift SLOWLY out to 14 deg off. A gradual drift stays steady throughout,
  // so hysteresis is what decides: having been ready, we hold on out to 18.
  settle(t, 90);
  assert.equal(t.latest.ready, true, 'precondition: ready at level');
  for (let beta = 90; beta >= 76; beta -= 0.5) settle(t, beta, 0, 6);
  const fromInside = t.latest;

  // Now approach the same pose from well outside. Having lost readiness, we
  // must get properly inside 12 deg before it returns.
  settle(t, 50, 0, 60);
  assert.equal(t.latest.ready, false, 'precondition: not ready at 40 deg off');
  for (let beta = 50; beta <= 76; beta += 0.5) settle(t, beta, 0, 6);
  const fromOutside = t.latest;

  assert.ok(Math.abs(fromInside.pitchOff + 14) < 1.5, 'both end at ~14 deg off');
  assert.ok(Math.abs(fromOutside.pitchOff + 14) < 1.5, 'both end at ~14 deg off');

  assert.equal(fromInside.ready, true, 'stays ready when drifting out slowly');
  assert.equal(fromOutside.ready, false, 'does not latch on until well inside');
});

test('a sudden lurch drops readiness even if it lands inside tolerance', () => {
  // This is deliberate, and it is why the hysteresis test above has to drift:
  // a fast movement is unsteady, and an unsteady phone is never capture-ready
  // no matter how good its angle happens to be at that instant.
  const t = makeTracker({ mode: 'wall' });
  settle(t, 90);
  assert.equal(t.latest.ready, true);

  for (let i = 0; i < 8; i++) t.handleOrientation({ beta: 78, gamma: 0, alpha: 0 });
  assert.equal(t.latest.steady, false, 'the lurch reads as movement');
  assert.equal(t.latest.ready, false, 'so capture is not armed mid-movement');
});

test('onReadyChange fires only on transitions, not every frame', () => {
  let transitions = 0;
  const t = makeTracker({ mode: 'wall', onReadyChange: () => { transitions += 1; } });

  settle(t, 90, 0, 60);   // -> ready (1)
  settle(t, 90, 0, 60);   // still ready, no further events
  assert.equal(transitions, 1, 'no repeat events while state is unchanged');

  settle(t, 50, 0, 60);   // -> not ready (2)
  assert.equal(transitions, 2);
});

// -------------------------------------------------------------- smoothing

test('sensor jitter is smoothed and dead-banded out of the readout', () => {
  const seen = [];
  const t = new LevelTracker({ onUpdate: (s) => seen.push(s.pitchOff), uiHz: 100000 });

  // Settle first, then inject +/-0.6 deg of noise around level.
  settle(t, 90, 0, 60);
  seen.length = 0;
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 120; i++) {
    t.handleOrientation({ beta: 90 + (rand() - 0.5) * 1.2, gamma: 0, alpha: 0 });
  }

  const spread = Math.max(...seen) - Math.min(...seen);
  assert.ok(spread < 0.6,
    `reported spread ${spread.toFixed(3)} deg should be well under the 1.2 deg input noise`);
});

test('UI updates are throttled', () => {
  let calls = 0;
  const t = new LevelTracker({ onUpdate: () => { calls += 1; }, uiHz: 8 });
  // 200 sensor events arriving back-to-back within one tick.
  for (let i = 0; i < 200; i++) t.handleOrientation({ beta: 90, gamma: 0, alpha: 0 });
  assert.ok(calls < 200, 'must not repaint once per sensor event');
  assert.ok(calls <= 3, `expected heavy throttling, got ${calls} paints from 200 events`);
});

// ------------------------------------------------------------ subject modes

test('ground mode levels against pointing down, not up', () => {
  const t = makeTracker({ mode: 'ground' });
  assert.equal(SUBJECT_MODES.ground.idealPitch, 0);
  assert.equal(settle(t, 0).ready, true, 'flat down is level for ground');
  assert.equal(settle(t, 90).ready, false, 'upright is wrong for ground');
});

test('free mode disables the pitch gate but still requires steadiness', () => {
  const t = makeTracker({ mode: 'free' });
  assert.equal(SUBJECT_MODES.free.idealPitch, null);
  assert.equal(settle(t, 37).ready, true, 'any angle accepted');

  // Wild movement should still not report ready.
  for (let i = 0; i < 20; i++) t.handleOrientation({ beta: i * 9, gamma: 0, alpha: 0 });
  assert.equal(t.latest.steady, false, 'movement must still be detected');
  assert.equal(t.latest.ready, false, 'free mode still needs a steady hand');
});

test('setMode resets the filters so the old pose does not bleed through', () => {
  const t = makeTracker({ mode: 'wall' });
  settle(t, 90);
  t.setMode('ground');
  assert.equal(t.mode.id, 'ground');
  assert.equal(t.pitch.value, null, 'smoothing state cleared');
});

// ------------------------------------------------------------- steadiness

test('movement is detected and blocks readiness even when level', () => {
  const t = makeTracker({ mode: 'wall' });
  // Oscillate around level: pitch is fine, but the phone is clearly moving.
  for (let i = 0; i < 30; i++) {
    t.handleOrientation({ beta: 90 + (i % 2 ? 7 : -7), gamma: 0, alpha: 0 });
  }
  assert.equal(t.latest.steady, false, 'oscillation must read as unsteady');
  assert.equal(t.latest.ready, false, 'unsteady must not be capture-ready');
});

// --------------------------------------------------------------- rendering

test('drawBubbleLevel renders without touching the DOM API surface it lacks', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_, prop) {
      if (prop === 'canvas') return { width: 400, height: 400 };
      return (...args) => { calls.push(prop); return undefined; };
    },
    set() { return true; },
  });

  const t = makeTracker({ mode: 'wall' });
  const state = settle(t, 82, 6);
  drawBubbleLevel(ctx, state, { cx: 200, cy: 200, radius: 50 });

  assert.ok(calls.includes('arc'), 'draws the vial and bubble');
  assert.ok(calls.includes('save') && calls.includes('restore'), 'restores context state');
});

test('drawBubbleLevel is a no-op without state rather than throwing', () => {
  assert.doesNotThrow(() => drawBubbleLevel({}, null, { cx: 0, cy: 0 }));
});
