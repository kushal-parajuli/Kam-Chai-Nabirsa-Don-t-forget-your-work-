/**
 * IndexedDB wrapper for Kam Chai Nabirsa (database: kcn-db, version: 1).
 * Exposes promise-based functions; never leaks raw transactions or database instances.
 */

const DB_NAME = 'kcn-db';
const DB_VERSION = 1;

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

      // Object store: todos
      if (!db.objectStoreNames.contains('todos')) {
        const todoStore = db.createObjectStore('todos', { keyPath: 'id' });
        todoStore.createIndex('done', 'done', { unique: false });
        todoStore.createIndex('remindAt', 'remindAt', { unique: false });
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

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
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

    request.onerror = () => reject(new Error(`Failed to get todos: ${request.error?.message}`));
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

  const newTodo = {
    id: crypto.randomUUID(),
    title: trimmedTitle,
    done: false,
    createdAt: now,
    updatedAt: now,
    remindAt: typeof remindAt === 'number' ? remindAt : null,
    reminded: false,
    snoozedUntil: null
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const request = store.add(newTodo);

    request.onsuccess = () => resolve(newTodo);
    request.onerror = () => reject(new Error(`Failed to add todo: ${request.error?.message}`));
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
        existing.remindAt = updates.remindAt;
      }

      if (updates.reminded !== undefined) {
        existing.reminded = Boolean(updates.reminded);
      }

      if (updates.snoozedUntil !== undefined) {
        existing.snoozedUntil = updates.snoozedUntil;
      }

      existing.updatedAt = Date.now();

      const putReq = store.put(existing);
      putReq.onsuccess = () => resolve(existing);
      putReq.onerror = () => reject(new Error(`Failed to update todo: ${putReq.error?.message}`));
    };

    getReq.onerror = () => reject(new Error(`Failed to find todo: ${getReq.error?.message}`));
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
      putReq.onerror = () => reject(new Error(`Failed to toggle todo: ${putReq.error?.message}`));
    };

    getReq.onerror = () => reject(new Error(`Failed to retrieve todo for toggle: ${getReq.error?.message}`));
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
      delReq.onerror = () => reject(new Error(`Failed to delete todo: ${delReq.error?.message}`));
    };

    getReq.onerror = () => reject(new Error(`Failed to locate todo for deletion: ${getReq.error?.message}`));
  });
}

/**
 * Deletes all completed todos from the database.
 * @returns {Promise<number>} Count of cleared todos.
 */
export async function clearCompletedTodos() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('todos', 'readwrite');
    const store = tx.objectStore('todos');
    const index = store.index('done');
    const request = index.getAllKeys(IDBKeyRange.only(true));

    request.onsuccess = () => {
      const keys = request.result || [];
      if (keys.length === 0) {
        resolve(0);
        return;
      }

      let deletedCount = 0;
      for (const key of keys) {
        store.delete(key);
        deletedCount++;
      }

      tx.oncomplete = () => resolve(deletedCount);
      tx.onerror = () => reject(new Error(`Failed while clearing completed todos: ${tx.error?.message}`));
    };

    request.onerror = () => reject(new Error(`Failed to query completed todos: ${request.error?.message}`));
  });
}
