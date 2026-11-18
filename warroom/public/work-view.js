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

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}


export function groupWorkTasks(tasks, scope, project, now) {
  const today = calendarDay.format(now);
  const groups = Object.fromEntries(sections.map(({ id }) => [id, []]));
  for (const task of tasks) {
    if (scope === 'mine' && !task.mine) continue;
    if (project && String(task.projectId ?? 'unlinked') !== project) continue;
    if (task.doneAt !== null) {
      if (calendarDay.format(task.doneAt) === today) groups.done.push(task);
      continue;
    }
    if (task.dueAt === null) {
      groups.undated.push(task);
      continue;
    }
    const dueDay = calendarDay.format(task.dueAt);
    groups[dueDay < today ? 'overdue' : dueDay === today ? 'today' : 'upcoming'].push(task);
  }
  for (const { id } of sections) {
    groups[id].sort((a, b) => id === 'done' ? b.doneAt - a.doneAt : a.dueAt - b.dueAt || a.id - b.id);
  }
  return groups;
}

const layoutKey = 'warroom-work-layout';
const messages = {
  work_reauth: 'เข้าสู่ระบบ Google อีกครั้งเพื่อยืนยันสิทธิ์งานทีม',
  work_not_in_group: 'บัญชีที่จับคู่ไว้ไม่มีสิทธิ์ในกลุ่มทดลอง',
  forbidden: 'บัญชีนี้ยังไม่มีสิทธิ์ดูงานในกลุ่มทดลอง',
  not_found: 'หน้างานทีมยังไม่เปิดใช้งาน',
  waiting: 'กำลังรอรายการงานจากบอท',
  expired: 'รายการงานหมดอายุแล้ว รอให้บอทซิงก์ใหม่',
  loading: 'กำลังโหลดรายการงาน',
  error: 'โหลดรายการงานไม่สำเร็จ ลองอัปเดตอีกครั้ง',
};

