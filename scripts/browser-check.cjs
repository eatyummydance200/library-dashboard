// Run: node check.cjs (uses the Chromium and ws already installed on this machine).
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const WebSocket = require('ws');
const root = require('node:path').resolve(__dirname, '..');
const settings=Object.fromEntries(readFileSync(join(root,'.runtime.env'),'utf8').trim().split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));
const baseURL=process.argv[2]||'http://127.0.0.1:8091/library-dashboard';
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
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const wednesday=new Date(Date.UTC(+parts.year,+parts.month-1,+parts.day,5,45));
  wednesday.setUTCDate(wednesday.getUTCDate()-(wednesday.getUTCDay()+6)%7+2);
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date;window.__qaNativeDate=NativeDate;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${wednesday.getTime()}]));}static now(){return ${wednesday.getTime()};}};}`});
  await call('Emulation.setDeviceMetricsOverride',{width:1536,height:1400,deviceScaleFactor:1,mobile:false});
  async function waitFor(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timed out: '+expression+' '+await evaluate('JSON.stringify({url:location.pathname,toast:document.querySelector("#toast")?.textContent,error:document.querySelector("#load-error")?.textContent,role:typeof user!=="undefined"?user?.role:null,tasks:[...document.querySelectorAll("[data-archive-task]")].slice(0,3).map(e=>({id:e.dataset.archiveTask,checked:e.checked,disabled:e.disabled}))})'));}
  async function loginAs(username,password){
    await call('Page.navigate',{url:baseURL+'/login'});
    await waitFor('document.readyState === "complete" && !!document.querySelector("input[name=username]")');
    await evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(username)};document.querySelector('input[name=password]').value=${JSON.stringify(password)};document.querySelector('form').requestSubmit()`);
    await waitFor('typeof user !== "undefined" && !!user && !!document.querySelector("#handoff .shift") && typeof csrfToken !== "undefined" && !!csrfToken');
  }
  await loginAs(settings.ADMIN_USER,settings.ADMIN_PASSWORD);
  await waitFor('document.querySelector("#handoff").children.length===3');
  await evaluate('document.fonts.ready');
  assert.equal(await evaluate('document.querySelector("#dashboard .week-board, #dashboard #schedule-slot, #dashboard .stats-card")'),null);
  assert.equal(await evaluate('document.querySelectorAll("#dashboard .issues-card").length'),1);
  assert.equal(await evaluate('Number(getComputedStyle(document.body).zoom)'),.8);
  await waitFor('typeof dutyContact!=="undefined" && !!document.querySelector("#duty-teacher")');
  assert.equal(await evaluate('document.querySelectorAll("#dashboard .duty-card").length'),1);
  if(local){
    const original=await evaluate('api("/duty")');
    await evaluate('document.querySelector("#edit-duty").click();document.querySelector("#duty-teacher-input").value="<img src=x> 담당";document.querySelector("#duty-extension-input").value="0123";document.querySelector("#duty-form").requestSubmit()');
    await waitFor('!document.querySelector("#duty-dialog").open && document.querySelector("#duty-teacher").textContent==="<img src=x> 담당"');
    assert.equal(await evaluate('document.querySelector("#duty-teacher img")'),null);
    await evaluate('loadDuty()');
    assert.equal(await evaluate('document.querySelector("#duty-extension").textContent'),'0123');
    await evaluate(`api('/duty',{method:'PUT',body:${JSON.stringify(original)}}).then(loadDuty)`);
  }
  await evaluate('setView("schedule")');

  assert.equal(await evaluate('document.querySelectorAll(".time-tick").length'),26);
  assert.equal(await evaluate('document.querySelector(".time-end").textContent'),'22:00');
  assert.equal(await evaluate('document.querySelector("#metrics")'),null);
  assert.equal(await evaluate('document.querySelectorAll(".metric").length'),0);
  assert.equal(await evaluate('document.querySelector(".shift.current h3").textContent.includes("현재 근무")'),true);
  assert.equal(await evaluate('document.querySelectorAll(".duty-group[data-duty=desk]").length'),3);
  assert.equal(await evaluate('document.querySelectorAll(".duty-group[data-duty=standby]").length'),3);
  assert.equal(await evaluate('document.querySelector(".current-row").dataset.start'),'870');
  assert.equal(await evaluate('document.querySelectorAll(".now-line").length'),1);
  assert.equal(await evaluate('document.fonts.check("16px Pretendard")'),true);
  assert.equal(await evaluate('getComputedStyle(document.body).fontFamily.includes("Pretendard")'),true);
  assert.equal(await evaluate('parseFloat(getComputedStyle(document.querySelector(".time-tick")).fontSize)>=16'),true);

  assert.equal(await evaluate('document.querySelector("#preview-time,#live-time,.clock-control,.semester,#status-mode")'),null);
  assert.equal(await evaluate('document.querySelector("#shift-date").textContent.endsWith("수요일 14:45")'),true);
  assert.equal(await evaluate('document.querySelector(".worker small,.worker time")'),null);
  assert.equal(await evaluate('[...document.querySelectorAll(".worker")].every(e=>e.textContent===staff.find(s=>s.dbid===rawShifts.find(r=>r.id===Number(e.dataset.shift)).staff_id).name)'),true);
  for(const [stamp,suffix] of [[wednesday.getTime()+60000,'수요일 14:46'],[new Date(wednesday).setUTCHours(14,59,0,0),'수요일 23:59'],[new Date(wednesday).setUTCHours(15,0,0,0),'목요일 00:00']]){
    await evaluate(`window.Date=class extends window.__qaNativeDate{constructor(...args){super(...(args.length?args:[${stamp}]));}static now(){return ${stamp};}};loadStatus()`);
    assert.equal(await evaluate('document.querySelector("#shift-date").textContent.endsWith('+JSON.stringify(suffix)+')'),true);
  }
  await evaluate(`window.Date=class extends window.__qaNativeDate{constructor(...args){super(...(args.length?args:[${wednesday.getTime()}]));}static now(){return ${wednesday.getTime()};}};loadStatus()`);
  for(const [hour,minute,expected] of [[8,59,null],[9,0,'540'],[9,29,'540'],[9,30,'570'],[20,59,'1230'],[21,0,'1260'],[21,30,'1290'],[21,59,'1290'],[22,0,null]]){
    const stamp=new Date(wednesday);stamp.setUTCHours(hour-9,minute,0,0);
    await evaluate(`window.Date=class extends window.__qaNativeDate{constructor(...args){super(...(args.length?args:[${stamp.getTime()}]));}static now(){return ${stamp.getTime()};}};renderSchedule()`);
    assert.equal(await evaluate('document.querySelector(".current-row")?.dataset.start??null'),expected);
  }
  const saturday=wednesday.getTime()+3*86400000;
  await evaluate(`window.Date=class extends window.__qaNativeDate{constructor(...args){super(...(args.length?args:[${saturday}]));}};renderSchedule()`);
  assert.equal(await evaluate('document.querySelectorAll(".now-line").length'),0);
  await evaluate(`window.Date=class extends window.__qaNativeDate{constructor(...args){super(...(args.length?args:[${wednesday.getTime()}]));}static now(){return ${wednesday.getTime()};}};renderSchedule()`);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".time-tick")].slice(0,3).map(r=>Number(r.dataset.start))'),[540,570,600]);
  assert.equal(await evaluate(`(()=>{for(const shift of rawShifts){const block=document.querySelector('[data-shift="'+shift.id+'"]');if(!block||Number(block.dataset.start)!==shift.start||Number(block.dataset.end)!==shift.end||Number(block.style.gridRowStart)!==(shift.start-540)/30+1)return false;}return document.querySelectorAll('[data-shift]').length===rawShifts.length;})()`),true);
  assert.equal(await evaluate(`(()=>{const layout=layoutShifts([{persistId:1,start:9,end:10,desk:true},{persistId:2,start:9.5,end:10.5,desk:true},{persistId:3,start:10,end:11,desk:true},{persistId:4,start:9,end:12,desk:false}]);return layout.lanes===3&&layout.entries.find(e=>e.persistId===1).lane===layout.entries.find(e=>e.persistId===3).lane&&layout.entries.find(e=>e.persistId===2).lane!==layout.entries.find(e=>e.persistId===1).lane;})()`),true);
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#handoff article")].map(e=>e.getAttribute("aria-label"))'),['이전 근무','현재 근무','다음 근무']);
  assert.equal(await evaluate('document.querySelector("#dashboard .stats-card")'),null);
  assert.equal(await evaluate('document.querySelector("#schedule .stats-card h2").textContent.startsWith("주당 근무 시간")'),true);
  assert.equal(await evaluate('document.querySelector("#page-subtitle, .eyebrow")'),null);
  assert.equal(await evaluate('document.querySelectorAll(".staff-row").length>=7'),true);
  assert.equal(await evaluate('document.querySelector(".brand img").naturalWidth'),539);
  assert.equal(await evaluate('document.querySelector(".brand img").naturalHeight'),301);
  assert.equal(await evaluate('document.querySelector(".brand img").closest("a")'),null);
  assert.equal(await evaluate('document.querySelector("#load-error").hidden'),true);
  for(const id of ['schedule','people','issues','archive','tagging','dashboard']){
    await evaluate(`document.querySelector('[data-view="${id}"]').click()`);
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),false);
    assert.equal(await evaluate('document.querySelector(".footer")'),null);
  }

  await evaluate('setView("schedule")');
  await evaluate('document.querySelector("#staff-filter").value="0";document.querySelector("#staff-filter").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('document.querySelectorAll(".worker.dimmed").length>0'),true);
  await evaluate('selectedStaff="";renderSchedule()');
  const week=await evaluate('document.querySelector(".week-board").dataset.week');
  await evaluate('document.querySelector("#next-week").click()');
  await waitFor(`document.querySelector('.week-board').dataset.week!==${JSON.stringify(week)}`);
  assert.equal(await evaluate('document.querySelectorAll(".now-line").length'),0);
  await evaluate('document.querySelector("#this-week").click()');
  await waitFor(`document.querySelector('.week-board').dataset.week===${JSON.stringify(week)}`);

  await evaluate('setView("archive")');
  await waitFor('document.querySelectorAll(".archive-group").length===7');
  assert.equal(await evaluate('document.querySelector("[data-view=archive] .soon")'),null);
  const currentArchiveMonth=await evaluate('archiveMonth');
  await evaluate('document.querySelector("#prev-archive-month").click()');
  await waitFor('document.querySelectorAll(".archive-group").length===7');
  assert.notEqual(await evaluate('archiveMonth'),currentArchiveMonth);
  await evaluate('document.querySelector("#this-archive-month").click()');
  await waitFor('document.querySelectorAll(".archive-group").length===7');
  assert.equal(await evaluate('archiveMonth'),currentArchiveMonth);
  if(local){
    await evaluate('archiveMonth="2099-01";loadArchive()');
    const drawn=await evaluate('!!document.querySelector("[data-archive-task]")');
    if(!drawn){
      await evaluate('window.__originalConfirm=window.confirm;window.confirm=()=>true;document.querySelector("#draw-archive").click()');
      await waitFor('document.querySelectorAll("[data-archive-task]").length===20');
      await evaluate('window.confirm=window.__originalConfirm');
    }
    assert.equal(await evaluate('document.querySelector("#draw-archive")'),null);
    const assignment=await evaluate('api("/archive?month=2099-01").then(d=>d.assignments[0])');
    const task=assignment.tasks[0];
    const completed=!!task.completed;
    await evaluate(`document.querySelector('[data-archive-task="${task.id}"]').click()`);
    await waitFor(`!!document.querySelector('[data-archive-task="${task.id}"]')&&!document.querySelector('[data-archive-task="${task.id}"]').disabled&&document.querySelector('[data-archive-task="${task.id}"]').checked===${!completed}`);
    await evaluate('loadArchive()');
    assert.equal(await evaluate(`document.querySelector('[data-archive-task="${task.id}"]').checked`),!completed);
    await evaluate(`document.querySelector('[data-archive-task="${task.id}"]').click()`);
    await waitFor(`!!document.querySelector('[data-archive-task="${task.id}"]')&&!document.querySelector('[data-archive-task="${task.id}"]').disabled&&document.querySelector('[data-archive-task="${task.id}"]').checked===${completed}`);
    await evaluate('archiveMonth="2099-02";loadArchive()');
    const manualIds=await evaluate('archiveData.participants.slice(0,7).map(p=>p.id)');
    await evaluate('document.querySelector("#edit-archive").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-archive-assignment]").length'),7);
    await evaluate(`[...document.querySelectorAll('[data-archive-assignment]')].forEach((s,i)=>s.value=${JSON.stringify(manualIds)}[i]);document.querySelector('#archive-edit-form').requestSubmit()`);
    await waitFor('!document.querySelector("#archive-edit-dialog").open&&!!archiveData&&archiveData.month==="2099-02"&&archiveData.assignments.length===7');
    assert.deepEqual(await evaluate('archiveData.assignments.map(a=>a.staff_id)'),manualIds);
    const preserved=await evaluate('archiveData.assignments.map(a=>a.tasks)');
    const swapped=[manualIds[1],manualIds[0],...manualIds.slice(2)];
    await evaluate('document.querySelector("#edit-archive").click()');
    await evaluate(`[...document.querySelectorAll('[data-archive-assignment]')].forEach((s,i)=>s.value=${JSON.stringify(swapped)}[i]);document.querySelector('#archive-edit-form').requestSubmit()`);
    await waitFor(`!document.querySelector('#archive-edit-dialog').open&&!!archiveData&&archiveData.assignments[0].staff_id===${swapped[0]}`);
    assert.deepEqual(await evaluate('archiveData.assignments.map(a=>a.tasks)'),preserved);
    const name='qa_archive_'+Date.now();
    const password='Browser-test-only-12345';
    await evaluate('setView("people")');
    await waitFor('users.length>0');
    await evaluate(`document.querySelector('#add-user').click();document.querySelector('#user-name').value=${JSON.stringify(name)};document.querySelector('#user-password').value=${JSON.stringify(password)};document.querySelector('#user-form').requestSubmit()`);
    await waitFor(`!document.querySelector('#user-dialog').open&&users.some(u=>u.username===${JSON.stringify(name)})`);
    const workerId=await evaluate(`users.find(u=>u.username===${JSON.stringify(name)}).id`);
    await evaluate(`document.querySelector('[data-link-user="${workerId}"]').value=${JSON.stringify(String(assignment.staff_id))};document.querySelector('[data-link-user="${workerId}"]').dispatchEvent(new Event('change',{bubbles:true}))`);
    await waitFor(`users.find(u=>u.id===${workerId}).staff_id===${assignment.staff_id}`);
    await evaluate('api("/logout",{method:"POST"})');
    await loginAs(name,password);
    assert.equal(await evaluate('document.querySelector("#edit-duty").hidden'),true);
    await evaluate('archiveMonth="2099-01";setView("archive")');
    await waitFor('document.querySelectorAll("[data-archive-task]").length===20');
    assert.equal(await evaluate('document.querySelectorAll(".my-archive").length'),1);
    assert.equal(await evaluate('document.querySelectorAll("[data-archive-task]:not(:disabled)").length'),assignment.tasks.length);
    assert.equal(await evaluate('document.querySelectorAll(".archive-group:not(.my-archive) [data-archive-task]:not(:disabled)").length'),0);
    await evaluate(`document.querySelector('[data-archive-task="${task.id}"]').click()`);
    await waitFor(`!!document.querySelector('[data-archive-task="${task.id}"]')&&!document.querySelector('[data-archive-task="${task.id}"]').disabled&&document.querySelector('[data-archive-task="${task.id}"]').checked===${!completed}`);
    const workerShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    writeFileSync(join(root,'preview-archive-worker.png'),Buffer.from(workerShot.data,'base64'));
    await evaluate(`document.querySelector('[data-archive-task="${task.id}"]').click()`);
    await waitFor(`!!document.querySelector('[data-archive-task="${task.id}"]')&&!document.querySelector('[data-archive-task="${task.id}"]').disabled&&document.querySelector('[data-archive-task="${task.id}"]').checked===${completed}`);
    await evaluate('api("/logout",{method:"POST"})');
    await loginAs(settings.ADMIN_USER,settings.ADMIN_PASSWORD);
  }
  await evaluate('setView("dashboard")');
  await evaluate('setView("tagging")');
  await waitFor('!!document.querySelector(".tag-mark")');
  assert.equal(await evaluate('document.querySelectorAll(".tagging-table thead th").length'),13);
  assert.equal(await evaluate('document.querySelectorAll(".tagging-status-card").length'),1);
  assert.equal(await evaluate('document.querySelectorAll(".sidebar .profile,.sidebar .profile-user,#password-button,#logout-button").length'),0);
  if(local){
    const tag=await evaluate('(()=>{const b=[...document.querySelectorAll(".tag-mark")].find(b=>Number(b.dataset.month)===9);return {person:b.dataset.tagPerson,before:b.getAttribute("aria-pressed")};})()');
    await evaluate(`document.querySelector('[data-tag-person="${tag.person}"][data-month="9"]').click()`);
    await waitFor(`document.querySelector('[data-tag-person="${tag.person}"][data-month="9"]').getAttribute('aria-pressed')!==${JSON.stringify(tag.before)}`);
    await evaluate('loadTagging()');
    assert.equal(await evaluate(`document.querySelector('[data-tag-person="${tag.person}"][data-month="9"]').getAttribute('aria-pressed')`),tag.before==='true'?'false':'true');
    await evaluate(`document.querySelector('[data-tag-person="${tag.person}"][data-month="9"]').click()`);
    await waitFor(`document.querySelector('[data-tag-person="${tag.person}"][data-month="9"]').getAttribute('aria-pressed')===${JSON.stringify(tag.before)}`);
  }
  const tagYearBefore=await evaluate('tagYear');
  await evaluate('document.querySelector("#prev-tag-year").click()');
  await waitFor('!!document.querySelector(".tag-mark")');
  assert.equal(await evaluate('tagYear'),tagYearBefore-1);
  await evaluate('document.querySelector("#this-tag-year").click()');
  await waitFor('!!document.querySelector(".tag-mark")');
  await evaluate('setView("dashboard")');
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
    await evaluate('setView("schedule");loadShiftIssues()');
    await evaluate('document.querySelector("#add-shift-issue").click()');
    assert.equal(await evaluate('document.querySelector("#issue-category").value'),'근무 변경');
    await evaluate('document.querySelector("#issue-title").value="브라우저 근무 변경 확인";document.querySelector("#issue-content").value="<img src=x onerror=alert(1)>";document.querySelector("#issue-form").requestSubmit()');
    await waitFor('!document.querySelector("#issue-dialog").open&&shiftIssues.some(i=>i.title==="브라우저 근무 변경 확인"&&!i.done)');
    assert.equal(await evaluate('document.querySelector("#shift-issue-list img")'),null);
    await evaluate('document.querySelector("#shift-issue-list [data-toggle-issue]").click()');
    await waitFor('shiftIssues[0].done');
    await evaluate('document.querySelector("#shift-issue-filter").value="done";document.querySelector("#shift-issue-filter").dispatchEvent(new Event("change"))');
    assert.equal(await evaluate('document.querySelector("#shift-issue-list").textContent.includes("브라우저 근무 변경 확인")'),true);
    const issueId=await evaluate('shiftIssues[0].id');
    const sourceWeek=await evaluate('isoDay(weekDates()[0])');
    await evaluate('document.querySelector("#next-week").click()');
    await waitFor(`document.querySelector('.week-board').dataset.week!==${JSON.stringify(sourceWeek)}&&document.querySelector('#shift-issue-week').textContent!==''&&!shiftIssues.some(i=>i.id===${issueId})`);
    await evaluate('document.querySelector("#this-week").click()');
    await waitFor(`document.querySelector('.week-board').dataset.week===${JSON.stringify(sourceWeek)}&&shiftIssues.some(i=>i.id===${issueId})`);
    const late=await evaluate('(()=>{const p=staff.find(s=>s.active),day=isoDay(weekDates()[0]);return {staff_id:p.dbid,day,hours:p.hours,close:p.close,alreadyClosing:rawShifts.some(s=>s.staff_id===p.dbid&&s.day===day&&s.end===Math.max(1260,...rawShifts.filter(s=>s.day===day).map(s=>s.end)))};})()');
    await evaluate(`document.querySelector('#add-shift').click();document.querySelector('#shift-person').value=${JSON.stringify(String(late.staff_id))};document.querySelector('#shift-day').value=${JSON.stringify(late.day)};document.querySelector('#shift-start').value='21:00';document.querySelector('#shift-end').value='22:00';document.querySelector('#shift-form').requestSubmit()`);
    await waitFor('!document.querySelector("#shift-dialog").open&&rawShifts.some(s=>s.end===1320)');
    const lateId=await evaluate(`rawShifts.find(s=>s.staff_id===${late.staff_id}&&s.day===${JSON.stringify(late.day)}&&s.end===1320).id`);
    assert.equal(await evaluate(`document.querySelector('[data-shift="${lateId}"]').style.gridRowStart`),'25');
    assert.equal(await evaluate(`staff.find(s=>s.dbid===${late.staff_id}).hours`),late.hours+1);
    assert.equal(await evaluate(`staff.find(s=>s.dbid===${late.staff_id}).close`),late.close+(late.alreadyClosing?0:1));
    await evaluate(`api('/shifts/${lateId}',{method:'DELETE'}).then(loadWeek)`);
    await evaluate('setView("dashboard")');
    await call('Page.reload');
    await waitFor('typeof user!=="undefined" && !!user && !!document.querySelector("#handoff .shift")');
    assert.equal(await evaluate('staff[0].phone'),'010-1234-5678');
  }
  await evaluate('setView("dashboard")');
  await waitFor('document.querySelector("#handoff").children.length===3');

  await evaluate('setView("schedule")');
  for(const width of [390,700,768,1024,1280,1536]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:1400,deviceScaleFactor:1,mobile:false});
    await evaluate('setView("dashboard");scrollTo(0,0)');
    const dutyLayout=await evaluate('(()=>{const a=document.querySelector(".dashboard-duty-layout>section").getBoundingClientRect(),b=document.querySelector(".duty-card").getBoundingClientRect();return {right:a.right,top:a.top,bottom:a.bottom,dutyLeft:b.left,dutyTop:b.top};})()');
    assert.equal(width>1200?dutyLayout.dutyLeft>=dutyLayout.right:dutyLayout.dutyTop>=dutyLayout.bottom,true,`duty layout at ${width}px`);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`dashboard overflow at ${width}px`);
    const headings=await evaluate('[...document.querySelectorAll("#dashboard h2")].map(e=>({card:!!e.closest(".card"),head:e.parentElement.classList.contains("card-head"),size:getComputedStyle(e).fontSize,padding:getComputedStyle(e.parentElement).padding}))');
    assert.equal(headings.length,3);
    assert.equal(headings.every(e=>e.card&&e.head&&e.size===headings[0].size&&e.padding===headings[0].padding),true,`dashboard headings at ${width}px`);

    await evaluate('setView("schedule");scrollTo(0,0)');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`overflow at ${width}px`);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".time-end")).fontSize===getComputedStyle(document.querySelector(".time-tick:not(.half-hour)")).fontSize && getComputedStyle(document.querySelector(".time-end")).fontWeight===getComputedStyle(document.querySelector(".time-tick:not(.half-hour)")).fontWeight'),true);
    const size=await evaluate('(()=>{const b=document.querySelector(".week-board");return {w:b.clientWidth,sw:b.scrollWidth,h:b.clientHeight,sh:b.scrollHeight,tracks:[...b.querySelectorAll(".day-track")].map(e=>({w:e.clientWidth,sw:e.scrollWidth,h:e.clientHeight,sh:e.scrollHeight,display:getComputedStyle(e).display}))};})()');
    assert.equal(size.sw<=size.w&&size.sh<=size.h,true,`schedule overflow at ${width}px: ${JSON.stringify(size)}`);
    assert.equal(await evaluate('[...document.querySelectorAll(".day-track")].filter(e=>getComputedStyle(e).display!=="none").length'),width<=900?1:5);
    const layout=await evaluate('(()=>{const a=document.querySelector("#full-schedule-slot").getBoundingClientRect(),b=document.querySelector(".stats-card").getBoundingClientRect();return {left:a.left,right:a.right,width:a.width,statsLeft:b.left,statsTop:b.top,statsWidth:b.width,top:a.top,zoom:Number(getComputedStyle(document.body).zoom),row:document.querySelector(".time-tick").getBoundingClientRect().height};})()');
    assert.equal(layout.zoom,width>900?.8:1);
    if(width>1000){assert.equal(layout.statsLeft>=layout.right,true);assert.equal(layout.width>layout.statsWidth*1.7,true);assert.equal(Math.abs(layout.top-layout.statsTop)<2,true);assert.equal(layout.row>=30&&layout.row<=41,true);assert.equal(await evaluate('document.querySelector(".shift-issues-card").getBoundingClientRect().top>=document.querySelector(".stats-card").getBoundingClientRect().bottom'),true);}


  }
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});


  assert.equal(await evaluate('(()=>{const board=document.querySelector(".week-board");return board.scrollHeight<=board.clientHeight&&board.scrollWidth<=board.clientWidth;})()'),true);
  await evaluate('setView("dashboard")');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(root,local?'preview-readable.png':'preview-live.png'),Buffer.from(shot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});

  await evaluate('setView("schedule");[...document.querySelectorAll("[data-day]")].find(b=>Number(b.dataset.day)===1).click()');
  assert.equal(await evaluate('document.querySelector(".selected-day").getAttribute("aria-label").includes("화요일")'),true);
  const mobileShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(root,'preview-readable-mobile.png'),Buffer.from(mobileShot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:1536,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('setView("schedule")');
  const scheduleShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(root,'preview-schedule.png'),Buffer.from(scheduleShot.data,'base64'));
  await evaluate('setView("tagging")');
  await waitFor('!!document.querySelector(".tag-mark")');
  const tagShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(root,'preview-tagging.png'),Buffer.from(tagShot.data,'base64'));
  await evaluate('setView("archive")');
  if(local)await evaluate('archiveMonth="2099-01";loadArchive()');
  await waitFor('document.querySelectorAll(".archive-group").length===7');
  for(const [width,height] of [[390,844],[768,1024],[1024,768],[1280,800],[1536,768]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate('scrollTo(0,0)');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`archive overflow at ${width}px`);
    const table=await evaluate('(()=>{const r=document.querySelector(".archive-table").getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,page:document.documentElement.scrollHeight};})()');
    assert.equal(table.top>=0&&table.bottom<=table.height&&table.page<=table.height,true,`archive requires scrolling at ${width}x${height}: ${JSON.stringify(table)}`);
  }
  const archiveShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(root,'preview-archive.png'),Buffer.from(archiveShot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const archiveMobileShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(join(root,'preview-archive-mobile.png'),Buffer.from(archiveMobileShot.data,'base64'));
  assert.deepEqual(errors,[]);
  console.log('PASS: Pretendard loading, 26 half-hour ticks through 22:00, name-only merged shift placement and live Korean date/time, no schedule scrolling, previous/current/next, 80% desktop scaling, dashboard with status, shared duty contact, and issues, taller calendar beside compact stats and weekly shift-change issues, persistent monthly tagging, archive drawing and manual assignments, full archive table without scrolling, account linking, worker-owned checklists, current-time boundaries, and 390–1536px layouts.');
  await command('Browser.close');
}

main().catch(error => { console.error(error, errors); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close();
  browser.kill();
  await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve));
  await require('node:fs/promises').rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
