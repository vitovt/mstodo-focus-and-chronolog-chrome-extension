// To Do Focus & Hide Upcoming (Manifest V3 content script)
// Injects: (1) Work Chip timer per task row, (2) "Hide upcoming" toggle button.
// Not affiliated with Microsoft. Best-effort selectors; resilient to failures.

(() => {
  'use strict';
  if (window.__kuroInjected) return;
  window.__kuroInjected = true;

  const STORAGE_KEYS = {
    workStartMap: 'kuro.work.start',
    hideFuture: 'kuro.hideFuture'
  };

  const OBSERVER_CFG = { childList: true, subtree: true };

  // ---------- Utilities ----------
  const log = (...args) => console.log('[ToDo Focus+Hide]', ...args);
  const safeQ = (sel, root = document) => root.querySelector(sel);
  const safeQA = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const textOf = (el) => (el && (el.innerText || el.textContent) || '').trim();

  function readJsonLS(key, fallback = {}) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJsonLS(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
    } catch {
      /* ignore */
    }
  }

  // ---------- Work Chip (Focus timer) ----------
  function setupWorkChips() {
    // initial augment
    safeQA('.taskItem-body').forEach(augmentTaskItemBody);

    // observe for new tasks
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

    tryRestoreWorkingState(taskBody);
  }

  function onWorkChipClick(ev, taskBody) {
    ev.preventDefault();
    ev.stopPropagation();

    const key = getTaskWorkKey(taskBody);
    const now = Date.now();

    if (taskBody.classList.contains('is-working')) {
      // stop → compute elapsed and rename
      const started = Number(taskBody.getAttribute('data-work-start')) || getPersistedStart(key);
      const deltaMs = started ? Math.max(0, now - started) : 0;

      taskBody.classList.remove('is-working');
      taskBody.removeAttribute('data-work-start');
      persistStart(key, null);

      if (deltaMs > 0) {
        const mins = Math.round(deltaMs / 60000);
        const titleEl = taskBody.querySelector('.taskItem-title');
        if (!titleEl) return;

        const originalTitle = getTitleText(titleEl);
        const { baseTitle, existingMins } = splitTitleAndTrackedMins(originalTitle);
        const newTotal = (existingMins || 0) + mins;
        const newTitle = `${baseTitle} [${formatMinutes(newTotal)}]`;

        renameTaskThroughUI(taskBody, newTitle)
          .catch(() => {
            // fallback: visible only
            setVisibleTitle(titleEl, newTitle);
          });
      }
    } else {
      // start
      taskBody.classList.add('is-working');
      taskBody.setAttribute('data-work-start', String(now));
      persistStart(key, now);
    }
  }

  function tryRestoreWorkingState(taskBody) {
    const key = getTaskWorkKey(taskBody);
    const started = getPersistedStart(key);
    if (started) {
      taskBody.classList.add('is-working');
      taskBody.setAttribute('data-work-start', String(started));
    }
  }

  function getTitleText(titleEl) {
    return textOf(titleEl);
  }
  function setVisibleTitle(titleEl, text) {
    if (!titleEl) return;
    titleEl.textContent = text;
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

  function currentListName() {
    const listEl = document.querySelector('.listTitle');
    const name = listEl ? textOf(listEl) : '';
    return name || 'Tasks';
  }

  function getTaskWorkKey(taskBody) {
    const titleEl = taskBody.querySelector('.taskItem-title');
    const rawTitle = getTitleText(titleEl);
    const { baseTitle } = splitTitleAndTrackedMins(rawTitle);
    return `${currentListName()}::${baseTitle}`;
  }

  function getPersistedStart(key) {
    const map = readJsonLS(STORAGE_KEYS.workStartMap, {});
    const val = map[key];
    return typeof val === 'number' ? val : null;
  }

  function persistStart(key, value) {
    const map = readJsonLS(STORAGE_KEYS.workStartMap, {});
    if (value) map[key] = value;
    else delete map[key];
    writeJsonLS(STORAGE_KEYS.workStartMap, map);
  }

  async function renameTaskThroughUI(taskBody, newTitle) {
    // Ensure the row is selected
    const rowBtn = taskBody.querySelector('button.taskItem-titleWrapper') ||
                   taskBody.querySelector('.taskItem-titleWrapper');
    if (!rowBtn) throw new Error('Title wrapper not found');
    rowBtn.click();

    // Open editor in the right pane
    const editButton = await waitForSelector('.editableContent-editButton', 2000);
    editButton.click();

    // Find an editable field
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
        const anyToolbarIconButton = document.querySelector('.toolbarButton, [role="toolbar"] .button');
        if (!anyToolbarIconButton) return false;
        listBtn = anyToolbarIconButton;
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
    safeQA('.taskItem').forEach(classifyTaskFutureState);
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
  function boot() {
    try {
      setupWorkChips();
    } catch (e) {
      console.error('WorkChip init failed', e);
    }

    try {
      setupHideFutureTasksToggle();
    } catch (e) {
      console.error('Hide-future toggle init failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

