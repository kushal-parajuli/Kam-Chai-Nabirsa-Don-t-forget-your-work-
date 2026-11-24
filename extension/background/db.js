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

/**
 * Strips the binary Blob from a note record to ensure serialization safety across messaging.
 * @param {object} note 
 * @returns {object}
 */
function sanitizeNote(note) {
  if (!note) return null;
  const { blob, ...rest } = note;
  return rest;
}

/**
 * Retrieves all notes from IndexedDB.
 * Returns records WITHOUT binary Blobs (only thumbnail data URLs).
 * Sorted: pinned first, then newest first (sorting performed in JavaScript).
 * @returns {Promise<Array<object>>}
 */
export async function getNotes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readonly');
    const store = tx.objectStore('notes');
    const req = store.getAll();

    req.onsuccess = () => {
      const records = req.result || [];
      const sanitized = records.map(sanitizeNote);
      sanitized.sort((a, b) => {
        if (Boolean(b.pinned) !== Boolean(a.pinned)) {
          return b.pinned ? 1 : -1;
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      resolve(sanitized);
    };

    req.onerror = () => {
      console.error('[KCN DB] Failed to list notes:', req.error);
      reject(new Error(`Failed to list notes: ${req.error?.message}`));
    };
  });
}

/**
 * Retrieves a single note by ID, including its full Blob if present.
 * @param {string} id 
 * @returns {Promise<object|null>}
 */
export async function getNoteById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readonly');
    const store = tx.objectStore('notes');
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => {
      console.error(`[KCN DB] Failed to get note ${id}:`, req.error);
      reject(new Error(`Failed to get note: ${req.error?.message}`));
    };
  });
}

/**
 * Adds a new text or image note to IndexedDB.
 * @param {object} noteData 
 * @returns {Promise<object>} Sanitized note record without Blob
 */
export async function addNote(noteData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `note-${now}-${Math.random().toString(36).slice(2, 9)}`;

    const kind = noteData.kind === 'image' ? 'image' : 'text';
    const isImage = kind === 'image';

    const record = {
      id,
      kind,
      text: isImage ? null : String(noteData.text || ''),
      blob: isImage ? (noteData.blob || null) : null,
      mimeType: noteData.mimeType || (isImage ? 'image/png' : 'text/plain'),
      thumb: noteData.thumb || null,
      fileName: noteData.fileName || null,
      size: typeof noteData.size === 'number' ? noteData.size : 0,
      createdAt: now,
      updatedAt: now,
      pinned: Boolean(noteData.pinned)
    };

    let saved = null;
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');

    const req = store.add(record);
    req.onsuccess = () => {
      saved = sanitizeNote(record);
    };
    req.onerror = () => {
      console.error('[KCN DB] Failed to add note:', req.error);
      reject(new Error(`Failed to add note: ${req.error?.message}`));
    };

    tx.oncomplete = () => {
      if (saved) resolve(saved);
    };
    tx.onerror = () => {
      console.error('[KCN DB] Transaction error adding note:', tx.error);
      reject(new Error(`Transaction failed: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Add note transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };
  });
}

/**
 * Updates the text content of an existing text note.
 * @param {string} id 
 * @param {string} newText 
 * @returns {Promise<object>} Updated sanitized note
 */
export async function updateNoteText(id, newText) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    let updatedRecord = null;

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Note not found: ${id}`));
        return;
      }
      if (existing.kind !== 'text') {
        reject(new Error('Cannot update text on a non-text note'));
        return;
      }

      existing.text = String(newText || '');
      existing.updatedAt = Date.now();
      if (typeof Blob !== 'undefined') {
        existing.size = new Blob([existing.text]).size;
      } else {
        existing.size = Buffer.byteLength(existing.text, 'utf8');
      }

      updatedRecord = sanitizeNote(existing);
      store.put(existing);
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to retrieve note for update:', getReq.error);
      reject(new Error(`Failed to retrieve note: ${getReq.error?.message}`));
    };

    tx.oncomplete = () => {
      if (updatedRecord) resolve(updatedRecord);
    };
    tx.onerror = () => {
      console.error('[KCN DB] Transaction error updating note:', tx.error);
      reject(new Error(`Failed to update note: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Update note transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };
  });
}

/**
 * Pins or unpins a note.
 * @param {string} id 
 * @param {boolean} [pinned] If undefined, toggles the pinned state
 * @returns {Promise<object>} Updated sanitized note
 */
export async function setNotePin(id, pinned) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    let updatedRecord = null;

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Note not found: ${id}`));
        return;
      }

      existing.pinned = typeof pinned === 'boolean' ? pinned : !existing.pinned;
      existing.updatedAt = Date.now();

      updatedRecord = sanitizeNote(existing);
      store.put(existing);
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to retrieve note for pin:', getReq.error);
      reject(new Error(`Failed to retrieve note: ${getReq.error?.message}`));
    };

    tx.oncomplete = () => {
      if (updatedRecord) resolve(updatedRecord);
    };
    tx.onerror = () => {
      console.error('[KCN DB] Transaction error pinning note:', tx.error);
      reject(new Error(`Failed to pin note: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Pin note transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };
  });
}

/**
 * Deletes a single note by ID.
 * @param {string} id 
 * @returns {Promise<{ id: string }>}
 */
export async function deleteNote(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    let deleted = false;

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Note not found: ${id}`));
        return;
      }
      deleted = true;
      store.delete(id);
    };

    getReq.onerror = () => {
      console.error('[KCN DB] Failed to retrieve note for deletion:', getReq.error);
      reject(new Error(`Failed to retrieve note: ${getReq.error?.message}`));
    };

    tx.oncomplete = () => {
      if (deleted) resolve({ id });
    };
    tx.onerror = () => {
      console.error('[KCN DB] Transaction error deleting note:', tx.error);
      reject(new Error(`Failed to delete note: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Delete note transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };
  });
}

/**
 * Clears notes from the database.
 * If alsoDeletePinned is true, clears all notes.
 * If false, leaves pinned notes intact.
 * Scans with an open cursor (no index key range).
 * @param {boolean} [alsoDeletePinned=false] 
 * @returns {Promise<{ count: number, deletedNotes: Array<object> }>}
 */
export async function clearNotes(alsoDeletePinned = false) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const deletedNotes = [];
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    const cursorReq = store.openCursor();

    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const shouldDelete = alsoDeletePinned || !record.pinned;
        if (shouldDelete) {
          deletedNotes.push(sanitizeNote(record));
          cursor.delete();
        }
        cursor.continue();
      }
    };

    cursorReq.onerror = () => {
      console.error('[KCN DB] Cursor error scanning notes:', cursorReq.error);
      reject(new Error(`Cursor scan failed: ${cursorReq.error?.message}`));
    };

    tx.oncomplete = () => {
      resolve({ count: deletedNotes.length, deletedNotes });
    };
    tx.onerror = () => {
      console.error('[KCN DB] Transaction error clearing notes:', tx.error);
      reject(new Error(`Transaction failed: ${tx.error?.message}`));
    };
    tx.onabort = () => {
      reject(new Error(`Clear notes transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };
  });
}

