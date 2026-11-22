// © 2026 Kushal Parajuli

/**
 * IndexedDB wrapper for Kam Chai Nabirsa (database: kcn-db, version: 3).
 * Exposes promise-based functions; never leaks raw transactions or database instances.
 * Booleans are not indexed in IndexedDB; queries filter in JavaScript.
 */

const DB_NAME = 'kcn-db';
const DB_VERSION = 3;

let dbInstance = null;

/**
 * Opens or returns the cached IndexedDB database connection.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;

      // Object store: todos
      let todoStore;
      if (!db.objectStoreNames.contains('todos')) {
        todoStore = db.createObjectStore('todos', { keyPath: 'id' });
        todoStore.createIndex('remindAt', 'remindAt', { unique: false });
      } else {
        todoStore = tx.objectStore('todos');
        // Delete 'done' boolean index if previously created in older DB versions
        if (todoStore.indexNames.contains('done')) {
          try {
            todoStore.deleteIndex('done');
          } catch (err) {
            console.warn('[KCN DB] Failed to delete legacy done index:', err);
          }
        }
        if (!todoStore.indexNames.contains('remindAt')) {
          todoStore.createIndex('remindAt', 'remindAt', { unique: false });
        }
      }

      // Object store: notes (created now for schema completeness)
      if (!db.objectStoreNames.contains('notes')) {
        const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
        noteStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Object store: downloads (created now for schema completeness)
      if (!db.objectStoreNames.contains('downloads')) {
        db.createObjectStore('downloads', { keyPath: 'id' });
      }
    };

    request.onblocked = () => {
      console.warn('[KCN DB] Database open blocked: please close other tabs running older database version.');
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        console.warn('[KCN DB] Database version change detected, closing connection.');
        dbInstance.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      console.error('[KCN DB] Failed to open IndexedDB:', request.error);
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message || 'Unknown error'}`));
    };
  });
}

/**
 * Retrieves all todos from the database.
 * @returns {Promise<Array<object>>}
 */
export async function getTodos() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('todos', 'readonly');
    const store = tx.objectStore('todos');
    const request = store.getAll();

    request.onsuccess = () => {
      const list = request.result || [];
      // Sort by createdAt descending (newest first)
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(list);
    };

    request.onerror = () => {
      console.error('[KCN DB] Failed to get todos:', request.error);
      reject(new Error(`Failed to get todos: ${request.error?.message}`));
    };
  });
}

/**
 * Adds a new todo to the database.
 * @param {object} param0
 * @param {string} param0.title
 * @param {number|null} [param0.remindAt]
 * @returns {Promise<object>} The created todo record.
 */
export async function addTodo({ title, remindAt = null }) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new Error('Todo title is required and cannot be empty.');
  }

  const trimmedTitle = title.trim().slice(0, 200);
  const now = Date.now();

  const validRemindAt = (typeof remindAt === 'number' && !isNaN(remindAt) && remindAt > 0) ? remindAt : null;

  const newTodo = {
    id: crypto.randomUUID(),
    title: trimmedTitle,
    done: false,
    createdAt: now,
    updatedAt: now,
    remindAt: validRemindAt,
    reminded: false,
    snoozedUntil: null,
    preReminded: false,
    ringing: false,
    ringCount: 0,
    lastRingAt: null
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const request = store.add(newTodo);

    request.onsuccess = () => resolve(newTodo);
    request.onerror = () => {
      console.error('[KCN DB] Failed to add todo:', request.error);
      reject(new Error(`Failed to add todo: ${request.error?.message}`));
    };
  });
}

/**
 * Updates an existing todo item.
 * @param {string} id
 * @param {object} updates
 * @returns {Promise<object>} The updated todo record.
 */
