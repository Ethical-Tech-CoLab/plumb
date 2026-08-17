/**
 * Layout probe for the Plumb client, driven over the Chrome DevTools Protocol.
 *
 * The editor's browser tooling kept dropping its connection mid-session, and
 * its screenshot tool captured an unrelated window, so this drives a headless
 * Chrome directly instead. No dependencies: Node 22+ ships a global WebSocket.
 *
 * It checks the things that are only observable once the CSS has actually been
 * laid out, and that unit tests therefore cannot reach:
 *   - the control tray stays on screen and hittable at every sheet position
 *   - no viewport can strand content in an unscrollable page
 *   - the grid overlay is sized to, and registered with, the live preview
 *
 * Usage: node tools/layout-probe.mjs [url]     (serves prototype/ if no url)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const CHROME = process.env.CHROME_PATH ?? CANDIDATES.find((p) => existsSync(p));
if (!CHROME) throw new Error('No Chrome, Chromium or Edge binary found. Set CHROME_PATH.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Serve the client ourselves. ES modules are blocked over file://, so a server
 * is required, and starting our own keeps the probe a single command with no
 * setup step to forget.
 */
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'prototype');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
  const file = join(ROOT, rel === '' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = process.argv[2] ?? `http://127.0.0.1:${server.address().port}/index.html`;

const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'plumb-probe-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--no-sandbox', '--disable-dev-shm-usage',   // required on CI runners
  'about:blank',
], { stdio: 'ignore' });

async function debuggerUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (!msg.id || !c.pending.has(msg.id)) return;
      const { res, rej } = c.pending.get(msg.id);
      c.pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
    return r.result.value;
  }
}

const LAYOUT_PROBE = String.raw`(() => {
  const de = document.documentElement;
  const q = (s) => document.querySelector(s);
  const box = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect();
    return Math.round(b.left) + ',' + Math.round(b.top) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height); };

  const y0 = scrollY; window.scrollTo(0, 99999); const maxY = Math.round(scrollY); window.scrollTo(0, y0);
  const tray = q('.tray').getBoundingClientRect();

  const hit = (el) => { const b = el.getBoundingClientRect();
    const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!(t && t.closest('#tray')); };

  const panel = q('#panel');
  const snapHits = {};
  for (const s of ['peek', 'half', 'full']) {
    panel.dataset.snap = s; panel.getBoundingClientRect();
    snapHits[s] = ['btnShutter','btnTrayGrid','btnTrayLevel','btnTrayLive','btnTraySheet'].every((id) => hit(document.getElementById(id)));
  }
  panel.dataset.snap = 'peek';

  return {
    vp: innerWidth + 'x' + innerHeight,
    trayPosition: getComputedStyle(q('.tray')).position,
    stage: box('.stage-wrap'), tray: box('.tray'), panel: box('#panel'),
    trayReachable: (tray.bottom <= innerHeight + 1) || (maxY + innerHeight >= tray.bottom - 1),
    trayButtonsHittable: snapHits,
    maxScrollY: maxY,
    sideScrollPx: Math.max(0, de.scrollWidth - innerWidth),
    hudOnViewfinder: !!q('#stage #hud'),
    poseReadoutInSheet: !!(q('#poseReadout') && q('#poseReadout').closest('#panel')),
    gridToolsInSheet: !!(q('.overlay-tools') && q('.overlay-tools').closest('#panel')),
  };
})()`;

const GRID_PROBE = String.raw`(async () => {
  const v = document.getElementById('video'), oc = document.getElementById('overlayCanvas');
  const before = oc.width + 'x' + oc.height;

  // A real MediaStream, so the <video> gets a genuine intrinsic size and the
  // browser applies the same max-width/max-height clamp to video and canvas.
  const src = document.createElement('canvas'); src.width = 1920; src.height = 1080;
  const c = src.getContext('2d'); c.fillStyle = '#345'; c.fillRect(0, 0, 1920, 1080);
  v.srcObject = src.captureStream(10); v.classList.remove('hidden');
  await v.play().catch(() => {});
  await new Promise((r) => v.videoWidth ? r() : v.addEventListener('loadedmetadata', r, { once: true }));
  await new Promise((r) => requestAnimationFrame(r));

  document.getElementById('btnTrayGrid').click();
  await new Promise((r) => requestAnimationFrame(r));

  const d = oc.getContext('2d').getImageData(0, 0, oc.width, oc.height).data;
  let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
  const vb = v.getBoundingClientRect(), ob = oc.getBoundingClientRect();
  return {
    overlayBefore: before,
    overlayAfter: oc.width + 'x' + oc.height,
    gridLabel: document.getElementById('trayGridLab').textContent,
    litPixels: lit,
    registeredWithVideo: Math.abs(vb.left - ob.left) < 1 && Math.abs(vb.top - ob.top) < 1
      && Math.abs(vb.width - ob.width) < 1 && Math.abs(vb.height - ob.height) < 1,
  };
})()`;

let failures = 0;
const expect = (name, ok) => { if (!ok) { failures++; console.log(`  FAIL  ${name}`); } };

try {
  const cdp = await Cdp.connect(await debuggerUrl());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const sizes = [
    ['desktop 1280x900', 1280, 900],
    ['small window 800x900', 800, 900],
    ['phone landscape 844x390', 844, 390],
    ['phone portrait 390x844', 390, 844],
  ];

  const results = {};
  for (const [label, width, height] of sizes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(900);
    const r = await cdp.eval(LAYOUT_PROBE);
    results[label] = r;
    expect(`${label}: tray reachable`, r.trayReachable);
    expect(`${label}: tray usable at every sheet position`,
      r.trayButtonsHittable.peek && r.trayButtonsHittable.half && r.trayButtonsHittable.full);
    expect(`${label}: no sideways scroll`, r.sideScrollPx === 0);
    expect(`${label}: numeric HUD off the viewfinder`, !r.hudOnViewfinder);
    expect(`${label}: pose readout moved into the sheet`, r.poseReadoutInSheet);
    expect(`${label}: grid controls in the sheet`, r.gridToolsInSheet);
    // Nothing should require scrolling the page itself: desktop fits, and every
    // smaller viewport uses the fixed camera-first layout.
    expect(`${label}: page itself never scrolls`, r.maxScrollY === 0);
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Page.navigate', { url: URL_ });
  await sleep(900);
  const g = await cdp.eval(GRID_PROBE);
  results['grid over live preview'] = g;
  expect('grid: overlay leaves the 300x150 default', g.overlayBefore === '300x150' && g.overlayAfter === '1920x1080');
  expect('grid: actually paints pixels', g.litPixels > 1000);
  expect('grid: registered with the video box', g.registeredWithVideo);

  console.log(JSON.stringify(results, null, 2));
  console.log(failures === 0 ? '\nAll layout checks passed.' : `\n${failures} layout check(s) FAILED.`);
} finally {
  chrome.kill();
  server.close();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
}

process.exit(failures === 0 ? 0 : 1);
