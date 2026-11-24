// © 2026 Kushal Parajuli

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  clamp,
  sanitizeSettings,
  getSettings,
  saveSettings,
  exportSettingsData
} from '../extension/shared/settings.js';
import * as db from '../extension/background/db.js';
import * as reminders from '../extension/background/reminders.js';

describe('Phase 5: Settings, Polish, Backup, and Auto-Delete Tests', () => {
  let mockStorage = {};
  let alarmsCreated = [];
  let alarmsCleared = [];

  beforeEach(async () => {
    mockStorage = {};
    alarmsCreated = [];
    alarmsCleared = [];

    globalThis.chrome = {
      storage: {
        local: {
          get: async (key) => {
            if (typeof key === 'string') {
              return { [key]: mockStorage[key] };
            }
            if (Array.isArray(key)) {
              const res = {};
              for (const k of key) res[k] = mockStorage[k];
              return res;
            }
            if (key && typeof key === 'object') {
              const res = { ...key };
              for (const k of Object.keys(key)) {
                if (mockStorage[k] !== undefined) res[k] = mockStorage[k];
              }
              return res;
            }
            return { ...mockStorage };
          },
          set: async (items) => {
            Object.assign(mockStorage, items);
          }
        },
        onChanged: {
          addListener: () => {}
        }
      },
      alarms: {
        create: (name, options) => {
          alarmsCreated.push({ name, options });
        },
        clear: async (name) => {
          alarmsCleared.push(name);
          alarmsCreated = alarmsCreated.filter((a) => a.name !== name);
          return true;
        }
      },
      notifications: {
        create: () => {},
        clear: () => {}
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {}
      },
      offscreen: {
        hasDocument: async () => false,
        createDocument: async () => {},
        closeDocument: async () => {}
      },
      runtime: {
        sendMessage: async () => ({ ok: true }),
        getURL: (p) => `chrome-extension://test/${p}`
      },
      tabs: {
        query: async () => [],
        sendMessage: async () => {}
      }
    };

    await db.resetDB();
  });

  afterEach(() => {
    db.closeDB();
  });

  test('Settings: defaults, clamping, validation, and repair', () => {
    // 1. Clamping helper
    assert.equal(clamp(50, 10, 100, 80), 50);
    assert.equal(clamp(5, 10, 100, 80), 10);
    assert.equal(clamp(150, 10, 100, 80), 100);
    assert.equal(clamp('invalid', 10, 100, 80), 80);

    // 2. Empty raw object returns default schema
    const def = sanitizeSettings({});
    assert.equal(def.schemaVersion, SETTINGS_SCHEMA_VERSION);
    assert.equal(def.theme, 'auto');
    assert.equal(def.widgetOpacity, 35);
    assert.equal(def.widgetSize, 'medium');
    assert.equal(def.alarmVolume, 80);
    assert.equal(def.ringSeconds, 60);
    assert.equal(def.repeatMinutes, 5);
    assert.equal(def.maxRepeats, 10);
    assert.equal(def.snoozeMinutes, 5);
    assert.equal(def.preAlertMinutes, 5);
    assert.equal(def.notesAutoDeleteDays, 0);
    assert.equal(def.helperPort, 8765);
    assert.equal(def.helperToken, '');

    // 3. Clamping of out-of-range inputs
    const clamped = sanitizeSettings({
      theme: 'invalid-theme',
      widgetOpacity: 999,
      widgetSize: 'ultra',
      edgeSide: 'center',
      alarmVolume: -5,
      ringSeconds: 1000,
      repeatMinutes: 0,
      maxRepeats: 100,
      snoozeMinutes: -1,
      preAlertMinutes: 60,
      notesAutoDeleteDays: 500,
      helperPort: 99999,
      helperToken: '   secret-token-123   '
    });

    assert.equal(clamped.theme, 'auto');
    assert.equal(clamped.widgetOpacity, 100);
    assert.equal(clamped.widgetSize, 'medium');
    assert.equal(clamped.edgeSide, 'right');
    assert.equal(clamped.alarmVolume, 10);
    assert.equal(clamped.ringSeconds, 300);
    assert.equal(clamped.repeatMinutes, 1);
    assert.equal(clamped.maxRepeats, 20);
    assert.equal(clamped.snoozeMinutes, 1);
    assert.equal(clamped.preAlertMinutes, 30);
    assert.equal(clamped.notesAutoDeleteDays, 365);
    assert.equal(clamped.helperPort, 65535);
    assert.equal(clamped.helperToken, 'secret-token-123');
  });

  test('Settings: exportSettingsData strictly omits helperToken', () => {
    const raw = {
      theme: 'dark',
      helperToken: 'SUPER_SECRET_TOKEN',
      helperPort: 8765
    };
    const exported = exportSettingsData(raw);
    assert.equal(exported.theme, 'dark');
    assert.equal(exported.helperPort, 8765);
    assert.equal(exported.helperToken, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(exported, 'helperToken'), false);
  });

  test('Reminders honor settings: preAlertMinutes = 0 schedules NO pre-alert', async () => {
    mockStorage.settings = sanitizeSettings({ preAlertMinutes: 0 });

    const now = Date.now();
    const todo = await db.addTodo({
      title: 'Task with no pre-alert',
      remindAt: now + (30 * 60 * 1000) // 30 mins ahead
    });

    await reminders.scheduleReminder(todo);

    const preAlarm = alarmsCreated.find((a) => a.name.startsWith('pre:'));
    const todoAlarm = alarmsCreated.find((a) => a.name.startsWith('todo:'));

    assert.ok(todoAlarm, 'Main reminder alarm must be scheduled');
    assert.equal(preAlarm, undefined, 'Pre-alert alarm must NOT be scheduled when preAlertMinutes = 0');
  });

  test('Reminders honor settings: custom preAlertMinutes schedules at remindAt - preAlertMinutes', async () => {
    mockStorage.settings = sanitizeSettings({ preAlertMinutes: 10 });

    const now = Date.now();
    const remindAt = now + (30 * 60 * 1000); // 30 mins ahead
    const todo = await db.addTodo({
      title: 'Task with 10m pre-alert',
      remindAt
    });

    await reminders.scheduleReminder(todo);

    const preAlarm = alarmsCreated.find((a) => a.name === `pre:${todo.id}`);
    assert.ok(preAlarm, 'Pre-alert alarm must be created');
    assert.equal(preAlarm.options.when, remindAt - (10 * 60 * 1000));
  });

  test('Reminders honor settings: custom ringSeconds and repeatMinutes on ringing', async () => {
    mockStorage.settings = sanitizeSettings({
      ringSeconds: 120,
      repeatMinutes: 15
    });

    const now = Date.now();
    const todo = await db.addTodo({
      title: 'Immediate Ringing Task',
      remindAt: now + 5000
    });

    await reminders.startRinging(todo.id, false);

    const stopAlarm = alarmsCreated.find((a) => a.name === `stop:${todo.id}`);
    const repeatAlarm = alarmsCreated.find((a) => a.name === `repeat:${todo.id}`);

    assert.ok(stopAlarm, 'Stop alarm must be scheduled');
    assert.ok(stopAlarm.options.when >= now + (119 * 1000), 'Stop alarm must match 120s ringSeconds');

    assert.ok(repeatAlarm, 'Repeat alarm must be scheduled');
    assert.ok(repeatAlarm.options.when >= now + (14 * 60 * 1000), 'Repeat alarm must match 15m repeatMinutes');
  });

  test('Backup import/export round trip with past reminder marked as reminded', async () => {
    // 1. Add some initial data
    const pastRemindAt = Date.now() - (60 * 60 * 1000); // 1 hour ago
    const futureRemindAt = Date.now() + (60 * 60 * 1000); // 1 hour future

    const t1 = await db.addTodo({ title: 'Past Reminder Task', remindAt: pastRemindAt });
    const t2 = await db.addTodo({ title: 'Future Reminder Task', remindAt: futureRemindAt });
    const n1 = await db.addNote({ kind: 'text', text: 'Important note', pinned: true });

    mockStorage.settings = sanitizeSettings({
      theme: 'dark',
      widgetOpacity: 75,
      helperToken: 'private-secret'
    });

    // 2. Export
    const exportedSettings = exportSettingsData(mockStorage.settings);
    const backup = {
      app: 'Kam Chai Nabirsa',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      todos: [t1, t2],
      notes: [n1],
      settings: exportedSettings
    };

    assert.equal(backup.app, 'Kam Chai Nabirsa');
    assert.equal(backup.schemaVersion, 1);
    assert.equal(backup.settings.helperToken, undefined);

    // 3. Clear DB to test restore
    await db.resetDB();
    const emptyTodos = await db.getTodos();
    assert.equal(emptyTodos.length, 0);

    // 4. Import backup in 'replace' mode
    const importRes = await db.importBackupData({
      todos: backup.todos,
      notes: backup.notes
    }, 'replace');

    assert.equal(importRes.importedTodos, 2);
    assert.equal(importRes.importedNotes, 1);

    // 5. Verify past reminder got reminded=true so it does not ring upon import
    const restoredTodos = await db.getTodos();
    const restoredPast = restoredTodos.find((t) => t.id === t1.id);
    const restoredFuture = restoredTodos.find((t) => t.id === t2.id);

    assert.ok(restoredPast);
    assert.equal(restoredPast.reminded, true, 'Past reminder must be marked reminded=true');
    assert.equal(restoredPast.ringing, false);

    assert.ok(restoredFuture);
    assert.equal(restoredFuture.reminded, false, 'Future reminder must remain unreminded');
  });

  test('Backup import: merge mode skips duplicate IDs, replace mode clears existing', async () => {
    const t1 = await db.addTodo({ title: 'Existing Task 1' });
    const t2 = await db.addTodo({ title: 'Existing Task 2' });

    const backupPayload = {
      todos: [
        { id: t1.id, title: 'Modified Existing Task 1' }, // Should be skipped in merge
        { id: 'brand-new-todo-id', title: 'Brand New Task' }
      ],
      notes: []
    };

    // Merge mode
    const mergeRes = await db.importBackupData(backupPayload, 'merge');
    assert.equal(mergeRes.importedTodos, 1, 'Merge mode should only import the non-existing ID');

    const todosAfterMerge = await db.getTodos();
    assert.equal(todosAfterMerge.length, 3);
    const originalT1 = todosAfterMerge.find((t) => t.id === t1.id);
    assert.equal(originalT1.title, 'Existing Task 1', 'Existing task was not overwritten');

    // Replace mode
    const replaceRes = await db.importBackupData(backupPayload, 'replace');
    assert.equal(replaceRes.importedTodos, 2);
    const todosAfterReplace = await db.getTodos();
    assert.equal(todosAfterReplace.length, 2);
  });

  test('Notes auto-delete removes only unpinned notes older than cutoff', async () => {
    const now = Date.now();
    const msDay = 24 * 60 * 60 * 1000;

    // 1. Add notes with different dates and pin states
    const oldUnpinned = await db.addNote({ kind: 'text', text: 'Old unpinned note', pinned: false });
    const oldPinned = await db.addNote({ kind: 'text', text: 'Old pinned note (keep!)', pinned: true });
    const recentUnpinned = await db.addNote({ kind: 'text', text: 'Recent unpinned note', pinned: false });

    // Manually backdate the old notes in IndexedDB
    const idb = await db.openDB();
    await new Promise((resolve) => {
      const tx = idb.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      store.get(oldUnpinned.id).onsuccess = (e) => {
        const item = e.target.result;
        item.createdAt = now - (45 * msDay); // 45 days old
        store.put(item);
      };
      store.get(oldPinned.id).onsuccess = (e) => {
        const item = e.target.result;
        item.createdAt = now - (45 * msDay); // 45 days old but PINNED
        store.put(item);
      };
      tx.oncomplete = () => resolve();
    });

    // 2. Run deleteOldNotes with 30-day retention
    const result = await db.deleteOldNotes(30);

    assert.equal(result.count, 1, 'Should delete exactly 1 old unpinned note');
    assert.equal(result.deletedNotes[0].id, oldUnpinned.id);

    // 3. Verify remaining notes
    const remainingNotes = await db.getNotes();
    assert.equal(remainingNotes.length, 2);

    const hasPinned = remainingNotes.some((n) => n.id === oldPinned.id);
    const hasRecent = remainingNotes.some((n) => n.id === recentUnpinned.id);
    const hasOld = remainingNotes.some((n) => n.id === oldUnpinned.id);

    assert.ok(hasPinned, 'Pinned note must survive auto-deletion');
    assert.ok(hasRecent, 'Recent note must survive auto-deletion');
    assert.equal(hasOld, false, 'Old unpinned note was deleted');

    // 4. Test days = 0 deletes nothing
    const zeroResult = await db.deleteOldNotes(0);
    assert.equal(zeroResult.count, 0);
  });
});
