
const icons={home:'<path d="m3 9 7-6 7 6v8H5V9"/><path d="M8 17v-6h4v6"/>',grid:'<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>',calendar:'<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6 3v4m8-4v4M3 9h14m-10 3h2m3 0h1m-6 3h2"/>',people:'<circle cx="8" cy="7" r="3"/><path d="M2 17v-2c0-4 12-4 12 0v2m-1-13c5 0 5 6 1 6m2 2c2 1 2 3 2 5"/>',message:'<path d="M17 11a6 6 0 0 1-6 6H3l1-4a7 7 0 1 1 13-2Z"/><path d="M7 8h6m-6 3h4"/>',archive:'<path d="M4 7v10h12V7M3 3h14v4H3zM8 11h4"/>',tag:'<path d="m3 4 7-1 7 7-7 7-7-7Z"/><circle cx="7" cy="7" r="1"/>',book:'<path d="M10 5c-3-2-5-2-8-1v12c3-1 5-1 8 1 3-2 5-2 8-1V4c-3-1-5-1-8 1Zm0 0v12"/>',chevron:'<path d="m8 5 5 5-5 5"/>',left:'<path d="m12 5-5 5 5 5"/>',clock:'<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',desk:'<rect x="3" y="3" width="14" height="10" rx="1"/><path d="M10 13v4m-4 0h8M3 10h14"/>',sun:'<circle cx="10" cy="10" r="3"/><path d="M10 2v1m0 14v1M2 10h1m14 0h1M4 4l1 1m10 10 1 1M4 16l1-1M15 5l1-1"/>',moon:'<path d="M16.5 12A7 7 0 0 1 8 3.5 7 7 0 1 0 16.5 12Z"/>',chart:'<path d="M4 16V9m6 7V4m6 12v-5"/>',plus:'<path d="M10 4v12M4 10h12"/>',check:'<path d="m4 10 4 4 8-8"/>',arrow:'<path d="M3 10h14m-5-5 5 5-5 5"/>'};
const icon=n=>`<svg viewBox="0 0 20 20" aria-hidden="true">${icons[n]||icons.grid}</svg>`;
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const navItems=[['dashboard','대시보드','grid'],['schedule','시간표','calendar'],['people','인적관리','people'],['issues','이슈','message'],['archive','과월호','archive'],['tagging','태깅','tag']];


const base=document.body.dataset.base;
let staff=[],shifts=Array.from({length:7},()=>[]),issues=[],rawShifts=[],users=[],shiftIssues=[];
let user=null,csrfToken='',weekOffset=0,selectedStaff='',activeView='dashboard',editingId=null,editingShift=null,toastTimer;
const days=['월','화','수','목','금'];
const scheduleStart=540,scheduleEnd=1320,scheduleSlots=(scheduleEnd-scheduleStart)/30;
const formatTime=t=>`${String(Math.floor(t)).padStart(2,'0')}:${t%1?'30':'00'}`;

