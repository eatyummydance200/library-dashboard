const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function screen() {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { dataset: {} });
    return nodes.get(selector);
  }
  const context = vm.createContext({
    document: {
      body: { dataset: { base: '/library-dashboard' } },
      querySelector: node,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    // Keep automatic initialization pending; drive schedule requests below.
    fetch: () => new Promise(() => {}),
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    pending: [],
  });
  for (const file of ['app.js', 'actions.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../static', file), 'utf8'), context);
  }
  vm.runInContext(`
    api=path=>new Promise(resolve=>pending.push({week:path.split('=')[1],resolve}));
    renderStats=()=>{};renderPeople=()=>{};renderSchedule=()=>{};applyPermissions=()=>{};
  `, context);
  return context;
}

for (const offset of [1, 0]) {
  test(`late schedule response is ignored (${offset ? 'different' : 'same'} week)`, async () => {
    const context = screen();
    const run = code => vm.runInContext(code, context);
    const first = run('weekOffset=0;loadWeek()');
    const second = run(`weekOffset=${offset};loadWeek()`);
    function reply(index, name) {
      context.pending[index].resolve({
        week: context.pending[index].week,
        staff: [{ id: 1, name, active: 1 }],
        shifts: [{ id: index + 1, staff_id: 1, day: context.pending[index].week,
          start: 540, end: 600, role: 'desk' }],
      });
    }
    reply(1, 'Latest');
    await second;
    reply(0, 'Stale');
    await first;
    assert.equal(run('rawShifts[0].id'), 2);
    assert.equal(run('staff[0].name'), 'Latest');
    assert.equal(run('staff[0].hours'), 1);
    assert.equal(run('rawShifts[0].day'), context.pending[1].week);
  });
}

test('response is ignored when the selected week changed before it arrived', async () => {
  const context = screen();
  const request = vm.runInContext('loadWeek()', context);
  vm.runInContext('weekOffset++', context);
  context.pending[0].resolve({});
  await request;
  assert.equal(vm.runInContext('rawShifts.length', context), 0);
});

test('tagging summary counts active workers for the given month and escapes names', () => {
  const context = screen();
  context.data = { year: 2026, staff: [
    { id: 1, name: '<img src=x>', active: 1 }, { id: 2, name: '미완료 근무자', active: 1 },
    { id: 3, name: '퇴직 근무자', active: 0 },
  ], tags: [
    { staff_id: 1, month: 10, completed: 1 }, { staff_id: 2, month: 9, completed: 1 },
    { staff_id: 2, month: 10, completed: 0 }, { staff_id: 3, month: 10, completed: 1 },
  ] };
  vm.runInContext('renderTaggingStatus(data,10)', context);
  const html = vm.runInContext('$("#tag-status").innerHTML', context);
  assert.match(html, /1<span> \/ 2명 완료/);
  assert.match(html, /50%/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /퇴직 근무자|<img/);
  assert.match(vm.runInContext('$("#tag-status-month").textContent', context), /2026년 10월/);
});

test('tagging summary handles no active workers', () => {
  const context = screen();
  vm.runInContext('renderTaggingStatus({year:2026,staff:[],tags:[]},10)', context);
  const html = vm.runInContext('$("#tag-status").innerHTML', context);
  assert.match(html, /재직 중인 근무자가 없습니다/);
  assert.match(html, /max="1" value="0"/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

for (const year of [2026, 2025]) {
  test(`annual table ${year} keeps summary on the actual current month`, async () => {
    const context = screen();
    context.calls = [];
    vm.runInContext(`
      koreaParts=()=>({year:'2026',month:'10'});user={role:'worker'};tagYear=${year};
      api=async path=>{
        calls.push(path);
        const year=Number(path.split('=')[1]);
        return {year,staff:[{id:1,name:'근무자',active:1}],tags:year===2026?[{staff_id:1,month:10,completed:1}]:[]};
      };
    `, context);
    await vm.runInContext('loadTagging()', context);
    assert.match(vm.runInContext('$("#tag-status-month").textContent', context), /2026년 10월/);
    assert.match(vm.runInContext('$("#tag-status").innerHTML', context), /1<span> \/ 1명 완료/);
    assert.match(vm.runInContext('$("#tag-table").innerHTML', context), new RegExp(`${year}년 근무자별`));
    assert.equal(context.calls.length, year === 2026 ? 1 : 2);
    assert.match(vm.runInContext('$("#tag-table").innerHTML', context), /disabled/);
  });
}

test('stale tagging requests cannot replace the newest annual table or summary', async () => {
  const context = screen();
  vm.runInContext("koreaParts=()=>({year:'2026',month:'10'});user={role:'admin'};tagYear=2025", context);
  const first = vm.runInContext('loadTagging()', context);
  const second = vm.runInContext('tagYear=2026;loadTagging()', context);
  const data = { year: 2026, staff: [{ id: 1, name: '최신', active: 1 }],
    tags: [{ staff_id: 1, month: 10, completed: 1 }] };
  context.pending[2].resolve(data);
  await second;
  context.pending[0].resolve({ ...data, year: 2025, tags: [] });
  context.pending[1].resolve({ ...data, tags: [] });
  await first;
  assert.match(vm.runInContext('$("#tag-status").innerHTML', context), /1<span> \/ 1명 완료/);
  assert.match(vm.runInContext('$("#tag-table").innerHTML', context), /2026년 근무자별/);
});
