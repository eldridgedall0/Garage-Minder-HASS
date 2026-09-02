/**
 * Mounts the REAL gm-panel.js custom element the way Home Assistant does —
 * into a plain container that gives its child no height — and checks that the
 * app actually renders inside it.
 *
 * This exists because an earlier smoke test stubbed the panel and hard-coded
 * the iframe height, which hid a `height: 100%` on :host collapsing the panel
 * to 150px in Home Assistant: a sidebar entry that opened to nothing, with no
 * error in any log.
 *
 *   npm install playwright && node tools/panel-smoke/run.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('.', import.meta.url).pathname);
const FRONTEND = path.resolve(ROOT, '../../custom_components/garageminder/frontend');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=http.createServer((rq,rs)=>{let u=decodeURIComponent(rq.url.split('?')[0]);
  if(u.startsWith('/garageminder_static/')) u=u.slice('/garageminder_static'.length);
  const f = u === '/' ? path.join(ROOT, 'harness.html') : path.join(FRONTEND, u);
  fs.readFile(f,(e,b)=>{ if(e){rs.writeHead(404);rs.end();return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});rs.end(b);});});
await new Promise(r=>server.listen(8897,r));

const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await browser.newPage({viewport:{width:1400,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
await page.goto('http://127.0.0.1:8897/',{waitUntil:'networkidle'});
await page.waitForTimeout(3000);

const box = await page.evaluate(() => {
  const el = window.__panelEl;
  const wrapper = document.querySelector('ha-panel-custom');
  const host = el.getBoundingClientRect();
  const iframe = el.shadowRoot.querySelector('iframe').getBoundingClientRect();
  return { wrapperDisplay: getComputedStyle(wrapper).display,
           wrapperH: Math.round(wrapper.getBoundingClientRect().height),
           hostH: Math.round(host.height), hostW: Math.round(host.width),
           iframeH: Math.round(iframe.height), iframeW: Math.round(iframe.width),
           bridge: typeof window.__gmBridge };
});
console.log('panel geometry:', JSON.stringify(box));

const frame = page.frames().find(f => f.url().includes('/app/index.html'));
if (!frame) { console.log('FAIL: app iframe not found'); process.exit(1); }
const app = await frame.evaluate(() => ({
  boot: { scripts: (window.GM_SCRIPTS||[]).length, preloaded: !!window.__gmPreloaded, cfg: !!window.GM_CONFIG, jq: typeof window.jQuery },
  title: (document.querySelector('.app-title')||{}).textContent,
  vehicles: [...document.querySelectorAll('#active-vehicle option')].map(o=>o.textContent.trim()),
  entries: document.querySelectorAll('#entry-list > *').length,
  preloaderVisible: !!document.querySelector('.gm-preloader:not([hidden])') &&
      getComputedStyle(document.querySelector('.gm-preloader')).opacity !== '0',
}));
console.log('app inside panel:', JSON.stringify(app));
console.log('errors:', errors.length ? errors : 'none');
const ok = box.iframeH > 400 && app.title === 'GarageMinder' && !app.preloaderVisible;
console.log(ok ? 'PASS — panel has height and the app rendered' : 'FAIL');
await page.screenshot({path: path.join(ROOT, 'panel-in-ha.png')});
await browser.close(); server.close();
process.exit(ok?0:1);
