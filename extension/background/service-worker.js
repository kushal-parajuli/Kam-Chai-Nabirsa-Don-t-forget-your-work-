import { MESSAGES, createResponse } from '../shared/messages.js';

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

  // Inject into all already-open tabs
  await injectWidgetIntoAllTabs();
});

/**
 * On startup lifecycle event (browser launched).
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[KCN Service Worker] Browser startup event received.');
  // Ensure restored or active tabs receive injection
  await injectWidgetIntoAllTabs();
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
      sendResponse(createResponse(true, { acknowledged: true, type }));
      return false;
  }
});
