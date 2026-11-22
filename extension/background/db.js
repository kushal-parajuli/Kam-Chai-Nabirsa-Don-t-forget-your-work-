// © 2026 Kushal Parajuli

/**
 * IndexedDB wrapper for Kam Chai Nabirsa (database: kcn-db, version: 4).
 * Exposes promise-based functions; never leaks raw transactions or database instances.
 * Booleans and nullable fields are NEVER indexed or queried via key ranges in IndexedDB;
 * all queries scan the store via getAll() or openCursor() and filter in JavaScript.
 */

const DB_NAME = 'kcn-db';
const DB_VERSION = 4;

let dbInstance = null;
let dbOpenPromise = null;

/**
 * Closes the active database connection and resets the cached instance.
 */
export function closeDB() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) { }
    dbInstance = null;
  }
  dbOpenPromise = null;
}

/**
 * Opens or returns the cached IndexedDB database connection.
 * Guards against concurrent opening requests and hanging onblocked states.
 * Rejects with a clear timeout error after 5 seconds if blocked by another connection.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    let settled = false;

    // Reject after 5 seconds if open is blocked by another unclosed connection
    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        dbOpenPromise = null;
        reject(new Error('IndexedDB open timed out after 5000ms. Database upgrade is blocked by an unclosed connection in another tab. Please refresh or close other tabs.'));
      }
    }, 5000);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      try {
        const db = event.target.result;
        const tx = event.target.transaction;

        // Object store: todos (primary key: id)
        let todoStore;
        if (!db.objectStoreNames.contains('todos')) {
          todoStore = db.createObjectStore('todos', { keyPath: 'id' });
        } else {
          todoStore = tx.objectStore('todos');
        }

        // Safely delete legacy or unused indexes if present (guarded with contains)
        if (todoStore && todoStore.indexNames) {
          if (todoStore.indexNames.contains('done')) {
            try {
              todoStore.deleteIndex('done');
            } catch (err) {
              console.warn('[KCN DB] Failed to delete legacy done index:', err);
            }
          }
          if (todoStore.indexNames.contains('remindAt')) {
            try {
              todoStore.deleteIndex('remindAt');
            } catch (err) {
              console.warn('[KCN DB] Failed to delete legacy remindAt index:', err);
            }
          }
        }

        // Object store: notes (created now for schema completeness)
        let noteStore;
        if (!db.objectStoreNames.contains('notes')) {
          noteStore = db.createObjectStore('notes', { keyPath: 'id' });
          noteStore.createIndex('createdAt', 'createdAt', { unique: false });
        } else {
          noteStore = tx.objectStore('notes');
          if (!noteStore.indexNames.contains('createdAt')) {
            noteStore.createIndex('createdAt', 'createdAt', { unique: false });
          }
        }

        // Object store: downloads (created now for schema completeness)
        if (!db.objectStoreNames.contains('downloads')) {
          db.createObjectStore('downloads', { keyPath: 'id' });
        }
      } catch (upgradeErr) {
        console.error('[KCN DB] Error during onupgradeneeded:', upgradeErr);
        // Let transaction abort handle the error cleanly
      }
    };

    request.onblocked = (event) => {
      console.warn('[KCN DB] Database open blocked by unclosed connection:', event);
    };

    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      dbOpenPromise = null;

      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        console.warn('[KCN DB] Database version change detected, closing connection immediately.');
        closeDB();
      };
      dbInstance.onclose = () => {
        console.warn('[KCN DB] Database connection closed unexpectedly.');
        closeDB();
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      dbOpenPromise = null;

      const errMsg = request.error?.message || 'Unknown error';
      console.error('[KCN DB] Failed to open IndexedDB:', request.error);
      reject(new Error(`Failed to open IndexedDB: ${errMsg}`));
    };
  });

  return dbOpenPromise;
}

/**
 * Completely resets and recreates the database.
 * Deletes kcn-db and opens a clean new database.
 * @returns {Promise<void>}
 */
