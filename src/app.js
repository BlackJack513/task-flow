'use strict';

(() => {
  const STATUSES = ['todo', 'doing', 'done'];
  const STORAGE_KEY = 'taskflow.board.v1';
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const MAX_TITLE = 160;
  const MAX_NOTE = 1000;

  const $ = (id) => document.getElementById(id);

  const els = {
    topbar: $('topbar'),
    dateLine: $('dateLine'),
    progressText: $('progressText'),
    progressTrack: $('progressTrack'),
    progressFill: $('progressFill'),
    saveState: $('saveState'),
    saveText: $('saveText'),
    helpButton: $('helpButton'),
    addForm: $('addForm'),
    addInput: $('addInput'),
    searchInput: $('searchInput'),
    searchClear: $('searchClear'),
    searchBox: document.querySelector('.search-box'),
    searchShortcut: document.querySelector('.search-shortcut'),
    board: $('board'),
    lists: {
      todo: $('listTodo'),
      doing: $('listDoing')
    },
    doneGroups: $('doneGroups'),
    scrolls: {
      todo: document.querySelector('.column-scroll[data-status="todo"]'),
      doing: document.querySelector('.column-scroll[data-status="doing"]'),
      done: document.querySelector('.column-scroll[data-status="done"]')
    },
    counts: {
      todo: $('countTodo'),
      doing: $('countDoing'),
      done: $('countDone')
    },
    toggleAllGroups: $('toggleAllGroups'),
    dropPlaceholder: $('dropPlaceholder'),
    taskMenu: $('taskMenu'),
    toastHost: $('toastHost'),
    editDialog: $('editDialog'),
    editForm: $('editForm'),
    editTitle: $('editTitle'),
    editNote: $('editNote'),
    editError: $('editError'),
    editDeleteButton: $('editDeleteButton'),
    helpDialog: $('helpDialog'),
    openDataFolderButton: $('openDataFolderButton'),
    appVersion: $('appVersion'),
    editStatusInputs: Array.from(document.querySelectorAll('input[name="editStatus"]'))
  };

  const ui = {
    query: '',
    dayKey: localDateKey(new Date()),
    editingId: null,
    menuTaskId: null,
    menuAnchor: null,
    dragTaskId: null,
    dragSourceStatus: null,
    dragHeight: 0,
    dropStatus: null,
    dropIndex: 0,
    addComposing: false,
    editComposing: false,
    toastToken: 0,
    toastTimer: 0,
    animationTimer: 0,
    saveErrorShown: false,
    storageBlocked: false
  };

  let state = createEmptyState();

  /* ---------- Small helpers ---------- */

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseDateKey(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function todayKey() {
    return localDateKey(new Date());
  }

  function yesterdayKey() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return localDateKey(date);
  }

  function weekdayOfKey(key) {
    return WEEKDAYS[parseDateKey(key).getDay()];
  }

  function formatDateLine(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`;
  }

  function formatTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function doneDayLabel(key) {
    if (key === todayKey()) return '今天';
    if (key === yesterdayKey()) return '昨天';
    const date = parseDateKey(key);
    const now = new Date();
    const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`;
    return `${year}${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function truncate(value, length) {
    return value.length > length ? `${value.slice(0, length)}…` : value;
  }

  function createTaskId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeDate(value, fallback) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  function isTypingTarget(target) {
    return target instanceof Element
      && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function hasDesktopBridge() {
    return Boolean(window.taskflow && typeof window.taskflow.load === 'function');
  }

  function svgIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function makeElement(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function findTaskElement(taskId) {
    return Array.from(document.querySelectorAll('[data-task-id]'))
      .find((node) => node.dataset.taskId === taskId) || null;
  }

  /* ---------- State ---------- */

  function createEmptyState() {
    return {
      version: 1,
      tasks: [],
      settings: { collapsedDays: {} }
    };
  }

  function normalizeState(raw) {
    const normalized = createEmptyState();
    const now = new Date().toISOString();
    const seenIds = new Set();

    if (!raw || typeof raw !== 'object') return normalized;

    const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    for (const item of rawTasks) {
      if (!item || typeof item !== 'object') continue;

      const title = String(item.title == null ? '' : item.title)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE);
      if (!title) continue;

      let id = typeof item.id === 'string' && item.id ? item.id.slice(0, 120) : createTaskId();
      while (seenIds.has(id)) id = createTaskId();
      seenIds.add(id);

      const status = STATUSES.includes(item.status) ? item.status : 'todo';
      const createdAt = normalizeDate(item.createdAt, now);
      const updatedAt = normalizeDate(item.updatedAt, createdAt);
      const completedAt = status === 'done' ? normalizeDate(item.completedAt, updatedAt) : null;
      const note = String(item.note == null ? '' : item.note)
        .replace(/\r\n/g, '\n')
        .slice(0, MAX_NOTE)
        .trim();
      const order = Number.isFinite(item.order) ? item.order : 0;

      normalized.tasks.push({
        id,
        title,
        note,
        status,
        createdAt,
        updatedAt,
        completedAt,
        order
      });
    }

    for (const status of ['todo', 'doing']) {
      normalized.tasks
        .filter((task) => task.status === status)
        .sort((a, b) => a.order - b.order
          || a.createdAt.localeCompare(b.createdAt)
          || a.id.localeCompare(b.id))
        .forEach((task, index) => {
          task.order = index + 1;
        });
    }

    const rawCollapsed = raw.settings && raw.settings.collapsedDays;
    if (rawCollapsed && typeof rawCollapsed === 'object' && !Array.isArray(rawCollapsed)) {
      for (const [key, value] of Object.entries(rawCollapsed)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'boolean') {
          normalized.settings.collapsedDays[key] = value;
        }
      }
    }

    return normalized;
  }

  function serializeState() {
    return {
      version: 1,
      tasks: state.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        note: task.note,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        order: task.order
      })),
      settings: {
        collapsedDays: { ...state.settings.collapsedDays }
      }
    };
  }

  function getTask(taskId) {
    return state.tasks.find((task) => task.id === taskId) || null;
  }

  function tasksFor(status) {
    const list = state.tasks.filter((task) => task.status === status);
    if (status === 'done') {
      return list.sort((a, b) => {
        const aTime = new Date(a.completedAt || a.updatedAt).getTime();
        const bTime = new Date(b.completedAt || b.updatedAt).getTime();
        return bTime - aTime || a.id.localeCompare(b.id);
      });
    }
    return list.sort((a, b) => a.order - b.order
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));
  }

  function setColumnOrder(status, orderedIds) {
    const byId = new Map(state.tasks.map((task) => [task.id, task]));
    orderedIds.forEach((id, index) => {
      const task = byId.get(id);
      if (task && task.status === status) task.order = index + 1;
    });
  }

  function normalizeOrders(status) {
    if (status === 'done') return;
    tasksFor(status).forEach((task, index) => {
      task.order = index + 1;
    });
  }

  function matchesQuery(task) {
    if (!ui.query) return true;
    return `${task.title}\n${task.note}`.toLocaleLowerCase().includes(ui.query);
  }

  /* ---------- Persistence ---------- */

  async function loadState() {
    let raw = null;
    let warning = '';

    if (hasDesktopBridge()) {
      const result = await window.taskflow.load();
      if (!result || result.ok !== true) {
        throw new Error((result && result.error) || '无法读取本地数据');
      }
      raw = result.data;
      warning = typeof result.warning === 'string' ? result.warning : '';
    } else {
      let stored = null;
      try {
        stored = window.localStorage.getItem(STORAGE_KEY);
      } catch (error) {
        warning = '无法访问浏览器本地存储，任务可能不会被保存。';
      }
      if (stored) {
        try {
          raw = JSON.parse(stored);
        } catch (error) {
          try {
            window.localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, stored);
          } catch { /* Ignore a second storage failure. */ }
          warning = '浏览器中的旧数据格式异常，已另存一份异常数据，并从空看板开始。';
        }
      }
    }

    state = normalizeState(raw);
    ui.dayKey = todayKey();
    return warning;
  }

  function setSaveState(kind, detail) {
    els.saveState.classList.remove('is-error', 'is-saving');
    if (kind === 'error') {
      els.saveState.classList.add('is-error');
      els.saveText.textContent = '保存失败';
      els.saveState.title = detail ? `保存失败：${detail}` : '保存失败';
      return;
    }
    if (kind === 'saving') {
      els.saveState.classList.add('is-saving');
      els.saveText.textContent = '保存中';
      els.saveState.title = '正在保存';
      return;
    }

    els.saveText.textContent = '已保存';
    const savedAt = detail instanceof Date && !Number.isNaN(detail.getTime()) ? detail : new Date();
    const where = hasDesktopBridge() ? '这台电脑' : '此浏览器';
    els.saveState.title = `已于 ${formatTime(savedAt)} 保存到${where}`;
  }

  function persistState() {
    if (ui.storageBlocked) {
      setSaveState('error', '数据读取异常，暂时停止写入，以免覆盖原文件。');
      return false;
    }

    try {
      const payload = serializeState();
      let savedAt = new Date();
      if (hasDesktopBridge()) {
        const result = window.taskflow.save(payload);
        if (!result || result.ok !== true) {
          throw new Error((result && result.error) || '保存失败');
        }
        if (result.savedAt) savedAt = new Date(result.savedAt);
      } else {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      }
      ui.saveErrorShown = false;
      setSaveState('saved', savedAt);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveState('error', message);
      if (!ui.saveErrorShown) {
        ui.saveErrorShown = true;
        showToast({
          message: `保存失败：${message}`,
          type: 'error',
          duration: 9000
        });
      }
      return false;
    }
  }

  /* ---------- Rendering ---------- */

  function captureScroll() {
    return {
      todo: els.scrolls.todo.scrollTop,
      doing: els.scrolls.doing.scrollTop,
      done: els.scrolls.done.scrollTop
    };
  }

  function restoreScroll(positions) {
    for (const status of STATUSES) {
      els.scrolls[status].scrollTop = positions[status] || 0;
    }
  }

  function updateDateLine() {
    els.dateLine.textContent = formatDateLine(new Date());
  }

  function updateProgress() {
    const total = state.tasks.length;
    const done = state.tasks.reduce((count, task) => count + (task.status === 'done' ? 1 : 0), 0);
    const percent = total ? Math.round((done / total) * 100) : 0;
    els.progressText.textContent = `${done} / ${total}`;
    els.progressFill.style.width = `${percent}%`;
    els.progressTrack.setAttribute('aria-valuenow', String(percent));
    els.progressTrack.setAttribute('aria-valuetext', `已完成 ${done} 项，共 ${total} 项`);
    els.progressTrack.title = `全部 ${total} 项任务中已完成 ${done} 项`;
  }

  function updateCount(countElement, visible, total) {
    if (ui.query) {
      countElement.textContent = `${visible}/${total}`;
      countElement.title = `匹配 ${visible} 项，共 ${total} 项`;
    } else {
      countElement.textContent = String(total);
      countElement.title = `共 ${total} 项`;
    }
  }

  function createColumnEmptyState(status, filtered) {
    const wrapper = makeElement('div', 'empty-state');
    const iconBox = makeElement('span', 'empty-icon');
    const iconName = status === 'todo' ? 'inbox' : status === 'doing' ? 'play' : 'archive';
    iconBox.append(svgIcon(iconName));

    let heading = '';
    let copy = '';
    if (filtered) {
      heading = status === 'done' ? '没有找到已完成任务' : '没有找到匹配任务';
      copy = '试试更短的关键词，或换一种说法。按 Esc 清空搜索。';
    } else if (status === 'todo') {
      heading = '从第一件小事开始';
      copy = '把脑海里的任务写进上方输入框，它们会先落到这里。';
    } else if (status === 'doing') {
      heading = '把任务拖到这里';
      copy = '正在做的事不用太多，一次专注一两件就好。';
    } else {
      heading = '完成的任务会住在这里';
      copy = '每完成一件，就按日期自动归档。今天展开，往日收起。';
    }

    wrapper.append(iconBox, makeElement('h3', '', heading), makeElement('p', '', copy));
    return wrapper;
  }

  function createMenuButton(task) {
    const button = makeElement('button', 'card-menu-button');
    button.type = 'button';
    button.draggable = false;
    button.setAttribute('aria-label', `任务操作：${task.title}`);
    button.setAttribute('aria-haspopup', 'menu');
    button.title = '任务操作';
    button.append(svgIcon('more'));
    return button;
  }

  function createTaskCard(task, animatedId) {
    const card = makeElement('article', 'task-card');
    card.dataset.taskId = task.id;
    card.dataset.status = task.status;
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${task.title}。${task.note ? `备注：${task.note}。` : ''}双击编辑，拖动可改变状态。`);

    const title = makeElement('p', 'task-title', task.title);
    title.title = task.title;
    card.append(title);

    if (task.note) {
      const note = makeElement('p', 'task-note', task.note);
      note.title = task.note;
      card.append(note);
    }

    card.append(createMenuButton(task));
    if (animatedId && animatedId === task.id) card.classList.add('is-entering');
    return card;
  }

  function createDoneRow(task, animatedId) {
    const row = makeElement('div', 'done-row');
    row.dataset.taskId = task.id;
    row.dataset.status = 'done';
    row.draggable = true;
    row.tabIndex = 0;
    row.setAttribute('aria-label', `${task.title}，已完成于 ${formatTime(task.completedAt)}。双击编辑。`);
    row.title = task.note ? `${task.title}\n${task.note}` : task.title;

    const check = makeElement('span', 'done-check');
    check.append(svgIcon('check-circle'));
    const title = makeElement('span', 'done-title', task.title);
    const time = makeElement('span', 'done-time', formatTime(task.completedAt));
    row.append(check, title, time, createMenuButton(task));
    if (animatedId && animatedId === task.id) row.classList.add('is-entering');
    return row;
  }

  function renderActiveColumn(status, visibleTasks, totalCount, animatedId) {
    const list = els.lists[status];
    const fragment = document.createDocumentFragment();

    if (!visibleTasks.length) {
      fragment.append(createColumnEmptyState(status, Boolean(ui.query)));
    } else {
      for (const task of visibleTasks) {
        fragment.append(createTaskCard(task, animatedId));
      }
    }

    list.replaceChildren(fragment);
    updateCount(els.counts[status], visibleTasks.length, totalCount);
  }

  function groupDoneTasks(tasks) {
    const groups = new Map();
    for (const task of tasks) {
      const key = localDateKey(new Date(task.completedAt || task.updatedAt));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }

  function isGroupOpen(dayKey) {
    if (ui.query) return true;
    const collapsed = state.settings.collapsedDays[dayKey];
    if (typeof collapsed === 'boolean') return !collapsed;
    return dayKey === todayKey();
  }

  function toggleDoneGroup(dayKey) {
    if (!dayKey || ui.query) return;
    const currentlyOpen = isGroupOpen(dayKey);
    state.settings.collapsedDays[dayKey] = currentlyOpen;
    commitBoard({ focusDay: dayKey });
  }

  function renderDoneColumn(visibleTasks, totalCount, animatedId) {
    const host = els.doneGroups;
    const fragment = document.createDocumentFragment();

    if (!visibleTasks.length) {
      fragment.append(createColumnEmptyState('done', Boolean(ui.query)));
      host.replaceChildren(fragment);
      updateCount(els.counts.done, 0, totalCount);
      return [];
    }

    const groups = groupDoneTasks(visibleTasks);
    for (const [dayKey, tasks] of groups) {
      const collapsed = !isGroupOpen(dayKey);
      const group = makeElement('section', `done-group${collapsed ? ' is-collapsed' : ''}`);
      group.setAttribute('aria-label', `${doneDayLabel(dayKey)}，${tasks.length} 项已完成任务`);

      const header = makeElement('button', 'done-group-header');
      header.type = 'button';
      header.dataset.day = dayKey;
      header.disabled = Boolean(ui.query);
      header.setAttribute('aria-expanded', String(!collapsed));
      header.title = ui.query ? '搜索时自动展开' : (collapsed ? '展开这一天的任务' : '收起这一天的任务');

      const chevron = makeElement('span', 'done-chevron');
      chevron.append(svgIcon('chevron'));
      const date = makeElement('span', 'done-date', doneDayLabel(dayKey));
      const weekday = makeElement('span', 'done-date-span', weekdayOfKey(dayKey));
      const count = makeElement('span', 'done-group-count', String(tasks.length));
      const rule = makeElement('span', 'done-header-rule');
      header.append(chevron, date, weekday, count, rule);

      const body = makeElement('div', 'done-group-body');
      if (!collapsed) {
        const bodyFragment = document.createDocumentFragment();
        for (const task of tasks) {
          bodyFragment.append(createDoneRow(task, animatedId));
        }
        body.append(bodyFragment);
      }

      group.append(header, body);
      fragment.append(group);
    }

    host.replaceChildren(fragment);
    updateCount(els.counts.done, visibleTasks.length, totalCount);
    return groups;
  }

  function updateDoneToggle(allGroups) {
    const canToggle = !ui.query && allGroups.length > 1;
    els.toggleAllGroups.hidden = !canToggle;
    if (!canToggle) return;

    const allOpen = allGroups.every(([dayKey]) => isGroupOpen(dayKey));
    els.toggleAllGroups.textContent = allOpen ? '全部收起' : '全部展开';
    els.toggleAllGroups.setAttribute('aria-label', allOpen ? '收起全部日期分组' : '展开全部日期分组');
  }

  function scheduleAfterRender(options) {
    window.requestAnimationFrame(() => {
      if (options.focusDay) {
        const header = Array.from(document.querySelectorAll('.done-group-header'))
          .find((node) => node.dataset.day === options.focusDay);
        if (header) {
          header.focus({ preventScroll: true });
          header.scrollIntoView({ block: 'nearest' });
        }
      }

      const revealId = options.revealTaskId || options.focusTaskId;
      if (!revealId) return;
      const node = findTaskElement(revealId);
      if (!node) return;
      if (options.focusTaskId) node.focus({ preventScroll: true });
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function renderAll(options = {}) {
    const scrollPositions = options.resetScroll ? null : captureScroll();
    closeTaskMenu();

    const all = {
      todo: tasksFor('todo'),
      doing: tasksFor('doing'),
      done: tasksFor('done')
    };
    const visible = {
      todo: all.todo.filter(matchesQuery),
      doing: all.doing.filter(matchesQuery),
      done: all.done.filter(matchesQuery)
    };

    ui.dayKey = todayKey();
    updateDateLine();
    updateProgress();

    renderActiveColumn('todo', visible.todo, all.todo.length, options.animatedTaskId);
    renderActiveColumn('doing', visible.doing, all.doing.length, options.animatedTaskId);
    const allGroups = groupDoneTasks(all.done);
    const visibleGroups = renderDoneColumn(visible.done, all.done.length, options.animatedTaskId);
    updateDoneToggle(allGroups.length ? allGroups : visibleGroups);

    if (options.resetScroll) {
      for (const status of STATUSES) els.scrolls[status].scrollTop = 0;
    } else if (scrollPositions) {
      restoreScroll(scrollPositions);
    }

    if (options.animatedTaskId) {
      window.clearTimeout(ui.animationTimer);
      ui.animationTimer = window.setTimeout(() => {
        document.querySelectorAll('.is-entering').forEach((node) => node.classList.remove('is-entering'));
      }, 340);
    }

    scheduleAfterRender(options);
  }

  function commitBoard(options = {}) {
    renderAll(options);
    persistState();
  }

  /* ---------- Task mutations ---------- */

  function applyMove(taskId, targetStatus, targetIndex = 0) {
    const task = getTask(taskId);
    if (!task || !STATUSES.includes(targetStatus)) return null;

    const previousStatus = task.status;
    const previousCompletedAt = task.completedAt;
    const previousIndex = Math.max(0, tasksFor(previousStatus).findIndex((item) => item.id === taskId));
    const now = new Date().toISOString();

    if (previousStatus === targetStatus) {
      if (previousStatus === 'done') return null;
      const list = tasksFor(targetStatus).filter((item) => item.id !== taskId);
      const index = clamp(targetIndex, 0, list.length);
      list.splice(index, 0, task);
      list.forEach((item, itemIndex) => {
        item.order = itemIndex + 1;
      });
      task.updatedAt = now;
      return {
        task,
        previousStatus,
        previousCompletedAt,
        previousIndex,
        completedNow: false
      };
    }

    const destination = tasksFor(targetStatus).filter((item) => item.id !== taskId);
    task.status = targetStatus;
    task.updatedAt = now;

    if (targetStatus === 'done') {
      task.completedAt = now;
      task.order = 0;
      state.settings.collapsedDays[todayKey()] = false;
    } else {
      task.completedAt = null;
      const index = clamp(targetIndex, 0, destination.length);
      destination.splice(index, 0, task);
      destination.forEach((item, itemIndex) => {
        item.order = itemIndex + 1;
      });
    }

    if (previousStatus !== 'done') normalizeOrders(previousStatus);

    return {
      task,
      previousStatus,
      previousCompletedAt,
      previousIndex,
      completedNow: targetStatus === 'done'
    };
  }

  function showCompletionToast(taskId, moveInfo) {
    const task = getTask(taskId);
    if (!task) return;
    showToast({
      message: `已完成「${truncate(task.title, 20)}」`,
      type: 'success',
      actionLabel: '撤销',
      duration: 5200,
      onAction: () => {
        const current = getTask(taskId);
        if (!current || current.status !== 'done') return;
        moveTask(taskId, moveInfo.previousStatus, moveInfo.previousIndex, {
          notifyComplete: false,
          focusTaskId: taskId
        });
      }
    });
  }

  function moveTask(taskId, targetStatus, targetIndex = 0, options = {}) {
    const moveInfo = applyMove(taskId, targetStatus, targetIndex);
    if (!moveInfo) return null;

    commitBoard({
      keepScroll: true,
      animatedTaskId: taskId,
      focusTaskId: options.focusTaskId || null
    });

    if (moveInfo.completedNow && options.notifyComplete !== false) {
      showCompletionToast(taskId, moveInfo);
    }
    return moveInfo;
  }

  function addTask(title) {
    const now = new Date().toISOString();
    const task = {
      id: createTaskId(),
      title,
      note: '',
      status: 'todo',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      order: 0
    };
    state.tasks.push(task);

    const remaining = tasksFor('todo').filter((item) => item.id !== task.id).map((item) => item.id);
    remaining.unshift(task.id);
    setColumnOrder('todo', remaining);

    resetSearch({ render: false });
    commitBoard({
      animatedTaskId: task.id,
      revealTaskId: task.id
    });
  }

  function deleteTask(taskId) {
    const task = getTask(taskId);
    if (!task) return null;

    const snapshot = { ...task };
    const previousIndex = Math.max(0, tasksFor(task.status).findIndex((item) => item.id === taskId));
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
    normalizeOrders(snapshot.status);

    commitBoard();
    showToast({
      message: `已删除「${truncate(snapshot.title, 18)}」`,
      type: 'success',
      actionLabel: '撤销',
      duration: 5600,
      onAction: () => {
        if (getTask(snapshot.id)) return;
        const restored = { ...snapshot };
        state.tasks.push(restored);

        if (restored.status === 'done') {
          const day = localDateKey(new Date(restored.completedAt || restored.updatedAt));
          state.settings.collapsedDays[day] = false;
        } else {
          const ids = tasksFor(restored.status)
            .filter((item) => item.id !== restored.id)
            .map((item) => item.id);
          ids.splice(clamp(previousIndex, 0, ids.length), 0, restored.id);
          setColumnOrder(restored.status, ids);
        }

        commitBoard({
          animatedTaskId: restored.id,
          focusTaskId: restored.id
        });
      }
    });
    return snapshot;
  }

  /* ---------- Search ---------- */

  function updateSearchChrome() {
    const hasText = els.searchInput.value.trim().length > 0;
    els.searchClear.hidden = !hasText;
    els.searchShortcut.hidden = hasText;
  }

  function resetSearch(options = {}) {
    els.searchInput.value = '';
    ui.query = '';
    updateSearchChrome();
    if (options.render !== false) renderAll({ resetScroll: true });
    if (options.focus) els.searchInput.focus();
  }

  function handleSearchInput() {
    ui.query = els.searchInput.value.trim().toLocaleLowerCase();
    updateSearchChrome();
    renderAll({ resetScroll: true });
  }

  /* ---------- Menu, toasts, dialogs ---------- */

  function showToast({ message, actionLabel, onAction, type = 'success', duration = 5000 }) {
    window.clearTimeout(ui.toastTimer);
    const token = ++ui.toastToken;
    const host = els.toastHost;
    host.replaceChildren();

    const toast = makeElement('div', 'toast');
    if (type === 'warning') toast.classList.add('is-warning');
    if (type === 'error') toast.classList.add('is-error');

    const iconWrap = makeElement('span', 'toast-icon');
    iconWrap.append(svgIcon(type === 'success' ? 'check-circle' : 'help'));
    const messageNode = makeElement('span', 'toast-message', message);
    toast.append(iconWrap, messageNode);

    function dismissToast() {
      if (token !== ui.toastToken) return;
      window.clearTimeout(ui.toastTimer);
      toast.classList.add('is-leaving');
      window.setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 180);
    }

    if (actionLabel && typeof onAction === 'function') {
      const action = makeElement('button', 'toast-action', actionLabel);
      action.type = 'button';
      action.addEventListener('click', () => {
        try {
          onAction();
        } finally {
          dismissToast();
        }
      });
      toast.append(action);
    }

    const close = makeElement('button', 'toast-close');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭提示');
    close.append(svgIcon('close'));
    close.addEventListener('click', dismissToast);
    toast.append(close);

    host.append(toast);
    if (duration > 0) {
      ui.toastTimer = window.setTimeout(dismissToast, duration);
    }
  }

  function closeTaskMenu(options = {}) {
    if (els.taskMenu.hidden) return;
    const anchor = ui.menuAnchor;
    els.taskMenu.hidden = true;
    els.taskMenu.replaceChildren();
    ui.menuTaskId = null;
    ui.menuAnchor = null;
    if (options.restoreFocus && anchor && anchor.isConnected) {
      anchor.focus({ preventScroll: true });
    }
  }

  function addMenuButton(action, label, iconName, options = {}) {
    const button = makeElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('role', 'menuitem');
    if (options.danger) button.classList.add('menu-danger');
    button.append(svgIcon(iconName), makeElement('span', '', label));
    if (options.shortcut) {
      button.append(makeElement('span', 'menu-shortcut', options.shortcut));
    }
    els.taskMenu.append(button);
    return button;
  }

  function openTaskMenu(taskId, anchor, point) {
    const task = getTask(taskId);
    if (!task) return;

    if (!els.taskMenu.hidden && ui.menuTaskId === taskId && ui.menuAnchor === anchor) {
      closeTaskMenu({ restoreFocus: true });
      return;
    }

    closeTaskMenu();
    ui.menuTaskId = taskId;
    ui.menuAnchor = anchor;
    els.taskMenu.replaceChildren();

    if (task.status === 'todo') {
      addMenuButton('advance', '移到「进行中」', 'arrow-right');
    } else if (task.status === 'doing') {
      addMenuButton('advance', '标记为完成', 'check');
    } else {
      addMenuButton('advance', '放回「待开始」', 'arrow-left');
    }
    addMenuButton('edit', '编辑任务', 'edit');
    const separator = document.createElement('hr');
    els.taskMenu.append(separator);
    addMenuButton('delete', '删除任务', 'trash', { danger: true });

    els.taskMenu.hidden = false;
    const rect = els.taskMenu.getBoundingClientRect();
    let left;
    let top;
    if (point) {
      left = point.x;
      top = point.y;
    } else {
      const anchorRect = anchor.getBoundingClientRect();
      left = anchorRect.right - rect.width;
      top = anchorRect.bottom + 6;
    }
    left = clamp(left, 8, Math.max(8, window.innerWidth - rect.width - 8));
    top = clamp(top, 8, Math.max(8, window.innerHeight - rect.height - 8));
    els.taskMenu.style.left = `${Math.round(left)}px`;
    els.taskMenu.style.top = `${Math.round(top)}px`;

    const firstItem = els.taskMenu.querySelector('button');
    if (firstItem) {
      window.requestAnimationFrame(() => {
        if (!els.taskMenu.hidden) firstItem.focus({ preventScroll: true });
      });
    }
  }

  function handleMenuAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const taskId = ui.menuTaskId;
    closeTaskMenu();
    const task = getTask(taskId);
    if (!task) return;

    if (action === 'edit') {
      openEditDialog(taskId);
      return;
    }
    if (action === 'delete') {
      deleteTask(taskId);
      return;
    }
    if (action === 'advance') {
      const target = task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : 'todo';
      moveTask(taskId, target, 0, {
        notifyComplete: target === 'done',
        focusTaskId: taskId
      });
    }
  }

  function openEditDialog(taskId) {
    const task = getTask(taskId);
    if (!task) return;
    closeTaskMenu();
    if (els.helpDialog.open) els.helpDialog.close();
    ui.editingId = taskId;
    els.editTitle.value = task.title;
    els.editNote.value = task.note;
    for (const input of els.editStatusInputs) {
      input.checked = input.value === task.status;
    }
    els.editError.hidden = true;
    if (!els.editDialog.open) els.editDialog.showModal();
    window.requestAnimationFrame(() => {
      els.editTitle.focus();
      els.editTitle.select();
    });
  }

  function closeEditDialog() {
    if (els.editDialog.open) els.editDialog.close();
  }

  function saveEditDialog(event) {
    event.preventDefault();
    if (ui.editComposing) return;

    const task = getTask(ui.editingId);
    if (!task) {
      closeEditDialog();
      return;
    }

    const title = els.editTitle.value.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (!title) {
      els.editError.hidden = false;
      els.editTitle.focus();
      return;
    }

    const checked = els.editStatusInputs.find((input) => input.checked);
    const nextStatus = checked && STATUSES.includes(checked.value) ? checked.value : task.status;
    const previousStatus = task.status;
    task.title = title;
    task.note = els.editNote.value.replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTE);

    let moveInfo = null;
    if (nextStatus !== previousStatus) {
      moveInfo = applyMove(task.id, nextStatus, 0);
    } else {
      task.updatedAt = new Date().toISOString();
    }

    closeEditDialog();
    commitBoard({
      animatedTaskId: task.id,
      focusTaskId: task.id
    });
    if (moveInfo && moveInfo.completedNow) {
      showCompletionToast(task.id, moveInfo);
    }
  }

  function deleteFromEditDialog() {
    const taskId = ui.editingId;
    closeEditDialog();
    if (taskId) deleteTask(taskId);
  }

  function openHelpDialog() {
    closeTaskMenu();
    if (els.editDialog.open) return;
    if (!els.helpDialog.open) els.helpDialog.showModal();
  }

  async function openDataFolder() {
    if (!window.taskflow || typeof window.taskflow.openDataFolder !== 'function') {
      showToast({
        message: '浏览器预览模式没有独立的数据文件夹。',
        type: 'warning',
        duration: 4500
      });
      return;
    }
    try {
      const result = await window.taskflow.openDataFolder();
      if (!result || result.ok !== true) {
        throw new Error((result && result.error) || '无法打开数据位置');
      }
    } catch (error) {
      showToast({
        message: `无法打开数据位置：${error.message || error}`,
        type: 'error',
        duration: 6000
      });
    }
  }

  async function loadAppInfo() {
    if (!window.taskflow || typeof window.taskflow.info !== 'function') return;
    try {
      const info = await window.taskflow.info();
      if (info && info.ok && info.version) {
        els.appVersion.textContent = `v${info.version}`;
      }
    } catch { /* Version is decorative. */ }
  }

  /* ---------- Drag and drop ---------- */

  function cleanupDragState() {
    ui.dragTaskId = null;
    ui.dragSourceStatus = null;
    ui.dragHeight = 0;
    ui.dropStatus = null;
    ui.dropIndex = 0;

    document.querySelectorAll('.column.is-drop-target').forEach((column) => {
      column.classList.remove('is-drop-target');
    });
    document.querySelectorAll('.is-dragging').forEach((node) => {
      node.classList.remove('is-dragging');
    });

    const placeholder = els.dropPlaceholder;
    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
    placeholder.hidden = true;
    placeholder.style.height = '';
  }

  function dropIndexAt(list, clientY) {
    const cards = Array.from(list.querySelectorAll(':scope > .task-card'))
      .filter((card) => !card.classList.contains('is-dragging'));
    for (let index = 0; index < cards.length; index += 1) {
      const rect = cards[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return cards.length;
  }

  function setDropTarget(column) {
    document.querySelectorAll('.column.is-drop-target').forEach((node) => {
      if (node !== column) node.classList.remove('is-drop-target');
    });
    column.classList.add('is-drop-target');
  }

  function handleDragStart(event) {
    const card = event.target.closest('[data-task-id]');
    if (!card || !els.board.contains(card)) return;
    if (event.target.closest('.card-menu-button')) {
      event.preventDefault();
      return;
    }
    const task = getTask(card.dataset.taskId);
    if (!task) return;

    closeTaskMenu();
    ui.dragTaskId = task.id;
    ui.dragSourceStatus = task.status;
    ui.dragHeight = Math.round(card.getBoundingClientRect().height);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', task.id);
    }

    window.setTimeout(() => {
      if (ui.dragTaskId !== task.id) return;
      const current = findTaskElement(task.id);
      if (current) current.classList.add('is-dragging');
    }, 0);
  }

  function handleColumnDragOver(event) {
    if (!ui.dragTaskId) return;
    const column = event.currentTarget;
    const status = column.dataset.status;
    const task = getTask(ui.dragTaskId);
    if (!task) return;

    event.preventDefault();
    if (status === 'done' && task.status === 'done') {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      column.classList.remove('is-drop-target');
      if (els.dropPlaceholder.parentNode) els.dropPlaceholder.parentNode.removeChild(els.dropPlaceholder);
      els.dropPlaceholder.hidden = true;
      ui.dropStatus = null;
      return;
    }

    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDropTarget(column);
    ui.dropStatus = status;

    if (status === 'done') {
      if (els.dropPlaceholder.parentNode) els.dropPlaceholder.parentNode.removeChild(els.dropPlaceholder);
      els.dropPlaceholder.hidden = true;
      ui.dropIndex = 0;
      return;
    }

    const list = els.lists[status];
    const index = dropIndexAt(list, event.clientY);
    ui.dropIndex = index;
    const placeholder = els.dropPlaceholder;
    placeholder.hidden = false;
    placeholder.style.height = `${ui.dragHeight || 48}px`;
    const cards = Array.from(list.querySelectorAll(':scope > .task-card'))
      .filter((card) => !card.classList.contains('is-dragging'));
    const reference = cards[index] || null;
    if (placeholder.parentElement !== list || placeholder.nextElementSibling !== reference) {
      list.insertBefore(placeholder, reference);
    }
  }

  function handleColumnDragLeave(event) {
    const column = event.currentTarget;
    if (event.relatedTarget && column.contains(event.relatedTarget)) return;
    if (ui.dropStatus !== column.dataset.status) return;
    column.classList.remove('is-drop-target');
    ui.dropStatus = null;
    if (els.dropPlaceholder.parentNode) els.dropPlaceholder.parentNode.removeChild(els.dropPlaceholder);
    els.dropPlaceholder.hidden = true;
  }

  function handleColumnDrop(event) {
    if (!ui.dragTaskId) return;
    const column = event.currentTarget;
    const status = column.dataset.status;
    const taskId = ui.dragTaskId;
    const task = getTask(taskId);
    if (!task) {
      cleanupDragState();
      return;
    }

    event.preventDefault();
    if (status === 'done' && task.status === 'done') {
      cleanupDragState();
      return;
    }

    let targetIndex = 0;
    if (status !== 'done') {
      if (ui.query && status === task.status) {
        cleanupDragState();
        return;
      }
      targetIndex = ui.query ? 0 : dropIndexAt(els.lists[status], event.clientY);
    }

    cleanupDragState();
    moveTask(taskId, status, targetIndex, {
      notifyComplete: status === 'done' && task.status !== 'done'
    });
  }

  /* ---------- Event wiring ---------- */

  function bindEvents() {
    els.addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (ui.addComposing) return;
      const title = els.addInput.value.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
      if (!title) {
        els.addInput.focus();
        return;
      }
      addTask(title);
      els.addInput.value = '';
      els.addInput.focus();
    });

    els.addInput.addEventListener('compositionstart', () => {
      ui.addComposing = true;
    });
    els.addInput.addEventListener('compositionend', () => {
      ui.addComposing = false;
    });
    els.addForm.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.isComposing || ui.addComposing)) {
        event.preventDefault();
      }
    });

    els.editForm.addEventListener('submit', saveEditDialog);
    els.editForm.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.isComposing || ui.editComposing)) {
        event.preventDefault();
      }
    });
    els.editTitle.addEventListener('compositionstart', () => {
      ui.editComposing = true;
    });
    els.editTitle.addEventListener('compositionend', () => {
      ui.editComposing = false;
    });
    els.editTitle.addEventListener('input', () => {
      els.editError.hidden = true;
    });
    els.editDeleteButton.addEventListener('click', deleteFromEditDialog);
    els.editDialog.addEventListener('close', () => {
      ui.editingId = null;
      ui.editComposing = false;
      els.editError.hidden = true;
    });

    els.searchInput.addEventListener('input', handleSearchInput);
    els.searchClear.addEventListener('click', () => {
      resetSearch({ focus: true });
    });

    els.helpButton.addEventListener('click', openHelpDialog);
    els.openDataFolderButton.addEventListener('click', openDataFolder);
    els.toggleAllGroups.addEventListener('click', () => {
      if (ui.query) return;
      const groups = groupDoneTasks(tasksFor('done'));
      if (!groups.length) return;
      const allOpen = groups.every(([dayKey]) => isGroupOpen(dayKey));
      for (const [dayKey] of groups) {
        state.settings.collapsedDays[dayKey] = allOpen;
      }
      commitBoard();
    });

    els.board.addEventListener('dblclick', (event) => {
      if (event.target.closest('.card-menu-button, .done-group-header')) return;
      const card = event.target.closest('[data-task-id]');
      if (!card) return;
      openEditDialog(card.dataset.taskId);
    });

    els.board.addEventListener('click', (event) => {
      const groupHeader = event.target.closest('.done-group-header');
      if (groupHeader) {
        if (!groupHeader.disabled) toggleDoneGroup(groupHeader.dataset.day);
        return;
      }

      const menuButton = event.target.closest('.card-menu-button');
      if (menuButton) {
        const card = menuButton.closest('[data-task-id]');
        if (card) openTaskMenu(card.dataset.taskId, menuButton, null);
        return;
      }
    });

    els.board.addEventListener('contextmenu', (event) => {
      const card = event.target.closest('[data-task-id]');
      if (!card || !els.board.contains(card)) return;
      event.preventDefault();
      openTaskMenu(card.dataset.taskId, card, { x: event.clientX, y: event.clientY });
    });

    els.board.addEventListener('keydown', (event) => {
      const card = event.target.closest('[data-task-id]');
      if (!card || event.target !== card) return;

      if (event.key === 'Enter' && !event.altKey) {
        event.preventDefault();
        openEditDialog(card.dataset.taskId);
        return;
      }

      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const task = getTask(card.dataset.taskId);
        if (!task) return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextStatus = STATUSES[STATUSES.indexOf(task.status) + direction];
        if (!nextStatus) return;
        moveTask(task.id, nextStatus, 0, {
          notifyComplete: nextStatus === 'done',
          focusTaskId: task.id
        });
      }
    });

    els.board.addEventListener('dragstart', handleDragStart);
    els.board.addEventListener('dragend', cleanupDragState);

    document.querySelectorAll('.column[data-status]').forEach((column) => {
      column.addEventListener('dragenter', (event) => {
        if (ui.dragTaskId) event.preventDefault();
      });
      column.addEventListener('dragover', handleColumnDragOver);
      column.addEventListener('dragleave', handleColumnDragLeave);
      column.addEventListener('drop', handleColumnDrop);
    });

    els.taskMenu.addEventListener('click', handleMenuAction);
    els.taskMenu.addEventListener('keydown', (event) => {
      const items = Array.from(els.taskMenu.querySelectorAll('button'));
      if (!items.length) return;
      const currentIndex = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const start = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex;
        const nextIndex = (start + delta + items.length) % items.length;
        items[nextIndex].focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : items.length - 1].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeTaskMenu({ restoreFocus: true });
      }
    });

    document.addEventListener('pointerdown', (event) => {
      if (els.taskMenu.hidden) return;
      if (event.target.closest('#taskMenu, .card-menu-button')) return;
      closeTaskMenu();
    }, true);

    document.addEventListener('scroll', () => {
      if (!els.taskMenu.hidden) closeTaskMenu();
    }, true);

    window.addEventListener('resize', () => {
      closeTaskMenu();
      cleanupDragState();
    });
    window.addEventListener('blur', () => {
      closeTaskMenu();
      cleanupDragState();
    });

    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialog = $(button.dataset.closeDialog);
        if (dialog && dialog.open) dialog.close();
      });
    });

    for (const dialog of [els.editDialog, els.helpDialog]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    els.topbar.addEventListener('dblclick', (event) => {
      if (event.target.closest('button, input, textarea, .save-state')) return;
      if (window.taskflow && typeof window.taskflow.toggleMaximize === 'function') {
        window.taskflow.toggleMaximize();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (els.editDialog.open || els.helpDialog.open) return;

      if (event.key === 'Escape') {
        if (!els.taskMenu.hidden) {
          closeTaskMenu({ restoreFocus: true });
          return;
        }
        if (ui.query) {
          event.preventDefault();
          resetSearch({ focus: true });
          return;
        }
        if (document.activeElement === els.addInput || document.activeElement === els.searchInput) {
          document.activeElement.blur();
        }
        return;
      }

      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault();
        els.addInput.focus();
        const end = els.addInput.value.length;
        els.addInput.setSelectionRange(end, end);
        return;
      }
      if (withModifier && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault();
        els.searchInput.focus();
        els.searchInput.select();
        return;
      }

      if (!isTypingTarget(event.target) && !withModifier && !event.altKey) {
        if (event.key === '?') {
          event.preventDefault();
          openHelpDialog();
        }
      }
    });

    window.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      if (!ui.dragTaskId) event.preventDefault();
    });

    window.addEventListener('beforeunload', () => {
      cleanupDragState();
    });
  }

  function tickClock() {
    updateDateLine();
    const nextDayKey = todayKey();
    if (nextDayKey !== ui.dayKey) {
      renderAll();
    }
  }

  async function init() {
    bindEvents();
    updateDateLine();
    els.dropPlaceholder.firstElementChild.textContent = '放在这里';

    try {
      const warning = await loadState();
      renderAll();
      setSaveState('saved');
      if (warning) {
        showToast({
          message: warning,
          type: 'warning',
          duration: 9500
        });
      }
    } catch (error) {
      ui.storageBlocked = true;
      const message = error instanceof Error ? error.message : String(error);
      renderAll();
      setSaveState('error', message);
      showToast({
        message: `无法读取本地数据：${message}`,
        type: 'error',
        duration: 12000
      });
    }

    loadAppInfo();
    els.addInput.focus();
    window.setInterval(tickClock, 30000);
  }

  init();
})();
