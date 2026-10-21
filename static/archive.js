let archiveMonth=localInput().slice(0,7), archiveRequest=0;
$('#archive-month').value=archiveMonth;
function archiveTime(value){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
async function loadArchive(){
  const requestId=++archiveRequest, month=archiveMonth;
  $('#archive-month').value=month;
  $('#prev-archive-month').disabled=month==='2000-01';$('#next-archive-month').disabled=month==='2100-12';
  $('#archive-content').textContent='불러오는 중…';
  try{
    const data=await api('/archive?month='+encodeURIComponent(month));
    if(requestId!==archiveRequest)return;
    if(!data.draw){
      const eligible=data.participants.length===data.groups.length;
      $('#archive-content').innerHTML=`<div class="archive-start"><div><h3>${esc(month.replace('-','년 '))}월 추첨 전</h3><p>${user.role==='admin'?`재직 근무자 ${data.participants.length}명 · 신문 묶음 ${data.groups.length}개`:'관리자가 추첨하면 담당 신문사가 표시됩니다.'}</p></div>${user.role==='admin'?`<button class="btn primary" id="draw-archive" ${eligible?'':'disabled'} data-month="${month}">담당자 추첨</button>`:''}</div>${!eligible&&user.role==='admin'?'<p class="archive-notice">7개 묶음의 추첨에는 재직 근무자 7명이 필요합니다. 인적관리에서 재직 상태를 확인해주세요.</p>':''}<div class="archive-grid">${data.groups.map((papers,i)=>`<article class="archive-group unassigned-group"><div class="archive-group-head"><span class="archive-number">${i+1}번</span><h3>담당 미정</h3></div><ul class="archive-paper-list">${papers.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></article>`).join('')}</div>`;
      return;
    }
    const total=data.assignments.flatMap(a=>a.tasks), done=total.filter(t=>t.completed).length;
    $('#archive-content').innerHTML=`<div class="archive-summary"><div><strong>${done}<span> / ${total.length}개 신문사 완료</span></strong><progress max="${total.length}" value="${done}" aria-label="${month} 과월호 진행률">${done}/${total.length}</progress></div><span class="archive-drawn">${archiveTime(data.draw.created_at)} 추첨 · ${esc(data.draw.created_by_name)}</span></div>${user.role!=='admin'&&!user.staff_id?'<p class="archive-notice">본인 과월호를 체크하려면 관리자에게 계정과 근무자 이름 연결을 요청해주세요.</p>':''}<div class="archive-grid">${data.assignments.map(a=>{
      const mine=user.staff_id===a.staff_id, editable=user.role==='admin'||mine, count=a.tasks.filter(t=>t.completed).length;
      return `<article class="archive-group ${mine?'my-archive':''} ${count===a.tasks.length?'archive-complete':''}"><div class="archive-group-head"><span class="archive-number">${a.group_number}번</span><h3>${esc(a.staff_name)}${mine?'<small>내 담당</small>':''}</h3><span class="archive-group-count">${count}/${a.tasks.length}</span></div><div class="archive-task-list">${a.tasks.map(t=>`<label class="archive-task ${t.completed?'is-complete':''}"><input type="checkbox" data-archive-task="${t.id}" ${t.completed?'checked':''} ${editable?'':'disabled'} aria-label="${esc(a.staff_name)} ${esc(t.newspaper)} 과월호 완료"><span><strong>${esc(t.newspaper)}</strong><small>${t.completed?`${archiveTime(t.completed_at)} · ${esc(t.completed_by_name||'')}`:'미완료'}</small></span><span class="archive-task-status">${t.completed?'완료':'대기'}</span></label>`).join('')}</div></article>`;
    }).join('')}</div>`;
  }catch(error){if(requestId===archiveRequest)$('#archive-content').textContent='과월호 기록을 불러오지 못했습니다. 과월호 탭을 다시 눌러주세요.';throw error;}
}
function shiftArchiveMonth(offset){
  const [year,month]=archiveMonth.split('-').map(Number), date=new Date(Date.UTC(year,month-1+offset,1));
  const next=date.toISOString().slice(0,7);if(next<'2000-01'||next>'2100-12')return;
  archiveMonth=next;loadArchive().catch(showError);
}
$('#prev-archive-month').onclick=()=>shiftArchiveMonth(-1);
$('#next-archive-month').onclick=()=>shiftArchiveMonth(1);
$('#this-archive-month').onclick=()=>{archiveMonth=localInput().slice(0,7);loadArchive().catch(showError);};
$('#archive-month').onchange=event=>{if(!event.target.value||!event.target.checkValidity()){event.target.value=archiveMonth;return;}archiveMonth=event.target.value;loadArchive().catch(showError);};
document.addEventListener('click',async event=>{
  const button=event.target.closest('#draw-archive');if(!button||button.disabled)return;
  const month=button.dataset.month;
  if(!confirm(`${month} 담당을 무작위 추첨할까요? 확정된 결과는 다시 추첨하지 않습니다.`))return;
  button.disabled=true;
  try{await api('/archive/draw',{method:'POST',body:{month}});await loadArchive();toast(`${month} 담당 추첨 결과를 저장했습니다.`);}
  catch(error){showError(error);await loadArchive().catch(showError);}
});
document.addEventListener('change',async event=>{
  const input=event.target.closest('[data-archive-task]');if(!input)return;
  const completed=input.checked, restoreFocus=document.activeElement===input;input.disabled=true;
  try{await api('/archive/tasks/'+input.dataset.archiveTask,{method:'PUT',body:{completed}});await loadArchive();if(restoreFocus&&document.activeElement===document.body&&activeView==='archive')document.querySelector(`[data-archive-task="${input.dataset.archiveTask}"]`)?.focus({preventScroll:true});toast(completed?'과월호 완료를 저장했습니다.':'완료 표시를 해제했습니다.');}
  catch(error){input.checked=!completed;input.disabled=false;showError(error);}
});