export async function updateTodo(id, updates = {}) {
  if (!id) {
    throw new Error('Todo ID is required for update.');
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Todo with ID ${id} not found.`));
        return;
      }

      if (updates.title !== undefined) {
        if (!updates.title || !String(updates.title).trim()) {
          reject(new Error('Todo title cannot be empty.'));
          return;
        }
        existing.title = String(updates.title).trim().slice(0, 200);
      }

      if (updates.done !== undefined) {
        existing.done = Boolean(updates.done);
      }

      if (updates.remindAt !== undefined) {
        existing.remindAt = (typeof updates.remindAt === 'number' && !isNaN(updates.remindAt) && updates.remindAt > 0) ? updates.remindAt : null;
      }

      if (updates.reminded !== undefined) {
        existing.reminded = Boolean(updates.reminded);
      }

      if (updates.snoozedUntil !== undefined) {
        existing.snoozedUntil = (typeof updates.snoozedUntil === 'number' && !isNaN(updates.snoozedUntil) && updates.snoozedUntil > 0) ? updates.snoozedUntil : null;
      }

      if (updates.preReminded !== undefined) {
        existing.preReminded = Boolean(updates.preReminded);
      }

      if (updates.ringing !== undefined) {
        existing.ringing = Boolean(updates.ringing);
      }

      if (updates.ringCount !== undefined) {
        existing.ringCount = Number(updates.ringCount) || 0;
      }

      if (updates.lastRingAt !== undefined) {
        existing.lastRingAt = updates.lastRingAt;
      }

      existing.updatedAt = Date.now();

      const putReq = store.put(existing);
      putReq.onsuccess = () => resolve(existing);
      putReq.onerror = () => {
        console.error('[KCN DB] Failed to save updated todo:', putReq.error);
        reject(new Error(`Failed to update todo: ${putReq.error?.message}`));
      };
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to retrieve todo for update:', getReq.error);
      reject(new Error(`Failed to find todo: ${getReq.error?.message}`));
    };
  });
}

/**
 * Toggles the done state of a todo.
 * @param {string} id 
 * @returns {Promise<object>} The updated todo record.
 */
export async function toggleTodo(id) {
  if (!id) {
    throw new Error('Todo ID is required to toggle.');
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Todo with ID ${id} not found.`));
        return;
      }

      existing.done = !existing.done;
      existing.updatedAt = Date.now();

      const putReq = store.put(existing);
      putReq.onsuccess = () => resolve(existing);
      putReq.onerror = () => {
        console.error('[KCN DB] Failed to save toggled todo:', putReq.error);
        reject(new Error(`Failed to toggle todo: ${putReq.error?.message}`));
      };
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to retrieve todo for toggle:', getReq.error);
      reject(new Error(`Failed to retrieve todo for toggle: ${getReq.error?.message}`));
    };
  });
}

/**
 * Deletes a todo by its ID.
 * @param {string} id 
 * @returns {Promise<object>} Returns the deleted item for undo support.
 */
export async function deleteTodo(id) {
  if (!id) {
    throw new Error('Todo ID is required for deletion.');
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Todo with ID ${id} not found.`));
        return;
      }

      const delReq = store.delete(id);
      delReq.onsuccess = () => resolve(existing);
      delReq.onerror = () => {
        console.error('[KCN DB] Failed to delete todo:', delReq.error);
        reject(new Error(`Failed to delete todo: ${delReq.error?.message}`));
      };
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to locate todo for deletion:', getReq.error);
      reject(new Error(`Failed to locate todo for deletion: ${getReq.error?.message}`));
    };
  });
}

/**
 * Deletes all completed todos from the database in a single readwrite transaction.
 * Uses in-memory filtering because booleans cannot be indexed in IndexedDB.
 * Resolves with the count and array of deleted todos for cleanup.
 * @returns {Promise<{ count: number, deletedTodos: Array<object> }>}
 */
export async function clearCompletedTodos() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let completedTodos = [];
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const request = store.getAll();

    request.onsuccess = () => {
      const allTodos = request.result || [];
      completedTodos = allTodos.filter((t) => Boolean(t.done));
      if (completedTodos.length === 0) {
        return;
      }

      for (const todo of completedTodos) {
        store.delete(todo.id);
      }
    };

    tx.oncomplete = () => {
      resolve({ count: completedTodos.length, deletedTodos: completedTodos });
    };

    tx.onerror = () => {
      const errMsg = tx.error?.message || 'Transaction error';
      console.error('[KCN DB] Transaction error clearing completed todos:', tx.error);
      reject(new Error(`Transaction failed: ${errMsg}`));
    };

    request.onerror = () => {
      const errMsg = request.error?.message || 'Query error';
      console.error('[KCN DB] Failed to query todos for clearing:', request.error);
      reject(new Error(`Failed to query todos: ${errMsg}`));
    };
  });
}
