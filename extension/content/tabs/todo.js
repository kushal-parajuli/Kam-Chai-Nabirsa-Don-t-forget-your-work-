import { MESSAGES } from '../../shared/messages.js';
import { MIN_LEAD_SECONDS } from '../../shared/constants.js';

/**
 * Formats relative time remaining until a reminder timestamp.
 * @param {number} epochMs 
 * @returns {{ text: string, isOverdue: boolean, isAmber: boolean }}
 */
export function formatTimeLeft(epochMs) {
  if (!epochMs) return { text: '', isOverdue: false, isAmber: false };

  const diff = epochMs - Date.now();
  if (diff <= 0) {
    return { text: 'Overdue', isOverdue: true, isAmber: false };
  }

  const totalMinutes = Math.floor(diff / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  let text = '';
  if (totalDays > 0) {
    const remHours = totalHours % 24;
    text = remHours > 0 ? `in ${totalDays}d ${remHours}h` : `in ${totalDays}d`;
  } else if (totalHours > 0) {
    const remMin = totalMinutes % 60;
    text = remMin > 0 ? `in ${totalHours}h ${remMin}m` : `in ${totalHours}h`;
  } else {
    text = `in ${Math.max(1, totalMinutes)}m`;
  }

  const isAmber = totalMinutes < 5;
  return { text, isOverdue: false, isAmber };
}

/**
 * Converts a Date object to YYYY-MM-DDTHH:mm string for datetime-local inputs.
 * @param {Date} date 
 * @returns {string}
 */
function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const Y = date.getFullYear();
  const M = pad(date.getMonth() + 1);
  const D = pad(date.getDate());
  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  return `${Y}-${M}-${D}T${h}:${m}`;
}

/**
 * Calculates epoch ms for tomorrow at 9:00 AM.
 * @returns {number}
 */
function getTomorrow9AM() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/**
 * Initializes the Todo tab interface inside the Shadow DOM pane.
 * @param {object} options
 * @param {HTMLElement} options.paneElement The todo tab pane container.
 * @param {Function} options.onBadgeUpdate Callback to update the badge count on the pill.
 */
