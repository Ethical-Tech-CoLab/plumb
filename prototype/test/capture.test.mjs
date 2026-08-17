/**
 * Tests for the capture path.
 *
 * Written after a field report of a blank screen during auto-capture, plus
 * auto-capture firing repeatedly. Three compounding causes, each covered here:
 *
 *   1. takePhoto() asked for the maximum advertised photo size with no
 *      fallback. Several Android devices reject that or return an empty frame.
 *   2. No re-entrancy guard, so a second takePhoto() could start while one was
 *      in flight (InvalidStateError on Android).
 *   3. adoptImage() trusted whatever it was handed. An empty blob produced a
 *      0x0 canvas AND hid the live preview — the blank screen, with no error
 *      surfaced anywhere.
 *
 * Run: node --test prototype/test/capture.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CameraController, detectPlatform } from '../lib/camera.js';

/** Minimal ImageCapture stand-in with scriptable behaviour. */
function fakeImageCapture({ failOnSettings = false, emptyOnSettings = false, delayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async takePhoto(settings) {
      calls.push(settings);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const constrained = settings && ('imageWidth' in settings || 'imageHeight' in settings);
      if (constrained && failOnSettings) throw new Error('NotSupportedError');
      if (constrained && emptyOnSettings) return { size: 0 };
      return { size: 2_000_000 };
    },
  };
}

function controllerWith(imageCapture, photoCapabilities = { imageWidth: { max: 4080 }, imageHeight: { max: 3072 }, fillLightMode: ['off', 'auto'] }) {
  const c = new CameraController();
  c.imageCapture = imageCapture;
  c.photoCapabilities = photoCapabilities;
  return c;
}

// ------------------------------------------------------------ fallbacks

test('falls back to a plain takePhoto when max-size settings are rejected', async () => {
  const ic = fakeImageCapture({ failOnSettings: true });
  const cam = controllerWith(ic);

  const blob = await cam.takePhoto();
  assert.ok(blob.size > 1024, 'still returns a usable image');
  assert.ok(ic.calls.length > 1, 'more than one strategy attempted');
  assert.ok('imageWidth' in (ic.calls[0] ?? {}), 'first attempt asks for full resolution');
});

test('an empty frame from the constrained call is not accepted as success', async () => {
  // This is the blank-screen bug at its source: a 0-byte blob used to sail
  // straight through to the canvas.
  const ic = fakeImageCapture({ emptyOnSettings: true });
  const cam = controllerWith(ic);

  const blob = await cam.takePhoto();
  assert.ok(blob.size > 1024, 'rejects the empty frame and retries');
  assert.ok(ic.calls.length > 1);
});

test('throws with a useful message when every strategy fails', async () => {
  const cam = controllerWith({
    async takePhoto() { throw new Error('camera busy'); },
  });
  await assert.rejects(() => cam.takePhoto(), /camera busy/);
});

test('an all-empty camera surfaces an error rather than an empty blob', async () => {
  const cam = controllerWith({ async takePhoto() { return { size: 0 }; } });
  await assert.rejects(() => cam.takePhoto(), /empty image/i);
});

test('takePhoto without ImageCapture fails clearly', async () => {
  const cam = new CameraController();
  await assert.rejects(() => cam.takePhoto(), /not available/i);
});

// ------------------------------------------------------- re-entrancy guard

test('a second capture is refused while one is in flight', async () => {
  const ic = fakeImageCapture({ delayMs: 40 });
  const cam = controllerWith(ic);

  const first = cam.takePhoto();
  assert.equal(cam.isCapturing, true, 'flag is set during flight');
  await assert.rejects(() => cam.takePhoto(), /already in progress/i);

  await first;
  assert.equal(cam.isCapturing, false, 'flag clears afterwards');
});

test('the in-flight flag clears even when the capture fails', async () => {
  const cam = controllerWith({ async takePhoto() { throw new Error('boom'); } });
  await assert.rejects(() => cam.takePhoto());
  assert.equal(cam.isCapturing, false, 'must not latch on and block all future captures');
});

test('captures can be taken back to back once the first completes', async () => {
  const ic = fakeImageCapture();
  const cam = controllerWith(ic);
  await cam.takePhoto();
  await cam.takePhoto();
  await cam.takePhoto();
  assert.equal(cam.isCapturing, false);
});

// ------------------------------------------------------- capture profile

test('capture profile records what invalidates a lens calibration', () => {
  const cam = new CameraController();
  cam.track = {
    getSettings: () => ({ zoom: 2, focusMode: 'continuous', width: 1920, height: 1080 }),
    getCapabilities: () => ({}),
  };
  const p = cam.captureProfile();
  assert.equal(p.zoom, 2);
  assert.equal(p.optics_locked, false);
  assert.equal(p.lens_profile_valid, false, 'zoom != 1 and unlocked optics must invalidate');

  cam.opticsLocked = true;
  cam.track.getSettings = () => ({ zoom: 1, focusMode: 'manual' });
  assert.equal(cam.captureProfile().lens_profile_valid, true);
});

// ------------------------------------------------------------- platform

test('platform detection distinguishes capability tiers', () => {
  const p = detectPlatform();
  assert.ok(['primary', 'reduced'].includes(p.tier));
  assert.equal(typeof p.label, 'string');
  assert.ok(p.label.length > 0);
});
