// © 2026 Kushal Parajuli

import 'fake-indexeddb/auto';
import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Import real db.js
import { openDB, closeDB, getTodos, addTodo, updateTodo, clearCompletedTodos } from '../extension/background/db.js';

describe('IndexedDB db.js Tests', () => {

  afterEach(() => {
    closeDB();
  });

  test('Add 4 todos, verify listing, and clearCompletedTodos deletes only completed ones', async () => {
    // Clean start
    await new Promise((resolve) => {
      closeDB();
      const req = indexedDB.deleteDatabase('kcn-db');
      req.onsuccess = resolve;
      req.onerror = resolve;
    });

    // 1. Add 4 todos: 2 done, 1 with reminder, 1 without
    const t1 = await addTodo({ title: 'Task 1 (to complete)', remindAt: null });
    const t2 = await addTodo({ title: 'Task 2 (to complete)', remindAt: null });
    const t3 = await addTodo({ title: 'Task 3 (with reminder)', remindAt: Date.now() + 3600000 });
    const t4 = await addTodo({ title: 'Task 4 (without reminder)', remindAt: null });

    // Mark 2 as done
    await updateTodo(t1.id, { done: true });
    await updateTodo(t2.id, { done: true });

    // 2. List works
    const listBefore = await getTodos();
    assert.equal(listBefore.length, 4, 'Should list all 4 todos');

    const completedBefore = listBefore.filter((t) => t.done);
    assert.equal(completedBefore.length, 2, 'Should have 2 completed todos');

    // 3. clearCompletedTodos deletes exactly the 2 done ones
    const { count, deletedTodos } = await clearCompletedTodos();
    assert.equal(count, 2, 'Should report 2 deleted todos');
    assert.equal(deletedTodos.length, 2, 'deletedTodos array should have length 2');

    const deletedIds = deletedTodos.map((t) => t.id).sort();
    assert.deepEqual(deletedIds, [t1.id, t2.id].sort(), 'Deleted IDs must match completed todos');

    // Verify remaining items
    const listAfter = await getTodos();
    assert.equal(listAfter.length, 2, 'Should have exactly 2 todos remaining');

    const remainingIds = listAfter.map((t) => t.id).sort();
    assert.deepEqual(remainingIds, [t3.id, t4.id].sort(), 'Remaining todos must be Task 3 and Task 4');
    assert.ok(listAfter.every((t) => !t.done), 'No completed todos should remain');
  });

  test('A todo with remindAt null never counts as due', async () => {
    // Add a todo with remindAt null
    const todoWithoutReminder = await addTodo({ title: 'Task No Reminder', remindAt: null });
    assert.equal(todoWithoutReminder.remindAt, null, 'remindAt must be null');

    const todos = await getTodos();
    const now = Date.now();

    // Verify predicate: typeof remindAt === 'number' && !isNaN(remindAt) && remindAt > 0
    const hasValidReminder = (t) => typeof t.remindAt === 'number' && !isNaN(t.remindAt) && t.remindAt > 0;
    assert.equal(hasValidReminder(todoWithoutReminder), false, 'Must not be considered a valid reminder');

    // Due check: must NOT treat null as <= now
    const isDue = (t) => !t.done && (t.ringing || (hasValidReminder(t) && t.remindAt <= now));
    const dueList = todos.filter(isDue);
    assert.equal(dueList.some((t) => t.id === todoWithoutReminder.id), false, 'Todo with null remindAt must never count as due');
  });

  test('DB upgrade from legacy version with "done" index preserves data and removes index', async () => {
    // Reset database
    closeDB();
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('kcn-db');
      req.onsuccess = resolve;
      req.onerror = resolve;
    });

    // Create a legacy v1 database with a "done" index
    await new Promise((resolve, reject) => {
      const openReq = indexedDB.open('kcn-db', 1);
      openReq.onupgradeneeded = (e) => {
        const db = e.target.result;
        const store = db.createObjectStore('todos', { keyPath: 'id' });
        store.createIndex('done', 'done', { unique: false });
      };
      openReq.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('todos', 'readwrite');
        const store = tx.objectStore('todos');
        store.add({
          id: 'legacy-1',
          title: 'Legacy Task Preserved',
          done: false,
          createdAt: Date.now(),
          remindAt: null
        });
        store.add({
          id: 'legacy-2',
          title: 'Legacy Done Task',
          done: true,
          createdAt: Date.now(),
          remindAt: null
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      openReq.onerror = () => reject(openReq.error);
    });

    // Now open using db.js (which upgrades to DB_VERSION 4)
    const db = await openDB();
    const tx = db.transaction('todos', 'readonly');
    const store = tx.objectStore('todos');

    // Verify 'done' index was successfully removed
    assert.equal(store.indexNames.contains('done'), false, '"done" index must be deleted during upgrade');

    // Verify existing legacy data is preserved
    const list = await getTodos();
    assert.equal(list.length, 2, 'Both legacy tasks must survive upgrade');
    assert.ok(list.some((t) => t.id === 'legacy-1' && t.title === 'Legacy Task Preserved'));

    // Verify clearCompletedTodos works on upgraded database without throwing DataError
    const { count, deletedTodos } = await clearCompletedTodos();
    assert.equal(count, 1, 'Should delete the 1 completed legacy task');
    assert.equal(deletedTodos[0].id, 'legacy-2');

    const remaining = await getTodos();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'legacy-1');
  });

  test('Static check: "IDBKeyRange.only(" and ".index(\'done\')" must not appear anywhere in extension/', () => {
    const extensionDir = path.resolve('extension');

    function scanFiles(dir) {
      let results = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(scanFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const files = scanFiles(extensionDir);
    assert.ok(files.length > 5, 'Should scan multiple extension source files');

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      assert.ok(
        !content.includes('IDBKeyRange.only('),
        `Found forbidden 'IDBKeyRange.only(' in ${path.relative(process.cwd(), file)}`
      );
      assert.ok(
        !content.includes(".index('done')"),
        `Found forbidden '.index(\\'done\\')' in ${path.relative(process.cwd(), file)}`
      );
    }
  });

});
