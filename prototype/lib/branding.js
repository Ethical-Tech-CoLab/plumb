/**
 * branding.js — optional Ethical Tech CoLab branding.
 *
 * Plumb ships with neutral standalone branding by default so it can be deployed
 * by a landmarks commission, a university, or a private practice without implying
 * an endorsement. Ethical Tech CoLab branding is opt-in.
 *
 * Selection order (first match wins):
 *   1. ?brand=etc | ?brand=plumb   — URL parameter, useful for deep links and demos
 *   2. localStorage 'plumb.brand'  — sticky user/deployment choice
 *   3. window.PLUMB_BRAND          — set by a host page for a fixed deployment
 *   4. 'plumb'                     — default
 */

export const BRANDS = {
  plumb: {
    id: 'plumb',
    name: 'Plumb',
    tagline: 'measured photography for landmarks',
    org: null,
    orgUrl: null,
    accent: '#00e5ff',
    credit: null,
  },
  etc: {
    id: 'etc',
    name: 'Plumb',
    tagline: 'measured photography for landmarks',
    org: 'Ethical Tech CoLab',
    orgUrl: 'https://github.com/Ethical-Tech-CoLab',
    accent: '#7c5cff',
    credit: 'An Ethical Tech CoLab project — open tools for verifiable public record.',
  },
};

const STORAGE_KEY = 'plumb.brand';

export function resolveBrand() {
  const fromUrl = new URLSearchParams(location.search).get('brand');
  if (fromUrl && BRANDS[fromUrl]) return BRANDS[fromUrl];

  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch { /* storage may be blocked */ }
  if (stored && BRANDS[stored]) return BRANDS[stored];

  if (window.PLUMB_BRAND && BRANDS[window.PLUMB_BRAND]) return BRANDS[window.PLUMB_BRAND];
  return BRANDS.plumb;
}

export function setBrand(id) {
  if (!BRANDS[id]) return null;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch { /* ignore */ }
  applyBrand(BRANDS[id]);
  return BRANDS[id];
}

/** Apply a brand to the document. Purely presentational — no behaviour changes. */
export function applyBrand(brand) {
  document.documentElement.style.setProperty('--accent', brand.accent);
  document.title = brand.org
    ? `${brand.name} — ${brand.tagline} · ${brand.org}`
    : `${brand.name} — ${brand.tagline}`;

  const nameEl = document.querySelector('.brand strong');
  const subEl = document.querySelector('.brand .sub');
  if (nameEl) nameEl.textContent = brand.name;
  if (subEl) subEl.textContent = brand.tagline;

  const orgEl = document.getElementById('brandOrg');
  if (orgEl) {
    if (brand.org) {
      orgEl.textContent = brand.org;
      orgEl.href = brand.orgUrl;
      orgEl.classList.remove('hidden');
    } else {
      orgEl.classList.add('hidden');
    }
  }

  const creditEl = document.getElementById('brandCredit');
  if (creditEl) {
    creditEl.textContent = brand.credit || '';
    creditEl.classList.toggle('hidden', !brand.credit);
  }

  const toggle = document.getElementById('brandToggle');
  if (toggle) {
    toggle.textContent = brand.org ? 'ETC' : 'Plumb';
    toggle.title = brand.org
      ? 'Branding: Ethical Tech CoLab — click for standalone'
      : 'Branding: standalone — click for Ethical Tech CoLab';
    toggle.setAttribute('aria-pressed', String(!!brand.org));
  }

  document.body.dataset.brand = brand.id;
  return brand;
}

/** Attribution recorded in the provenance sidecar, so exports say who published them. */
export function brandProvenance(brand) {
  return {
    application: brand.name,
    deployment_brand: brand.id,
    publisher: brand.org || null,
    publisher_url: brand.orgUrl || null,
  };
}

export function initBranding() {
  const brand = applyBrand(resolveBrand());
  const toggle = document.getElementById('brandToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = document.body.dataset.brand === 'etc' ? 'plumb' : 'etc';
      setBrand(next);
    });
  }
  return brand;
}
