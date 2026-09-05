/**
 * Drives the real restore path: POSTs a backup to restore-full.php and checks
 * that gm-compat.js rebuilds the dataset over the websocket and replays the
 * embedded attachments and vehicle photos into the attachment store.
 *
 * This exists because restore-full.php does not exist in the HA build, so the
 * app was parsing Home Assistant's plain-text "404: Not Found" as JSON and
 * failing with "unexpected non-whitespace character after JSON at position 3".
 *
 *   npm install playwright && node tools/panel-smoke/restore.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('.', import.meta.url).pathname);
const FRONTEND = path.resolve(ROOT, '../../custom_components/garageminder/frontend');
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'};

// Stand-in for the HA websocket + attachment view.
let stored = { vehicles: [], serviceTypes: [], entries: [], reminders: [],
  vehicleIntervals: {}, entryTemplates: [], attachments: {},
  settings: {siteTitle:"GarageMinder",unit:"mi"}, activeVehicleId:"all" };
const uploads = [];

const server = http.createServer(async (rq, rs) => {
  let u = decodeURIComponent(rq.url.split('?')[0]);
  if (u.startsWith('/api/garageminder/attachment/')) {
    const chunks=[]; for await (const c of rq) chunks.push(c);
    const body = Buffer.concat(chunks);
    const id = new URL(rq.url,'http://x').searchParams.get('id');
    const key = decodeURIComponent(u.split('/attachment/')[1]);
    uploads.push({ key, id, bytes: body.length });
    const rec = { id: id || ('gen'+uploads.length), name:'f', size: body.length, mime:'application/pdf', stored:'x' };
    stored.attachments = stored.attachments || {};
    (stored.attachments[key] = stored.attachments[key] || []).push(rec);
    rs.writeHead(200,{'Content-Type':'application/json'}); rs.end(JSON.stringify(rec)); return;
  }
  if (u.startsWith('/garageminder_static/')) u = u.slice('/garageminder_static'.length);
  const f = u === '/' ? path.join(ROOT,'harness.html') : path.join(FRONTEND, u);
  fs.readFile(f,(e,b)=>{ if(e){rs.writeHead(404);rs.end('404: Not Found');return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});rs.end(b);});
});
await new Promise(r=>server.listen(8896,r));

const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page = await browser.newPage({viewport:{width:1400,height:900}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(() => {
  window.__stored = null;
  window.__gmBridge = {
    callWS: (m) => {
      if (m.type === 'garageminder/config')
        return Promise.resolve({appName:'GarageMinder', appTagline:'x', unit:'mi',
          maxAttachments:10, maxAttachmentSizeMB:10, user:{id:'u1',name:'Ken',is_admin:true}, isHomeAssistant:true});
      if (m.type === 'garageminder/load')
        return fetch('/__state').then(r=>r.json()).then(d=>({data:d, data_version:'tok'}));
      if (m.type === 'garageminder/save')
        return fetch('/__save',{method:'POST',body:JSON.stringify(m.data)}).then(()=>({data_version:'tok2'}));
      return Promise.reject(new Error('unknown '+m.type));
    },
    callService: () => Promise.resolve(),
    signPath: (p) => Promise.resolve(p),
    accessToken: () => 'fake',
    user: () => ({id:'u1',name:'Ken',is_admin:true}),
    themeMode: () => 'dark', language: () => 'en', currency: () => 'USD',
  };
});
// state endpoints
server.on('request',()=>{});
await page.route('**/__state', route => route.fulfill({ body: JSON.stringify(stored), contentType:'application/json' }));
await page.route('**/__save', async route => {
  stored = JSON.parse(route.request().postData()); 
  await route.fulfill({ body: '{}', contentType:'application/json' });
});

await page.goto('http://127.0.0.1:8896/garageminder_static/app/index.html',{waitUntil:'networkidle'});
await page.waitForTimeout(2500);

// Drive the real restore path: POST the real backup to restore-full.php.
const result = await page.evaluate(async () => {
  // Synthetic fixture — never ship anyone's real garage data in a test.
  const pdf = btoa('%PDF-1.4 fake');
  const backup = {
    version: '2.2', created_at: '2026-01-01 00:00:00', backup_type: 'full_json',
    data: {
      vehicles: [{id:'v1', name:'Alpha', currentOdo: 1000}, {id:'v2', name:'Beta', currentOdo: 2000}],
      serviceTypes: [{name:'Oil change', intervalMiles:5000, intervalMonths:6}],
      entries: [{id:'e1', vehicleId:'v1', date:'2026-01-01', odo:1000,
                 services:[{name:'Oil change',cost:50}], cost:0,
                 attachments:[{id:'att_1', name:'r.pdf', size:15, type:'application/pdf'}]}],
      reminders: [{vehicleId:'v1', service:'Oil change', intervalMiles:5000, baseOdo:1000}],
      vehicleIntervals:{}, entryTemplates:[], settings:{siteTitle:'GarageMinder',unit:'mi'},
      activeVehicleId:'v1'
    },
    attachments_embedded: [{id:'att_1', entry_id:'e1', name:'r.pdf',
                            mime_type:'application/pdf', size:15, data_base64: pdf}],
    vehicle_photos_embedded: [{vehicle_id:'v1', mime_type:'image/webp', size:4,
                               data_base64: btoa('webp')}],
  };
  const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
  const fd = new FormData(); fd.append('backup_file', file);
  const r = await fetch('restore-full.php', { method: 'POST', body: fd });
  const j = await r.json();
  return { ok: j.success, restored: j.attachments_restored, errors: j.errors || j.attachments_errors,
           vehicles: j.data ? j.data.vehicles.length : -1,
           entries: j.data ? j.data.entries.length : -1,
           reminders: j.data ? j.data.reminders.length : -1 };
});
console.log('restore result:', JSON.stringify(result));
console.log('uploads:', uploads.length, '| with original ids:', uploads.filter(u=>u.id).length,
            '| photo keys:', uploads.filter(u=>u.key.startsWith('vehicle-photo:')).length);
console.log('total bytes uploaded:', uploads.reduce((a,b)=>a+b.bytes,0));
console.log('pageerrors:', errors.length?errors:'none');
const ok = result.ok && result.vehicles === 2 && result.entries === 1 &&
           result.restored === 2 && uploads.filter(u=>u.id).length === 1 &&
           uploads.filter(u=>u.key.startsWith('vehicle-photo:')).length === 1 &&
           errors.length === 0;
console.log(ok ? 'PASS — restore rebuilt the dataset and replayed attachments' : 'FAIL');
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
