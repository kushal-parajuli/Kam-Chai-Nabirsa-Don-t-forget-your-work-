// © 2026 Kushal Parajuli

import { MESSAGES, createResponse } from '../shared/messages.js';
import * as db from './db.js';
import * as reminders from './reminders.js';

/**
 * Default user settings.
 */
const DEFAULT_SETTINGS = {
  widgetEnabled: true,
  widgetPosition: { edge: 'right', top: 120 },
  widgetOpacity: 0.35,
  theme: 'auto',
  soundEnabled: true,
  helperPort: 8765,
  helperToken: '',
  lastActiveTab: 'todo',
  notesAutoDeleteDays: 0
};

/**
 * Injects the content script into all open tabs matching http, https, or file schemes.
 * Ensures the widget is immediately active even on tabs opened prior to extension install/reload.
 * Restricts injection strictly to normal Chrome windows (skips devtools, popups, and app windows).
 */
async function injectWidgetIntoAllTabs() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const win of windows) {
      if (win.type !== 'normal') continue; // Only normal browser windows

      for (const tab of win.tabs || []) {
        if (!tab.id || !tab.url) continue;

        const isInjectable = tab.url.startsWith('http://') || 
                             tab.url.startsWith('https://') || 
                             tab.url.startsWith('file:///');

        if (!isInjectable) continue;

        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/widget-css.js', 'content/tabs/todo.js', 'content/widget.js']
          });
        } catch (tabErr) {
          // Silently skip restricted tabs (e.g. Chrome Web Store)
        }
      }
    }
  } catch (err) {
    console.error('[KCN Service Worker] Error querying windows/tabs for injection:', err);
  }
}

/**
 * Broadcasts a message to all active tabs.
 * @param {object} message 
 */
async function broadcastToAllTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (err) {
    console.error('[KCN Service Worker] Error broadcasting message:', err);
  }
}

