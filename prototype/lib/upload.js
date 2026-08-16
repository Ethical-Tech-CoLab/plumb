/**
 * upload.js — upload policy and transfer gating.
 *
 * Plumb captures full-resolution stills. A single facade session can run to
 * hundreds of megabytes, so uploading over a metered cellular connection is a
 * real cost to a volunteer. Like every photo-sync app, the default is
 * **Wi-Fi only**.
 *
 * Because processing is asynchronous (see docs/05-server-and-provenance.md),
 * holding a capture back costs nothing. Nothing in the field workflow blocks on
 * upload — captures sit in the durable local queue until the policy is satisfied.
 *
 * Detection notes:
 *   - `navigator.connection.type` is the authoritative signal and is available on
 *     Android Chrome, our primary platform.
 *   - `effectiveType` / `downlink` are weaker heuristics available more widely.
 *   - `saveData` reflects the user's OS-level Data Saver preference and is always
 *     respected, whatever the policy says.
 *   - The web platform cannot detect roaming. Documented, not solved.
 */

export const UPLOAD_POLICIES = {
  'wifi-only': {
    id: 'wifi-only',
    label: 'Wi-Fi only',
    description: 'Default. Uploads only on Wi-Fi or a wired connection. Nothing is sent over cellular.',
    allowsCellular: false,
  },
  'wifi-preferred': {
    id: 'wifi-preferred',
    label: 'Wi-Fi preferred',
    description: 'Prefers Wi-Fi, but will use a fast cellular connection (4G/5G) if Wi-Fi is unavailable.',
    allowsCellular: true,
    requiresFastCellular: true,
  },
  'any-network': {
    id: 'any-network',
    label: 'Any network',
    description: 'Uploads on any connection, including slow or metered cellular. May use significant data.',
    allowsCellular: true,
  },
  'manual': {
    id: 'manual',
    label: 'Manual only',
    description: 'Never uploads automatically. You choose when to send.',
    allowsCellular: false,
    manualOnly: true,
  },
};

export const DEFAULT_POLICY = 'wifi-only';

const STORAGE_KEY = 'plumb.uploadPolicy';
const UNKNOWN_KEY = 'plumb.treatUnknownAsUnmetered';

/** Read the current connection, normalising across browsers. */
export function connectionInfo() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;

  if (!c) {
    return {
      supported: false,
      type: 'unknown',
      effectiveType: null,
      saveData: false,
      downlinkMbps: null,
      metered: null,
      online: navigator.onLine,
    };
  }

  const type = c.type ?? 'unknown';
  // `type` is authoritative where present; otherwise we genuinely do not know.
  let metered = null;
  if (type === 'cellular') metered = true;
  else if (type === 'wifi' || type === 'ethernet') metered = false;

  return {
    supported: true,
    type,
    effectiveType: c.effectiveType ?? null,
    saveData: !!c.saveData,
    downlinkMbps: c.downlink ?? null,
    metered,
    online: navigator.onLine,
  };
}

export function getPolicy() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && UPLOAD_POLICIES[stored]) return UPLOAD_POLICIES[stored];
  } catch { /* storage blocked */ }
  return UPLOAD_POLICIES[DEFAULT_POLICY];
}

export function setPolicy(id) {
  if (!UPLOAD_POLICIES[id]) return null;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch { /* ignore */ }
  return UPLOAD_POLICIES[id];
}

/**
 * On desktop and iOS, `connection.type` is often unavailable. Rather than
 * stranding uploads forever, the user can declare that an unknown connection
 * should be treated as unmetered. Off by default — Wi-Fi only means Wi-Fi only
 * unless you say otherwise.
 */
export function getTreatUnknownAsUnmetered() {
  try {
    return localStorage.getItem(UNKNOWN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTreatUnknownAsUnmetered(value) {
  try {
    localStorage.setItem(UNKNOWN_KEY, String(!!value));
  } catch { /* ignore */ }
  return !!value;
}

/**
 * Decide whether uploading is allowed right now.
 * @returns {{allowed:boolean, reason:string, waiting:boolean, conn:object, policy:object}}
 */
export function canUploadNow({ policy = getPolicy(), conn = connectionInfo(), override = false } = {}) {
  const base = { conn, policy };

  if (!conn.online) {
    return { ...base, allowed: false, waiting: true, reason: 'Offline — captures are held in the local queue.' };
  }

  // A one-shot user override beats policy, but never beats Data Saver silently.
  if (override) {
    return { ...base, allowed: true, waiting: false, reason: 'Uploading now — one-time override for this session.' };
  }

  if (conn.saveData) {
    return {
      ...base,
      allowed: false,
      waiting: true,
      reason: 'Data Saver is on in your OS settings — holding uploads. Override to send anyway.',
    };
  }

  if (policy.manualOnly) {
    return { ...base, allowed: false, waiting: true, reason: 'Manual mode — uploads start only when you say so.' };
  }

  if (policy.id === 'any-network') {
    return { ...base, allowed: true, waiting: false, reason: 'Any network allowed.' };
  }

  // Unmetered connection confirmed.
  if (conn.metered === false) {
    return { ...base, allowed: true, waiting: false, reason: `On ${conn.type} — uploading.` };
  }

  // Confirmed cellular.
  if (conn.metered === true) {
    if (!policy.allowsCellular) {
      return {
        ...base,
        allowed: false,
        waiting: true,
        reason: 'On cellular — holding uploads until you reach Wi-Fi. Nothing is lost.',
      };
    }
    if (policy.requiresFastCellular && !['4g', '5g'].includes(conn.effectiveType)) {
      return {
        ...base,
        allowed: false,
        waiting: true,
        reason: `Cellular connection is ${conn.effectiveType || 'slow'} — waiting for a faster network.`,
      };
    }
    return { ...base, allowed: true, waiting: false, reason: 'On fast cellular — uploading.' };
  }

  // Connection type genuinely unknown.
  if (getTreatUnknownAsUnmetered()) {
    return { ...base, allowed: true, waiting: false, reason: 'Network type unknown, treated as unmetered by your setting.' };
  }
  return {
    ...base,
    allowed: false,
    waiting: true,
    reason: 'Cannot confirm this is Wi-Fi, so uploads are held. Change this in upload settings, or override once.',
  };
}

/** Human-readable size, for showing what is queued. */
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Watch for connection changes so a queue can drain the moment Wi-Fi appears.
 * Returns an unsubscribe function.
 */
export function watchConnection(onChange) {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const emit = () => onChange(canUploadNow());

  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  c?.addEventListener?.('change', emit);

  emit();

  return () => {
    window.removeEventListener('online', emit);
    window.removeEventListener('offline', emit);
    c?.removeEventListener?.('change', emit);
  };
}

/** What the provenance sidecar records about how this capture was transferred. */
export function uploadProvenance(decision = canUploadNow()) {
  return {
    policy: decision.policy.id,
    network_type: decision.conn.type,
    effective_type: decision.conn.effectiveType,
    save_data: decision.conn.saveData,
    uploaded_over_metered: decision.conn.metered === true && decision.allowed,
    note: 'Web platform cannot detect roaming; a Wi-Fi connection may still be a paid hotspot.',
  };
}
