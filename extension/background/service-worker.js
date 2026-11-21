import { MESSAGES, createResponse } from '../shared/messages.js';
import * as db from './db.js';

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
 */
async function injectWidgetIntoAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;

      const isInjectable = tab.url.startsWith('http://') || 
                           tab.url.startsWith('https://') || 
                           tab.url.startsWith('file:///');

      if (!isInjectable) continue;

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/widget.js']
        });
      } catch (tabErr) {
        // Silently skip tabs where script execution is restricted (e.g. chrome://, Web Store)
      }
    }
  } catch (err) {
    console.error('[KCN Service Worker] Error querying tabs for injection:', err);
  }
}

/**
 * Broadcasts a message to all active tabs.
 * Used to keep widgets synchronized when data changes in another tab.
 * @param {object} message 
 */
async function broadcastToAllTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab may not have content script mounted; ignore silently
      });
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
      console.log('[KCN Service Worker] Initialized default settings:', updates);
    }
  } catch (err) {
    console.error('[KCN Service Worker] Failed to initialize default settings:', err);
  }

  // Pre-open DB so object stores are ready
  try {
    await db.openDB();
  } catch (dbErr) {
    console.error('[KCN Service Worker] Failed to open IndexedDB on install:', dbErr);
  }

  // Inject into all already-open tabs
  await injectWidgetIntoAllTabs();
});

/**
 * On startup lifecycle event (browser launched).
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[KCN Service Worker] Browser startup event received.');
  try {
    await db.openDB();
  } catch (dbErr) {
    console.error('[KCN Service Worker] Failed to open IndexedDB on startup:', dbErr);
  }
  await injectWidgetIntoAllTabs();
});

/**
 * Central message router.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { type, payload } = request || {};

  switch (type) {
    // Todo CRUD operations
    case MESSAGES.TODO_LIST:
      db.getTodos()
        .then((todos) => sendResponse(createResponse(true, todos)))
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true; // asynchronous response

    case MESSAGES.TODO_ADD:
      db.addTodo(payload || {})
        .then((newTodo) => {
          sendResponse(createResponse(true, newTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true;

    case MESSAGES.TODO_UPDATE:
      db.updateTodo(payload?.id, payload?.updates || {})
        .then((updatedTodo) => {
          sendResponse(createResponse(true, updatedTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true;

    case MESSAGES.TODO_TOGGLE:
      db.toggleTodo(payload?.id)
        .then((toggledTodo) => {
          sendResponse(createResponse(true, toggledTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true;

    case MESSAGES.TODO_DELETE:
      db.deleteTodo(payload?.id)
        .then((deletedTodo) => {
          sendResponse(createResponse(true, deletedTodo));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true;

    case MESSAGES.TODO_CLEAR_DONE:
      db.clearCompletedTodos()
        .then((deletedCount) => {
          sendResponse(createResponse(true, { count: deletedCount }));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true;

    // Settings
    case MESSAGES.SETTINGS_GET:
      chrome.storage.local.get(null)
        .then((settings) => sendResponse(createResponse(true, settings)))
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true;

    case MESSAGES.SETTINGS_SET:
      chrome.storage.local.set(payload || {})
        .then(() => sendResponse(createResponse(true, payload)))
        .catch((err) => sendResponse(createResponse(false, null, err.message)));
      return true;

    case MESSAGES.BADGE_REFRESH:
      db.getTodos()
        .then((todos) => {
          const openCount = todos.filter((t) => !t.done).length;
          sendResponse(createResponse(true, { count: openCount }));
        })
        .catch(() => sendResponse(createResponse(true, { count: 0 })));
      return true;

    default:
      sendResponse(createResponse(true, { acknowledged: true, type }));
      return false;
  }
});
