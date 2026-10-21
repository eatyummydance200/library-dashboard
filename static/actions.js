async function api(path, options={}) {
  const headers={'Accept':'application/json',...options.headers};
  if(options.body){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
  if(options.method&&options.method!=='GET')headers['X-CSRF-Token']=csrfToken;
  const response=await fetch(base+'/api'+path,{...options,headers,credentials:'same-origin'});
  if(response.status===401){location.assign(base+'/login');throw new Error('다시 로그인해주세요.');}
  const data=await response.json().catch(()=>({error:'서버 응답을 확인하지 못했습니다.'}));
  if(!response.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');
  return data;
}
function showError(error){toast(error.message||'연결을 확인해주세요.');}
function localInput(date=new Date()){const p=koreaParts(date);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
function today(){return localInput().slice(0,10);}
function isoDay(date){return date.toISOString().slice(0,10);}
function applyPermissions(){document.querySelectorAll('.admin-only').forEach(e=>e.hidden=user?.role!=='admin');}
async function loadWeek(){
  const data=await api('/schedule?week='+isoDay(weekDates()[0]));
  rawShifts=data.shifts;
  staff=data.staff.map((person,i)=>({...person,dbid:person.id,id:i,hours:0,desk:0,open:0,close:0}));
  shifts=Array.from({length:7},()=>[]);
  const opening=new Set(),closing=new Set(),closingAt=new Map();
  for(const entry of rawShifts)closingAt.set(entry.day,Math.max(closingAt.get(entry.day)||1260,entry.end));
  for(const entry of rawShifts){
    const person=staff.find(s=>s.dbid===entry.staff_id);
    if(!person)continue;
    const day=(new Date(entry.day+'T00:00:00Z').getUTCDay()+6)%7;
    shifts[day].push({id:person.id,persistId:entry.id,day:entry.day,start:entry.start/60,end:entry.end/60,desk:entry.role==='desk'});
    person.hours+=(entry.end-entry.start)/60;
    if(entry.role==='desk')person.desk+=(entry.end-entry.start)/60;
    if(entry.start===540)opening.add(entry.staff_id+':'+entry.day);
    if(entry.end===closingAt.get(entry.day))closing.add(entry.staff_id+':'+entry.day);
  }
  for(const s of staff){s.open=[...opening].filter(k=>k.startsWith(s.dbid+':')).length;s.close=[...closing].filter(k=>k.startsWith(s.dbid+':')).length;}
  renderStats();renderPeople();renderSchedule();applyPermissions();if($('#staff-total'))$('#staff-total').textContent=staff.filter(s=>s.active).length+'명';
  document.querySelectorAll('.stats-card h2 small').forEach(e=>e.textContent=staff.filter(s=>s.active).length+'명');
  if(activeView==='schedule')await loadShiftIssues();
}
function renderPeople(){
  $('#people-rows').innerHTML=staff.map((s,i)=>`<tr><td><div class="staff-name"><span class="avatar av-${i%7}">${esc(s.name.slice(0,1))}</span>${esc(s.name)}${s.active?'':' <small>비활성</small>'}</div></td><td>${esc(s.phone||'미등록')}</td><td>연속간행물실</td><td>${user?.role==='admin'?`<button class="btn" data-edit="${s.id}">수정</button>`:'조회 전용'}</td></tr>`).join('');
}
async function loadStatus(){
  const at=$('#preview-time').value;
  const data=await api('/status?at='+encodeURIComponent(at+'+09:00'));
  const p=snapshot(preview()||new Date());
  $('#shift-date').textContent=`${p.month}월 ${p.dayNumber}일 ${['월','화','수','목','금','토','일'][p.day]}요일`;
  $('#status-mode').textContent=manualTime?'선택 시각 조회':'실시간';
  const when=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'예정 없음';
  const group=(entries,desk)=>{
    const assigned=entries.filter(entry=>(entry.role==='desk')===desk);
    return `<div class="duty-group ${desk?'desk-duty':'standby-duty'}" data-duty="${desk?'desk':'standby'}"><h3>${desk?'데스크 담당':'대기 근무'}</h3><div class="duty-people">${assigned.length?assigned.map(entry=>`<span class="duty-person">${esc(staff.find(s=>s.dbid===entry.staff_id)?.name||'근무자')}</span>`).join(''):'<span class="unassigned">배정 없음</span>'}</div></div>`;
  };
  $('#handoff').innerHTML=[['이전 근무',data.previous,data.previous_at],['현재 근무',data.current,data.at],['다음 근무',data.next,data.next_at]].map(([label,entries,time],i)=>`<article class="shift ${i===1?'current':''}" aria-label="${label}"><div class="shift-head"><h3>${i===1?'<i class="dot"></i>':icon(i===0?'clock':'arrow')}${label}</h3><time>${when(time)}</time></div>${group(entries,true)}${group(entries,false)}</article>`).join('');
}
let dutyContact={teacher:'',extension:''};
async function loadDuty(){
  dutyContact=await api('/duty');
  $('#duty-teacher').textContent=dutyContact.teacher||'미등록';
  $('#duty-extension').textContent=dutyContact.extension||'미등록';
}
$('#edit-duty').onclick=()=>{$('#duty-teacher-input').value=dutyContact.teacher;$('#duty-extension-input').value=dutyContact.extension;$('#duty-dialog').showModal();};
formHandler('#duty-form',async()=>{await api('/duty',{method:'PUT',body:{teacher:$('#duty-teacher-input').value.trim(),extension:$('#duty-extension-input').value.trim()}});$('#duty-dialog').close();await loadDuty();toast('당직 정보를 저장했어요.');});
async function loadIssues(){issues=await api('/issues');renderIssues();}
function renderIssues(){
  const open=issues.filter(i=>!i.done);
  $('#issue-count').textContent=open.length;
  $('#issue-preview').innerHTML=open.slice(0,2).map(i=>`<div><span class="pill ${i.category==='공지'?'green':''}">${esc(i.category)}</span><small>${esc(i.day)}</small><p>${esc(i.title)}</p></div>`).join('')||'<p>남아 있는 이슈가 없어요.</p>';
  const filter=$('#issue-filter').value;
  const visible=issues.filter(i=>filter==='all'||(filter==='done')===!!i.done);
  $('#issue-list').innerHTML=visible.map(i=>`<article class="issue-entry ${i.done?'done':''}"><span class="avatar">${esc(i.author.slice(0,1))}</span><div class="issue-body"><span class="pill ${i.category==='공지'?'green':''}">${esc(i.category)}</span><span class="hint">${i.done?'완료':'진행 중'} · ${esc(i.day)}</span><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p><small>${esc(i.author)} · ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(i.created_at))}</small></div><button class="btn" data-toggle-issue="${i.id}">${i.done?'다시 열기':'완료하기'}</button></article>`).join('')||'<div class="empty-state" style="padding:50px 0"><p>해당하는 이슈가 없어요.</p></div>';
  renderNav();
}
async function loadUsers(){
  users=await api('/users');
  $('#users-list').innerHTML=users.map(u=>`<div class="user-row"><strong>${esc(u.username)}</strong><span>${u.role==='admin'?'관리자':'근무자'} · ${u.active?'사용 중':'비활성'}</span>${u.role==='worker'?`<label class="account-link">연결 근무자<select class="select" data-link-user="${u.id}" aria-label="${esc(u.username)} 연결 근무자"><option value="">미연결</option>${staff.map(s=>`<option value="${s.dbid}" ${u.staff_id===s.dbid?'selected':''}>${esc(s.name)}${s.active?'':' (비활성)'}</option>`).join('')}</select></label>`:''}${u.id===user.id?'<small>내 계정</small>':`<button class="btn" data-user="${u.id}">${u.active?'비활성화':'활성화'}</button>`}</div>`).join('');
}
function openPerson(id=null){
  editingId=id;
  const person=id===null?null:staff[id];
  $('#contact-name').value=person?.name||'';$('#contact-phone').value=person?.phone||'';$('#contact-active').value=String(person?!!person.active:true);
  $('#contact-dialog h2').textContent=person?'근무자 정보 수정':'근무자 추가';$('#contact-dialog').showModal();
}
function openShift(id=null){
  if(user.role!=='admin')return;
  editingShift=id;
  const entry=rawShifts.find(s=>s.id===id);
  $('#shift-person').innerHTML=staff.filter(s=>s.active||s.dbid===entry?.staff_id).map(s=>`<option value="${s.dbid}">${esc(s.name)}${s.active?'':' (비활성)'}</option>`).join('');
  $('#shift-day').value=entry?.day||isoDay(weekDates()[0]);
  $('#shift-start').value=formatTime((entry?.start||540)/60);$('#shift-end').value=formatTime((entry?.end||600)/60);
  $('#shift-role').value=entry?.role||'desk';
  if(entry)$('#shift-person').value=String(entry.staff_id);
  $('#shift-dialog h2').textContent=entry?'근무 수정':'근무 추가';$('#delete-shift').hidden=!entry;
  $('#shift-dialog').showModal();
}
function formHandler(selector,callback){
  $(selector).onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;if(form.dataset.busy)return;const submit=form.querySelector('[type=submit]');form.dataset.busy='true';submit.disabled=true;
    try{await callback();}catch(error){showError(error);}finally{delete form.dataset.busy;submit.disabled=false;}};
}
document.addEventListener('click',async event=>{
  try{
    const view=event.target.closest('[data-view]');if(view)setView(view.dataset.view);
    const tag=event.target.closest('[data-tag-person]');
    if(tag&&!tag.disabled){
      tag.disabled=true;
      try{
        const completed=tag.getAttribute('aria-pressed')!=='true';
        await api(`/tagging/${tag.dataset.tagPerson}/${tagYear}/${tag.dataset.month}`,{method:'PUT',body:{completed}});
        tag.setAttribute('aria-pressed',String(completed));tag.textContent=completed?'○':'—';
        tag.setAttribute('aria-label',`${tag.dataset.name} ${tagYear}년 ${tag.dataset.month}월 ${completed?'완료':'미완료'}`);
        toast('태깅 상태를 저장했습니다.');
      }finally{tag.disabled=false;}
    }
    const close=event.target.closest('[data-close]');if(close)$('#'+close.dataset.close).close();
    const edit=event.target.closest('[data-edit]');if(edit)openPerson(+edit.dataset.edit);
    const shift=event.target.closest('[data-shift]');if(shift)openShift(+shift.dataset.shift);
    const toggle=event.target.closest('[data-toggle-issue]');if(toggle){const issue=[...issues,...shiftIssues].find(i=>i.id===+toggle.dataset.toggleIssue);await api('/issues/'+issue.id,{method:'PATCH',body:{done:!issue.done}});await loadIssues();if(activeView==='schedule')await loadShiftIssues();toast('이슈 상태를 저장했어요.');}
    const account=event.target.closest('[data-user]');if(account){const target=users.find(u=>u.id===+account.dataset.user);if(!confirm(`${target.username} 계정을 ${target.active?'비활성화':'활성화'}할까요?`))return;await api('/users/'+target.id,{method:'PATCH',body:{active:!target.active}});await loadUsers();toast('계정 상태를 변경했어요.');}
    if(event.target.closest('#add-shift'))openShift();
    if(event.target.closest('#copy-week')){$('#copy-source').value=isoDay(new Date(weekDates()[0].getTime()-7*86400000));$('#copy-target').value=isoDay(weekDates()[0]);$('#copy-dialog').showModal();}
  }catch(error){showError(error);}
});
$('#preview-time').onchange=async()=>{if(!preview())return;manualTime=true;weekOffset=0;try{await loadWeek();await loadStatus();}catch(error){showError(error);}};
$('#live-time').onclick=async()=>{manualTime=false;$('#preview-time').value=localInput();weekOffset=0;try{await loadWeek();await loadStatus();}catch(error){showError(error);}};
$('#add-person').onclick=()=>openPerson();
formHandler('#contact-form',async()=>{
  const name=$('#contact-name').value.trim(),phone=$('#contact-phone').value.trim(),active=$('#contact-active').value==='true';
  if(!name)throw new Error('이름을 입력해주세요.');
  await api(editingId===null?'/staff':'/staff/'+staff[editingId].dbid,{method:editingId===null?'POST':'PUT',body:{name,phone,active}});
  $('#contact-dialog').close();await loadWeek();await loadStatus();toast('근무자 정보를 저장했어요.');
});
formHandler('#shift-form',async()=>{
  const minute=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
  const body={staff_id:+$('#shift-person').value,day:$('#shift-day').value,start:minute($('#shift-start').value),end:minute($('#shift-end').value),role:$('#shift-role').value};
  await api(editingShift===null?'/shifts':'/shifts/'+editingShift,{method:editingShift===null?'POST':'PUT',body});
  $('#shift-dialog').close();await loadWeek();await loadStatus();toast('근무를 저장했어요.');
});
$('#delete-shift').onclick=async()=>{if(editingShift===null||!confirm('이 근무 구간을 삭제할까요?'))return;try{await api('/shifts/'+editingShift,{method:'DELETE'});$('#shift-dialog').close();await loadWeek();await loadStatus();toast('근무를 삭제했어요.');}catch(error){showError(error);}};
formHandler('#copy-form',async()=>{const data=await api('/schedule/copy',{method:'POST',body:{source:$('#copy-source').value,target:$('#copy-target').value}});$('#copy-dialog').close();await loadWeek();await loadStatus();toast(data.count+'개 근무 구간을 복사했어요.');});
$('#add-issue').onclick=()=>{$('#issue-form').reset();$('#issue-date').value=today();$('#issue-dialog').showModal();};
formHandler('#issue-form',async()=>{await api('/issues',{method:'POST',body:{day:$('#issue-date').value,category:$('#issue-category').value,title:$('#issue-title').value.trim(),body:$('#issue-content').value.trim()}});$('#issue-dialog').close();$('#issue-filter').value='all';await loadIssues();if(activeView==='schedule')await loadShiftIssues();toast('인계 사항을 저장했어요.');});
$('#issue-filter').onchange=renderIssues;
$('#logout-button').onclick=async()=>{try{await api('/logout',{method:'POST'});location.assign(base+'/login');}catch(error){showError(error);}};
$('#password-button').onclick=()=>{$('#password-form').reset();$('#password-dialog').showModal();};
formHandler('#password-form',async()=>{if($('#new-password').value!==$('#confirm-password').value)throw new Error('새 비밀번호가 일치하지 않습니다.');await api('/password',{method:'POST',body:{current:$('#current-password').value,password:$('#new-password').value}});location.assign(base+'/login');});
$('#add-user').onclick=()=>{$('#user-form').reset();$('#user-staff').innerHTML='<option value="">미연결</option>'+staff.filter(s=>s.active).map(s=>`<option value="${s.dbid}">${esc(s.name)}</option>`).join('');$('#user-dialog').showModal();};
formHandler('#user-form',async()=>{await api('/users',{method:'POST',body:{username:$('#user-name').value.trim(),password:$('#user-password').value,role:$('#user-role').value,staff_id:$('#user-staff').value?Number($('#user-staff').value):null}});$('#user-dialog').close();await loadUsers();toast('계정을 만들었어요.');});
$('#backup-button').onclick=()=>{location.assign(base+'/api/backup');};
async function initialize(){
  $('#preview-time').value=localInput();
  const data=await api('/me');user=data.user;csrfToken=data.csrf;
  $('#current-user').textContent=user.username+' · '+(user.role==='admin'?'관리자':'근무자');
  await loadWeek();await Promise.all([loadIssues(),loadStatus(),loadDuty()]);renderIcons();applyPermissions();
}
initialize().catch(error=>{$('#load-error').textContent='데이터를 불러오지 못했습니다. '+error.message+' 새로고침해주세요.';$('#load-error').hidden=false;});
async function refreshCurrentView(){
  if(!user||document.hidden)return;
  if(manualTime){renderSchedule();return;}
  try{$('#preview-time').value=localInput();await loadWeek();await Promise.all([loadStatus(),loadIssues(),loadDuty()]);}catch(error){showError(error);}
}
setInterval(refreshCurrentView,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCurrentView();});

$('.top-actions .avatar').onclick=()=>$('#account-dialog').showModal();
$('#account-password').onclick=()=>{$('#account-dialog').close();$('#password-button').click();};
$('#account-logout').onclick=()=>$('#logout-button').click();

let tagYear=Number(koreaParts(new Date()).year), tagRequest=0;
async function loadTagging(){
  const requestId=++tagRequest, year=tagYear;
  $('#tag-year').textContent=year+'년';
  $('#prev-tag-year').disabled=year<=2000;$('#next-tag-year').disabled=year>=2100;
  $('#tag-table').textContent='불러오는 중…';
  try{
    const data=await api('/tagging?year='+year);
    if(requestId!==tagRequest)return;
    const current=koreaParts(new Date()), editable=user.role==='admin';
    const months=Array.from({length:12},(_,i)=>i+1);
    const currentMonth=m=>year===Number(current.year)&&m===Number(current.month)?'this-month':'';
    $('#tag-permission').textContent=editable?'클릭하여 변경':'조회 전용';
    $('#tag-table').innerHTML=`<table class="tagging-table"><caption class="sr-only">${year}년 근무자별 월간 태깅 완료 여부</caption><thead><tr><th scope="col">근무자</th>${months.map(m=>`<th scope="col" class="${currentMonth(m)}">${m}월</th>`).join('')}</tr></thead><tbody>${data.staff.map(person=>`<tr><th scope="row">${esc(person.name)}${person.active?'':'<small>비활성</small>'}</th>${months.map(m=>{const completed=!!data.tags.find(t=>t.staff_id===person.id&&t.month===m)?.completed;return `<td class="${currentMonth(m)}"><button class="tag-mark" data-tag-person="${person.id}" data-month="${m}" data-name="${esc(person.name)}" aria-pressed="${completed}" aria-label="${esc(person.name)} ${year}년 ${m}월 ${completed?'완료':'미완료'}" ${editable?'':'disabled'}>${completed?'○':'—'}</button></td>`;}).join('')}</tr>`).join('')||'<tr><td colspan="13">등록된 근무자가 없습니다.</td></tr>'}</tbody></table>`;
  }catch(error){if(requestId===tagRequest)$('#tag-table').textContent='태깅 표를 불러오지 못했습니다. 태깅 탭을 다시 눌러주세요.';throw error;}
}
$('#prev-tag-year').onclick=()=>{if(tagYear>2000){tagYear--;loadTagging().catch(showError);}};
$('#next-tag-year').onclick=()=>{if(tagYear<2100){tagYear++;loadTagging().catch(showError);}};
$('#this-tag-year').onclick=()=>{tagYear=Number(koreaParts(new Date()).year);loadTagging().catch(showError);};

document.addEventListener('change',async event=>{
  const select=event.target.closest('[data-link-user]');if(!select)return;
  select.disabled=true;
  try{await api('/users/'+select.dataset.linkUser,{method:'PATCH',body:{staff_id:select.value?Number(select.value):null}});await loadUsers();toast('근무자 연결을 저장했습니다. 해당 계정은 다시 로그인해주세요.');}
  catch(error){const previous=users.find(u=>u.id===Number(select.dataset.linkUser));select.value=previous?.staff_id||'';showError(error);}
  finally{select.disabled=false;}
});

let shiftIssueRequest=0;
async function loadShiftIssues(){
  const requestId=++shiftIssueRequest, week=isoDay(weekDates()[0]);
  const data=await api('/issues?category='+encodeURIComponent('근무 변경')+'&week='+week);
  if(requestId!==shiftIssueRequest||week!==isoDay(weekDates()[0]))return;
  shiftIssues=data;
  const dates=weekDates();$('#shift-issue-week').textContent=`${dates[0].getUTCMonth()+1}.${dates[0].getUTCDate()}–${dates[4].getUTCMonth()+1}.${dates[4].getUTCDate()}`;
  renderShiftIssues();
}
function renderShiftIssues(){
  const filter=$('#shift-issue-filter').value;
  const visible=shiftIssues.filter(i=>filter==='all'||(filter==='done')===!!i.done);
  $('#shift-issue-list').innerHTML=visible.map(i=>`<article class="shift-issue-entry ${i.done?'done':''}"><div><time>${esc(i.day)}</time><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p><small>${esc(i.author)}</small></div><button class="text-btn" data-toggle-issue="${i.id}">${i.done?'다시 열기':'완료'}</button></article>`).join('')||'<p class="shift-issue-empty">해당 주의 이슈가 없습니다.</p>';
}
$('#shift-issue-filter').onchange=renderShiftIssues;
$('#add-shift-issue').onclick=()=>{$('#issue-form').reset();const dates=weekDates(),now=today();$('#issue-date').value=now>=isoDay(dates[0])&&now<=isoDay(dates[4])?now:isoDay(dates[0]);$('#issue-category').value='근무 변경';$('#issue-dialog').showModal();};
