
const icons={home:'<path d="m3 9 7-6 7 6v8H5V9"/><path d="M8 17v-6h4v6"/>',grid:'<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>',calendar:'<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6 3v4m8-4v4M3 9h14m-10 3h2m3 0h1m-6 3h2"/>',people:'<circle cx="8" cy="7" r="3"/><path d="M2 17v-2c0-4 12-4 12 0v2m-1-13c5 0 5 6 1 6m2 2c2 1 2 3 2 5"/>',message:'<path d="M17 11a6 6 0 0 1-6 6H3l1-4a7 7 0 1 1 13-2Z"/><path d="M7 8h6m-6 3h4"/>',archive:'<path d="M4 7v10h12V7M3 3h14v4H3zM8 11h4"/>',tag:'<path d="m3 4 7-1 7 7-7 7-7-7Z"/><circle cx="7" cy="7" r="1"/>',book:'<path d="M10 5c-3-2-5-2-8-1v12c3-1 5-1 8 1 3-2 5-2 8-1V4c-3-1-5-1-8 1Zm0 0v12"/>',chevron:'<path d="m8 5 5 5-5 5"/>',left:'<path d="m12 5-5 5 5 5"/>',clock:'<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',desk:'<rect x="3" y="3" width="14" height="10" rx="1"/><path d="M10 13v4m-4 0h8M3 10h14"/>',sun:'<circle cx="10" cy="10" r="3"/><path d="M10 2v1m0 14v1M2 10h1m14 0h1M4 4l1 1m10 10 1 1M4 16l1-1M15 5l1-1"/>',moon:'<path d="M16.5 12A7 7 0 0 1 8 3.5 7 7 0 1 0 16.5 12Z"/>',chart:'<path d="M4 16V9m6 7V4m6 12v-5"/>',plus:'<path d="M10 4v12M4 10h12"/>',check:'<path d="m4 10 4 4 8-8"/>',arrow:'<path d="M3 10h14m-5-5 5 5-5 5"/>'};
const icon=n=>`<svg viewBox="0 0 20 20" aria-hidden="true">${icons[n]||icons.grid}</svg>`;
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const navItems=[['dashboard','대시보드','grid'],['schedule','시간표','calendar'],['people','인적관리','people'],['issues','이슈','message'],['archive','과월호','archive'],['tagging','태깅','tag']];


const base=document.body.dataset.base;
let staff=[],shifts=Array.from({length:7},()=>[]),issues=[],rawShifts=[],users=[];
let user=null,csrfToken='',weekOffset=0,selectedStaff='',activeView='dashboard',editingId=null,editingShift=null,toastTimer,manualTime=false;
const days=['월','화','수','목','금'];
const formatTime=t=>`${String(Math.floor(t)).padStart(2,'0')}:${t%1?'30':'00'}`;

