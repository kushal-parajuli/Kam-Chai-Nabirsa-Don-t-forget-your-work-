import { MESSAGES } from '../../shared/messages.js';

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
        <button type="submit" class="kcn-todo-add-btn" id="kcn-todo-add-btn" aria-label="Add task" title="Add task (Enter)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </form>

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

  // Element Selectors
  const form = paneElement.querySelector('#kcn-todo-form');
  const input = paneElement.querySelector('#kcn-todo-input');
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
    }, 4000);
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

    // Title element (Safe rendering via textContent)
    const titleEl = document.createElement('span');
    titleEl.className = 'kcn-todo-title';
    titleEl.textContent = todo.title;
    titleEl.title = 'Double-click to edit';
    item.appendChild(titleEl);

    // Actions container
    const actions = document.createElement('div');
    actions.className = 'kcn-todo-actions';

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

      item.replaceChild(editInput, titleEl);
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

        // Cancel / revert if unchanged or failed
        item.classList.remove('kcn-editing');
        if (item.contains(editInput)) {
          item.replaceChild(titleEl, editInput);
        }
      }

      function cancelEdit() {
        if (isFinished) return;
        isFinished = true;
        item.classList.remove('kcn-editing');
        if (item.contains(editInput)) {
          item.replaceChild(titleEl, editInput);
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
      await sendMsg(MESSAGES.TODO_ADD, { title: trimmed });
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

  return {
    reload: loadTodos
  };
}

// Global hook for direct script attachment fallback
if (typeof window !== 'undefined') {
  window.__kcnInitTodoTab = initTodoTab;
}
