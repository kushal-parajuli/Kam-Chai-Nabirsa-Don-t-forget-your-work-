import { MESSAGES, createResponse } from '../shared/messages.js';

/**
 * Default user settings.
 */
const DEFAULT_SETTINGS = {
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
});

/**
 * On startup lifecycle event.
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('[KCN Service Worker] Browser startup event received.');
});

/**
 * Central message router.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[KCN Service Worker] Message received:', request?.type, 'from:', sender?.tab ? `tab:${sender.tab.id}` : 'popup');

  const { type, payload } = request || {};

  switch (type) {
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
      sendResponse(createResponse(true, { count: 0 }));
      return false;

    default:
      // Stub acknowledgment for unhandled messages
      sendResponse(createResponse(true, { acknowledged: true, type }));
      return false;
  }
});