function preview(){const v=$('#preview-time').value;const date=new Date(`${v}:00+09:00`);return Number.isNaN(date.getTime())?null:date;}
function koreaParts(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);return Object.fromEntries(parts.map(p=>[p.type,p.value]));}
function snapshot(date){const p=koreaParts(date);const local=new Date(Date.UTC(+p.year,+p.month-1,+p.day));return {day:(local.getUTCDay()+6)%7,time:+p.hour+(+p.minute/60),date:local,month:+p.month,dayNumber:+p.day};}
function renderIcons(root=document){root.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));}
function weekDates(){const p=snapshot(preview()||new Date());const monday=new Date(p.date);monday.setUTCDate(monday.getUTCDate()-p.day+weekOffset*7);return days.map((_,i)=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+i);return d;});}
function renderSchedule(){
  if(activeView!=='dashboard'&&activeView!=='schedule')return;
  const dates=weekDates();
  const dateKey=date=>date.toISOString().slice(0,10);
  const now=new Date(), clock=koreaParts(now);
  const todayKey=`${clock.year}-${clock.month}-${clock.day}`;
  const todayColumn=dates.findIndex(d=>dateKey(d)===todayKey);
  const minute=Number(clock.hour)*60+Number(clock.minute);
  const operating=minute>=540&&minute<1260&&snapshot(now).day<5;
  const currentSlot=operating&&todayColumn>=0?Math.floor((minute-540)/30):-1;
  const slot=activeView==='schedule'?$('#full-schedule-slot'):$('#schedule-slot');
  const other=activeView==='schedule'?$('#schedule-slot'):$('#full-schedule-slot');
  const previous=slot.querySelector('.table-scroll');
  const saved=previous?.dataset.week===dateKey(dates[0])?{top:previous.scrollTop,left:previous.scrollLeft}:null;
  other.innerHTML='';
  const roleName=desk=>desk?'데스크':'대기';
  const rows=Array.from({length:24},(_,index)=>{
    const start=540+index*30,end=start+30;
    const current=index===currentSlot;
    return `<tr data-start="${start}" class="${start%60===0?'hour-start ':''}${current?'current-row':''}" ${current?'aria-current="time"':''}>
      <th class="time" scope="row" aria-label="${formatTime(start/60)}부터 ${formatTime(end/60)}까지"><span class="slot-start">${formatTime(start/60)}</span><span class="slot-end">${formatTime(end/60)}</span></th>
      ${days.map((_,day)=>{
        const entries=shifts[day].filter(s=>s.start*60<end&&s.end*60>start);
        return `<td class="${day===todayColumn?'today-col':''}"><div class="cell-items">${entries.map(s=>`<button type="button" data-shift="${s.persistId}" class="worker ${s.desk?'desk':'standby'} ${selectedStaff!==''&&selectedStaff!==String(s.id)?'dimmed':''}" title="${esc(staff[s.id].name)} · ${formatTime(s.start)}–${formatTime(s.end)} · ${roleName(s.desk)} 근무"><strong>${esc(staff[s.id].name)}</strong><small>${roleName(s.desk)}</small></button>`).join('')||'<span class="empty-slot" aria-label="배정 없음">—</span>'}</div>${current&&day===todayColumn?`<span class="now-line" style="top:${(minute-start)/30*100}%"><span>지금 ${clock.hour}:${clock.minute}</span></span>`:''}</td>`;
      }).join('')}
    </tr>`;
  }).join('');
  slot.innerHTML=`<div class="${activeView==='schedule'?'card schedule-only':''}">
    <div class="card-head schedule-head"><div><h2>주간 근무 시간표</h2><p class="subtitle">30분 단위 · 데스크와 대기 근무를 구분해 확인하세요.</p></div>
      <div class="week-controls"><button class="icon-btn" id="prev-week" aria-label="이전 주">${icon('left')}</button><strong>${dates[0].getUTCMonth()+1}.${String(dates[0].getUTCDate()).padStart(2,'0')} – ${dates[4].getUTCMonth()+1}.${String(dates[4].getUTCDate()).padStart(2,'0')}</strong><button class="icon-btn" id="next-week" aria-label="다음 주">${icon('chevron')}</button><button class="btn" id="this-week">이번 주</button></div>
    </div>
    ${user?.role==='admin'?'<div class="edit-toolbar"><button class="btn" id="add-shift">＋ 근무 추가</button><button class="btn" id="copy-week">다른 주에서 복사</button><span class="hint">근무 이름을 누르면 수정할 수 있어요.</span></div>':''}
    <div class="schedule-tools"><div class="legend"><span class="desk-legend"><i></i>데스크 담당</span><span class="standby-legend"><i></i>대기 근무</span></div><div class="schedule-filters"><button class="btn" id="show-now" ${currentSlot<0?'disabled':''}>현재 시간으로</button><select class="select" id="staff-filter" aria-label="시간표 근무자 선택"><option value="">전체 근무자</option>${staff.map(s=>`<option value="${s.id}" ${selectedStaff===String(s.id)?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div></div>
    <div class="schedule-clock"><span class="clock-label">${icon('clock')} 한국 시간 ${clock.month}.${clock.day} ${clock.hour}:${clock.minute}</span><span>${!operating?'운영시간 외 · 평일 09:00–21:00':todayColumn<0?'다른 주를 보고 있습니다.':'현재 근무 구간을 파란 선으로 표시합니다.'}</span></div>
    <div class="table-scroll" data-week="${dateKey(dates[0])}" tabindex="0" aria-label="주간 시간표, 가로와 세로로 스크롤할 수 있습니다."><table class="timetable"><caption class="sr-only">월요일부터 금요일, 09:00부터 21:00까지 30분 단위 근무 시간표. 파란색은 데스크 담당, 노란색은 대기 근무입니다.</caption><thead><tr><th scope="col">시간</th>${days.map((day,i)=>`<th scope="col" class="${todayColumn===i?'today':''}"><span>${day}요일</span><span class="day-date">${dates[i].getUTCMonth()+1}.${String(dates[i].getUTCDate()).padStart(2,'0')}${todayColumn===i?' · 오늘':''}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="table-foot"><span>시간은 한국 시간 기준입니다.</span><span>파랑 · 데스크 담당 / 노랑 · 대기 근무</span></div>
  </div>`;
  const scroller=slot.querySelector('.table-scroll');
  if(saved){scroller.scrollTop=saved.top;scroller.scrollLeft=saved.left;}
  $('#prev-week').onclick=()=>{weekOffset--;loadWeek().catch(showError);};
  $('#next-week').onclick=()=>{weekOffset++;loadWeek().catch(showError);};
  $('#this-week').onclick=()=>{$('#preview-time').value=localInput();manualTime=false;weekOffset=0;loadWeek().then(loadStatus).catch(showError);};
  $('#staff-filter').onchange=e=>{selectedStaff=e.target.value;renderSchedule();};
  function focusCurrent(behavior='auto'){
    const row=slot.querySelector('.current-row'),cell=row?.querySelector('.today-col');
    if(!row||!cell)return;
    scroller.scrollTo({top:Math.max(0,row.offsetTop-scroller.clientHeight/2+row.offsetHeight/2),left:Math.max(0,cell.offsetLeft-(scroller.clientWidth-cell.offsetWidth)/2),behavior});
  }
  $('#show-now').onclick=()=>focusCurrent(matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth');
  if(!saved&&currentSlot>=0)focusCurrent();
}
function renderStats(){
  $('#staff-stats').innerHTML=staff.map((s,i)=>`<div class="staff-row"><div class="staff-name"><span class="avatar av-${i%7}">${esc(s.name.slice(0,1))}</span>${esc(s.name)}</div><span>${s.hours}<small>h</small></span><span class="blue">${s.desk}<small>h</small></span><span>${s.open}<small>회</small></span><span>${s.close}<small>회</small></span></div>`).join('');
}
function renderNav(){$('#navigation').innerHTML=navItems.map(([id,label,ic])=>`<button data-view="${id}" class="${activeView===id?'active':''}" ${activeView===id?'aria-current="page"':''}>${icon(ic)}${label}${['archive','tagging'].includes(id)?'<span class="soon">SOON</span>':''}${id==='issues'?`<span class="count-badge">${issues.filter(i=>!i.done).length}</span>`:''}</button>`).join('');}
function setView(id){if(!navItems.some(n=>n[0]===id))return;activeView=id;document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==id);const title=navItems.find(n=>n[0]===id)[1];$('#breadcrumb').textContent=title;$('#page-title').textContent=id==='dashboard'?'근무 대시보드':title;$('#page-subtitle').textContent={dashboard:'지금 근무 중인 사람과 이번 주 시간표를 확인하세요.',schedule:'우리의 한 주를 함께 확인하고, 근무를 준비하세요.',people:'함께하는 근무자들의 정보를 한곳에서 관리하세요.',issues:'오늘의 이슈와 다음 근무자를 위한 인계 사항을 모아요.',archive:'과월호 관리를 위한 공간입니다.',tagging:'태깅 관리를 위한 공간입니다.'}[id];renderNav();renderSchedule();applyPermissions();if(id==='people'&&user.role==='admin')loadUsers().catch(showError);}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,2600);}
