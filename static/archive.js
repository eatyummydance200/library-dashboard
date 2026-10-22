let archiveMonth=localInput().slice(0,7), archiveRequest=0, archiveData=null, archiveEdit=null;
$('#archive-month').value=archiveMonth;
function archiveTime(value){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
async function loadArchive(){
  const requestId=++archiveRequest, month=archiveMonth;
  $('#archive-month').value=month;
  $('#prev-archive-month').disabled=month==='2000-01';$('#next-archive-month').disabled=month==='2100-12';
  $('#archive-content').textContent='불러오는 중…';archiveData=null;
  try{
    const data=await api('/archive?month='+encodeURIComponent(month));
    if(requestId!==archiveRequest)return;
    archiveData=data;
    const assigned=!!data.draw, admin=user.role==='admin';
    const rows=assigned?data.assignments:data.groups.map((papers,i)=>({group_number:i+1,staff_name:'미정',staff_id:null,tasks:papers.map(newspaper=>({newspaper,completed:0}))}));
    const total=rows.flatMap(a=>a.tasks), done=total.filter(t=>t.completed).length;
    $('#archive-content').innerHTML=`<div class="archive-summary"><div class="archive-progress"><strong>${done}<span> / ${total.length} 완료</span></strong><progress max="${total.length}" value="${done}" aria-label="${month} 과월호 진행률">${done}/${total.length}</progress></div><div class="archive-actions">${admin?`${!assigned?`<button class="btn" id="draw-archive" ${data.participants.length!==7?'disabled':''} data-month="${month}">무작위 추첨</button>`:''}<button class="btn primary" id="edit-archive" ${!assigned&&data.participants.length<7?'disabled':''}>${assigned?'담당자 수정':'수동 입력'}</button>`:''}</div></div>${!assigned&&data.participants.length!==7&&admin?'<p class="archive-notice">추첨은 재직 7명일 때 가능합니다. 수동 입력은 7명을 선택해주세요.</p>':''}${!admin&&!user.staff_id?'<p class="archive-notice">본인 체크는 관리자에게 계정과 근무자 이름 연결을 요청해주세요.</p>':''}<div class="table-inset"><table class="archive-table"><caption class="sr-only">${month} 번호별 과월호 담당자와 신문사 완료 상태</caption><thead><tr><th scope="col">번호</th><th scope="col">담당자</th><th scope="col">신문사 · 완료 체크</th><th scope="col">완료</th></tr></thead><tbody>${rows.map(a=>{
      const mine=assigned&&user.staff_id===a.staff_id, editable=assigned&&(admin||mine), count=a.tasks.filter(t=>t.completed).length;
      return `<tr class="archive-group ${mine?'my-archive':''} ${count===a.tasks.length?'archive-complete':''}"><td><span class="archive-number">${a.group_number}</span></td><th scope="row" class="archive-owner">${esc(a.staff_name)}${mine?'<small>내 담당</small>':''}</th><td><div class="archive-papers">${a.tasks.map(t=>{const detail=t.completed?`${archiveTime(t.completed_at)} · ${esc(t.completed_by_name||'')}`:assigned?'미완료':'배정 전';return `<label class="archive-task ${t.completed?'is-complete':''}" title="${detail}"><input type="checkbox" ${t.id?`data-archive-task="${t.id}"`:''} ${t.completed?'checked':''} ${editable?'':'disabled'} aria-label="${esc(a.staff_name)} ${esc(t.newspaper)} 과월호 완료 · ${detail}"><span>${esc(t.newspaper)}</span></label>`;}).join('')}</div></td><td class="archive-group-count">${count}/${a.tasks.length}</td></tr>`;
    }).join('')}</tbody></table></div>${assigned?`<p class="archive-meta">최초 등록 ${archiveTime(data.draw.created_at)} · ${esc(data.draw.created_by_name)}</p>`:''}`;
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
  if(event.target.closest('#edit-archive')&&archiveData){
    const data=archiveData;
    archiveEdit={month:data.month,expected:data.draw?data.assignments.map(a=>a.staff_id):null};
    const people=new Map(data.participants.map(p=>[p.id,p]));
    for(const a of data.assignments)if(!people.has(a.staff_id))people.set(a.staff_id,{id:a.staff_id,name:a.staff_name+' (비활성)'});
    $('#archive-edit-month').textContent=data.month;
    $('#archive-assignment-fields').innerHTML=data.groups.map((papers,i)=>`<label class="archive-editor-row"><span class="archive-number">${i+1}</span><span><strong>${papers.map(esc).join(' · ')}</strong><select data-archive-assignment required aria-label="${i+1}번 담당자"><option value="">담당자 선택</option>${[...people.values()].map(p=>`<option value="${p.id}" ${archiveEdit.expected?.[i]===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></span></label>`).join('');
    $('#archive-edit-dialog').showModal();return;
  }
  const button=event.target.closest('#draw-archive');if(!button||button.disabled)return;
  const month=button.dataset.month;
  if(!confirm(`${month} 담당을 무작위 추첨할까요? 완료 기록은 유지하며, 이후 담당자는 수동으로 수정할 수 있습니다.`))return;
  button.disabled=true;
  try{await api('/archive/draw',{method:'POST',body:{month}});await loadArchive();toast(`${month} 담당 추첨 결과를 저장했습니다.`);}
  catch(error){showError(error);await loadArchive().catch(showError);}
});
formHandler('#archive-edit-form',async()=>{
  const ids=[...document.querySelectorAll('[data-archive-assignment]')].map(s=>Number(s.value));
  if(new Set(ids).size!==7)throw new Error('담당자가 중복되었습니다. 7명을 한 번씩 선택해주세요.');
  await api('/archive/assignments',{method:'PUT',body:{...archiveEdit,staff_ids:ids}});
  $('#archive-edit-dialog').close();await loadArchive();toast('담당자를 저장했습니다. 완료 기록은 유지됩니다.');
});
document.addEventListener('change',async event=>{
  const input=event.target.closest('[data-archive-task]');if(!input)return;
  const completed=input.checked, restoreFocus=document.activeElement===input;input.disabled=true;
  try{await api('/archive/tasks/'+input.dataset.archiveTask,{method:'PUT',body:{completed}});await loadArchive();if(restoreFocus&&document.activeElement===document.body&&activeView==='archive')document.querySelector(`[data-archive-task="${input.dataset.archiveTask}"]`)?.focus({preventScroll:true});toast(completed?'과월호 완료를 저장했습니다.':'완료 표시를 해제했습니다.');}
  catch(error){input.checked=!completed;input.disabled=false;showError(error);}
});