export function initTodoTab({ paneElement, onBadgeUpdate }) {
  if (!paneElement) return;

  // Local state
  let todos = [];
  let isCompletedExpanded = false;
  let undoTimer = null;
  let lastDeletedTodo = null;
  let newTodoRemindAt = null;
  let isAddReminderRowOpen = false;
  let refreshTimer = null;

  // Render Skeleton Template inside pane
  paneElement.innerHTML = `
    <div class="kcn-todo-container">
      <!-- Input bar -->
      <form class="kcn-todo-form" id="kcn-todo-form" autocomplete="off">
        <input 
          type="text" 
          class="kcn-todo-input" 
          id="kcn-todo-input" 
          placeholder="Add a new task..." 
          maxlength="200" 
          aria-label="New task title"
        />
        <button type="button" class="kcn-todo-bell-btn" id="kcn-toggle-reminder-row-btn" aria-label="Set reminder before adding" title="Set reminder">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </button>
        <button type="submit" class="kcn-todo-add-btn" id="kcn-todo-add-btn" aria-label="Add task" title="Add task (Enter)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </form>

      <!-- Pre-Add Reminder Row (Revealed by bell button) -->
      <div class="kcn-reminder-row kcn-hidden" id="kcn-reminder-row">
        <div class="kcn-reminder-row-header">
          <span class="kcn-reminder-row-label">Reminder:</span>
          <div class="kcn-reminder-active-chip kcn-hidden" id="kcn-reminder-active-chip">
            <span id="kcn-reminder-chip-text"></span>
            <button type="button" class="kcn-reminder-chip-clear" id="kcn-reminder-chip-clear" title="Clear reminder" aria-label="Clear reminder">×</button>
          </div>
        </div>
        <div class="kcn-quick-chips">
          <button type="button" class="kcn-chip-btn" data-preset="10m">+10 min</button>
          <button type="button" class="kcn-chip-btn" data-preset="1h">+1 hour</button>
          <button type="button" class="kcn-chip-btn" data-preset="tomorrow">Tomorrow 9 AM</button>
        </div>
        <div class="kcn-custom-time-row">
          <input type="datetime-local" class="kcn-dt-input" id="kcn-dt-input" aria-label="Custom reminder date and time" />
        </div>
      </div>

      <!-- Error alert -->
      <div class="kcn-todo-error kcn-hidden" id="kcn-todo-error" role="alert"></div>

      <!-- Main scrollable list area -->
      <div class="kcn-todo-scroll-area">
        <!-- Open todos list -->
        <div class="kcn-todo-list" id="kcn-todo-open-list" role="list" aria-label="Open tasks"></div>

        <!-- Empty state placeholder -->
        <div class="kcn-todo-empty kcn-hidden" id="kcn-todo-empty">
          <div class="kcn-todo-empty-icon">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <div class="kcn-todo-empty-title">All caught up!</div>
          <div class="kcn-todo-empty-desc">Add a task above to keep track of your work.</div>
        </div>

        <!-- Collapsible Completed Section -->
        <div class="kcn-completed-section kcn-hidden" id="kcn-completed-section">
          <div class="kcn-completed-header">
            <button class="kcn-completed-toggle" id="kcn-completed-toggle" aria-expanded="false" aria-controls="kcn-todo-completed-list">
              <svg class="kcn-completed-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
              <span id="kcn-completed-label">Completed (0)</span>
            </button>
            <button class="kcn-clear-completed-btn" id="kcn-clear-completed-btn" title="Remove all completed tasks">
              Clear completed
            </button>
          </div>
          <div class="kcn-todo-list kcn-hidden" id="kcn-todo-completed-list" role="list" aria-label="Completed tasks"></div>
        </div>
      </div>

      <!-- 5-second Undo Toast -->
      <div class="kcn-toast kcn-hidden" id="kcn-todo-toast" role="status" aria-live="polite">
        <span class="kcn-toast-text" id="kcn-toast-text">Task deleted</span>
        <button class="kcn-toast-undo-btn" id="kcn-toast-undo-btn">Undo</button>
      </div>
    </div>
  `;

  // Selectors
  const form = paneElement.querySelector('#kcn-todo-form');
  const input = paneElement.querySelector('#kcn-todo-input');
  const toggleReminderRowBtn = paneElement.querySelector('#kcn-toggle-reminder-row-btn');
  const reminderRow = paneElement.querySelector('#kcn-reminder-row');
  const reminderActiveChip = paneElement.querySelector('#kcn-reminder-active-chip');
  const reminderChipText = paneElement.querySelector('#kcn-reminder-chip-text');
  const reminderChipClear = paneElement.querySelector('#kcn-reminder-chip-clear');
  const dtInput = paneElement.querySelector('#kcn-dt-input');
  const errorEl = paneElement.querySelector('#kcn-todo-error');
  const openListEl = paneElement.querySelector('#kcn-todo-open-list');
  const completedSection = paneElement.querySelector('#kcn-completed-section');
  const completedToggle = paneElement.querySelector('#kcn-completed-toggle');
  const completedLabel = paneElement.querySelector('#kcn-completed-label');
  const completedListEl = paneElement.querySelector('#kcn-todo-completed-list');
  const clearCompletedBtn = paneElement.querySelector('#kcn-clear-completed-btn');
  const emptyStateEl = paneElement.querySelector('#kcn-todo-empty');
  const toastEl = paneElement.querySelector('#kcn-todo-toast');
  const toastUndoBtn = paneElement.querySelector('#kcn-toast-undo-btn');

  // Display friendly errors
  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.remove('kcn-hidden');
    setTimeout(() => {
      errorEl.classList.add('kcn-hidden');
      errorEl.textContent = '';
    }, 4500);
  }

  // Messaging helper
  function sendMsg(type, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.ok) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || 'Unknown storage error'));
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Pre-add Reminder Row Logic
  function updatePreAddReminderChip() {
    if (newTodoRemindAt) {
      reminderActiveChip.classList.remove('kcn-hidden');
      toggleReminderRowBtn.classList.add('kcn-bell-active');
      const date = new Date(newTodoRemindAt);
      reminderChipText.textContent = date.toLocaleTimeString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } else {
      reminderActiveChip.classList.add('kcn-hidden');
      toggleReminderRowBtn.classList.remove('kcn-bell-active');
      reminderChipText.textContent = '';
      if (dtInput) dtInput.value = '';
    }
  }

  function setPreAddReminderTime(ms) {
    const minTime = Date.now() + (MIN_LEAD_SECONDS * 1000);
    if (ms < minTime) {
      showError('Reminder must be at least 30 seconds into the future.');
      return false;
    }
    newTodoRemindAt = ms;
    updatePreAddReminderChip();
    return true;
  }

  toggleReminderRowBtn?.addEventListener('click', () => {
    isAddReminderRowOpen = !isAddReminderRowOpen;
    reminderRow.classList.toggle('kcn-hidden', !isAddReminderRowOpen);
    toggleReminderRowBtn.classList.toggle('kcn-bell-open', isAddReminderRowOpen);

    if (isAddReminderRowOpen && dtInput) {
      // Set min attribute to now + 30s
      dtInput.min = toDatetimeLocal(new Date(Date.now() + (MIN_LEAD_SECONDS * 1000)));
    }
  });

  reminderChipClear?.addEventListener('click', () => {
    newTodoRemindAt = null;
    updatePreAddReminderChip();
  });

  // Preset chips
  paneElement.querySelectorAll('.kcn-chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const now = Date.now();
      if (preset === '10m') {
        setPreAddReminderTime(now + 10 * 60 * 1000);
      } else if (preset === '1h') {
        setPreAddReminderTime(now + 60 * 60 * 1000);
      } else if (preset === 'tomorrow') {
        setPreAddReminderTime(getTomorrow9AM());
      }
    });
  });

  // Datetime input
  dtInput?.addEventListener('change', () => {
    if (!dtInput.value) return;
    const selectedMs = new Date(dtInput.value).getTime();
    if (isNaN(selectedMs)) return;
    setPreAddReminderTime(selectedMs);
  });

  // Load Todos from Service Worker
  async function loadTodos() {
    try {
      const data = await sendMsg(MESSAGES.TODO_LIST);
      todos = Array.isArray(data) ? data : [];
      renderTodos();
    } catch (err) {
      console.error('[KCN Todo] Failed to load todos:', err);
      showError('Unable to load tasks from storage.');
    }
  }

  // Periodic refresh of reminder time chips (every 30s)
  function refreshTimeChips() {
    paneElement.querySelectorAll('.kcn-time-chip').forEach((chip) => {
      const ms = Number(chip.getAttribute('data-remind-at'));
      if (ms) {
        const { text, isOverdue, isAmber } = formatTimeLeft(ms);
        chip.textContent = text;
        chip.classList.toggle('kcn-chip-overdue', isOverdue);
        chip.classList.toggle('kcn-chip-amber', isAmber);
      }
    });
  }

  // Render Todos list
  function renderTodos() {
    openListEl.innerHTML = '';
    completedListEl.innerHTML = '';

    const openTodos = todos.filter((t) => !t.done);
    const completedTodos = todos.filter((t) => t.done);

    // Update pill badge
    if (typeof onBadgeUpdate === 'function') {
      onBadgeUpdate(openTodos.length);
    }

    // Toggle Empty State
    if (todos.length === 0) {
      emptyStateEl.classList.remove('kcn-hidden');
    } else {
      emptyStateEl.classList.add('kcn-hidden');
    }

    // Render Open Todos
    openTodos.forEach((todo) => {
      const itemNode = createTodoNode(todo);
      openListEl.appendChild(itemNode);
    });

    // Render Completed Section
    if (completedTodos.length > 0) {
      completedSection.classList.remove('kcn-hidden');
      completedLabel.textContent = `Completed (${completedTodos.length})`;
      completedTodos.forEach((todo) => {
        const itemNode = createTodoNode(todo);
        completedListEl.appendChild(itemNode);
      });
    } else {
      completedSection.classList.add('kcn-hidden');
    }
  }

  // Create single todo DOM node (using textContent strictly for safety)
  function createTodoNode(todo) {
    const item = document.createElement('div');
    item.className = `kcn-todo-item ${todo.done ? 'kcn-item-done' : ''}`;
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-id', todo.id);

    // Checkbox container
    const checkWrap = document.createElement('label');
    checkWrap.className = 'kcn-todo-check-wrap';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'kcn-todo-checkbox';
    checkbox.checked = Boolean(todo.done);
    checkbox.setAttribute('aria-label', `Mark "${todo.title}" as ${todo.done ? 'incomplete' : 'complete'}`);

    checkbox.addEventListener('change', async () => {
      try {
        await sendMsg(MESSAGES.TODO_TOGGLE, { id: todo.id });
        await loadTodos();
      } catch (err) {
        console.error('[KCN Todo] Toggle failed:', err);
        showError('Failed to update task status.');
        checkbox.checked = !checkbox.checked;
      }
    });

    const customCheck = document.createElement('span');
    customCheck.className = 'kcn-custom-checkbox';
    checkWrap.appendChild(checkbox);
    checkWrap.appendChild(customCheck);
    item.appendChild(checkWrap);

    // Content container (title + clock chip)
    const contentWrap = document.createElement('div');
    contentWrap.className = 'kcn-todo-content-wrap';

    const titleEl = document.createElement('span');
    titleEl.className = 'kcn-todo-title';
    titleEl.textContent = todo.title;
    titleEl.title = 'Double-click to edit';
    contentWrap.appendChild(titleEl);

    // Clock chip if reminder is set
    if (todo.remindAt && !todo.done) {
      const timeInfo = formatTimeLeft(todo.remindAt);
      const clockChip = document.createElement('span');
      clockChip.className = `kcn-time-chip ${timeInfo.isOverdue ? 'kcn-chip-overdue' : ''} ${timeInfo.isAmber ? 'kcn-chip-amber' : ''}`;
      clockChip.setAttribute('data-remind-at', String(todo.remindAt));
      clockChip.textContent = timeInfo.text;
      clockChip.title = `Reminder: ${new Date(todo.remindAt).toLocaleString()}`;
      contentWrap.appendChild(clockChip);
    }

    item.appendChild(contentWrap);

    // Actions container
    const actions = document.createElement('div');
    actions.className = 'kcn-todo-actions';

    // Reminder Bell button for existing todo
    const bellBtn = document.createElement('button');
    bellBtn.className = `kcn-todo-action-btn ${todo.remindAt ? 'kcn-bell-has-reminder' : ''}`;
    bellBtn.setAttribute('aria-label', todo.remindAt ? 'Change or remove reminder' : 'Set reminder');
    bellBtn.title = todo.remindAt ? `Reminder set: ${new Date(todo.remindAt).toLocaleTimeString()}` : 'Add reminder';
    bellBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="${todo.remindAt ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
    `;

    // Toggle item inline reminder editor
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openItemReminderDialog(todo, item);
    });
    actions.appendChild(bellBtn);

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'kcn-todo-action-btn';
    editBtn.setAttribute('aria-label', `Edit "${todo.title}"`);
    editBtn.title = 'Edit task';
    editBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
      </svg>
    `;
    actions.appendChild(editBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'kcn-todo-action-btn kcn-del-btn';
    delBtn.setAttribute('aria-label', `Delete "${todo.title}"`);
    delBtn.title = 'Delete task';
    delBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    actions.appendChild(delBtn);

    item.appendChild(actions);

    // Inline edit handler
    function startEdit() {
      if (item.classList.contains('kcn-editing')) return;
      item.classList.add('kcn-editing');

      const editInput = document.createElement('input');
      editInput.type = 'text';
      editInput.className = 'kcn-todo-edit-input';
      editInput.maxLength = 200;
      editInput.value = todo.title;
      editInput.setAttribute('aria-label', 'Edit task title');

      contentWrap.replaceChild(editInput, titleEl);
      editInput.focus();
      editInput.select();

      let isFinished = false;

      async function saveEdit() {
        if (isFinished) return;
        isFinished = true;
        const newTitle = editInput.value.trim();

        if (newTitle && newTitle !== todo.title) {
          try {
            await sendMsg(MESSAGES.TODO_UPDATE, { id: todo.id, updates: { title: newTitle } });
            await loadTodos();
            return;
          } catch (err) {
            console.error('[KCN Todo] Edit failed:', err);
            showError('Failed to save task edit.');
          }
        }

        item.classList.remove('kcn-editing');
        if (contentWrap.contains(editInput)) {
          contentWrap.replaceChild(titleEl, editInput);
        }
      }

      function cancelEdit() {
        if (isFinished) return;
        isFinished = true;
        item.classList.remove('kcn-editing');
        if (contentWrap.contains(editInput)) {
          contentWrap.replaceChild(titleEl, editInput);
        }
      }

      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
      });

      editInput.addEventListener('blur', () => {
        saveEdit();
      });
    }

    titleEl.addEventListener('dblclick', startEdit);
    editBtn.addEventListener('click', startEdit);

    // Delete with 5-second undo toast
    delBtn.addEventListener('click', async () => {
      try {
        const deleted = await sendMsg(MESSAGES.TODO_DELETE, { id: todo.id });
        lastDeletedTodo = deleted || todo;
        showUndoToast(`Deleted "${lastDeletedTodo.title}"`);
        await loadTodos();
      } catch (err) {
        console.error('[KCN Todo] Delete failed:', err);
        showError('Failed to delete task.');
      }
    });

    return item;
  }

  // Inline reminder dialog for an existing item
  function openItemReminderDialog(todo, itemElement) {
    const existingDialog = paneElement.querySelector('.kcn-item-reminder-popover');
    if (existingDialog) {
      existingDialog.remove();
    }

    const popover = document.createElement('div');
    popover.className = 'kcn-item-reminder-popover';
    popover.innerHTML = `
      <div class="kcn-popover-header">
        <span>Set Reminder</span>
        <button type="button" class="kcn-popover-close" aria-label="Close">×</button>
      </div>
      <div class="kcn-quick-chips">
        <button type="button" class="kcn-chip-btn" data-preset="10m">+10 min</button>
        <button type="button" class="kcn-chip-btn" data-preset="1h">+1 hour</button>
        <button type="button" class="kcn-chip-btn" data-preset="tomorrow">Tomorrow 9 AM</button>
      </div>
      <div class="kcn-custom-time-row" style="margin-top:6px;">
        <input type="datetime-local" class="kcn-dt-input kcn-popover-dt" />
      </div>
      <div class="kcn-popover-actions">
        ${todo.remindAt ? '<button type="button" class="kcn-popover-btn-remove">Remove Reminder</button>' : ''}
        <button type="button" class="kcn-popover-btn-cancel">Cancel</button>
      </div>
    `;

    // Position popover below item
    itemElement.insertAdjacentElement('afterend', popover);

    const dtPicker = popover.querySelector('.kcn-popover-dt');
    if (dtPicker) {
      dtPicker.min = toDatetimeLocal(new Date(Date.now() + (MIN_LEAD_SECONDS * 1000)));
      if (todo.remindAt && todo.remindAt > Date.now()) {
        dtPicker.value = toDatetimeLocal(new Date(todo.remindAt));
      }
    }

    async function applyReminder(remindAt) {
      try {
        await sendMsg(MESSAGES.TODO_UPDATE, {
          id: todo.id,
          updates: { remindAt, reminded: false, preReminded: false }
        });
        popover.remove();
        await loadTodos();
      } catch (err) {
        console.error('[KCN Todo] Failed to update reminder:', err);
        showError('Failed to update reminder.');
      }
    }

    popover.querySelector('.kcn-popover-close')?.addEventListener('click', () => popover.remove());
    popover.querySelector('.kcn-popover-btn-cancel')?.addEventListener('click', () => popover.remove());
    popover.querySelector('.kcn-popover-btn-remove')?.addEventListener('click', () => applyReminder(null));

    popover.querySelectorAll('.kcn-chip-btn').forEach((chip) => {
      chip.addEventListener('click', () => {
        const preset = chip.getAttribute('data-preset');
        const now = Date.now();
        if (preset === '10m') {
          applyReminder(now + 10 * 60 * 1000);
        } else if (preset === '1h') {
          applyReminder(now + 60 * 60 * 1000);
        } else if (preset === 'tomorrow') {
          applyReminder(getTomorrow9AM());
        }
      });
    });

    dtPicker?.addEventListener('change', () => {
      if (!dtPicker.value) return;
      const ms = new Date(dtPicker.value).getTime();
      const minTime = Date.now() + (MIN_LEAD_SECONDS * 1000);
      if (ms < minTime) {
        showError('Reminder must be at least 30 seconds into the future.');
        return;
      }
      applyReminder(ms);
    });
  }

  // 5-second Undo Toast mechanism
  function showUndoToast(message) {
    if (!toastEl) return;
    clearTimeout(undoTimer);

    const toastText = paneElement.querySelector('#kcn-toast-text');
    if (toastText) {
      toastText.textContent = message;
    }

    toastEl.classList.remove('kcn-hidden');

    undoTimer = setTimeout(() => {
      toastEl.classList.add('kcn-hidden');
      lastDeletedTodo = null;
    }, 5000);
  }

  toastUndoBtn?.addEventListener('click', async () => {
    if (!lastDeletedTodo) return;
    clearTimeout(undoTimer);
    toastEl.classList.add('kcn-hidden');

    const toRestore = lastDeletedTodo;
    lastDeletedTodo = null;

    try {
      await sendMsg(MESSAGES.TODO_ADD, {
        title: toRestore.title,
        remindAt: toRestore.remindAt
      });
      await loadTodos();
    } catch (err) {
      console.error('[KCN Todo] Undo restore failed:', err);
      showError('Failed to restore deleted task.');
    }
  });

  // Add Todo Form Submit
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawVal = input?.value || '';
    const trimmed = rawVal.trim();

    if (!trimmed) return;

    try {
      input.value = '';
      const remindAtToSave = newTodoRemindAt;

      // Reset pre-add reminder state
      newTodoRemindAt = null;
      updatePreAddReminderChip();
      isAddReminderRowOpen = false;
      reminderRow.classList.add('kcn-hidden');
      toggleReminderRowBtn.classList.remove('kcn-bell-open');

      await sendMsg(MESSAGES.TODO_ADD, {
        title: trimmed,
        remindAt: remindAtToSave
      });
      await loadTodos();
      input.focus();
    } catch (err) {
      console.error('[KCN Todo] Add failed:', err);
      showError(err.message || 'Failed to add task.');
    }
  });

  // Toggle Completed Section collapse/expand
  completedToggle?.addEventListener('click', () => {
    isCompletedExpanded = !isCompletedExpanded;
    completedToggle.setAttribute('aria-expanded', String(isCompletedExpanded));
    completedToggle.classList.toggle('kcn-expanded', isCompletedExpanded);
    completedListEl.classList.toggle('kcn-hidden', !isCompletedExpanded);
  });

  // Clear Completed
  clearCompletedBtn?.addEventListener('click', async () => {
    try {
      await sendMsg(MESSAGES.TODO_CLEAR_DONE);
      await loadTodos();
    } catch (err) {
      console.error('[KCN Todo] Clear completed failed:', err);
      showError('Failed to clear completed tasks.');
    }
  });

  // Listen for broadcast event from other tabs
  const onMessageListener = (msg) => {
    if (msg?.type === MESSAGES.TODOS_CHANGED) {
      loadTodos();
    }
  };
  chrome.runtime.onMessage.addListener(onMessageListener);

  // Initial load
  loadTodos();

  // Refresh time chips every 30 seconds
  refreshTimer = setInterval(refreshTimeChips, 30000);

  return {
    reload: loadTodos,
    cleanup: () => {
      clearInterval(refreshTimer);
      chrome.runtime.onMessage.removeListener(onMessageListener);
    }
  };
}

// Global hook for direct script attachment fallback
if (typeof window !== 'undefined') {
  window.__kcnInitTodoTab = initTodoTab;
}
