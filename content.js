// To Do Focus & Hide Upcoming (Manifest V3 content script)
// Injects: (1) Work Chip timer per task row, (2) "Hide upcoming" toggle button.
// Not affiliated with Microsoft. Best-effort selectors; resilient to failures.
// 3) Chronolog (Daily time tracking): logs task sessions + Idle to chrome.storage
// and exposes a Markdown table via popup.html.

(() => {
  'use strict';
  if (window.__kuroInjected) return;
  window.__kuroInjected = true;

  const STORAGE_KEYS = {
    hideFuture: 'kuro.hideFuture',
    logs: 'kuro.logs' // { [YYYY-MM-DD]: Array<Session> }, Session: {label,start,end?}
  };

  const OBSERVER_CFG = { childList: true, subtree: true };
  const IDLE_LABEL = 'Idle';

  // ---------- Simple chrome.storage wrappers ----------
  const store = {
    get(keys) {
      return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    },
    set(obj) {
      return new Promise(resolve => chrome.storage.local.set(obj, resolve));
    }
  };

  // ---------- Time / format helpers ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  function todayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const da = pad2(d.getDate());
    return `${y}-${m}-${da}`;
  }
  function fmtHHMM(ts) {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function humanDur(ms) {
    const mins = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  // ---------- Logs (chronolog) ----------
  async function getLogs() {
    const data = await store.get([STORAGE_KEYS.logs]);
    return data[STORAGE_KEYS.logs] || {};
  }
  async function setLogs(logs) {
    await store.set({ [STORAGE_KEYS.logs]: logs });
  }
  async function getTodayLog() {
    const logs = await getLogs();
    const key = todayKey();
    return { logs, key, day: logs[key] || [] };
  }
  async function appendSession(label, startTs) {
    const { logs, key, day } = await getTodayLog();
    day.push({ label, start: startTs });
    logs[key] = day;
    await setLogs(logs);
  }
  async function endOpenSession(endTs) {
    const { logs, key, day } = await getTodayLog();
    if (day.length === 0) return null;
    const last = day[day.length - 1];
    if (last.end == null) {
      last.end = endTs;
      logs[key] = day;
      await setLogs(logs);
      return last;
    }
    return null;
  }
  async function ensureOpenSession(labelIfNone = IDLE_LABEL) {
    const { logs, key, day } = await getTodayLog();
    if (day.length === 0 || day[day.length - 1].end != null) {
      // Open a new session (Idle by default)
      await appendSession(labelIfNone, Date.now());
      return { label: labelIfNone };
    }
    return { label: day[day.length - 1].label };
  }
  async function switchSession(newLabel) {
    const now = Date.now();
    await endOpenSession(now);
    await appendSession(newLabel, now);
  }

  // Ensure we never have overlapping "working" sessions:
  async function stopOtherWorkingUIs(exceptBody, skipIdle) {
    const list = Array.from(document.querySelectorAll('.taskItem-body.is-working'));
    for (const el of list) {
      if (el !== exceptBody) {
        // Synthetic stop for UI-only; we need to actually trigger the same logic used on click:
        await stopWorkForTask(el, skipIdle);
      }
    }
  }

  // ---------- Core UI augmentation ----------
  function setupWorkChips() {
    document.querySelectorAll('.taskItem-body').forEach(augmentTaskItemBody);
    const root = document.getElementById('root') || document.body;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes || []) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.classList?.contains('taskItem-body')) {
            augmentTaskItemBody(n);
          } else {
            n.querySelectorAll?.('.taskItem-body').forEach(augmentTaskItemBody);
          }
        }
      }
    });
    mo.observe(root, OBSERVER_CFG);
  }

  function augmentTaskItemBody(taskBody) {
    if (!taskBody || taskBody.querySelector('.work-chip')) return;

    // layout context
    const cs = getComputedStyle(taskBody);
    if (cs.position === 'static') taskBody.style.position = 'relative';

    // chip
    const chip = document.createElement('div');
    chip.className = 'work-chip';
    chip.title = 'Click to start/stop Focus tracking for this task';
    chip.addEventListener('click', (ev) => onWorkChipClick(ev, taskBody));
    taskBody.prepend(chip);
  }

  function getTitleEl(taskBody) {
    return taskBody.querySelector('.taskItem-title');
  }

  function getTitleText(titleEl) {
    return (titleEl && (titleEl.innerText || titleEl.textContent) || '').trim();
  }
  function setVisibleTitle(titleEl, text) {
    if (titleEl) titleEl.textContent = text;
  }

  function splitTitleAndTrackedMins(title) {
    // matches: [1h 5m], [75m], [2h]
    const re = /\s*(?:\[(?:(\d+)h(?:\s+(\d+)m)?)\]|\[(\d+)m\])\s*$/;
    const m = title.match(re);
    if (!m) return { baseTitle: title, existingMins: 0 };

    let existingMins = 0;
    if (m[1]) {
      const h = parseInt(m[1], 10) || 0;
      const mm = parseInt(m[2] || '0', 10) || 0;
      existingMins = h * 60 + mm;
    } else if (m[3]) {
      existingMins = parseInt(m[3], 10) || 0;
    }
    const baseTitle = title.replace(re, '').trim();
    return { baseTitle, existingMins };
  }
  function formatMinutes(totalMins) {
    const h = Math.floor(totalMins / 60);
    const m = Math.max(0, totalMins % 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  async function onWorkChipClick(ev, taskBody) {
    ev.preventDefault();
    ev.stopPropagation();

    // Enforce single active: if any other is-working, stop it.
    await stopOtherWorkingUIs(taskBody, true);

    if (taskBody.classList.contains('is-working')) {
      await stopWorkForTask(taskBody);
    } else {
      await startWorkForTask(taskBody);
    }
  }

  async function startWorkForTask(taskBody) {
    const titleEl = getTitleEl(taskBody);
    if (!titleEl) return;

    // Switch chronolog session to this task
    const { baseTitle } = splitTitleAndTrackedMins(getTitleText(titleEl));
    await switchSession(baseTitle);

    // UI mark
    taskBody.classList.add('is-working');
    taskBody.setAttribute('data-work-start', String(Date.now()));
  }

  async function stopWorkForTask(taskBody, skipIdle) {
    const titleEl = getTitleEl(taskBody);
    if (!titleEl) {
      // still ensure Idle starts in chronolog
      if (!skipIdle) { await switchSession(IDLE_LABEL); }
      taskBody.classList.remove('is-working');
      taskBody.removeAttribute('data-work-start');
      return;
    }

    const rawTitle = getTitleText(titleEl);
    const { baseTitle, existingMins } = splitTitleAndTrackedMins(rawTitle);

    // Determine elapsed time from open session (safe fallback: from DOM attribute)
    const { logs, key, day } = await getTodayLog();
    const last = day[day.length - 1];
    const now = Date.now();
    let deltaMs = 0;

    if (last && last.label === baseTitle && last.end == null) {
      last.end = now;
      logs[key] = day;
      await setLogs(logs);
      deltaMs = now - last.start;
    } else {
      // Fallback to attribute (if any)
      const started = Number(taskBody.getAttribute('data-work-start')) || now;
      deltaMs = Math.max(0, now - started);
    }

    const mins = Math.round(deltaMs / 60000);
    const newTotal = (existingMins || 0) + mins;
    const newTitle = `${baseTitle} [${formatMinutes(newTotal)}]`;

    // Try to rename via UI; fallback to visual text only.
    try {
      await renameTaskThroughUI(taskBody, newTitle);
    } catch {
      setVisibleTitle(titleEl, newTitle);
    }

    // Switch to Idle session
    if (!skipIdle) { await switchSession(IDLE_LABEL); }

    // UI unmark
    taskBody.classList.remove('is-working');
    taskBody.removeAttribute('data-work-start');
  }

  async function renameTaskThroughUI(taskBody, newTitle) {
    const rowBtn = taskBody.querySelector('button.taskItem-titleWrapper') ||
                   taskBody.querySelector('.taskItem-titleWrapper');
    if (!rowBtn) throw new Error('Title wrapper not found');
    rowBtn.click();

    const editButton = await waitForSelector('.editableContent-editButton', 2000);
    editButton.click();

    const editor = await waitForSelector('.editableContent input[type="text"], .editableContent textarea, .editableContent [contenteditable="true"]', 2000);

    if (editor.tagName === 'INPUT' || editor.tagName === 'TEXTAREA') {
      editor.focus();
      editor.value = newTitle;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      editor.blur();
    } else if (editor.getAttribute('contenteditable') === 'true') {
      editor.focus();
      editor.textContent = newTitle;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.blur();
    }

    // Optional: close details pane if present
    const closeBtn = document.querySelector('.detailFooter-close');
    if (closeBtn) closeBtn.click();
  }

  function waitForSelector(selector, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        const el = document.querySelector(selector);
        el ? resolve(el) : reject(new Error(`Timeout waiting for selector: ${selector}`));
      }, timeoutMs);
    });
  }

  // ---------- Hide upcoming tasks ----------
  function setupHideFutureTasksToggle() {
    // apply saved state
    setHideFutureState(getHideFutureState());

    // insert button once toolbar is present
    insertHideFutureButton();

    // classify current tasks and observe
    classifyAllTasksForFuture();
    observeTasksForFutureClassification();
  }

  function getHideFutureState() {
    try {
      return localStorage.getItem(STORAGE_KEYS.hideFuture) === '1';
    } catch {
      return false;
    }
  }

  function setHideFutureState(on) {
    document.documentElement.classList.toggle('hide-future-tasks', !!on);
    try {
      localStorage.setItem(STORAGE_KEYS.hideFuture, on ? '1' : '0');
    } catch { /* ignore */ }

    const btn = document.querySelector('.kuro-hide-future-btn');
    if (btn) {
      btn.classList.toggle('selectedButton', !!on);
      const span = btn.querySelector('span');
      if (span) span.textContent = on ? 'Show upcoming' : 'Hide upcoming';
    }
  }

  function toggleHideFutureState() {
    setHideFutureState(!getHideFutureState());
    classifyAllTasksForFuture();
  }

  function insertHideFutureButton() {
    const tryInsert = () => {
      // Primary selector (close to your Electron patch)
      let listBtn = document.querySelector('.gridViewToggle .toolbarButton.listButton');

      // Fallbacks: try any toolbar region that holds view buttons
      if (!listBtn) {
        listBtn = document.querySelector('.toolbarButton, [role="toolbar"] .button');
        if (!listBtn) return false;
      }

      const container = listBtn.parentElement?.parentElement || listBtn.parentElement;
      if (!container) return false;

      if (document.querySelector('.kuro-hide-future-btn')) return true;

      const btn = document.createElement('button');
      btn.className = 'button loadingButton button toolbarButton kuro-hide-future-btn';
      btn.setAttribute('aria-label', 'Hide future tasks');
      btn.setAttribute('title', 'Hide tasks with a due date in the future');
      btn.setAttribute('tabindex', '0');

      const inner = document.createElement('div');
      inner.className = 'toolbarButton-inner';

      const icon = document.createElement('div');
      icon.className = 'toolbarButton-icon';
      // clone an existing icon block if we can, otherwise a simple placeholder
      const iconSrc = listBtn.querySelector('.toolbarButton-icon')?.cloneNode(true);
      if (iconSrc) icon.appendChild(iconSrc);
      else {
        const i = document.createElement('i');
        i.className = 'icon fontIcon ms-Icon ms-Icon--Filter iconSize-24';
        icon.appendChild(i);
      }

      const label = document.createElement('span');
      label.textContent = 'Hide upcoming';

      inner.appendChild(icon);
      inner.appendChild(label);
      btn.appendChild(inner);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleHideFutureState();
      });

      // Insert near listBtn block (after)
      const wrapper = document.createElement('div');
      wrapper.appendChild(btn);
      container.parentElement?.insertBefore(wrapper, container.nextSibling);

      if (getHideFutureState()) btn.classList.add('selectedButton');
      return true;
    };

    if (!tryInsert()) {
      const mo = new MutationObserver(() => {
        if (tryInsert()) mo.disconnect();
      });
      mo.observe(document.body, OBSERVER_CFG);
    }
  }

  function classifyAllTasksForFuture() {
    document.querySelectorAll('.taskItem').forEach(classifyTaskFutureState);
  }

  function classifyTaskFutureState(taskItem) {
    if (!(taskItem instanceof HTMLElement)) return;
    try {
      const dateEl = taskItem.querySelector('.taskItemInfo-date');
      const hasDate = !!dateEl;
      const isDueNow = !!(hasDate && (dateEl.classList.contains('overdue') || dateEl.classList.contains('dueToday')));
      const isFuture = hasDate && !isDueNow;
      taskItem.classList.toggle('kuro-future-task', isFuture);
    } catch {
      /* ignore */
    }
  }

  function observeTasksForFutureClassification() {
    const root = document.querySelector('.tasks') || document.getElementById('root') || document.body;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes?.length) {
          m.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.classList?.contains('taskItem')) classifyTaskFutureState(node);
            else node.querySelectorAll?.('.taskItem').forEach(classifyTaskFutureState);
          });
        }
        if (m.type === 'attributes' || m.type === 'characterData') {
          const el = (m.target instanceof HTMLElement) ? m.target : (m.target.parentElement || null);
          const task = el?.closest?.('.taskItem');
          if (task) classifyTaskFutureState(task);
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  // ---------- Boot ----------
  async function boot() {
    // Chronolog: ensure there's always an open session (Idle if none).
    await ensureOpenSession(IDLE_LABEL);

    try { setupWorkChips(); } catch (e) { console.error('WorkChip init failed', e); }
    try { setupHideFutureTasksToggle(); } catch (e) { console.error('Hide-future toggle init failed', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot(); }, { once: true });
  } else {
    boot();
  }
})();