export async function resetDB() {
  closeDB();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Database delete timed out after 5000ms. Please close other open tabs.'));
      }
    }, 5000);

    const delReq = indexedDB.deleteDatabase(DB_NAME);

    delReq.onblocked = () => {
      console.warn('[KCN DB] Database delete blocked: waiting for other connections to close...');
    };

    delReq.onsuccess = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await openDB();
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    delReq.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to delete database: ${delReq.error?.message || 'Unknown error'}`));
    };
  });
}

/**
 * Retrieves all todos from the database.
 * Sorts newest first in JavaScript.
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

    tx.onerror = () => {
      reject(new Error(`Transaction failed while getting todos: ${tx.error?.message}`));
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
    store.add(newTodo);

    tx.oncomplete = () => resolve(newTodo);
    tx.onerror = () => {
      console.error('[KCN DB] Failed to add todo:', tx.error);
      reject(new Error(`Failed to add todo: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Add todo transaction aborted: ${tx.error?.message || 'Aborted'}`));
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
    let updatedRecord = null;
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
      updatedRecord = existing;

      store.put(existing);
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to retrieve todo for update:', getReq.error);
      reject(new Error(`Failed to find todo: ${getReq.error?.message}`));
    };

    tx.oncomplete = () => {
      if (updatedRecord) {
        resolve(updatedRecord);
      }
    };
    tx.onerror = () => {
      console.error('[KCN DB] Failed to save updated todo:', tx.error);
      reject(new Error(`Failed to update todo: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Update todo transaction aborted: ${tx.error?.message || 'Aborted'}`));
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
    let toggledRecord = null;
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
      toggledRecord = existing;

      store.put(existing);
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to retrieve todo for toggle:', getReq.error);
      reject(new Error(`Failed to retrieve todo for toggle: ${getReq.error?.message}`));
    };

    tx.oncomplete = () => {
      if (toggledRecord) {
        resolve(toggledRecord);
      }
    };
    tx.onerror = () => {
      console.error('[KCN DB] Failed to save toggled todo:', tx.error);
      reject(new Error(`Failed to toggle todo: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Toggle todo transaction aborted: ${tx.error?.message || 'Aborted'}`));
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
    let deletedRecord = null;
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Todo with ID ${id} not found.`));
        return;
      }

      deletedRecord = existing;
      store.delete(id);
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to locate todo for deletion:', getReq.error);
      reject(new Error(`Failed to locate todo for deletion: ${getReq.error?.message}`));
    };

    tx.oncomplete = () => {
      if (deletedRecord) {
        resolve(deletedRecord);
      }
    };
    tx.onerror = () => {
      console.error('[KCN DB] Failed to delete todo:', tx.error);
      reject(new Error(`Failed to delete todo: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Delete todo transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };
  });
}

/**
 * Deletes all completed todos from the database in a single readwrite transaction.
 * Opens a cursor over the whole store (no index) and deletes records where record.done is true.
 * Resolves on tx.oncomplete with the deleted records array.
 * Rejects on tx.onerror and tx.onabort.
 * @returns {Promise<{ count: number, deletedTodos: Array<object> }>}
 */
export async function clearCompletedTodos() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const deletedTodos = [];
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const cursorReq = store.openCursor(); // open cursor over the whole store (no index)

    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        if (Boolean(record?.done)) {
          deletedTodos.push(record);
          cursor.delete();
        }
        cursor.continue();
      }
    };

    cursorReq.onerror = () => {
      const errMsg = cursorReq.error?.message || 'Cursor error';
      console.error('[KCN DB] Cursor error scanning completed todos:', cursorReq.error);
      reject(new Error(`Cursor scan failed: ${errMsg}`));
    };

    tx.oncomplete = () => {
      resolve({ count: deletedTodos.length, deletedTodos });
    };

    tx.onerror = () => {
      const errMsg = tx.error?.message || 'Transaction error';
      console.error('[KCN DB] Transaction error clearing completed todos:', tx.error);
      reject(new Error(`Transaction failed: ${errMsg}`));
    };

    tx.onabort = () => {
      const errMsg = tx.error?.message || 'Transaction aborted';
      console.error('[KCN DB] Transaction aborted clearing completed todos:', tx.error);
      reject(new Error(`Transaction aborted: ${errMsg}`));
    };
  });
}
