/**
 * camera.js — Android-first capture.
 *
 * Android Chrome is the reference platform. It exposes ImageCapture, photo
 * capabilities, and constrainable optics (zoom / torch / focus / exposure), so
 * the primary capture path takes a full sensor-resolution still in-page and can
 * LOCK the optics for the session.
 *
 * Locking matters for metrology, not just image quality: a fixed focus and zoom
 * keeps the camera's intrinsic parameters constant, which is what makes a stored
 * CAL-4 lens profile valid across every frame in the session. Autofocus silently
 * changes the effective focal length between shots.
 *
 * iOS Safari implements none of this. It is handled as a reduced-capability
 * client via the native-camera file input, and its limits do not constrain the
 * Android design.
 */

export function detectPlatform() {
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const hasImageCapture = typeof window.ImageCapture !== 'undefined';

  let tier;
  let label;
  if (isAndroid && hasImageCapture) {
    tier = 'primary';
    label = 'Android · full capability (reference platform)';
  } else if (hasImageCapture) {
    tier = 'primary';
    label = 'Desktop Chromium · full capability';
  } else if (isIOS) {
    tier = 'reduced';
    label = 'iOS Safari · reduced capability — native-camera capture only';
  } else {
    tier = 'reduced';
    label = 'Reduced capability browser';
  }

  return { isAndroid, isIOS, hasImageCapture, tier, label };
}

export class CameraController {
  constructor() {
    this.stream = null;
    this.track = null;
    this.imageCapture = null;
    this.photoCapabilities = null;
    this.opticsLocked = false;
  }

  get capabilities() {
    return this.track?.getCapabilities?.() ?? {};
  }

  get settings() {
    return this.track?.getSettings?.() ?? {};
  }

  async start({ width = 4096, height = 3072 } = {}) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: width },
        height: { ideal: height },
        // Ask for the sharpest, least-processed stream we can get.
        resizeMode: 'none',
      },
      audio: false,
    });

    this.track = this.stream.getVideoTracks()[0];

    if (typeof window.ImageCapture !== 'undefined') {
      this.imageCapture = new ImageCapture(this.track);
      try {
        this.photoCapabilities = await this.imageCapture.getPhotoCapabilities();
      } catch {
        this.photoCapabilities = null;
      }
    }

    return this.stream;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.imageCapture = null;
    this.photoCapabilities = null;
    this.opticsLocked = false;
  }

  /**
   * Full sensor-resolution still. This is the archival capture path on Android:
   * it does not go through the video pipeline, so it is not limited to the
   * preview stream's resolution.
   */
  async takePhoto() {
    if (!this.imageCapture) throw new Error('ImageCapture is not available on this browser.');

    const settings = {};
    const caps = this.photoCapabilities;
    if (caps?.imageWidth?.max) settings.imageWidth = caps.imageWidth.max;
    if (caps?.imageHeight?.max) settings.imageHeight = caps.imageHeight.max;
    if (caps?.fillLightMode?.includes('off')) settings.fillLightMode = 'off';

    return this.imageCapture.takePhoto(settings);
  }

  /** Grab a preview frame. Lower resolution — framing and overlay work only. */
  async grabFrame() {
    if (this.imageCapture) return this.imageCapture.grabFrame();
    throw new Error('grabFrame is not available on this browser.');
  }

  supports(name) {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
    return !!supported[name] && name in this.capabilities;
  }

  async setTorch(on) {
    if (!this.supports('torch')) throw new Error('Torch is not supported here.');
    await this.track.applyConstraints({ advanced: [{ torch: !!on }] });
    return this.settings.torch;
  }

  async setZoom(value) {
    if (!this.supports('zoom')) throw new Error('Zoom is not supported here.');
    await this.track.applyConstraints({ advanced: [{ zoom: value }] });
    return this.settings.zoom;
  }

  /**
   * Lock focus, exposure and white balance so the intrinsics stay constant.
   * Returns which locks actually took effect — never claims more than it achieved.
   */
  async lockOptics() {
    const caps = this.capabilities;
    const applied = {};
    const advanced = [];

    if (caps.focusMode?.includes('manual')) {
      advanced.push({ focusMode: 'manual' });
      applied.focusMode = 'manual';
    } else if (caps.focusMode?.includes('single-shot')) {
      advanced.push({ focusMode: 'single-shot' });
      applied.focusMode = 'single-shot';
    }

    if (caps.exposureMode?.includes('manual')) {
      advanced.push({ exposureMode: 'manual' });
      applied.exposureMode = 'manual';
    }

    if (caps.whiteBalanceMode?.includes('manual')) {
      advanced.push({ whiteBalanceMode: 'manual' });
      applied.whiteBalanceMode = 'manual';
    }

    if (!advanced.length) {
      this.opticsLocked = false;
      return { locked: false, applied, reason: 'No lockable optics exposed by this browser/device.' };
    }

    await this.track.applyConstraints({ advanced });
    this.opticsLocked = true;
    return { locked: true, applied, settings: this.settings };
  }

  /**
   * The capture profile written into the provenance sidecar. Zoom != 1 or
   * unlocked focus invalidates a stored CAL-4 lens profile, so it is recorded.
   */
  captureProfile() {
    const s = this.settings;
    return {
      device_id: s.deviceId ?? null,
      preview_width: s.width ?? null,
      preview_height: s.height ?? null,
      zoom: s.zoom ?? 1,
      focus_mode: s.focusMode ?? null,
      focus_distance: s.focusDistance ?? null,
      exposure_mode: s.exposureMode ?? null,
      white_balance_mode: s.whiteBalanceMode ?? null,
      torch: s.torch ?? null,
      optics_locked: this.opticsLocked,
      photo_max_width: this.photoCapabilities?.imageWidth?.max ?? null,
      photo_max_height: this.photoCapabilities?.imageHeight?.max ?? null,
      lens_profile_valid: this.opticsLocked && (s.zoom ?? 1) === 1,
    };
  }
}
