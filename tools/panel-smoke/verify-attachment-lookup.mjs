/**
 * Root-causes and verifies the fix for: deleting or downloading an entry
 * attachment fails ("Delete unknown error", download serves a JSON error
 * body instead of the file).
 *
 * The real bug: the app declares `let data = null;` at the top level of a
 * classic <script> (gm.core.js) -- a lexical `let` at script scope does NOT
 * become `window.data`, unlike `var`. So every place in gm-compat.js that
 * reads `window.data` (entryIdForAttachment, currentPhoto) to find which
 * entry owns an attachment id is reading an object the app never populates.
 * It always falls through to the "unfiled" bucket, so delete/download hit
 * the wrong URL and 404.
 *
 *   npm install playwright && node tools/panel-smoke/verify-attachment-lookup.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('.', import.meta.url).pathname);
const FRONTEND = path.resolve(ROOT, '../../custom_components/garageminder/frontend');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'};

// Stand-in for the HA websocket + attachment view, seeded with one entry
// that already has one attachment recorded against it -- exactly the shape
// store.py's join produces.
const RECORD = { id: 'att_1', name: 'receipt.pdf', size: 15, mime: 'application/pdf', stored: 'att_1_receipt.pdf' };
let stored = {
  vehicles: [{ id: 'v1', name: 'Civic', currentOdo: 1000 }],
  serviceTypes: [{ name: 'Oil change', intervalMiles: 5000, intervalMonths: 6 }],
  entries: [{ id: 'e1', vehicleId: 'v1', date: '2026-01-01', odo: 1000,
              services: [{ name: 'Oil change', cost: 50 }], cost: 50,
              attachments: [RECORD] }],
  reminders: [], vehicleIntervals: {}, entryTemplates: [],
  attachments: { e1: [RECORD] },
  settings: { siteTitle: 'GarageMinder', unit: 'mi' }, activeVehicleId: 'all',
};

const requests = [];
const server = http.createServer(async (rq, rs) => {
  let u = decodeURIComponent(rq.url.split('?')[0]);
  if (u.startsWith('/api/garageminder/attachment/')) {
    const rest = u.slice('/api/garageminder/attachment/'.length);
    const [entryKey, attachmentId] = rest.split('/');
    requests.push({ method: rq.method, entryKey, attachmentId });
    if (rq.method === 'DELETE') {
      const ok = entryKey === 'e1' && attachmentId === 'att_1';
      if (ok) { stored.attachments.e1 = []; stored.entries[0].attachments = []; }
      rs.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify(ok ? { success: true } : { message: 'Attachment not found' }));
      return;
    }
    // GET: serve the real bytes only for the correct key; otherwise the
    // same 404 JSON body the real HA view returns.
    if (entryKey === 'e1' && attachmentId === 'att_1') {
      rs.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="receipt.pdf"' });
      rs.end(Buffer.from('%PDF-1.4 fake'));
    } else {
      rs.writeHead(404, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ message: 'Attachment not found' }));
    }
    return;
  }
  if (u.startsWith('/garageminder_static/')) u = u.slice('/garageminder_static'.length);
  const f = u === '/' ? path.join(ROOT, 'harness.html') : path.join(FRONTEND, u);
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); rs.end('404: Not Found'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
await new Promise(r => server.listen(8898, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__gmBridge = {
    callWS: (m) => {
      if (m.type === 'garageminder/config')
        return Promise.resolve({ appName: 'GarageMinder', appTagline: 'x', unit: 'mi',
          maxAttachments: 10, maxAttachmentSizeMB: 10, user: { id: 'u1', name: 'Ken', is_admin: true }, isHomeAssistant: true });
      if (m.type === 'garageminder/load')
        return fetch('/__state').then(r => r.json()).then(d => ({ data: d, data_version: 'tok' }));
      if (m.type === 'auth/sign_path')
        return Promise.resolve({ path: m.path }); // no real signing needed for this harness
      if (m.type === 'garageminder/save') {
        // Navigating to the vehicle-detail page saves the new activeVehicleId.
        // addInitScript runs this in an isolated page context -- it can't
        // close over this file's outer `stored`, and doesn't need to; the
        // page's own live `data` object already has the update applied.
        return Promise.resolve({ data_version: 'tok2' });
      }
      return Promise.reject(new Error('unknown ' + m.type));
    },
    callService: () => Promise.resolve(),
    signPath: async (p) => p,
    accessToken: () => 'fake',
    user: () => ({ id: 'u1', name: 'Ken', is_admin: true }),
    themeMode: () => 'dark', language: () => 'en', currency: () => 'USD',
  };
});
await page.route('**/__state', route => route.fulfill({ body: JSON.stringify(stored), contentType: 'application/json' }));

