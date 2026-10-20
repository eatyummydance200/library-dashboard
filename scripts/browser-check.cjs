// Run: node check.cjs (uses the Chromium and ws already installed on this machine).
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const WebSocket = require('ws');
const root = require('node:path').resolve(__dirname, '..');
const settings=Object.fromEntries(readFileSync(join(root,'.runtime.env'),'utf8').trim().split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));
const baseURL=process.argv[2]||'http://127.0.0.1:8091/libaryDashBoard';
const local=baseURL.startsWith('http://127.0.0.1:8091/');
const profile = mkdtempSync(join(tmpdir(), 'moa-check-'));
const browser = spawn('/home/dev/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
const pending = new Map();
let seq = 0;
const errors = [];
async function main() {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chromium did not start')), 10000);
    browser.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    browser.once('error', reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise(resolve => ws.once('open', resolve));
  ws.on('message', data => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  function command(method, params = {}, sessionId) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => command(method, params, sessionId);
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1536,height:1400,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate', {url:baseURL+'/login'});
  async function waitFor(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timed out: '+expression);}
  await waitFor('document.readyState === "complete" && !!document.querySelector("input[name=username]")');
  await evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(settings.ADMIN_USER)};document.querySelector('input[name=password]').value=${JSON.stringify(settings.ADMIN_PASSWORD)};document.querySelector('form').requestSubmit()`);
  await waitFor('typeof user !== "undefined" && !!user && !!document.querySelector(".timetable") && typeof csrfToken !== "undefined" && !!csrfToken');
  await waitFor('document.querySelector("#handoff").children.length===3');
  assert.equal(await evaluate('document.querySelectorAll(".timetable tbody tr").length'),12);
  assert.equal(await evaluate('document.querySelectorAll(".staff-row").length>=7'),true);
  assert.equal(await evaluate('document.querySelector(".brand img").naturalWidth>0'),true);
  assert.equal(await evaluate('document.querySelector("#load-error").hidden'),true);
  for(const id of ['schedule','people','issues','archive','tagging','dashboard']){
    await evaluate(`document.querySelector('[data-view="${id}"]').click()`);
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),false);
  }
  await evaluate('document.querySelector("#staff-filter").value="0";document.querySelector("#staff-filter").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('document.querySelectorAll(".worker.dimmed").length>0'),true);
  await evaluate('selectedStaff="";renderSchedule()');
  if(local){
    await evaluate('setView("people");document.querySelector("[data-edit]").click()');
    await evaluate('document.querySelector("#contact-phone").value="010-1234-5678";document.querySelector("#contact-form").requestSubmit()');
    await waitFor('!document.querySelector("#contact-dialog").open');
    assert.equal(await evaluate('staff[0].phone'), '010-1234-5678');
    await evaluate('setView("schedule");document.querySelector("[data-shift]").click()');
    assert.equal(await evaluate('document.querySelector("#shift-dialog").open'),true);
    await evaluate('document.querySelector("#shift-dialog").close();setView("issues");document.querySelector("#add-issue").click();document.querySelector("#issue-title").value="<img src=x onerror=alert(1)>";document.querySelector("#issue-content").value="브라우저 저장 확인";document.querySelector("#issue-form").requestSubmit()');
    await waitFor('!document.querySelector("#issue-dialog").open');
    assert.equal(await evaluate('document.querySelector("#issue-list img")'),null);
    await evaluate('document.querySelector("[data-toggle-issue]").click()');
    await waitFor('issues[0].done');
    await evaluate('setView("dashboard")');
    await call('Page.reload');
    await waitFor('typeof user!=="undefined" && !!user && !!document.querySelector(".timetable")');
    assert.equal(await evaluate('staff[0].phone'),'010-1234-5678');
  }
  await evaluate('setView("dashboard")');
  await waitFor('document.querySelector("#handoff").children.length===3');
  for(const width of [390,700,768,1024,1280,1536]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1400,deviceScaleFactor:1,mobile:false});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`overflow at ${width}px`);
  }
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(root,local?'preview-service.png':'preview-live.png'),Buffer.from(shot.data,'base64'));
  assert.deepEqual(errors,[]);
  console.log('PASS: real login, all tabs, source data, filtering, persisted edits, issue escaping, and 390–1536px layouts.');
  await command('Browser.close');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close();
  browser.kill();
  await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve));
  await require('node:fs/promises').rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
