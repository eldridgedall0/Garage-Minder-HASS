/**
 * Control test for the "Add reminder" Service name dropdown bug.
 *
 * Bug: renderRemindersPage() (called by router navigation and every vehicle
 * switch) never called renderReminderServiceSelect(), so #rem-new-service
 * stayed empty unless the user had just added/edited/deleted a service type
 * in Settings during the same page life.
 *
 * Mounts the REAL panel, navigates to the Reminders route for the seeded
 * vehicle (which has one service type: "Oil change"), and checks that the
 * dropdown actually contains it.
 *
 *   node tools/panel-smoke/verify-service-dropdown.mjs
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
await new Promise(r=>server.listen(8898,r));

const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await browser.newPage({viewport:{width:1400,height:900}});
await page.goto('http://127.0.0.1:8898/',{waitUntil:'networkidle'});
await page.waitForTimeout(3000);

const frame = page.frames().find(f => f.url().includes('/app/index.html'));
if (!frame) { console.log('FAIL: app iframe not found'); process.exit(1); }

// Navigate the way a real user does: go to the reminders route for the
// already-active vehicle (harness seeds activeVehicleId = "v1").
await frame.evaluate(() => { window.location.hash = '#reminders'; });
await frame.waitForTimeout(500);

const result = await frame.evaluate(() => ({
  formVisible: $('#reminder-form').closest('.settings-section').is(':visible'),
  options: [...document.querySelectorAll('#rem-new-service option')].map(o => o.value),
}));
console.log('reminders route result:', JSON.stringify(result));

const ok = result.formVisible && result.options.includes('Oil change');
console.log(ok
  ? 'PASS — Service name dropdown is populated with the vehicle\'s service types'
  : 'FAIL — Service name dropdown did not populate ("Oil change" missing)');
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
