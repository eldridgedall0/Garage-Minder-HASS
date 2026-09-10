/**
 * Verifies the HA-only chrome added in gm-boot.js:
 *
 *   1. The web app's WordPress "user menu" (desktop dropdown + mobile drawer
 *      section) stays hidden even when the loaded dataset says
 *      multiUserEnabled: true -- the shape a dataset restored from a web-app
 *      backup can carry. This is a control: the fixture below deliberately
 *      forces the app to actually render both, so the test proves the CSS
 *      override wins against a real render, not just that the menu was never
 *      built in the first place.
 *   2. A "back to the Home Assistant dashboard" button is present in the nav
 *      and clicking it navigates the top window away from the panel, even
 *      before gm-boot.js's own websocket load resolves.
 *
 *   npm install playwright && node tools/panel-smoke/verify-ha-chrome.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('.', import.meta.url).pathname);
const FRONTEND = path.resolve(ROOT, '../../custom_components/garageminder/frontend');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };

// A dataset shaped like one restored from a web-app backup taken while
// ENABLE_MULTI_USER was on -- exactly what makes gm.user.js and
// gm.mobile-nav.js render the WordPress user menu inside this integration,
// where it doesn't belong (see gm-boot.js's applyHaChrome comment).
const STATE = {
  vehicles: [{ id: 'v1', name: 'F-150', currentOdo: 1000 }],
  serviceTypes: [{ name: 'Oil change', intervalMiles: 5000, intervalMonths: 6 }],
  entries: [], reminders: [], vehicleIntervals: {}, entryTemplates: [], attachments: {},
  settings: { siteTitle: 'GarageMinder', unit: 'mi' }, activeVehicleId: 'v1',
  multiUserEnabled: true,
  user: { id: 42, display_name: 'Ken', email: 'ken@example.com', has_subscription: false },
  authUrls: { profile_url: '/wp-admin/profile.php', subscribe_url: '/subscribe/', logout_url: '/wp-login.php?action=logout' },
};

const server = http.createServer((rq, rs) => {
  let u = decodeURIComponent(rq.url.split('?')[0]);
  if (u.startsWith('/garageminder_static/')) u = u.slice('/garageminder_static'.length);
  const f = path.join(FRONTEND, u);
  fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404); rs.end('404: Not Found'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); rs.end(b); });
});
await new Promise(r => server.listen(8899, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));

await page.addInitScript((state) => {
  // Same trick run.mjs/restore.mjs/verify-attachment-lookup.mjs use: load
  // index.html directly instead of through the gm-panel.js iframe, so this
  // one page IS both "top window" and "iframe" -- window.parent is window,
  // exactly like inside the real iframe where window.parent is the top HA
  // window holding the bridge.
  window.__gmBridge = {
    callWS: (m) => {
      if (m.type === 'garageminder/config')
        return Promise.resolve({ appName: 'GarageMinder', appTagline: 'x', unit: 'mi',
          maxAttachments: 10, maxAttachmentSizeMB: 10, user: { id: 'u1', name: 'Ken', is_admin: true }, isHomeAssistant: true });
      if (m.type === 'garageminder/load')
        return Promise.resolve({ data: state, data_version: 'tok' });
      return Promise.reject(new Error('unknown ' + m.type));
    },
    callService: () => Promise.resolve(),
    signPath: async (p) => p,
    accessToken: () => 'fake',
    user: () => ({ id: 'u1', name: 'Ken', is_admin: true }),
    themeMode: () => 'dark', language: () => 'en', currency: () => 'USD',
  };
}, STATE);

await page.goto('http://127.0.0.1:8899/garageminder_static/app/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // let gm-boot.js finish + gm.user.js's own setTimeout(100) fire

const before = await page.evaluate(() => {
  function info(sel) {
    const el = document.querySelector(sel);
    if (!el) return { present: false };
    const cs = getComputedStyle(el);
    return { present: true, display: cs.display, inNav: !!el.closest('.nav') };
  }
  const homeBtn = document.getElementById('gm-ha-home-btn');
  return {
    userMenu: info('#user-menu'),
    drawerUserSection: info('#drawer-user-section'),
    homeBtn: homeBtn ? {
      present: true,
      display: getComputedStyle(homeBtn).display,
      text: homeBtn.textContent.trim(),
      hasHouseIcon: !!homeBtn.querySelector('i.bi-house-door-fill'),
      isNavBtnClass: homeBtn.classList.contains('nav-btn'),
    } : { present: false },
  };
});
console.log('state after boot:', JSON.stringify(before, null, 2));

// gm.user.js only renders the full dropdown (the branch with the WordPress
// links) when currentUser.id is truthy -- confirm that branch actually ran,
// otherwise "hidden" would be trivially true because nothing was built.
const userMenuActuallyRendered = await page.evaluate(() =>
  !!document.querySelector('#user-menu .user-menu-dropdown') &&
  document.querySelector('#user-menu')?.innerHTML.includes('wp-login.php'));
console.log('user menu really rendered with WP links before being hidden:', userMenuActuallyRendered);

// Click the home button and confirm it actually navigates the (top) window,
// the same effect it will have on window.parent from inside the real iframe.
const navPromise = page.waitForNavigation({ timeout: 5000 }).catch(() => null);
await page.click('#gm-ha-home-btn');
const nav = await navPromise;
const urlAfterClick = page.url();
console.log('nav happened:', !!nav, 'url after click:', urlAfterClick);

console.log('pageerrors:', errors.length ? errors : 'none');

const ok =
  before.userMenu.present && before.userMenu.display === 'none' &&
  before.drawerUserSection.present && before.drawerUserSection.display === 'none' &&
  before.homeBtn.present && before.homeBtn.display !== 'none' &&
  !before.homeBtn.isNavBtnClass &&
  before.homeBtn.hasHouseIcon &&
  userMenuActuallyRendered &&
  urlAfterClick === 'http://127.0.0.1:8899/' &&
  errors.length === 0;

console.log(ok
  ? 'PASS — WordPress user menu stays hidden and the HA home button navigates away'
  : 'FAIL — see details above');
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