await page.goto('http://127.0.0.1:8898/garageminder_static/app/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Prove the actual root cause directly: window.data vs the script-scope `data`
// the app's own functions close over (both live in this same top-level page,
// since this harness loads index.html directly rather than through the
// gm-panel.js iframe wrapper -- same trick restore.mjs and run.mjs use).
const scopeCheck = await page.evaluate(() => ({
  windowDataIsUndefined: typeof window.data === 'undefined',
  scriptScopeDataIsPopulated: typeof data !== 'undefined' && !!data && Array.isArray(data.entries) && data.entries.length > 0,
}));
console.log('root cause check:', scopeCheck);

await page.evaluate(() => { window.confirm = () => true; }); // auto-accept the delete confirm()

// Entries render on the vehicle-detail page, reached via "View Details ->"
// on the dashboard health card -- not on the dashboard itself.
const clickResult = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('a,button')).find((e) => /view details/i.test(e.textContent));
  if (el) { el.click(); return 'clicked: ' + el.outerHTML.slice(0, 100); }
  return 'not found';
});
console.log('view-details click result:', clickResult);
await page.waitForTimeout(800);
// renderDashboardHistory() needs a second pass the first time the search bar
// state initializes -- unrelated to the bug under test, just how this view
// warms up; nudge it directly rather than fighting it.
await page.evaluate(() => { if (typeof renderDashboard === 'function') renderDashboard(); });
await page.waitForSelector('.entry-toggle', { timeout: 10000 });
await page.click('.entry-toggle'); // entry cards render collapsed
await page.waitForTimeout(300);

// The view-mode download button is visible immediately; edit mode renders
// its own (hidden, until Edit is clicked) copy of the same button.
const downloadPromise = page.waitForEvent('download').catch(() => null);
await page.locator('.entry-attach-download:visible').click();
const download = await downloadPromise;
let downloadedBytes = null;
if (download) {
  const p = await download.path();
  downloadedBytes = p ? fs.readFileSync(p) : null;
}

// The per-attachment delete button only exists in edit mode.
await page.click('.entry-btn-edit');
await page.waitForTimeout(300);
await page.click('.entry-attach-delete');
await page.waitForTimeout(500);

console.log('HTTP requests to the attachment view:', JSON.stringify(requests));
console.log('downloaded content:', downloadedBytes ? downloadedBytes.toString() : '(no download event fired)');
console.log('pageerrors:', errors.length ? errors : 'none');

const downloadHitRightKey = requests.some(r => r.method === 'GET' && r.entryKey === 'e1' && r.attachmentId === 'att_1');
const deleteHitRightKey = requests.some(r => r.method === 'DELETE' && r.entryKey === 'e1' && r.attachmentId === 'att_1');
const gotRealPdf = downloadedBytes && downloadedBytes.toString().startsWith('%PDF');
const ok = downloadHitRightKey && deleteHitRightKey && gotRealPdf && errors.length === 0;
console.log(ok ? 'PASS — delete and download resolve the real owning entry' : 'FAIL — still resolving to the wrong entry key (see requests above)');
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