/**
 * On installed lifecycle event.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[KCN Service Worker] Installed. Reason:', details.reason);

  try {
    const existing = await chrome.storage.local.get(null);
    const updates = {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (existing[key] === undefined) {
        updates[key] = value;
      }
    }
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error('[KCN Service Worker] Failed to initialize default settings:', err);
  }

  // Pre-open DB and rehydrate reminder alarms
  try {
    await db.openDB();
    await reminders.rehydrateAllReminders();
  } catch (dbErr) {
    console.error('[KCN Service Worker] Initialization error on install:', dbErr);
  }

  // Inject into all already-open normal tabs
  await injectWidgetIntoAllTabs();
});

/**
 * On startup lifecycle event (browser launched).
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[KCN Service Worker] Browser startup event received.');
  try {
    await db.openDB();
    await reminders.rehydrateAllReminders();
  } catch (dbErr) {
    console.error('[KCN Service Worker] Initialization error on startup:', dbErr);
  }
  await injectWidgetIntoAllTabs();
});

/**
 * Central message router.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { type, payload, target } = request || {};

  // Handshake from offscreen audio document
  if (type === MESSAGES.OFFSCREEN_READY || type === 'OFFSCREEN_READY') {
    reminders.handleOffscreenReady();
    sendResponse(createResponse(true));
    return false;
  }

  // Window type validation to ensure widget only mounts in normal tabs
  if (type === MESSAGES.CHECK_CAN_MOUNT || type === 'CHECK_CAN_MOUNT') {
    if (!sender.tab || sender.tab.windowId === undefined) {
      chrome.windows.getCurrent()
        .then((win) => {
          const shouldMount = Boolean(win && win.type === 'normal');
          sendResponse(createResponse(true, { shouldMount }));
        })
        .catch(() => {
          sendResponse(createResponse(true, { shouldMount: true }));
        });
      return true;
    }
    chrome.windows.get(sender.tab.windowId)
      .then((win) => {
        const shouldMount = Boolean(win && win.type === 'normal');
        sendResponse(createResponse(true, { shouldMount }));
      })
      .catch((err) => {
        console.warn('[KCN Service Worker] Window check error for mount:', err);
        sendResponse(createResponse(true, { shouldMount: true }));
      });
    return true;
  }

  // Audio Test Trigger
  if (type === MESSAGES.TEST_SOUND || type === 'TEST_SOUND') {
    reminders.testSound()
      .then(() => sendResponse(createResponse(true)))
      .catch((err) => {
        console.error('[KCN Service Worker] Test sound error:', err);
        sendResponse(createResponse(false, null, err.message));
      });
    return true;
  }

  switch (type) {
    // Todo CRUD operations
    case MESSAGES.TODO_LIST:
      db.getTodos()
        .then((todos) => sendResponse(createResponse(true, todos)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to list todos:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.TODO_ADD:
      db.addTodo(payload || {})
        .then(async (newTodo) => {
          if (typeof newTodo.remindAt === 'number' && newTodo.remindAt > 0) {
            await reminders.scheduleReminder(newTodo);
          }
          await reminders.refreshBadge();
          sendResponse(createResponse(true, newTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to add todo:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.TODO_UPDATE:
      db.updateTodo(payload?.id, payload?.updates || {})
        .then(async (updatedTodo) => {
          if (payload?.updates?.remindAt !== undefined || payload?.updates?.done !== undefined) {
            if (updatedTodo.done || typeof updatedTodo.remindAt !== 'number' || updatedTodo.remindAt <= 0) {
              await reminders.clearTodoAlarms(updatedTodo.id);
            } else {
              await reminders.scheduleReminder(updatedTodo);
            }
          }
          await reminders.refreshBadge();
          sendResponse(createResponse(true, updatedTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to update todo:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.TODO_TOGGLE:
      db.toggleTodo(payload?.id)
        .then(async (toggledTodo) => {
          if (toggledTodo.done || typeof toggledTodo.remindAt !== 'number' || toggledTodo.remindAt <= 0) {
            await reminders.clearTodoAlarms(toggledTodo.id);
          } else {
            await reminders.scheduleReminder(toggledTodo);
          }
          await reminders.refreshBadge();
          sendResponse(createResponse(true, toggledTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to toggle todo:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.TODO_DELETE:
      db.deleteTodo(payload?.id)
        .then(async (deletedTodo) => {
          try {
            await reminders.clearTodoAlarms(payload?.id);
          } catch (alarmErr) {
            console.error(`[KCN Service Worker] Failed to clear alarms on delete:`, alarmErr);
          }
          await reminders.refreshBadge();
          sendResponse(createResponse(true, deletedTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to delete todo:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.TODO_CLEAR_DONE:
      db.clearCompletedTodos()
        .then(async ({ count, deletedTodos = [] }) => {
          for (const t of deletedTodos) {
            try {
              await reminders.clearTodoAlarms(t.id);
            } catch (alarmErr) {
              console.error(`[KCN Service Worker] Failed to clear alarms for cleared todo ${t.id}:`, alarmErr);
            }
          }
          try {
            await reminders.refreshBadge();
          } catch (badgeErr) {
            console.error('[KCN Service Worker] Failed to refresh badge on clear completed:', badgeErr);
          }
          sendResponse(createResponse(true, { count }));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to clear completed todos:', err.name, err.message);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    // Alarms & Reminders Control
    case MESSAGES.ALARM_STATUS:
      db.getTodos()
        .then((todos) => {
          const ringingTodos = todos.filter((t) => !t.done && t.ringing);
          sendResponse(createResponse(true, ringingTodos));
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to get alarm status:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.ALARM_STOP:
      reminders.stopAlarm(payload?.id)
        .then(() => sendResponse(createResponse(true)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to stop alarm:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.ALARM_SNOOZE:
      reminders.snoozeAlarm(payload?.id)
        .then(() => sendResponse(createResponse(true)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to snooze alarm:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.ALARM_DONE:
      reminders.markDoneAlarm(payload?.id)
        .then(() => sendResponse(createResponse(true)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to mark done from alarm:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    // Settings
    case MESSAGES.SETTINGS_GET:
      chrome.storage.local.get(null)
        .then((settings) => sendResponse(createResponse(true, settings)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to get settings:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.SETTINGS_SET:
      chrome.storage.local.set(payload || {})
        .then(() => sendResponse(createResponse(true, payload)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to save settings:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.BADGE_REFRESH:
      reminders.refreshBadge()
        .then(() => sendResponse(createResponse(true)))
        .catch(() => sendResponse(createResponse(true)));
      return true;

    default:
      sendResponse(createResponse(true, { acknowledged: true, type }));
      return false;
  }
});
