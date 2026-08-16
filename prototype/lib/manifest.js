/**
 * manifest.js — provenance sidecar.
 *
 * Follows the ProofMode rule: the original media file is never modified. All
 * provenance lives in a separate JSON sidecar that references the original by
 * its SHA-256 digest.
 */

const SCHEMA = 'plumb-manifest/0.2';

/** SHA-256 of a Blob/ArrayBuffer, as lowercase hex. */
export async function sha256(input) {
  const buf = input instanceof Blob ? await input.arrayBuffer() : input;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Best-effort geolocation with its reported accuracy. Never used as scale. */
export function currentPosition(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        altitude: pos.coords.altitude,
        accuracy_m: pos.coords.accuracy,
        altitude_accuracy_m: pos.coords.altitudeAccuracy,
        timestamp: new Date(pos.timestamp).toISOString(),
        note: 'Positional metadata only. Not used for scale — smartphone GNSS is metre-level at best.',
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}

/**
 * Device orientation / compass. iOS requires a user-gesture permission request,
 * and reports heading via the non-standard webkitCompassHeading.
 */
export function startOrientationWatch(onUpdate) {
  let latest = null;

  const handler = (e) => {
    latest = {
      alpha: e.alpha,
      beta: e.beta,   // front-back tilt (pitch)
      gamma: e.gamma, // left-right tilt (roll)
      absolute: e.absolute ?? null,
      compass_heading: e.webkitCompassHeading ?? null,
      compass_accuracy_deg: e.webkitCompassAccuracy ?? null,
    };
    onUpdate?.(latest);
  };

  const attach = () => {
    window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation', handler, true);
  };

  const request = async () => {
    const Ev = window.DeviceOrientationEvent;
    if (Ev && typeof Ev.requestPermission === 'function') {
      try {
        const state = await Ev.requestPermission();
        if (state !== 'granted') return false;
      } catch {
        return false;
      }
    }
    attach();
    return true;
  };

  return { request, get latest() { return latest; } };
}

/** Capability probe — the evidence behind the browser-feasibility claim. */
export function browserCapabilities() {
  const constraints = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  return {
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    imageCapture: typeof window.ImageCapture !== 'undefined',
    supported_constraints: {
      zoom: !!constraints.zoom,
      torch: !!constraints.torch,
      focusDistance: !!constraints.focusDistance,
      focusMode: !!constraints.focusMode,
    },
    webxr: !!navigator.xr,
    webBluetooth: !!navigator.bluetooth,
    opfs: !!navigator.storage?.getDirectory,
    persistentStorage: !!navigator.storage?.persist,
    deviceOrientation: typeof window.DeviceOrientationEvent !== 'undefined',
    geolocation: !!navigator.geolocation,
    webgpu: !!navigator.gpu,
    crypto_subtle: !!window.crypto?.subtle,
  };
}

/**
 * Assemble the provenance sidecar.
 *
 * The `unverified` block exists to be explicit about what this artifact does NOT
 * prove. A device clock and a GNSS fix are self-reported; only a server-side
 * trusted timestamp and an identity check can raise them above that.
 */
export function buildManifest({
  imageSha256,
  imageBytes,
  imageWidth,
  imageHeight,
  sourceMode,
  capturedAt,
  subject,
  operator,
  position,
  orientation,
  device,
  calibration,
  measurements,
  overlay,
  capabilities,
  captureAttestation,
}) {
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),

    original: {
      sha256: imageSha256,
      bytes: imageBytes,
      width_px: imageWidth,
      height_px: imageHeight,
      source: sourceMode,
      modified: false,
      note: 'The original image is never re-encoded or overlaid. Overlays are separate artifacts.',
    },

    who: {
      operator_name: operator?.name || null,
      operator_org: operator?.org || null,
      credential_level: operator?.level || 'public',
      identity_verified: false,
    },

    when: {
      device_clock: capturedAt,
      device_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      trusted_timestamp: null,
    },

    where: {
      position: position || null,
      orientation: orientation || null,
      subject_identifier: subject?.identifier || null,
      subject_name: subject?.name || null,
      subject_registry: subject?.registry || null,
      elevation_face: subject?.face || null,
      operator_confirmed_subject: !!subject?.confirmed,
    },

    what: {
      device: device || null,
      app: { name: 'Plumb Prototype', version: '0.2.0' },
      browser_capabilities: capabilities || null,
    },

    /**
     * Reserved for hardware-backed capture attestation (Android Keystore /
     * StrongBox / Knox Vault) delivered by a native capture companion.
     *
     * A PWA cannot reach Android Keystore — Web Crypto keys are software-backed
     * and origin-bound, with no key attestation and no verified-boot binding. So
     * this stays null in the browser client, and the shutter-to-ingest gap is
     * covered only by the client-side SHA-256 above.
     *
     * The block exists from v1 so that adding a native attested client later is
     * purely additive: see docs/06-trust-anchor-and-licensing.md section 1.
     */
    capture_attestation: captureAttestation || {
      present: false,
      reason: 'PWA client: Android Keystore is not reachable from a browser.',
      security_level: null,          // 'TrustedEnvironment' | 'StrongBox'
      attestation_chain: null,       // X.509 chain rooted in Google attestation root
      verified_boot_state: null,
      app_identity: null,
      c2pa_assurance_target: 'Level 1 (server-signed at ingest)',
    },

    calibration: calibration || null,
    measurements: measurements || [],
    overlay: overlay || null,

    chain_of_custody: [
      { at: new Date().toISOString(), event: 'capture', detail: sourceMode },
      { at: new Date().toISOString(), event: 'manifest_created', detail: SCHEMA },
    ],

    unverified: [
      'Device clock is self-reported and can be altered; a trusted timestamp requires server ingest.',
      'Operator identity is self-asserted in this prototype.',
      'GNSS position is metre-level and is provenance only — it is never used for scale.',
      'No C2PA signature is applied client-side; signing requires a protected key held server-side.',
      'Content provenance proves pipeline integrity, not that the photographed scene is authentic.',
      'Capture is NOT hardware-attested: a browser cannot reach Android Keystore, so the interval ' +
        'between shutter and server ingest is covered only by the client-side SHA-256.',
    ],
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadJson(obj, filename) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), filename);
}
