import 'fake-indexeddb/auto';
import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeDB } from '../extension/background/db.js';

describe('Service Worker End-To-End & Upgrade Tests', () => {
  let messageListeners = [];
  let installedListeners = [];
  let startupListeners = [];
  let storageData = {};
  let alarmsCreated = [];
  let alarmsCleared = [];

  // Setup full Chrome API mock before importing service-worker.js
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      },
      onInstalled: {
        addListener: (fn) => installedListeners.push(fn)
      },
      onStartup: {
        addListener: (fn) => startupListeners.push(fn)
      },
      sendMessage: () => Promise.resolve({ ok: true }),
      getURL: (p) => 'chrome-extension://mock/' + p
    },
    storage: {
      local: {
        get: (keys) => {
          if (!keys) return Promise.resolve(storageData);
          if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
          if (typeof keys === 'object' && !Array.isArray(keys)) {
            const res = {};
            for (const k in keys) res[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
            return Promise.resolve(res);
          }
          return Promise.resolve(storageData);
        },
        set: (items) => {
          Object.assign(storageData, items);
          return Promise.resolve();
        }
      }
    },
    alarms: {
      create: (name, info) => alarmsCreated.push({ name, info }),
      clear: (name) => {
        alarmsCleared.push(name);
        return Promise.resolve(true);
      },
      onAlarm: { addListener: () => {} }
    },
    notifications: {
      create: () => {},
      clear: () => Promise.resolve(true),
      onButtonClicked: { addListener: () => {} },
      onClosed: { addListener: () => {} }
    },
    action: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve()
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1, url: 'https://example.com' }]),
      sendMessage: () => Promise.resolve()
    },
    windows: {
      getAll: () => Promise.resolve([{ type: 'normal', tabs: [{ id: 1, url: 'https://example.com' }] }]),
      get: (id) => Promise.resolve({ type: 'normal' }),
      getCurrent: () => Promise.resolve({ type: 'normal' })
    },
    offscreen: {
      hasDocument: () => Promise.resolve(false),
      createDocument: () => Promise.resolve(),
      closeDocument: () => Promise.resolve()
    },
    scripting: {
      executeScript: () => Promise.resolve()
    }
  };

  // Helper to dispatch messages through registered onMessage listener
  function dispatchMessage(msg, sender = { tab: { id: 1, windowId: 10 } }) {
    return new Promise((resolve) => {
      for (const listener of messageListeners) {
        const isAsync = listener(msg, sender, (response) => {
          resolve(response);
        });
        if (isAsync === false) {
          // Handled synchronously
        }
      }
    });
  }

  before(async () => {
    // Import real background service worker
    await import('../extension/background/service-worker.js');
  });

  afterEach(() => {
    closeDB();
  });

  test('CHECK_CAN_MOUNT verifies normal browser window', async () => {
    const res = await dispatchMessage({ type: 'CHECK_CAN_MOUNT' });
    assert.equal(res.ok, true);
    assert.equal(res.data.shouldMount, true);
  });

  test('End-to-End messaging: TODO_ADD, TODO_LIST, TODO_UPDATE, TODO_TOGGLE, TODO_DELETE, TODO_CLEAR_DONE', async () => {
    // 1. Add todo without reminder
    const addRes1 = await dispatchMessage({
      type: 'TODO_ADD',
      payload: { title: 'First Task (no reminder)' }
    });
    assert.equal(addRes1.ok, true);
    assert.ok(addRes1.data.id);
    assert.equal(addRes1.data.title, 'First Task (no reminder)');
    assert.equal(addRes1.data.remindAt, null);

    // 2. Add todo with reminder
    const futureEpoch = Date.now() + 600000;
    const addRes2 = await dispatchMessage({
      type: 'TODO_ADD',
      payload: { title: 'Second Task (with reminder)', remindAt: futureEpoch }
    });
    assert.equal(addRes2.ok, true);
    assert.equal(addRes2.data.remindAt, futureEpoch);

    // 3. List todos
    const listRes = await dispatchMessage({ type: 'TODO_LIST' });
    assert.equal(listRes.ok, true);
    assert.equal(listRes.data.length, 2);

    // 4. Update title
    const updateRes = await dispatchMessage({
      type: 'TODO_UPDATE',
      payload: { id: addRes1.data.id, updates: { title: 'First Task (Renamed)' } }
    });
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.data.title, 'First Task (Renamed)');

    // 5. Toggle done
    const toggleRes = await dispatchMessage({
      type: 'TODO_TOGGLE',
      payload: { id: addRes1.data.id }
    });
    assert.equal(toggleRes.ok, true);
    assert.equal(toggleRes.data.done, true);

    // 6. Clear completed
    const clearRes = await dispatchMessage({ type: 'TODO_CLEAR_DONE' });
    assert.equal(clearRes.ok, true);
    assert.equal(clearRes.data.count, 1);

    // List again to verify only open item remains
    const listResAfter = await dispatchMessage({ type: 'TODO_LIST' });
    assert.equal(listResAfter.ok, true);
    assert.equal(listResAfter.data.length, 1);
    assert.equal(listResAfter.data[0].id, addRes2.data.id);

    // 7. Delete remaining item
    const deleteRes = await dispatchMessage({
      type: 'TODO_DELETE',
      payload: { id: addRes2.data.id }
    });
    assert.equal(deleteRes.ok, true);
    assert.equal(deleteRes.data.id, addRes2.data.id);

    const emptyList = await dispatchMessage({ type: 'TODO_LIST' });
    assert.equal(emptyList.ok, true);
    assert.equal(emptyList.data.length, 0);
  });

  test('Upgrade from existing Version 3 database with pre-populated data', async () => {
    // Reset and seed database at v3
    closeDB();
    await new Promise((resolve) => {
      const delReq = indexedDB.deleteDatabase('kcn-db');
      delReq.onsuccess = resolve;
      delReq.onerror = resolve;
    });

    await new Promise((resolve, reject) => {
      const openV3 = indexedDB.open('kcn-db', 3);
      openV3.onupgradeneeded = (e) => {
        const db = e.target.result;
        const store = db.createObjectStore('todos', { keyPath: 'id' });
        store.createIndex('remindAt', 'remindAt', { unique: false });
      };
      openV3.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('todos', 'readwrite');
        const store = tx.objectStore('todos');
        store.add({
          id: 'v3-task-1',
          title: 'Existing V3 Open Task',
          done: false,
          createdAt: Date.now() - 1000,
          remindAt: null
        });
        store.add({
          id: 'v3-task-2',
          title: 'Existing V3 Completed Task',
          done: true,
          createdAt: Date.now() - 500,
          remindAt: null
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      openV3.onerror = () => reject(openV3.error);
    });

    // Now query through service worker (triggers upgrade to v4)
    const listRes = await dispatchMessage({ type: 'TODO_LIST' });
    assert.equal(listRes.ok, true);
    assert.equal(listRes.data.length, 2, 'Must retrieve both pre-existing v3 items');

    // Add a new task on upgraded db
    const addRes = await dispatchMessage({
      type: 'TODO_ADD',
      payload: { title: 'New Task on V4' }
    });
    assert.equal(addRes.ok, true);

    // Clear completed on upgraded db
    const clearRes = await dispatchMessage({ type: 'TODO_CLEAR_DONE' });
    assert.equal(clearRes.ok, true);
    assert.equal(clearRes.data.count, 1, 'Should clear the 1 completed v3 task');

    const finalListing = await dispatchMessage({ type: 'TODO_LIST' });
    assert.equal(finalListing.data.length, 2, 'Should leave 2 open tasks');
    assert.ok(finalListing.data.some((t) => t.id === 'v3-task-1'));
    assert.ok(finalListing.data.some((t) => t.id === addRes.data.id));
  });

  test('DB_RESET message resets database, clears all items, and restores fresh store', async () => {
    // Add a todo first
    const addRes = await dispatchMessage({
      type: 'TODO_ADD',
      payload: { title: 'To be wiped' }
    });
    assert.equal(addRes.ok, true);

    const listBefore = await dispatchMessage({ type: 'TODO_LIST' });
    assert.ok(listBefore.data.length >= 1);

    // Call DB_RESET
    const resetRes = await dispatchMessage({ type: 'DB_RESET' });
    assert.equal(resetRes.ok, true);

    // Verify DB is fresh and empty
    const listAfter = await dispatchMessage({ type: 'TODO_LIST' });
    assert.equal(listAfter.ok, true);
    assert.equal(listAfter.data.length, 0);
  });

});
