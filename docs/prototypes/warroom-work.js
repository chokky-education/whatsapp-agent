// Synthetic work data for the local Warroom preview.
const timeZone = 'Asia/Bangkok';
const calendarDay = new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const longDate = new Intl.DateTimeFormat('th-TH', {
  timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat('th-TH', { timeZone, day: 'numeric', month: 'short' });
const time = new Intl.DateTimeFormat('th-TH', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const sections = [
  { id: 'overdue', label: 'เลยกำหนด', status: 'เลยกำหนด' },
  { id: 'today', label: 'วันนี้', status: 'วันนี้' },
  { id: 'upcoming', label: 'หลังวันนี้', status: 'เปิดอยู่' },
  { id: 'undated', label: 'ยังไม่มีกำหนด', status: 'เปิดอยู่' },
  { id: 'done', label: 'เสร็จวันนี้', status: 'เสร็จแล้ว' },
];

const viewer = { id: 'nok', groups: ['demo-studio'] };
const names = { nok: 'นก', somchai: 'สมชาย', mali: 'มะลิ' };
const dayMs = 86_400_000;
const start = Date.parse(`${calendarDay.format(Date.now())}T00:00:00+07:00`);
const at = (day, minutes) => start + day * dayMs + minutes * 60_000;
const house = 'บ้านตัวอย่าง';
const cafe = 'คาเฟ่ตัวอย่าง';
const office = 'สำนักงานตัวอย่าง';
const tasks = [
  { id: 1, title: 'ส่งแบบปรับห้องน้ำชั้นล่าง', project: house, assignee: 'nok', dueAt: at(-1, 900) },
  { id: 2, title: 'เช็กแบบไฟชั้น 2', project: house, assignee: 'nok', dueAt: at(0, 960) },
  { id: 3, title: 'สรุปตำแหน่งเคาน์เตอร์', project: cafe, assignee: 'nok', dueAt: at(0, 1050) },
  { id: 4, title: 'ตรวจรายการวัสดุปูพื้น', project: office, assignee: 'nok', dueAt: at(1, 840) },
  { id: 5, title: 'เตรียมแบบขยายหน้าต่าง', project: house, assignee: 'nok', dueAt: at(3, 660) },
  { id: 6, title: 'รวบรวมตัวอย่างสีผนัง', project: cafe, assignee: 'nok' },
  { id: 7, title: 'ส่งผังเฟอร์นิเจอร์ให้ทีม', project: office, assignee: 'nok', dueAt: at(0, 660), doneAt: Math.min(Date.now(), at(0, 620)) },
  { id: 8, title: 'วัดขนาดช่องเปิดหน้างาน', project: house, assignee: 'somchai', dueAt: at(-2, 930) },
  { id: 9, title: 'เช็กรายการสุขภัณฑ์กับแบบ', project: house, assignee: 'mali', dueAt: at(0, 1020) },
  { id: 10, title: 'ขอราคากระเบื้องตัวอย่าง', project: cafe, dueAt: at(2, 720) },
  { id: 11, title: 'เตรียมรายการตรวจหน้างาน' },
  { id: 12, title: 'ตรวจแบบห้องประชุม', project: 'โครงการกลุ่มอื่น', assignee: 'nok', group: 'other-studio' },
].map((task) => ({ group: 'demo-studio', dueAt: null, doneAt: null, ...task }));

const accessibleTasks = tasks.filter((task) => viewer.groups.includes(task.group));
const layouts = ['table', 'board'];
const layoutKey = 'warroom-work-layout';
let layout = 'table';
try {
  const saved = localStorage.getItem(layoutKey);
  if (layouts.includes(saved)) layout = saved;
} catch {
  // Storage may be disabled in a private browser.
}
let scope = 'mine';
let scenarioVersion = 0;
let nextSaveFails = false;
let selectedColumn = 0;
let lastSynced = Date.now();
let dayShown = calendarDay.format(lastSynced);
const pending = new Set();

const byId = (id) => document.getElementById(id);
const scenario = byId('work-scenario');
const filter = byId('work-project');
const content = byId('work-content');
const columnControls = byId('work-column-controls');
const feedback = byId('work-feedback');
const boardScroll = matchMedia('(max-width: 1199px)');
const offline = () => scenario.value === 'offline';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dayLabel(dueAt) {
  if (dueAt === null) return 'ยังไม่มีกำหนด';
  const date = calendarDay.format(dueAt) === dayShown ? 'วันนี้' : shortDate.format(dueAt);
  return `${date} ${time.format(dueAt)}`;
}

function sectionFor(task) {
  if (task.doneAt !== null) return calendarDay.format(task.doneAt) === dayShown ? 'done' : null;
  if (task.dueAt === null) return 'undated';
  const day = calendarDay.format(task.dueAt);
  if (day < dayShown) return 'overdue';
  return day === dayShown ? 'today' : 'upcoming';
}

function currentSections() {
  const grouped = Object.fromEntries(sections.map(({ id }) => [id, []]));
  if (scenario.value !== 'empty') {
    for (const task of accessibleTasks) {
      if (scope === 'mine' && task.assignee !== viewer.id) continue;
      if (filter.value && (task.project ?? 'unlinked') !== filter.value) continue;
      const section = sectionFor(task);
      if (section) grouped[section].push(task);
    }
  }
  for (const { id } of sections) {
    grouped[id].sort((a, b) => id === 'done' ? b.doneAt - a.doneAt : a.dueAt - b.dueAt || a.id - b.id);
  }
  return grouped;
}

function statusOf(section) {
  const status = element('span', 'work-status', section.status);
  status.dataset.section = section.id;
  return status;
}

function completeButton(task) {
  if (task.doneAt !== null || task.assignee !== viewer.id) return null;
  const saving = pending.has(task.id);
  const button = element('button', 'work-complete', saving ? 'กำลังบันทึก' : 'เสร็จ');
  button.type = 'button';
  button.dataset.complete = task.id;
  button.disabled = offline();
  button.setAttribute('aria-label', `${button.textContent} · ${task.title}`);
  if (saving) button.setAttribute('aria-disabled', 'true');
  return button;
}

function deadline(task) {
  if (task.dueAt === null) return document.createTextNode(dayLabel(null));
  const due = element('time', '', dayLabel(task.dueAt));
  due.dateTime = new Date(task.dueAt).toISOString();
  return due;
}

function tableView(grouped) {
  const wrapper = element('div', 'work-table-wrap');
  const table = element('table', 'work-table');
  table.setAttribute('aria-label', 'รายการงานตามกำหนดส่ง');
  table.setAttribute('role', 'table');
  const headers = table.createTHead().insertRow();
  headers.parentElement.setAttribute('role', 'rowgroup');
  headers.setAttribute('role', 'row');
  for (const label of ['งาน', 'โครงการ', 'ผู้รับผิดชอบ', 'กำหนดส่ง', 'สถานะ', 'ปิดงาน']) {
    const header = element('th', '', label);
    header.scope = 'col';
    header.setAttribute('role', 'columnheader');
    headers.append(header);
  }
  for (const section of sections) {
    if (grouped[section.id].length === 0) continue;
    const body = table.createTBody();
    body.setAttribute('role', 'rowgroup');
    const groupRow = body.insertRow();
    groupRow.setAttribute('role', 'row');
    groupRow.className = 'work-group';
    const header = element('th', 'work-group-title', section.label);
    header.scope = 'rowgroup';
    header.colSpan = 6;
    header.dataset.section = section.id;
    groupRow.append(header);

    for (const task of grouped[section.id]) {
      const row = body.insertRow();
      row.dataset.task = task.id;
      row.setAttribute('role', 'row');
      const details = [
        ['work-task-title', task.title],
        ['work-secondary work-project-cell', task.project ?? 'ไม่มีโครงการ'],
        ['work-secondary work-owner', names[task.assignee] ?? 'ยังไม่มีคนรับ'],
        ['work-deadline', deadline(task)],
        ['work-state', statusOf(section)],
        ['work-action', completeButton(task)],
      ];
      for (const [className, value] of details) {
        const cell = row.insertCell();
        cell.className = className;
        cell.setAttribute('role', 'cell');
        if (value !== null) cell.append(value);
      }
    }
  }
  wrapper.append(table);
  return wrapper;
}

function boardCard(task, section) {
  const card = element('article', 'work-card');
  card.dataset.task = task.id;
  const metadata = element('p', 'work-card-meta', `${task.project ?? 'ไม่มีโครงการ'} · ${names[task.assignee] ?? 'ยังไม่มีคนรับ'}`);
  const due = element('p', 'work-deadline');
  due.append(deadline(task));
  card.append(element('h3', 'work-task-title', task.title), due, metadata);
  const button = completeButton(task);
  if (button) {
    card.append(button);
    button.classList.add('work-action');
  } else {
    const status = statusOf(section);
    status.classList.add('work-action');
    card.append(status);
  }
  return card;
}

function setColumn(index) {
  selectedColumn = index;
  const button = columnControls.children[index];
  for (const control of columnControls.children) {
    control.setAttribute('aria-pressed', String(control === button));
  }
  if (button && boardScroll.matches) {
    const controlsLeft = columnControls.getBoundingClientRect().left;
    const bounds = button.getBoundingClientRect();
    if (bounds.left < controlsLeft || bounds.right > controlsLeft + columnControls.clientWidth) {
      columnControls.scrollLeft += bounds.left - controlsLeft - 3;
    }
  }
}

function moveBoard(board, index) {
  if (!boardScroll.matches) return;
  board.scrollLeft = board.children[index].offsetLeft - board.firstElementChild.offsetLeft;
}

function boardView(grouped) {
  const board = element('div', 'work-board');
  board.setAttribute('role', 'region');
  board.setAttribute('aria-label', 'กระดานงานตามกำหนดส่ง');
  const controls = [];
  sections.forEach((section, index) => {
    const rows = grouped[section.id];
    const column = element('section', 'work-column');
    column.dataset.section = section.id;
    column.setAttribute('aria-labelledby', `work-column-${section.id}`);
    const title = element('h2', '', section.label);
    title.id = `work-column-${section.id}`;
    const total = element('span', '', String(rows.length));
    total.setAttribute('aria-label', `${rows.length} งาน`);
    title.append(total);
    column.append(title);
    if (rows.length === 0) column.append(element('p', 'work-column-empty', 'ไม่มีงานในช่วงนี้'));
    for (const task of rows) column.append(boardCard(task, section));
    board.append(column);

    const button = element('button', '', section.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      setColumn(index);
      moveBoard(board, index);
    });
    controls.push(button);
  });
  columnControls.replaceChildren(...controls);
  board.addEventListener('scroll', () => {
    if (!boardScroll.matches) return;
    const columnWidth = board.children[1].offsetLeft - board.firstElementChild.offsetLeft;
    if (columnWidth <= 0) return;
    const nearest = Math.round(board.scrollLeft / columnWidth);
    setColumn(Math.min(sections.length - 1, Math.max(0, nearest)));
  }, { passive: true });
  return board;
}

function render() {
  const now = Date.now();
  dayShown = calendarDay.format(now);
  const grouped = currentSections();
  const count = sections.reduce((sum, section) => sum + grouped[section.id].length, 0);
  byId('work-title').textContent = scope === 'mine' ? 'งานของฉัน' : 'งานในกลุ่ม';
  byId('work-date').textContent = longDate.format(now);
  byId('work-sync').textContent = `ซิงก์ล่าสุด ${dayLabel(lastSynced)} น.`;
  byId('work-sync').toggleAttribute('data-offline', offline());
  byId('work-offline').hidden = !offline();
  for (const id of ['overdue', 'today', 'done']) {
    byId(`work-count-${id}`).textContent = grouped[id].length;
  }
  for (const button of document.querySelectorAll('[data-scope]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
  }
  for (const button of document.querySelectorAll('[data-layout]')) {
    button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
  }

  columnControls.hidden = layout !== 'board' || count === 0;
  if (count === 0) {
    const empty = element('div', 'work-empty');
    empty.append(element('h2', '', filter.value ? 'ไม่มีงานตรงตัวกรอง' : 'ยังไม่มีงาน'));
    if (filter.value) empty.append(element('p', '', 'ลองเลือกทุกโครงการเพื่อดูงานอื่น'));
    content.replaceChildren(empty);
  } else if (layout === 'table') {
    content.replaceChildren(tableView(grouped));
  } else {
    const board = boardView(grouped);
    content.replaceChildren(board);
    setColumn(selectedColumn);
    moveBoard(board, selectedColumn);
  }
}

function announce(text, result = '') {
  feedback.textContent = text;
  feedback.dataset.result = result;
}

async function markDone(taskId) {
  const task = accessibleTasks.find((candidate) => candidate.id === taskId);
  if (!task || task.assignee !== viewer.id || task.doneAt !== null || offline() || pending.has(taskId) || scenario.value === 'empty') return;

  const version = scenarioVersion;
  const fail = nextSaveFails;
  nextSaveFails = false;
  const selector = `[data-complete="${taskId}"]`;
  const hadFocus = document.activeElement?.matches(selector);
  pending.add(taskId);
  announce(`กำลังบันทึก “${task.title}”`);
  render();
  if (hadFocus) content.querySelector(selector)?.focus({ preventScroll: true });
  await new Promise((resolve) => setTimeout(resolve, 650));
  const stillFocused = document.activeElement?.matches(selector);
  pending.delete(taskId);

  if (version !== scenarioVersion || fail) {
    announce(`บันทึก “${task.title}” ไม่สำเร็จ${offline() ? ' · ลองใหม่เมื่อบอทออนไลน์' : ' · กดลองใหม่ได้'}`, 'failure');
  } else {
    task.doneAt = Date.now();
    lastSynced = task.doneAt;
    announce(`บันทึกแล้ว · ${task.title}`, 'success');
  }
  render();
  if (stillFocused) {
    const nextFocus = content.querySelector(`${selector}:not(:disabled)`) ?? feedback;
    nextFocus.focus({ preventScroll: true });
  }
}

const projects = new Set(accessibleTasks.map((task) => task.project).filter(Boolean));
for (const project of projects) filter.add(new Option(project, project));
if (accessibleTasks.some((task) => !task.project)) filter.add(new Option('ไม่มีโครงการ', 'unlinked'));
for (const button of document.querySelectorAll('[data-scope]')) {
  button.addEventListener('click', () => {
    scope = button.dataset.scope;
    render();
  });
}
for (const button of document.querySelectorAll('[data-layout]')) {
  button.addEventListener('click', () => {
    layout = button.dataset.layout;
    try { localStorage.setItem(layoutKey, layout); } catch { /* Keep it for this page. */ }
    render();
  });
}
filter.addEventListener('change', render);
scenario.addEventListener('change', () => {
  scenarioVersion++;
  nextSaveFails = scenario.value === 'failure';
  if (!offline()) lastSynced = Date.now();
  announce('');
  render();
});
content.addEventListener('click', (event) => {
  const button = event.target.closest('[data-complete]');
  if (button) void markDone(Number(button.dataset.complete));
});
boardScroll.addEventListener('change', () => {
  const board = content.querySelector('.work-board');
  if (board) moveBoard(board, selectedColumn);
});
setInterval(() => {
  if (calendarDay.format(Date.now()) !== dayShown) render();
}, 30_000);
feedback.tabIndex = -1;
render();