export function mountWorkView({ api, setHeader }) {
  const $ = (id) => document.getElementById(id);
  const filter = $('work-project');
  const content = $('work-content');
  const columnControls = $('work-column-controls');
  const feedback = $('work-feedback');
  const boardScroll = matchMedia('(max-width: 1199px)');
  let layout = 'table';
  try {
    if (localStorage.getItem(layoutKey) === 'board') layout = 'board';
  } catch { /* Use the default layout. */ }

  let snapshot = null;
  let state = 'loading';
  let pending = null;
  let scope = 'mine';
  let selectedColumn = 0;
  let active = false;
  let generation = 0;
  let displayTimer, actionTimer, loading, checking;
  function workNow() {
    if (!snapshot) return Date.now();
    snapshot.elapsed = Math.max(snapshot.elapsed, Date.now() - snapshot.requestedAt, performance.now() - snapshot.started);
    return snapshot.now + snapshot.elapsed;
  }
  const writable = () => snapshot?.writable && snapshot.writableUntil > workNow() && snapshot.expiresAt > workNow();

  function dayLabel(dueAt) {
    if (dueAt === null) return 'ยังไม่มีกำหนด';
    const date = calendarDay.format(dueAt) === calendarDay.format(workNow()) ? 'วันนี้' : shortDate.format(dueAt);
    return `${date} ${time.format(dueAt)}`;
  }

  function statusOf(section) {
    const status = element('span', 'work-status', section.status);
    status.dataset.section = section.id;
    return status;
  }

  function completeButton(task) {
    if (task.doneAt !== null || !task.mine) return null;
    const saving = pending?.taskId === task.id;
    const button = element('button', 'work-complete', saving ? 'กำลังบันทึก' : 'เสร็จ');
    button.type = 'button';
    button.dataset.complete = task.id;
    button.disabled = !writable() || Boolean(pending && !saving);
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
          ['work-secondary work-owner', task.assignee ?? 'ยังไม่มีคนรับ'],
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
    const metadata = element('p', 'work-card-meta', `${task.project ?? 'ไม่มีโครงการ'} · ${task.assignee ?? 'ยังไม่มีคนรับ'}`);
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

  function setProjects(tasks) {
    const current = filter.value;
    const entries = new Map();
    for (const task of tasks) entries.set(String(task.projectId ?? 'unlinked'), task.project ?? 'ไม่มีโครงการ');
    const sorted = [...entries].sort((a, b) => a[1].localeCompare(b[1], 'th'));
    filter.replaceChildren(new Option('ทุกโครงการ', ''), ...sorted.map(([id, name]) => new Option(name, id)));
    if (entries.has(current)) filter.value = current;
  }

  function render() {
    if (!active) return;
    clearTimeout(displayTimer);
    const now = workNow();
    if (snapshot?.expiresAt && snapshot.expiresAt <= now) {
      state = 'expired';
      snapshot = null;
    }
    const sync = snapshot?.syncedAt ? `ซิงก์ล่าสุด ${shortDate.format(snapshot.syncedAt)} ${time.format(snapshot.syncedAt)} น.` : '';
    setHeader(scope === 'mine' ? 'งานของฉัน' : 'งานในกลุ่ม', sync || longDate.format(now));
    $('work-unavailable').hidden = Boolean(snapshot);
    $('work-unavailable-title').textContent = messages[state] ?? messages.error;
    $('work-sign-in').hidden = state !== 'work_reauth';
    $('work-pane').hidden = !snapshot;
    if (!snapshot) {
      content.replaceChildren();
      setProjects([]);
      return;
    }

    const focused = document.activeElement?.dataset.complete;
    const grouped = groupWorkTasks(snapshot.tasks, scope, filter.value, now);
    const count = sections.reduce((sum, section) => sum + grouped[section.id].length, 0);
    $('work-offline').hidden = Boolean(writable());
    for (const id of ['overdue', 'today', 'done']) $('work-count-' + id).textContent = grouped[id].length;
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
    if (focused) (content.querySelector(`[data-complete="${focused}"]:not(:disabled)`) ?? feedback).focus({ preventScroll: true });

    const inMs = [snapshot.expiresAt, snapshot.writableUntil]
      .filter((deadline) => deadline > now).map((deadline) => deadline - now);
    if (inMs.length) displayTimer = setTimeout(render, Math.min(...inMs) + 1);
  }

  function announce(text, result = '') {
    feedback.textContent = text;
    feedback.dataset.result = result;
  }

  function clear(dropAction = true) {
    generation++;
    clearTimeout(displayTimer);
    clearTimeout(actionTimer);
    loading = null;
    checking = null;
    snapshot = null;
    state = 'loading';
    content.replaceChildren();
    setProjects([]);
    announce('');
    $('work-pane').hidden = true;
    if (dropAction) pending = null;
  }

  async function load(fresh = false) {
    if (!active) return;
    if (fresh && loading) await loading;
    if (!active) return;
    if (loading) return loading;
    const requestedFor = generation;
    const requestedAt = Date.now(), started = performance.now();
    loading = (async () => {
      try {
        const data = await api('/api/work');
        if (requestedFor !== generation) return;
        state = data.state;
        snapshot = data.state === 'ready' || data.state === 'stale'
          ? { ...data, requestedAt, started, elapsed: 0 } : null;
        setProjects(snapshot?.tasks ?? []);
      } catch (error) {
        if (requestedFor !== generation) return;
        state = messages[error.message] ? error.message : 'error';
        snapshot = null;
        if (error.status === 401 || error.status === 403) pending = null;
      } finally {
        if (requestedFor === generation) {
          loading = null;
          render();
        }
      }
    })();
    return loading;
  }

  async function applyOutcome(operation, result) {
    if (pending !== operation) return;
    if (result.state === 'applied' || result.state === 'already_done') {
      announce(result.state === 'applied' ? 'บันทึกว่าเสร็จแล้ว' : 'งานนี้ปิดแล้ว', 'success');
      await load(true);
      if (pending !== operation) return;
      pending = null;
      render();
    } else if (result.state === 'rejected') {
      pending = null;
      announce('ปิดงานไม่สำเร็จ · ลองอัปเดตรายการก่อนกดใหม่', 'failure');
      render();
      await load();
    } else {
      announce(result.state === 'unconfirmed' ? 'ยังยืนยันไม่ได้ กำลังรอผลจากบอท' : 'กำลังบันทึก…');
    }
  }

  async function checkAction() {
    if (!active || !pending || checking) return;
    clearTimeout(actionTimer);
    const operation = pending;
    checking = operation;
    try {
      const result = await api(`/api/work/completions/${operation.requestId}`);
      await applyOutcome(operation, result);
    } catch (error) {
      if (pending !== operation) return;
      if (error.status === 404 && Date.now() - operation.startedAt < 45_000 && !operation.retried) {
        operation.retried = true;
        await submit(operation);
      } else if (error.status === 404 || error.status === 403) {
        pending = null;
        announce('คำขอนี้หมดอายุหรือสิทธิ์เปลี่ยนไป', 'failure');
        await load();
      } else {
        announce('ยังยืนยันไม่ได้ กำลังรอผลจากบอท');
      }
    } finally {
      if (checking === operation) checking = null;
      if (active && pending === operation && Date.now() - operation.startedAt < 50_000) {
        actionTimer = setTimeout(checkAction, 2000);
      } else if (pending === operation) {
        announce('ยังยืนยันไม่ได้ กำลังรอผลจากบอท');
      }
    }
  }

  async function submit(operation) {
    try {
      const result = await api('/api/work/completions', {
        method: 'POST',
        body: JSON.stringify({ requestId: operation.requestId, taskId: operation.taskId }),
      });
      await applyOutcome(operation, result);
    } catch (error) {
      if (pending !== operation) return;
      if (error.status >= 400 && error.status < 500) {
        pending = null;
        announce('ปิดงานไม่สำเร็จ · ลองอัปเดตรายการก่อนกดใหม่', 'failure');
        render();
        await load();
      } else {
        announce('ยังยืนยันไม่ได้ กำลังตรวจคำขอเดิม');
      }
    }
  }

  content.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-complete]');
    if (!button || pending || !writable()) return;
    const operation = { requestId: crypto.randomUUID(), taskId: Number(button.dataset.complete), startedAt: Date.now() };
    pending = operation;
    announce('กำลังบันทึก…');
    render();
    await submit(operation);
    if (pending === operation) await checkAction();
  });

  for (const button of document.querySelectorAll('[data-scope]')) {
    button.addEventListener('click', () => {
      scope = button.dataset.scope;
      render();
    });
  }
  for (const button of document.querySelectorAll('[data-layout]')) {
    button.addEventListener('click', () => {
      layout = button.dataset.layout;
      try { localStorage.setItem(layoutKey, layout); } catch { /* Keep the current choice in memory. */ }
      render();
    });
  }
  filter.addEventListener('change', render);
  boardScroll.addEventListener('change', () => {
    const board = content.querySelector('.work-board');
    if (board) moveBoard(board, selectedColumn);
  });

  return {
    clear() {
      active = false;
      clear();
    },
    show() {
      active = true;
      render();
    },
    hide() {
      active = false;
      clear(false);
    },
    async refresh() {
      render();
      await load();
      await checkAction();
    },
  };
}
