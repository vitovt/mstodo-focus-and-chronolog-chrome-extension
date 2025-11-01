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
    hideRecurring: 'kuro.hideRecurring',
    logs: 'kuro.logs' // { [YYYY-MM-DD]: Array<Session> }, Session: {label,start,end?}
  };

  const OBSERVER_CFG = { childList: true, subtree: true };
  const IDLE_LABEL = 'Idle';

  // ---------- UI queue (serialize stop/start flows) ----------
  const uiQueue = (() => {
    let chain = Promise.resolve();
    return (fn) => (chain = chain.then(() => fn()).catch(err => {
      console.warn('[mstodo-ext] queue err', err);
    }))
  })();

  // Global busy gate to drop rapid clicks while a flow runs
  let uiBusy = false;
  function setBusyChips(on) {
    try {
      document.querySelectorAll('.work-chip').forEach(chip => {
        chip.classList.toggle('kuro-busy', !!on);
        chip.style.pointerEvents = on ? 'none' : '';
        if (on) {
          if (!chip.hasAttribute('data-prev-title')) chip.setAttribute('data-prev-title', chip.title || '');
          chip.title = 'Working… please wait';
        } else {
          const prev = chip.getAttribute('data-prev-title');
          if (prev != null) chip.title = prev;
          chip.removeAttribute('data-prev-title');
        }
      });
    } catch {/* ignore */}
  }

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
  // fmtHHMM and humanDur were unused and removed

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

  // stopOtherWorkingUIs replaced by queued variant below

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
  // setVisibleTitle was a fallback; removed to avoid writing into wrong pane

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

    // If a stop/start flow is in progress, drop extra clicks.
    if (uiBusy) {
      console.debug('[mstodo-ext] busy; dropping click');
      return;
    }
    uiBusy = true;
    setBusyChips(true);

    // Enforce single active: if any other is-working, stop it, queued.
    try {
      await stopOtherWorkingUIsQueued(taskBody, true);

      // Serialize the action for this row through the UI queue as well.
      if (taskBody.classList.contains('is-working')) {
        await uiQueue(() => stopWorkForTask(taskBody));
      } else {
        await uiQueue(() => startWorkForTask(taskBody));
      }
    } finally {
      uiBusy = false;
      setBusyChips(false);
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

    // Immutable per-task context snapshot
    const ctx = {
      taskBody,
      baseTitle,
      rawTitle,
      newTitle
    };

    // Try to rename via UI with scoped selectors and identity checks; fallback to visual text only.
    try {
      await renameTaskThroughUI(ctx);
    } catch (e) {
      console.warn('[mstodo-ext] stop: rename failed/aborted', e);
      try { alert(`[mstodo-ext] Could not safely rename "${rawTitle}".\n\nPlease rename manually to:\n${newTitle}`); } catch {}
    }

    // Switch to Idle session
    if (!skipIdle) { await switchSession(IDLE_LABEL); }

    // UI unmark
    taskBody.classList.remove('is-working');
    taskBody.removeAttribute('data-work-start');
  }

  async function renameTaskThroughUI(ctx) {
    const { taskBody, baseTitle, rawTitle, newTitle } = ctx;
    console.debug('[mstodo-ext] stop: ctx', { baseTitle });

    // Ensure the row is selected (click on the row title area)
    const rowBtn = taskBody.querySelector('button.taskItem-titleWrapper') ||
                   taskBody.querySelector('.taskItem-titleWrapper') ||
                   taskBody.querySelector('[role="button"], .taskItem-title');
    if (!rowBtn) throw new Error('Title wrapper not found');
    rowBtn.click();

    // Wait for the edit button within the details pane
    const editButton = await waitForSelector('.editableContent-editButton', 2000);

    // Scope to the nearest editableContent container for all subsequent queries
    const paneEditable = editButton.closest('.editableContent') || document;
    editButton.click();

    // Find an editable field within the scoped container
    const editor = await waitForSelectorWithin(
      paneEditable,
      'input[type="text"], textarea, [contenteditable="true"]',
      2000
    );

    // Identity verification before typing: compare editor's current text with task row's title
    const currentEditorText = (editor.tagName === 'INPUT' || editor.tagName === 'TEXTAREA')
      ? (editor.value || '')
      : (editor.textContent || '');

    const editorBase = splitTitleAndTrackedMins((currentEditorText || '').trim()).baseTitle;
    const rowBase = splitTitleAndTrackedMins(getTitleText(getTitleEl(taskBody))).baseTitle;
    const targetBase = baseTitle;

    const paneMatch = editorBase === targetBase && rowBase === targetBase;
    console.debug('[mstodo-ext] stop: paneMatch', paneMatch, { editorBase, rowBase, targetBase });

    if (!paneMatch) {
      const msg = `[mstodo-ext] abort: pane mismatch for "${rawTitle}" → "${newTitle}"`;
      console.warn(msg);
      try { alert(`${msg}\n\nPlease rename manually if needed.`); } catch {}
      throw new Error('Pane identity mismatch');
    }

    // Type and commit
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

    // Optional: close details pane if present, scoped if possible
    const paneRoot = editButton.closest('[class*="detail"], [class*="pane"], .editableContent') || document;
    const closeBtn = paneRoot.querySelector?.('.detailFooter-close') || document.querySelector('.detailFooter-close');
    if (closeBtn) closeBtn.click();
  }

  function waitForSelector(selector, timeoutMs = 3000) {
    return waitForSelectorWithin(document, selector, timeoutMs);
  }

  function waitForSelectorWithin(root, selector, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const q = () => root.querySelector?.(selector) || null;
      const existing = q();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = q();
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      const rootNode = (root instanceof Document) ? root.body : root;
      try { observer.observe(rootNode || document.body, { childList: true, subtree: true }); } catch {}

      const timeout = setTimeout(() => {
        observer.disconnect();
        const el = q();
        if (el) return resolve(el);
        reject(new Error(`Timeout waiting for selector: ${selector}`));
      }, timeoutMs);
    });
  }

  // Queued variant: stop all other working UIs
  async function stopOtherWorkingUIsQueued(exceptBody, skipIdle) {
    const list = Array.from(document.querySelectorAll('.taskItem-body.is-working'));
    for (const el of list) {
      if (el !== exceptBody) {
        await uiQueue(() => stopWorkForTask(el, skipIdle));
      }
    }
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

    // Update labels in the mobile dropdown, if present
    try { refreshFilterMenuLabels(); } catch {}
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

  // ---------- Mobile-friendly combined filter menu (Future + Recurring) ----------
  function setupMobileFiltersMenu() {
    insertFiltersMenuButton();
    refreshFilterMenuLabels();
  }

  function insertFiltersMenuButton() {
    const tryInsert = () => {
      // Prefer inserting into the right toolbar group, slightly left of sorting/grouping
      const rightActions = document.querySelector('.taskToolbar-right .tasksToolbar-actions');

      // If already exists, ensure it's positioned inside rightActions as first item
      const existing = document.querySelector('.kuro-filter-menu');
      if (existing) {
        if (rightActions && existing.parentElement !== rightActions) {
          rightActions.insertBefore(existing, rightActions.firstChild);
        }
        return true;
      }

      // Create wrapper
      const wrapper = document.createElement('div');
      // Match site structure for spacing
      wrapper.className = 'tasksToolbar-actionsItem kuro-filter-menu';

      const btn = document.createElement('button');
      btn.className = 'button loadingButton toolbarButton kuro-filter-menu-btn';
      btn.setAttribute('aria-label', 'Filter options');
      btn.setAttribute('title', 'Filter options');
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');

      const inner = document.createElement('div');
      inner.className = 'toolbarButton-inner';
      const icon = document.createElement('div');
      icon.className = 'toolbarButton-icon';
      const i = document.createElement('i');
      // Use a distinct icon (Filter) to avoid confusion with list view icon
      i.className = 'icon fontIcon ms-Icon ms-Icon--Filter iconSize-24';
      icon.appendChild(i);
      const label = document.createElement('span');
      label.textContent = 'Filters';
      inner.appendChild(icon);
      inner.appendChild(label);
      btn.appendChild(inner);

      const dropdown = document.createElement('div');
      dropdown.className = 'kuro-filter-dropdown';
      dropdown.setAttribute('role', 'menu');
      dropdown.setAttribute('aria-hidden', 'true');

      const itemFuture = document.createElement('button');
      itemFuture.className = 'kuro-filter-item kuro-filter-item-future';
      itemFuture.setAttribute('role', 'menuitemcheckbox');
      itemFuture.setAttribute('aria-checked', String(!!getHideFutureState()));
      itemFuture.textContent = getHideFutureState() ? 'Show Future Tasks' : 'Hide Future Tasks';
      itemFuture.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        toggleHideFutureState();
        refreshFilterMenuLabels();
        // Close after selection for better mobile UX
        try { dropdown.classList.remove('open'); dropdown.setAttribute('aria-hidden','true'); btn.setAttribute('aria-expanded','false'); } catch {}
      });

      const itemRecurring = document.createElement('button');
      itemRecurring.className = 'kuro-filter-item kuro-filter-item-recurring';
      itemRecurring.setAttribute('role', 'menuitemcheckbox');
      itemRecurring.setAttribute('aria-checked', String(!!getHideRecurringState()));
      itemRecurring.textContent = getHideRecurringState() ? 'Show Recurring Tasks' : 'Hide Recurring Tasks';
      itemRecurring.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        toggleHideRecurringState();
        refreshFilterMenuLabels();
        // Close after selection for better mobile UX
        try { dropdown.classList.remove('open'); dropdown.setAttribute('aria-hidden','true'); btn.setAttribute('aria-expanded','false'); } catch {}
      });

      dropdown.appendChild(itemFuture);
      dropdown.appendChild(itemRecurring);

      // Open/close handlers
      const closeMenu = () => {
        dropdown.classList.remove('open');
        dropdown.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
      };
      const openMenu = () => {
        dropdown.classList.add('open');
        dropdown.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
      };
      const toggleMenu = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        if (dropdown.classList.contains('open')) closeMenu();
        else openMenu();
      };
      btn.addEventListener('click', toggleMenu);

      // Click outside to close
      document.addEventListener('click', (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLElement)) return;
        if (!wrapper.contains(t)) closeMenu();
      });

      wrapper.appendChild(btn);
      wrapper.appendChild(dropdown);

      if (rightActions) {
        // Insert as first action on the right
        rightActions.insertBefore(wrapper, rightActions.firstChild);
        return true;
      }

      // Fallback: insert after the view toggle group (left side)
      let anchorBtn = document.querySelector('.gridViewToggle .toolbarButton.listButton') ||
                      document.querySelector('.gridViewToggle .toolbarButton.gridButton');
      if (!anchorBtn) {
        const anyToolbarIconButton = document.querySelector('.toolbarButton, [role="toolbar"] .button');
        if (!anyToolbarIconButton) return false;
        anchorBtn = anyToolbarIconButton;
      }
      const container = anchorBtn.parentElement?.parentElement || anchorBtn.parentElement;
      if (!container) return false;
      container.parentElement?.insertBefore(wrapper, container.nextSibling);
      return true;
    };

    if (!tryInsert()) {
      const mo = new MutationObserver(() => {
        if (tryInsert()) mo.disconnect();
      });
      mo.observe(document.body, OBSERVER_CFG);
    }
  }

  function refreshFilterMenuLabels() {
    // Update dropdown item labels and aria states, if present
    const itemFuture = document.querySelector('.kuro-filter-item-future');
    if (itemFuture) {
      const on = getHideFutureState();
      itemFuture.textContent = on ? 'Future Tasks Hidden' : 'Hide Future Tasks';
      itemFuture.setAttribute('aria-checked', String(!!on));
    }
    const itemRecurring = document.querySelector('.kuro-filter-item-recurring');
    if (itemRecurring) {
      const on = getHideRecurringState();
      itemRecurring.textContent = on ? 'Recurring Tasks Hidden' : 'Hide Recurring Tasks';
      itemRecurring.setAttribute('aria-checked', String(!!on));
    }
  }

  // ---------- Hide recurring tasks ----------
  function setupHideRecurringTasksToggle() {
    // apply saved state
    setHideRecurringState(getHideRecurringState());

    // insert button once toolbar is present
    insertHideRecurringButton();

    // classify current tasks and observe
    classifyAllTasksForRecurring();
    observeTasksForRecurringClassification();
  }

  function getHideRecurringState() {
    try {
      return localStorage.getItem(STORAGE_KEYS.hideRecurring) === '1';
    } catch {
      return false;
    }
  }

  function setHideRecurringState(on) {
    document.documentElement.classList.toggle('hide-recurring-tasks', !!on);
    try {
      localStorage.setItem(STORAGE_KEYS.hideRecurring, on ? '1' : '0');
    } catch { /* ignore */ }

    const btn = document.querySelector('.kuro-hide-recurring-btn');
    if (btn) {
      btn.classList.toggle('selectedButton', !!on);
      const span = btn.querySelector('span');
      if (span) span.textContent = on ? 'Show Recurring' : 'Hide Recurring';
    }

    // Update labels in the mobile dropdown, if present
    try { refreshFilterMenuLabels(); } catch {}
  }

  function toggleHideRecurringState() {
    setHideRecurringState(!getHideRecurringState());
    classifyAllTasksForRecurring();
  }

  function insertHideRecurringButton() {
    const tryInsert = () => {
      // Try to place next to existing toolbar buttons (near list/grid toggle)
      let listBtn = document.querySelector('.gridViewToggle .toolbarButton.listButton');

      if (!listBtn) {
        const anyToolbarIconButton = document.querySelector('.toolbarButton, [role="toolbar"] .button');
        if (!anyToolbarIconButton) return false;
        listBtn = anyToolbarIconButton;
      }

      const container = listBtn.parentElement?.parentElement || listBtn.parentElement;
      if (!container) return false;

      if (document.querySelector('.kuro-hide-recurring-btn')) return true;

      const btn = document.createElement('button');
      btn.className = 'button loadingButton button toolbarButton kuro-hide-recurring-btn';
      btn.setAttribute('aria-label', 'Hide recurring tasks');
      btn.setAttribute('title', 'Hide tasks that are recurring');
      btn.setAttribute('tabindex', '0');

      const inner = document.createElement('div');
      inner.className = 'toolbarButton-inner';

      const icon = document.createElement('div');
      icon.className = 'toolbarButton-icon';
      const iconSrc = listBtn.querySelector('.toolbarButton-icon')?.cloneNode(true);
      if (iconSrc) icon.appendChild(iconSrc);
      else {
        const i = document.createElement('i');
        i.className = 'icon fontIcon ms-Icon ms-Icon--RepeatAll iconSize-24';
        icon.appendChild(i);
      }

      const label = document.createElement('span');
      label.textContent = 'Hide Recurring';

      inner.appendChild(icon);
      inner.appendChild(label);
      btn.appendChild(inner);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleHideRecurringState();
      });

      const wrapper = document.createElement('div');
      wrapper.appendChild(btn);
      container.parentElement?.insertBefore(wrapper, container.nextSibling);

      if (getHideRecurringState()) btn.classList.add('selectedButton');
      return true;
    };

    if (!tryInsert()) {
      const mo = new MutationObserver(() => {
        if (tryInsert()) mo.disconnect();
      });
      mo.observe(document.body, OBSERVER_CFG);
    }
  }

  function classifyAllTasksForRecurring() {
    document.querySelectorAll('.taskItem').forEach(classifyTaskRecurringState);
  }

  function classifyTaskRecurringState(taskItem) {
    if (!(taskItem instanceof HTMLElement)) return;
    try {
      const isRecurring = !!taskItem.querySelector('.taskItemInfoRecurrence-icon');
      taskItem.classList.toggle('kuro-recurring-task', isRecurring);
    } catch {
      /* ignore */
    }
  }

  function observeTasksForRecurringClassification() {
    const root = document.querySelector('.tasks') || document.getElementById('root') || document.body;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes?.length) {
          m.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.classList?.contains('taskItem')) classifyTaskRecurringState(node);
            else node.querySelectorAll?.('.taskItem').forEach(classifyTaskRecurringState);
          });
        }
        if (m.type === 'attributes' || m.type === 'characterData') {
          const el = (m.target instanceof HTMLElement) ? m.target : (m.target.parentElement || null);
          const task = el?.closest?.('.taskItem');
          if (task) classifyTaskRecurringState(task);
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
    try { setupHideRecurringTasksToggle(); } catch (e) { console.error('Hide-recurring toggle init failed', e); }
    try { setupMobileFiltersMenu(); } catch (e) { console.error('Mobile filters menu init failed', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot(); }, { once: true });
  } else {
    boot();
  }
})();
