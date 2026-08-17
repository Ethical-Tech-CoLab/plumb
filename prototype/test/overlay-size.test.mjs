/**
 * Tests for overlay canvas sizing.
 *
 * Written after a field report: "I don't see the grid on screen when turning it
 * on or off; I see it is in the photo though."
 *
 * Cause: the overlay canvas only ever received a backing-store size inside
 * adoptImage(), i.e. once a photo had been captured. During live preview it sat
 * at the HTML default of 300x150. Because .stage canvas is laid out with
 * `inset: 0; margin: auto; max-width: 100%; max-height: 100%`, a 300x150 canvas
 * is centred at its intrinsic size rather than stretched, so the grid was drawn
 * into a small box floating in the middle of the stage — misaligned with the
 * video and easy to miss entirely against a bright scene.
 *
 * Run: node --test prototype/test/overlay-size.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { overlayTargetSize } from '../lib/overlay.js';

test('adopts the live video dimensions instead of the 300x150 canvas default', () => {
  const next = overlayTargetSize({
    sourceWidth: 1920,
    sourceHeight: 1080,
    currentWidth: 300,   // the HTML default that caused the bug
    currentHeight: 150,
  });
  assert.deepEqual(next, { width: 1920, height: 1080 });
});

test('returns null when already the right size, so the canvas is not cleared', () => {
  // Assigning canvas.width wipes the canvas even when the value is unchanged.
  // Resizing on every frame would erase the overlay as fast as it was drawn.
  const next = overlayTargetSize({
    sourceWidth: 1920,
    sourceHeight: 1080,
    currentWidth: 1920,
    currentHeight: 1080,
  });
  assert.equal(next, null);
});

test('returns null before the video reports its dimensions', () => {
  // videoWidth/videoHeight are 0 until loadedmetadata; sizing to 0 would give a
  // zero-area canvas and render() would draw nothing at all.
  assert.equal(overlayTargetSize({ sourceWidth: 0, sourceHeight: 0 }), null);
  assert.equal(overlayTargetSize({ sourceWidth: 1920, sourceHeight: 0 }), null);
  assert.equal(overlayTargetSize({ sourceWidth: 0, sourceHeight: 1080 }), null);
});

test('resizes when the camera switches to a different resolution', () => {
  // Switching between the wide and main lens changes videoWidth/videoHeight
  // with no other event; a stale overlay silently stops matching the picture.
  const next = overlayTargetSize({
    sourceWidth: 4032,
    sourceHeight: 3024,
    currentWidth: 1920,
    currentHeight: 1080,
  });
  assert.deepEqual(next, { width: 4032, height: 3024 });
});

test('handles a portrait stream, where width and height swap', () => {
  const next = overlayTargetSize({
    sourceWidth: 1080,
    sourceHeight: 1920,
    currentWidth: 1920,
    currentHeight: 1080,
  });
  assert.deepEqual(next, { width: 1080, height: 1920 });
});

test('an unchanged aspect ratio at a new size still resizes', () => {
  // 1280x720 and 1920x1080 share an aspect ratio. Comparing ratios rather than
  // dimensions would leave the overlay at the wrong pixel scale, quietly
  // changing every line width, tick length and label size on the grid.
  const next = overlayTargetSize({
    sourceWidth: 1280,
    sourceHeight: 720,
    currentWidth: 1920,
    currentHeight: 1080,
  });
  assert.deepEqual(next, { width: 1280, height: 720 });
});

test('defaults are safe when called with no arguments', () => {
  assert.equal(overlayTargetSize(), null);
});
