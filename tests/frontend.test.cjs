const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function screen() {
  const nodes = new Map();
  const clickHandlers = [];
  function node(selector) {
    if (!nodes.has(selector)) {
      const attributes = new Map(), classes = new Set();
      nodes.set(selector, {
        dataset: {},
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: name => attributes.get(name) ?? null,
        removeAttribute: name => attributes.delete(name),
        querySelector: child => node(selector + ' ' + child),
        classList: {
          toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
          contains: name => classes.has(name),
        },
      });
    }
    return nodes.get(selector);
  }
  const context = vm.createContext({
    document: {
      body: { dataset: { base: '/library-dashboard' } },
      querySelector: node,
      querySelectorAll: () => [],
      addEventListener(type, listener) { if (type === 'click') clickHandlers.push(listener); },
    },
    // Keep automatic initialization pending; drive schedule requests below.
    fetch: () => new Promise(() => {}),
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    pending: [],
    clickHandlers, testNode: node,
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

async function taggingScreen(year = 2026) {
  const context = screen();
  vm.runInContext(`
    koreaParts=()=>({year:'2026',month:'10'});user={role:'admin'};tagYear=${year};
    api=async path=>({year:Number(path.split('=')[1]),staff:[
      {id:1,name:'근무자 가',active:1},{id:2,name:'근무자 나',active:1}
    ],tags:[]});
  `, context);
  await vm.runInContext('loadTagging()', context);
  vm.runInContext(`
    api=(path,options)=>new Promise((resolve,reject)=>pending.push({path,options,resolve,reject}));
  `, context);
  context.button = (id = 1, month = 10) => {
    const button = context.testNode(`button-${id}-${month}`);
    button.dataset = { tagPerson: String(id), year: String(year), month: String(month), name: '근무자' };
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '—';
    return button;
  };
  context.click = button => context.clickHandlers[0]({
    target: { closest: selector => selector === '[data-tag-person]' ? button : null },
  });
  return context;
}

test('a successful check and uncheck update the cell and summary without replacing their containers', async () => {
  const context = await taggingScreen();
  const button = context.button();
  const table = context.testNode('#tag-table'), status = context.testNode('#tag-status');
  const tableHTML = table.innerHTML, statusHTML = status.innerHTML;
  for (const completed of [true, false]) {
    const save = context.click(button);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(button.getAttribute('aria-pressed'), String(!completed));
    const request = context.pending.at(-1);
    assert.equal(request.path, '/tagging/1/2026/10');
    assert.equal(request.options.body.completed, completed);
    request.resolve({ ok: true });
    await save;
    assert.equal(button.getAttribute('aria-pressed'), String(completed));
    assert.equal(button.textContent, completed ? '○' : '—');
    assert.match(button.getAttribute('aria-label'), new RegExp(completed ? '10월 완료$' : '10월 미완료$'));
    assert.equal(button.getAttribute('aria-busy'), null);
    assert.equal(button.getAttribute('aria-disabled'), null);
    assert.equal(context.testNode('#tag-status progress').value, Number(completed));
    assert.equal(context.testNode('#tag-status-percent').textContent, completed ? '50%' : '0%');
    assert.equal(context.testNode('[data-tag-status-person="1"]').classList.contains('is-complete'), completed);
    assert.match(context.testNode('#tag-status-count').innerHTML, new RegExp(`^${Number(completed)}<span>`));
    assert.equal(table.innerHTML, tableHTML);
    assert.equal(status.innerHTML, statusHTML);
  }
  assert.equal(context.pending.length, 2, 'checks must not make GET requests');
  assert.equal(vm.runInContext('tagStatusData.tags.length', context), 1);
});

test('duplicate clicks send one write and a failed save keeps the previous check and permits retry', async () => {
  const context = await taggingScreen();
  const button = context.button();
  const save = context.click(button);
  await context.click(button);
  assert.equal(context.pending.length, 1);
  context.pending[0].reject(new Error('저장 실패'));
  await save;
  assert.equal(button.textContent, '—');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(button.getAttribute('aria-disabled'), null);
  assert.equal(vm.runInContext('tagStatusData.tags.length', context), 0);
  assert.equal(context.testNode('#toast').textContent, '저장 실패');
  const retry = context.click(button);
  context.pending[1].resolve({ ok: true });
  await retry;
  assert.equal(button.textContent, '○');
});

test('different cells saved out of order retain both changes in the summary', async () => {
  const context = await taggingScreen();
  const first = context.click(context.button(1)), second = context.click(context.button(2));
  context.pending[1].resolve({ ok: true });
  await second;
  context.pending[0].resolve({ ok: true });
  await first;
  assert.equal(context.testNode('#tag-status progress').value, 2);
  assert.equal(context.testNode('#tag-status-percent').textContent, '100%');
});

for (const [year, month] of [[2025, 10], [2026, 9]]) {
  test(`checking ${year}-${month} leaves this month's summary unchanged`, async () => {
    const context = await taggingScreen(year);
    const status = context.testNode('#tag-status'), html = status.innerHTML;
    const button = context.button(1, month), save = context.click(button);
    context.pending[0].resolve({ ok: true });
    await save;
    assert.equal(button.textContent, '○');
    assert.equal(status.innerHTML, html);
    assert.equal(context.testNode('#tag-status-percent').textContent, undefined);
    assert.equal(vm.runInContext('tagStatusData.tags.length', context), year === 2026 ? 1 : 0);
  });
}

for (const succeeded of [true, false]) {
  test(`changing year waits for an in-flight ${succeeded ? 'successful' : 'failed'} save before fetching`, async () => {
    const context = await taggingScreen();
    const button = context.button(), save = context.click(button);
    const load = vm.runInContext('tagYear=2025;loadTagging()', context);
    assert.equal(context.pending.length, 1, 'year queries must wait for the write');
    if (succeeded) context.pending[0].resolve({ ok: true });
    else context.pending[0].reject(new Error('저장 실패'));
    await save;
    await Promise.resolve();
    assert.equal(context.pending.length, 3);
    for (const request of context.pending.slice(1)) {
      const year = Number(request.path.split('=')[1]);
      request.resolve({ year, staff: [{ id: 1, name: '근무자', active: 1 }],
        tags: year === 2026 && succeeded ? [{ staff_id: 1, month: 10, completed: 1 }] : [] });
    }
    await load;
    assert.match(context.testNode('#tag-table').innerHTML, /2025년 근무자별/);
    assert.match(context.testNode('#tag-status').innerHTML, new RegExp(`${Number(succeeded)}<span> / 1명 완료`));
  });
}