/**
 * Deletes unpinned notes older than the specified retention days.
 * Pinned notes are NEVER deleted.
 * @param {number} days Retention cutoff in days (0 or less skips cleanup).
 * @returns {Promise<{ count: number, deletedNotes: Array<object> }>}
 */
export async function deleteOldNotes(days) {
  if (!days || typeof days !== 'number' || days <= 0) {
    return { count: 0, deletedNotes: [] };
  }

  const db = await openDB();
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

  return new Promise((resolve, reject) => {
    const deletedNotes = [];
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    const cursorReq = store.openCursor();

    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        // Pinned notes are never deleted. Only unpinned older than cutoff.
        if (!record.pinned && (record.createdAt || 0) < cutoff) {
          deletedNotes.push(sanitizeNote(record));
          cursor.delete();
        }
        cursor.continue();
      }
    };

    cursorReq.onerror = () => {
      console.error('[KCN DB] Cursor error during auto-delete maintenance:', cursorReq.error);
      reject(new Error(`Notes auto-delete scan failed: ${cursorReq.error?.message}`));
    };

    tx.oncomplete = () => {
      resolve({ count: deletedNotes.length, deletedNotes });
    };

    tx.onerror = () => {
      console.error('[KCN DB] Transaction error in deleteOldNotes:', tx.error);
      reject(new Error(`Delete old notes transaction failed: ${tx.error?.message}`));
    };

    tx.onabort = () => {
      reject(new Error(`Delete old notes transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };
  });
}

/**
 * Imports todos and text notes from a backup payload.
 * Supports 'merge' (skips existing IDs) and 'replace' (clears stores before importing).
 * Todos whose remindAt is already in the past receive reminded=true so they do not ring.
 * @param {object} param0 
 * @param {Array<object>} param0.todos 
 * @param {Array<object>} param0.notes 
 * @param {'merge'|'replace'} [mode='merge'] 
 * @returns {Promise<{ importedTodos: number, importedNotes: number }>}
 */
export async function importBackupData({ todos = [], notes = [] }, mode = 'merge') {
  const db = await openDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['todos', 'notes'], 'readwrite');
    const todoStore = tx.objectStore('todos');
    const noteStore = tx.objectStore('notes');

    let importedTodos = 0;
    let importedNotes = 0;

    if (mode === 'replace') {
      todoStore.clear();
      noteStore.clear();
    }

    // Read existing IDs if in merge mode
    const todoReq = todoStore.getAllKeys();
    const noteReq = noteStore.getAllKeys();

    tx.oncomplete = () => {
      resolve({ importedTodos, importedNotes });
    };

    tx.onerror = () => {
      console.error('[KCN DB] Transaction error during backup import:', tx.error);
      reject(new Error(`Import transaction failed: ${tx.error?.message}`));
    };

    tx.onabort = () => {
      reject(new Error(`Import transaction aborted: ${tx.error?.message || 'Aborted'}`));
    };

    // Chain processing once keys are read
    let existingTodoKeys = new Set();
    let existingNoteKeys = new Set();

    let keysRead = 0;
    function proceed() {
      keysRead++;
      if (keysRead < 2) return;

      // 1. Process Todos
      for (const raw of todos) {
        if (!raw || typeof raw !== 'object' || !raw.title) continue;
        const id = raw.id || crypto.randomUUID();
        if (mode === 'merge' && existingTodoKeys.has(id)) continue;

        const hasReminder = typeof raw.remindAt === 'number' && !isNaN(raw.remindAt) && raw.remindAt > 0;
        const isPastReminder = hasReminder && raw.remindAt <= now;

        const record = {
          id,
          title: String(raw.title).trim().slice(0, 200),
          done: Boolean(raw.done),
          createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
          updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
          remindAt: hasReminder ? raw.remindAt : null,
          reminded: isPastReminder ? true : Boolean(raw.reminded),
          snoozedUntil: typeof raw.snoozedUntil === 'number' ? raw.snoozedUntil : null,
          preReminded: isPastReminder ? true : Boolean(raw.preReminded),
          ringing: false,
          ringCount: typeof raw.ringCount === 'number' ? raw.ringCount : 0,
          lastRingAt: typeof raw.lastRingAt === 'number' ? raw.lastRingAt : null
        };

        todoStore.put(record);
        existingTodoKeys.add(id);
        importedTodos++;
      }

      // 2. Process Notes (text notes only from backup)
      for (const raw of notes) {
        if (!raw || typeof raw !== 'object') continue;
        const id = raw.id || crypto.randomUUID();
        if (mode === 'merge' && existingNoteKeys.has(id)) continue;

        const record = {
          id,
          kind: 'text',
          text: String(raw.text || '').slice(0, 20000),
          blob: null,
          mimeType: 'text/plain',
          thumb: null,
          fileName: null,
          size: typeof raw.size === 'number' ? raw.size : (raw.text || '').length,
          createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
          updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
          pinned: Boolean(raw.pinned)
        };

        noteStore.put(record);
        existingNoteKeys.add(id);
        importedNotes++;
      }
    }

    todoReq.onsuccess = () => {
      existingTodoKeys = new Set(todoReq.result || []);
      proceed();
    };
    todoReq.onerror = () => reject(new Error('Failed to read todo keys'));

    noteReq.onsuccess = () => {
      existingNoteKeys = new Set(noteReq.result || []);
      proceed();
    };
    noteReq.onerror = () => reject(new Error('Failed to read note keys'));
  });
}

/**
 * Retrieves the history of recent downloads (up to 20, newest first).
 * @returns {Promise<Array<object>>}
 */
export async function getDownloads() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('downloads', 'readonly');
    const store = tx.objectStore('downloads');
    const req = store.getAll();

    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(list.slice(0, 20));
    };

    req.onerror = () => {
      console.error('[KCN DB] Failed to list downloads:', req.error);
      reject(new Error(`Failed to list downloads: ${req.error?.message}`));
    };
  });
}

/**
 * Adds or updates a download record.
 * @param {object} item 
 * @returns {Promise<object>}
 */
export async function saveDownload(item) {
  if (!item || !item.id) throw new Error('Download item must have an id');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('downloads', 'readwrite');
    const store = tx.objectStore('downloads');

    const record = {
      id: item.id,
      url: item.url || '',
      type: item.type === 'audio' ? 'audio' : 'video',
      state: item.state || 'queued',
      progress: typeof item.progress === 'number' ? item.progress : 0,
      filename: item.filename || null,
      error: item.error || null,
      createdAt: item.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    const req = store.put(record);
    req.onerror = () => reject(new Error(`Failed to save download: ${req.error?.message}`));

    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(new Error(`Transaction failed saving download: ${tx.error?.message}`));
  });
}

/**
 * Clears download history.
 * @returns {Promise<{ ok: boolean }>}
 */
export async function clearDownloads() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('downloads', 'readwrite');
    const store = tx.objectStore('downloads');
    const req = store.clear();

    req.onerror = () => reject(new Error(`Failed to clear downloads: ${req.error?.message}`));
    tx.oncomplete = () => resolve({ ok: true });
    tx.onerror = () => reject(new Error(`Transaction failed clearing downloads: ${tx.error?.message}`));
  });
}