function koreaParts(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);return Object.fromEntries(parts.map(p=>[p.type,p.value]));}
function snapshot(date){const p=koreaParts(date);const local=new Date(Date.UTC(+p.year,+p.month-1,+p.day));return {day:(local.getUTCDay()+6)%7,time:+p.hour+(+p.minute/60),date:local,month:+p.month,dayNumber:+p.day};}
function renderIcons(root=document){root.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));}
function weekDates(){const p=snapshot(new Date());const monday=new Date(p.date);monday.setUTCDate(monday.getUTCDate()-p.day+weekOffset*7);return days.map((_,i)=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+i);return d;});}
function layoutShifts(entries){
  const placed=[], counts=[];
  for(const desk of [true,false]){
    const ends=[], offset=counts.reduce((a,b)=>a+b,0);
    for(const shift of entries.filter(s=>s.desk===desk).sort((a,b)=>a.start-b.start||a.end-b.end||a.persistId-b.persistId)){
      let lane=ends.findIndex(end=>end<=shift.start);
      if(lane<0)lane=ends.length;
      ends[lane]=shift.end;placed.push({...shift,lane:offset+lane});
    }
    counts.push(Math.max(1,ends.length));
  }
  return {entries:placed,lanes:counts[0]+counts[1]};
}
let selectedDay=Math.min(snapshot(new Date()).day,4);
function renderSchedule(){
  if(activeView!=='schedule')return;
  const dates=weekDates(), dateKey=date=>date.toISOString().slice(0,10);
  const now=new Date(), clock=koreaParts(now), todayKey=`${clock.year}-${clock.month}-${clock.day}`;
  const todayColumn=dates.findIndex(d=>dateKey(d)===todayKey), minute=Number(clock.hour)*60+Number(clock.minute);
  const currentSlot=minute>=scheduleStart&&minute<scheduleEnd&&todayColumn>=0?Math.floor((minute-scheduleStart)/30):-1;
  const slot=$('#full-schedule-slot');
  const ticks=Array.from({length:scheduleSlots},(_,i)=>`<div class="time-tick ${i===currentSlot?'current-row':''} ${i%2?'half-hour':''}" data-start="${scheduleStart+i*30}" ${i===currentSlot?'aria-current="time"':''}>${formatTime((scheduleStart+i*30)/60)}</div>`).join('');
  slot.innerHTML=`<div class="card schedule-only">
    <div class="card-head schedule-head"><h2>주간 근무 시간표</h2><div class="week-controls"><button class="icon-btn" id="prev-week" aria-label="이전 주">${icon('left')}</button><strong>${dates[0].getUTCMonth()+1}.${String(dates[0].getUTCDate()).padStart(2,'0')} – ${dates[4].getUTCMonth()+1}.${String(dates[4].getUTCDate()).padStart(2,'0')}</strong><button class="icon-btn" id="next-week" aria-label="다음 주">${icon('chevron')}</button><button class="btn" id="this-week">이번 주</button></div></div>
    <div class="schedule-tools"><div class="legend"><span class="desk-legend"><i></i>데스크</span><span class="standby-legend"><i></i>대기</span></div><div class="schedule-filters">${user?.role==='admin'?'<button class="btn" id="add-shift">＋ 근무 추가</button><button class="btn" id="copy-week">주 복사</button>':''}<select class="select" id="staff-filter" aria-label="시간표 근무자 선택"><option value="">전체 근무자</option>${staff.map(s=>`<option value="${s.id}" ${selectedStaff===String(s.id)?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div></div>
    <div class="day-picker" role="group" aria-label="시간표 요일 선택">${days.map((d,i)=>`<button type="button" data-day="${i}" aria-pressed="${selectedDay===i}">${d} <small>${dates[i].getUTCMonth()+1}.${dates[i].getUTCDate()}</small></button>`).join('')}</div>
    <div class="table-inset schedule-table"><div class="week-board" style="--slot-count:${scheduleSlots}" data-week="${dateKey(dates[0])}" aria-label="30분 단위 주간 근무 시간표">
      <div class="time-axis"><div class="day-heading">시간</div><div class="time-ticks">${ticks}<span class="time-end">${formatTime(scheduleEnd/60)}</span></div></div>
      ${days.map((day,i)=>{const layout=layoutShifts(shifts[i]);return `<section class="day-track ${selectedDay===i?'selected-day':''} ${todayColumn===i?'today-col':''}" aria-label="${dates[i].getUTCMonth()+1}월 ${dates[i].getUTCDate()}일 ${day}요일"><h3 class="day-heading">${day}<span>${dates[i].getUTCMonth()+1}.${dates[i].getUTCDate()}${todayColumn===i?' · 오늘':''}</span></h3><div class="track-grid" style="--lanes:${layout.lanes}">${layout.entries.map(s=>{const span=(s.end-s.start)*2, name=esc(staff[s.id].name), label=`${name} · ${formatTime(s.start)}–${formatTime(s.end)} · ${s.desk?'데스크':'대기'}`;return `<button type="button" data-shift="${s.persistId}" data-lane="${s.lane}" data-start="${s.start*60}" data-end="${s.end*60}" class="worker ${s.desk?'desk':'standby'} ${span===1?'short-shift':''} ${selectedStaff!==''&&selectedStaff!==String(s.id)?'dimmed':''}" style="grid-row:${(s.start-9)*2+1}/span ${span};grid-column:${s.lane+1}" title="${label}" aria-label="${label}"><strong>${name}</strong></button>`;}).join('')}${!layout.entries.length?'<span class="empty-day">배정 없음</span>':''}${i===todayColumn&&currentSlot>=0?`<div class="current-band" style="top:${currentSlot/scheduleSlots*100}%"></div><span class="now-line" style="top:${(minute-scheduleStart)/(scheduleEnd-scheduleStart)*100}%"><span>현재 ${clock.hour}:${clock.minute}</span></span>`:''}</div></section>`;}).join('')}
    </div></div>
  </div>`;
  $('#prev-week').onclick=()=>{weekOffset--;loadWeek().catch(showError);};
  $('#next-week').onclick=()=>{weekOffset++;loadWeek().catch(showError);};
  $('#this-week').onclick=()=>{weekOffset=0;selectedDay=Math.min(snapshot(new Date()).day,4);loadWeek().then(loadStatus).catch(showError);};
  $('#staff-filter').onchange=e=>{selectedStaff=e.target.value;renderSchedule();};
  slot.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{selectedDay=Number(button.dataset.day);renderSchedule();});
}
function renderStats(){
  $('#staff-stats').innerHTML=staff.map((s,i)=>`<div class="staff-row"><div class="staff-name"><span class="avatar av-${i%7}">${esc(s.name.slice(0,1))}</span>${esc(s.name)}</div><span>${s.hours}<small>h</small></span><span class="blue">${s.desk}<small>h</small></span><span>${s.open}<small>회</small></span><span>${s.close}<small>회</small></span></div>`).join('');
}
function renderNav(){$('#navigation').innerHTML=navItems.map(([id,label,ic])=>`<button data-view="${id}" class="${activeView===id?'active':''}" ${activeView===id?'aria-current="page"':''}>${icon(ic)}${label}${id==='issues'?`<span class="count-badge">${issues.filter(i=>!i.done).length}</span>`:''}</button>`).join('');}
function setView(id){if(!navItems.some(n=>n[0]===id))return;activeView=id;document.body.dataset.page=id;document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==id);const title=navItems.find(n=>n[0]===id)[1];$('#breadcrumb').textContent=title;$('#page-title').textContent=id==='dashboard'?'근무 대시보드':title;renderNav();renderSchedule();applyPermissions();if(id==='schedule')loadShiftIssues().catch(showError);if(id==='archive')loadArchive().catch(showError);if(id==='tagging')loadTagging().catch(showError);if(id==='people'&&user.role==='admin')loadUsers().catch(showError);}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,2600);}
