// © 2026 Kushal Parajuli

/**
 * Todo Tab component for Kam Chai Nabirsa.
 * Injected as a content script without ES module dependencies or dynamic imports.
 */

(function () {
  const MIN_LEAD_SECONDS = 30;

  const MESSAGES = {
    TODO_LIST: 'TODO_LIST',
    TODO_ADD: 'TODO_ADD',
    TODO_UPDATE: 'TODO_UPDATE',
    TODO_DELETE: 'TODO_DELETE',
    TODO_TOGGLE: 'TODO_TOGGLE',
    TODO_CLEAR_DONE: 'TODO_CLEAR_DONE',
    TODOS_CHANGED: 'TODOS_CHANGED'
  };

  /**
   * Formats relative time remaining until a reminder timestamp.
   * @param {number} epochMs 
   * @returns {{ text: string, isOverdue: boolean, isAmber: boolean }}
   */
  function formatTimeLeft(epochMs) {
    if (typeof epochMs !== 'number' || epochMs <= 0) {
      return { text: '', isOverdue: false, isAmber: false };
    }

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
   * Formats exact due date and time for tooltips, e.g. "Fri 21 Nov, 5:30 PM".
   * @param {number} epochMs 
   * @returns {string}
   */
  function formatExactTime(epochMs) {
    if (typeof epochMs !== 'number' || epochMs <= 0) return '';
    const d = new Date(epochMs);
    const weekday = d.toLocaleDateString([], { weekday: 'short' });
    const day = d.getDate();
    const month = d.toLocaleDateString([], { month: 'short' });
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${weekday} ${day} ${month}, ${time}`;
  }

  /**
   * Helper to format Date for input[type=date] -> YYYY-MM-DD
   */
  function toDateInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /**
   * Helper to format Date for input[type=time] -> HH:mm
   */
  function toTimeInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * Helper to format Date for input[type=datetime-local] -> YYYY-MM-DDTHH:mm
   */
  function toDatetimeLocal(date) {
    return `${toDateInput(date)}T${toTimeInput(date)}`;
  }

  /**
   * Calculates epoch ms for tomorrow at 9:00 AM.
   */
  function getTomorrow9AM() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }

  /**
   * Main Todo Tab initializer.
   */
  function initTodoTab({ paneElement, onBadgeUpdate }) {
    if (!paneElement) return;

    // Component State
    let todos = [];
    let isCompletedExpanded = true; // Expanded by default so completed todos stay visible
    let undoTimer = null;
    let lastDeletedTodo = null;
    let newTodoRemindAt = null;
    let isAddReminderRowOpen = false;
    let chipInterval = null;

    // Render Tab Template
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

        <!-- Pre-Add Reminder Row (Direct time entry, quick chips, live preview) -->
        <div class="kcn-reminder-row kcn-hidden" id="kcn-reminder-row">
          <div class="kcn-reminder-row-header">
            <span class="kcn-reminder-row-label">Reminder options:</span>
            <div class="kcn-reminder-active-chip kcn-hidden" id="kcn-reminder-active-chip">
              <span id="kcn-reminder-chip-text"></span>
              <button type="button" class="kcn-reminder-chip-clear" id="kcn-reminder-chip-clear" title="Clear reminder" aria-label="Clear reminder">×</button>
            </div>
          </div>

          <!-- Quick chips -->
          <div class="kcn-quick-chips">
            <button type="button" class="kcn-chip-btn" data-preset="10m">+10 min</button>
            <button type="button" class="kcn-chip-btn" data-preset="1h">+1 hour</button>
            <button type="button" class="kcn-chip-btn" data-preset="tomorrow">Tomorrow 9 AM</button>
          </div>

          <!-- Relative entry: In [number] [unit] [Set] -->
          <div class="kcn-relative-row">
            <span>In</span>
            <input type="number" class="kcn-rel-num" id="kcn-rel-num" min="1" value="30" />
            <select class="kcn-rel-select" id="kcn-rel-unit">
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            <button type="button" class="kcn-rel-set-btn" id="kcn-rel-set-btn">Set</button>
          </div>

          <!-- Direct date & time inputs -->
          <div class="kcn-custom-time-row">
            <input type="date" class="kcn-date-input" id="kcn-date-input" title="Date" />
            <input type="time" class="kcn-time-input" id="kcn-time-input" title="Time (24h or AM/PM)" />
          </div>

          <!-- Live preview line -->
          <div class="kcn-reminder-live-preview kcn-hidden" id="kcn-reminder-live-preview"></div>
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
              <button class="kcn-completed-toggle kcn-expanded" id="kcn-completed-toggle" aria-expanded="true" aria-controls="kcn-todo-completed-list">
                <svg class="kcn-completed-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
                <span id="kcn-completed-label">Completed (0)</span>
              </button>
              <button class="kcn-clear-completed-btn" id="kcn-clear-completed-btn" title="Remove all completed tasks">
                Clear completed
              </button>
            </div>
            <div class="kcn-todo-list" id="kcn-todo-completed-list" role="list" aria-label="Completed tasks"></div>
          </div>
        </div>

        <!-- 5-second Undo Toast -->
        <div class="kcn-toast kcn-hidden" id="kcn-todo-toast" role="status" aria-live="polite">
          <span class="kcn-toast-text" id="kcn-toast-text">Task deleted</span>
          <button class="kcn-toast-undo-btn" id="kcn-toast-undo-btn">Undo</button>
        </div>
      </div>
    `;

    // Elements
    const form = paneElement.querySelector('#kcn-todo-form');
    const input = paneElement.querySelector('#kcn-todo-input');
    const toggleReminderRowBtn = paneElement.querySelector('#kcn-toggle-reminder-row-btn');
    const reminderRow = paneElement.querySelector('#kcn-reminder-row');
    const reminderActiveChip = paneElement.querySelector('#kcn-reminder-active-chip');
    const reminderChipText = paneElement.querySelector('#kcn-reminder-chip-text');
    const reminderChipClear = paneElement.querySelector('#kcn-reminder-chip-clear');
    const relNum = paneElement.querySelector('#kcn-rel-num');
    const relUnit = paneElement.querySelector('#kcn-rel-unit');
    const relSetBtn = paneElement.querySelector('#kcn-rel-set-btn');
    const dateInput = paneElement.querySelector('#kcn-date-input');
    const timeInput = paneElement.querySelector('#kcn-time-input');
    const livePreview = paneElement.querySelector('#kcn-reminder-live-preview');
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

    let errorTimer = null;

    // Display friendly error with actual message
    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.classList.remove('kcn-hidden');
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => {
        errorEl.classList.add('kcn-hidden');
        errorEl.textContent = '';
      }, 7000);
    }

    // Message sender with timeout and context-invalidation guards
    function sendMsg(type, payload = {}) {
      return new Promise((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Operation timed out. Background service worker took too long to respond.'));
          }
        }, 6000);

        try {
          if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
            clearTimeout(timer);
            reject(new Error('Extension was reloaded. Please refresh this page.'));
            return;
          }

          chrome.runtime.sendMessage({ type, payload }, (response) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (chrome.runtime.lastError) {
              const raw = chrome.runtime.lastError.message || '';
              if (raw.toLowerCase().includes('context invalidated')) {
                reject(new Error('Extension was reloaded. Please refresh this page.'));
              } else {
                reject(new Error(raw || 'Failed to communicate with extension background.'));
              }
              return;
            }

            if (!response) {
              reject(new Error('No response from background. Extension was reloaded. Please refresh this page.'));
              return;
            }

            if (response.ok) {
              resolve(response.data);
            } else {
              reject(new Error(response.error || 'Storage operation failed.'));
            }
          });
        } catch (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const raw = err?.message || String(err || '');
          if (raw.toLowerCase().includes('context invalidated')) {
            reject(new Error('Extension was reloaded. Please refresh this page.'));
          } else {
            reject(err);
          }
        }
      });
    }

    // Update live preview for pre-add reminder row
    function updateLivePreview(ms) {
      if (!livePreview) return;
      if (typeof ms !== 'number' || ms <= 0) {
        livePreview.classList.add('kcn-hidden');
        livePreview.textContent = '';
        return;
      }
      const minAllowed = Date.now() + (MIN_LEAD_SECONDS * 1000);
      if (ms < minAllowed) {
        livePreview.classList.remove('kcn-hidden');
        livePreview.classList.add('kcn-preview-invalid');
        livePreview.textContent = 'Time must be at least 30 seconds in the future.';
      } else {
        livePreview.classList.remove('kcn-hidden');
        livePreview.classList.remove('kcn-preview-invalid');
        const formatted = formatExactTime(ms);
        const { text } = formatTimeLeft(ms);
        livePreview.textContent = `Will remind: ${formatted} (${text})`;
      }
    }

    function setPreAddReminder(ms) {
      const minAllowed = Date.now() + (MIN_LEAD_SECONDS * 1000);
      if (ms < minAllowed) {
        showError('Reminder must be at least 30 seconds into the future.');
        updateLivePreview(ms);
        return false;
      }
      newTodoRemindAt = ms;
      updateLivePreview(ms);

      // Update date & time inputs to match
      const d = new Date(ms);
      if (dateInput) dateInput.value = toDateInput(d);
      if (timeInput) timeInput.value = toTimeInput(d);

      // Update chip
      reminderActiveChip.classList.remove('kcn-hidden');
      toggleReminderRowBtn.classList.add('kcn-bell-active');
      reminderChipText.textContent = formatExactTime(ms);
      return true;
    }

    function clearPreAddReminder() {
      newTodoRemindAt = null;
      reminderActiveChip.classList.add('kcn-hidden');
      toggleReminderRowBtn.classList.remove('kcn-bell-active');
      reminderChipText.textContent = '';
      if (dateInput) dateInput.value = '';
      if (timeInput) timeInput.value = '';
      updateLivePreview(null);
    }

    toggleReminderRowBtn?.addEventListener('click', () => {
      isAddReminderRowOpen = !isAddReminderRowOpen;
      reminderRow.classList.toggle('kcn-hidden', !isAddReminderRowOpen);
      toggleReminderRowBtn.classList.toggle('kcn-bell-open', isAddReminderRowOpen);

      if (isAddReminderRowOpen) {
        // Set default date input to today
        if (dateInput && !dateInput.value) {
          dateInput.value = toDateInput(new Date());
          dateInput.min = toDateInput(new Date());
        }
      }
    });

    reminderChipClear?.addEventListener('click', clearPreAddReminder);

    // Preset chips
    paneElement.querySelectorAll('.kcn-chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        const now = Date.now();
        if (preset === '10m') {
          setPreAddReminder(now + 10 * 60 * 1000);
        } else if (preset === '1h') {
          setPreAddReminder(now + 60 * 60 * 1000);
        } else if (preset === 'tomorrow') {
          setPreAddReminder(getTomorrow9AM());
        }
      });
    });

    // Relative entry: In [number] [unit] [Set]
    relSetBtn?.addEventListener('click', () => {
      const val = parseInt(relNum?.value, 10);
      if (isNaN(val) || val <= 0) {
        showError('Please enter a positive number.');
        return;
      }
      const unit = relUnit?.value || 'minutes';
      let msToAdd = val * 60 * 1000;
      if (unit === 'hours') msToAdd = val * 60 * 60 * 1000;
      if (unit === 'days') msToAdd = val * 24 * 60 * 60 * 1000;

      setPreAddReminder(Date.now() + msToAdd);
    });

    // Direct date & time inputs
    function onDateTimeChange() {
      if (!dateInput.value || !timeInput.value) return;
      const [year, month, day] = dateInput.value.split('-').map(Number);
      const [hour, minute] = timeInput.value.split(':').map(Number);
      const d = new Date(year, month - 1, day, hour, minute, 0, 0);
      setPreAddReminder(d.getTime());
    }

    dateInput?.addEventListener('change', onDateTimeChange);
    timeInput?.addEventListener('change', onDateTimeChange);

    // Load todos from storage
    async function loadTodos() {
      try {
        const data = await sendMsg(MESSAGES.TODO_LIST);
        todos = Array.isArray(data) ? data : [];
        renderTodos();
      } catch (err) {
        console.error('[KCN Todo] Failed to load todos:', err);
        showError('Unable to load tasks: ' + (err?.message || 'Storage error'));
      }
    }

    // Refresh countdown chips every 30s
    function refreshCountdownChips() {
      paneElement.querySelectorAll('.kcn-time-chip').forEach((chip) => {
        const ms = Number(chip.getAttribute('data-remind-at'));
        if (typeof ms === 'number' && ms > 0) {
          const { text, isOverdue, isAmber } = formatTimeLeft(ms);
          chip.textContent = text;
          chip.title = formatExactTime(ms);
          chip.classList.toggle('kcn-chip-overdue', isOverdue);
          chip.classList.toggle('kcn-chip-amber', isAmber);
        }
      });
    }

    // Render list
    function renderTodos() {
      openListEl.innerHTML = '';
      completedListEl.innerHTML = '';

      const openTodos = todos.filter((t) => !t.done);
      const completedTodos = todos.filter((t) => Boolean(t.done));

      // Update badge count
      if (typeof onBadgeUpdate === 'function') {
        onBadgeUpdate(openTodos.length);
      }

      // Empty State
      if (todos.length === 0) {
        emptyStateEl.classList.remove('kcn-hidden');
      } else {
        emptyStateEl.classList.add('kcn-hidden');
      }

      // Render Open Todos
      openTodos.forEach((todo) => {
        const itemNode = createTodoNode(todo, false);
        openListEl.appendChild(itemNode);
      });

      // Render Completed Section
      if (completedTodos.length > 0) {
        completedSection.classList.remove('kcn-hidden');
        completedLabel.textContent = `Completed (${completedTodos.length})`;
        completedTodos.forEach((todo) => {
          const itemNode = createTodoNode(todo, true);
          completedListEl.appendChild(itemNode);
        });
      } else {
        completedSection.classList.add('kcn-hidden');
      }
    }

    // Create a todo item row DOM node
    function createTodoNode(todo, isCompleted) {
      const item = document.createElement('div');
      item.className = `kcn-todo-item ${isCompleted ? 'kcn-item-done' : ''}`;
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-id', todo.id);

      // Checkbox
      const checkWrap = document.createElement('label');
      checkWrap.className = 'kcn-todo-check-wrap';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'kcn-todo-checkbox';
      checkbox.checked = isCompleted;
      checkbox.setAttribute('aria-label', `Mark "${todo.title}" as ${isCompleted ? 'incomplete' : 'complete'}`);

      checkbox.addEventListener('change', async () => {
        try {
          await sendMsg(MESSAGES.TODO_TOGGLE, { id: todo.id });
          await loadTodos();
        } catch (err) {
          console.error('[KCN Todo] Toggle failed:', err);
          showError('Failed to update task: ' + (err?.message || 'Error'));
          checkbox.checked = !checkbox.checked;
        }
      });

      checkWrap.appendChild(checkbox);
      item.appendChild(checkWrap);

      // Content wrap: Title + optional Countdown chip
      const contentWrap = document.createElement('div');
      contentWrap.className = 'kcn-todo-content-wrap';

      const titleEl = document.createElement('span');
      titleEl.className = 'kcn-todo-title';
      titleEl.textContent = todo.title;
      if (!isCompleted) {
        titleEl.title = 'Double-click to edit';
      }
      contentWrap.appendChild(titleEl);

      // Countdown chip: strictly ONLY when reminder exists and is open
      const hasReminder = typeof todo.remindAt === 'number' && todo.remindAt > 0;
      if (hasReminder && !isCompleted) {
        const timeInfo = formatTimeLeft(todo.remindAt);
        const clockChip = document.createElement('span');
        clockChip.className = `kcn-time-chip ${timeInfo.isOverdue ? 'kcn-chip-overdue' : ''} ${timeInfo.isAmber ? 'kcn-chip-amber' : ''}`;
        clockChip.setAttribute('data-remind-at', String(todo.remindAt));
        clockChip.textContent = timeInfo.text;
        clockChip.title = formatExactTime(todo.remindAt);
        contentWrap.appendChild(clockChip);
      }

      item.appendChild(contentWrap);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'kcn-todo-actions';

      // Reminder button
      const bellBtn = document.createElement('button');
      bellBtn.className = `kcn-todo-action-btn kcn-bell-btn-item ${hasReminder ? 'kcn-bell-has-reminder' : ''}`;
      bellBtn.setAttribute('aria-label', hasReminder ? 'Edit reminder' : 'Add reminder');
      bellBtn.title = hasReminder ? `Reminder: ${formatExactTime(todo.remindAt)}` : 'Add reminder';
      bellBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${hasReminder ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
      `;

      if (isCompleted) {
        // Disabled for completed tasks
        bellBtn.disabled = true;
        bellBtn.setAttribute('aria-disabled', 'true');
      } else {
        bellBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openItemReminderDialog(todo, item);
        });
      }
      actions.appendChild(bellBtn);

      // Edit button (ONLY for open tasks)
      if (!isCompleted) {
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
        editBtn.addEventListener('click', startEdit);
        actions.appendChild(editBtn);

        // Double-click edit (open tasks only)
        titleEl.addEventListener('dblclick', startEdit);
      }

      // Delete button (always available)
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

      delBtn.addEventListener('click', async () => {
        try {
          const deleted = await sendMsg(MESSAGES.TODO_DELETE, { id: todo.id });
          lastDeletedTodo = deleted || todo;
          showUndoToast(`Deleted "${lastDeletedTodo.title}"`);
          await loadTodos();
        } catch (err) {
          console.error('[KCN Todo] Delete failed:', err);
          showError('Failed to delete task: ' + (err?.message || 'Error'));
        }
      });
      actions.appendChild(delBtn);

      item.appendChild(actions);

      // Inline edit implementation (open tasks only)
      function startEdit() {
        if (isCompleted || item.classList.contains('kcn-editing')) return;
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
              showError('Failed to save edit: ' + (err?.message || 'Error'));
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

        editInput.addEventListener('blur', saveEdit);
      }

      return item;
    }

    // Inline reminder editor for existing item
    function openItemReminderDialog(todo, itemElement) {
      const existing = paneElement.querySelector('.kcn-item-reminder-popover');
      if (existing) existing.remove();

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
        <div class="kcn-relative-row" style="margin-top:6px;">
          <span>In</span>
          <input type="number" class="kcn-rel-num kcn-pop-rel-num" min="1" value="30" />
          <select class="kcn-rel-select kcn-pop-rel-unit">
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <button type="button" class="kcn-rel-set-btn kcn-pop-rel-set">Set</button>
        </div>
        <div class="kcn-custom-time-row" style="margin-top:6px;">
          <input type="date" class="kcn-date-input kcn-pop-date" />
          <input type="time" class="kcn-time-input kcn-pop-time" />
        </div>
        <div class="kcn-reminder-live-preview kcn-hidden kcn-pop-preview"></div>
        <div class="kcn-popover-actions">
          ${(typeof todo.remindAt === 'number' && todo.remindAt > 0) ? '<button type="button" class="kcn-popover-btn-remove">Remove Reminder</button>' : ''}
          <button type="button" class="kcn-popover-btn-cancel">Cancel</button>
        </div>
      `;

      itemElement.insertAdjacentElement('afterend', popover);

      const popDate = popover.querySelector('.kcn-pop-date');
      const popTime = popover.querySelector('.kcn-pop-time');
      const popPreview = popover.querySelector('.kcn-pop-preview');
      const popRelNum = popover.querySelector('.kcn-pop-rel-num');
      const popRelUnit = popover.querySelector('.kcn-pop-rel-unit');
      const popRelSet = popover.querySelector('.kcn-pop-rel-set');

      if (todo.remindAt && todo.remindAt > Date.now()) {
        const d = new Date(todo.remindAt);
        popDate.value = toDateInput(d);
        popTime.value = toTimeInput(d);
        popPreview.classList.remove('kcn-hidden');
        popPreview.textContent = `Will remind: ${formatExactTime(todo.remindAt)} (${formatTimeLeft(todo.remindAt).text})`;
      } else {
        popDate.value = toDateInput(new Date());
      }

      async function applyReminder(ms) {
        if (ms !== null) {
          const minAllowed = Date.now() + (MIN_LEAD_SECONDS * 1000);
          if (ms < minAllowed) {
            showError('Reminder must be at least 30 seconds into the future.');
            return;
          }
        }
        try {
          await sendMsg(MESSAGES.TODO_UPDATE, {
            id: todo.id,
            updates: {
              remindAt: ms,
              reminded: false,
              preReminded: false,
              ringing: false
            }
          });
          popover.remove();
          await loadTodos();
        } catch (err) {
          console.error('[KCN Todo] Reminder update failed:', err);
          showError('Failed to update reminder: ' + (err?.message || 'Error'));
        }
      }

      popover.querySelector('.kcn-popover-close')?.addEventListener('click', () => popover.remove());
      popover.querySelector('.kcn-popover-btn-cancel')?.addEventListener('click', () => popover.remove());
      popover.querySelector('.kcn-popover-btn-remove')?.addEventListener('click', () => applyReminder(null));

      // Presets
      popover.querySelectorAll('.kcn-chip-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-preset');
          const now = Date.now();
          let targetMs = now + 10 * 60 * 1000;
          if (preset === '1h') targetMs = now + 60 * 60 * 1000;
          if (preset === 'tomorrow') targetMs = getTomorrow9AM();
          applyReminder(targetMs);
        });
      });

      // Relative set
      popRelSet?.addEventListener('click', () => {
        const val = parseInt(popRelNum?.value, 10);
        if (isNaN(val) || val <= 0) return;
        const unit = popRelUnit?.value || 'minutes';
        let msToAdd = val * 60 * 1000;
        if (unit === 'hours') msToAdd = val * 60 * 60 * 1000;
        if (unit === 'days') msToAdd = val * 24 * 60 * 60 * 1000;
        applyReminder(Date.now() + msToAdd);
      });

      // Direct date/time
      function onPopDateTimeChange() {
        if (!popDate.value || !popTime.value) return;
        const [year, month, day] = popDate.value.split('-').map(Number);
        const [hour, minute] = popTime.value.split(':').map(Number);
        const d = new Date(year, month - 1, day, hour, minute, 0, 0);
        applyReminder(d.getTime());
      }

      popDate?.addEventListener('change', onPopDateTimeChange);
      popTime?.addEventListener('change', onPopDateTimeChange);
    }

    // 5-second Undo Toast
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
        showError('Failed to restore task: ' + (err?.message || 'Error'));
      }
    });

    // Add form submission
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawVal = input?.value || '';
      const trimmed = rawVal.trim();

      if (!trimmed) return;

      try {
        input.value = '';
        const remindAtToSave = (typeof newTodoRemindAt === 'number' && newTodoRemindAt > 0)
          ? newTodoRemindAt
          : null;

        clearPreAddReminder();
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
        showError('Failed to add task: ' + (err?.message || 'Error'));
      }
    });

    // Toggle completed section
    completedToggle?.addEventListener('click', () => {
      isCompletedExpanded = !isCompletedExpanded;
      completedToggle.setAttribute('aria-expanded', String(isCompletedExpanded));
      completedToggle.classList.toggle('kcn-expanded', isCompletedExpanded);
      completedListEl.classList.toggle('kcn-hidden', !isCompletedExpanded);
    });

    // Clear completed
    clearCompletedBtn?.addEventListener('click', async () => {
      try {
        await sendMsg(MESSAGES.TODO_CLEAR_DONE);
        await loadTodos();
      } catch (err) {
        console.error('[KCN Todo] Clear completed failed:', err);
        showError('Failed to clear completed tasks: ' + (err?.message || 'Unknown error'));
      }
    });

    // Broadcast listener
    const onMessageListener = (msg) => {
      if (msg?.type === MESSAGES.TODOS_CHANGED) {
        loadTodos();
      }
    };
    chrome.runtime.onMessage.addListener(onMessageListener);

    // Initial load
    loadTodos();

    // Start 30s countdown chip refresh
    function startChipInterval() {
      if (!chipInterval) {
        chipInterval = setInterval(refreshCountdownChips, 30000);
      }
    }

    function stopChipInterval() {
      if (chipInterval) {
        clearInterval(chipInterval);
        chipInterval = null;
      }
    }

    startChipInterval();

    return {
      reload: loadTodos,
      startRefresh: startChipInterval,
      stopRefresh: stopChipInterval,
      cleanup: () => {
        stopChipInterval();
        chrome.runtime.onMessage.removeListener(onMessageListener);
      }
    };
  }

  // Export to isolated window scope
  window.__kcn_initTodoTab = initTodoTab;
})();
