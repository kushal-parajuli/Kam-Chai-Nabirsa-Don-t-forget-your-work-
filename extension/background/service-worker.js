// © 2026 Kushal Parajuli

import { MESSAGES, createResponse } from '../shared/messages.js';
import { dataUrlToBlob, blobToDataUrl } from '../shared/utils.js';
import { getSettings, saveSettings, exportSettingsData, DEFAULT_SETTINGS } from '../shared/settings.js';
import * as db from './db.js';
import * as reminders from './reminders.js';
import * as helperClient from './helper-client.js';

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
            files: [
              'content/widget-css.js',
              'content/tabs/todo.js',
              'content/tabs/notes.js',
              'content/tabs/downloader.js',
              'content/widget.js'
            ]
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
 * Runs daily maintenance (purging unpinned notes older than notesAutoDeleteDays).
 */
export async function runMaintenance() {
  try {
    const settings = await getSettings();
    if (settings.notesAutoDeleteDays > 0) {
      const res = await db.deleteOldNotes(settings.notesAutoDeleteDays);
      if (res.count > 0) {
        broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
      }
    }
    await saveSettings({ lastMaintenanceAt: Date.now() });
  } catch (err) {
    console.error('[KCN Service Worker] Maintenance error:', err);
  }
}

/**
 * On installed lifecycle event.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[KCN Service Worker] Installed. Reason:', details.reason);

  try {
    await getSettings();
  } catch (err) {
    console.error('[KCN Service Worker] Failed to initialize settings:', err);
  }

  // Pre-open DB and rehydrate reminder alarms
  try {
    await db.openDB();
    await reminders.rehydrateAllReminders();
  } catch (dbErr) {
    console.error('[KCN Service Worker] Initialization error on install:', dbErr);
  }

  // Schedule daily maintenance alarm (every 24 hours)
  try {
    chrome.alarms.create('maintenance', { periodInMinutes: 1440 });
    await runMaintenance();
  } catch (alarmErr) {
    console.error('[KCN Service Worker] Failed to schedule maintenance alarm:', alarmErr);
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
    await runMaintenance();
  } catch (dbErr) {
    console.error('[KCN Service Worker] Initialization error on startup:', dbErr);
  }
  await injectWidgetIntoAllTabs();
});

// Maintenance Alarm Listener
if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'maintenance') {
      await runMaintenance();
    }
  });
}

// Settings live change listener
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      const oldSettings = changes.settings.oldValue;
      const newSettings = changes.settings.newValue;
      // If preAlertMinutes changed, re-sync alarms
      if (oldSettings?.preAlertMinutes !== newSettings?.preAlertMinutes) {
        await reminders.resyncAllReminders();
      }
    }
  });
}

// Download notification tracking
const notifiedDownloadJobs = new Set();

function notifyDownloadComplete(job) {
  if (!job || !job.id || notifiedDownloadJobs.has(job.id)) return;
  notifiedDownloadJobs.add(job.id);
  if (typeof chrome !== 'undefined' && chrome.notifications?.create) {
    const icon = typeof chrome.runtime?.getURL === 'function' 
      ? chrome.runtime.getURL('icons/icon128.png')
      : 'icons/icon128.png';
    chrome.notifications.create(`dl-done:${job.id}`, {
      type: 'basic',
      iconUrl: icon,
      title: 'Download complete',
      message: job.filename ? `Saved: ${job.filename}` : 'Your download has completed successfully.',
      priority: 0
    }, () => {
      if (chrome.runtime?.lastError) { /* ignore */ }
    });
  }
}

function notifyDownloadFailed(job) {
  if (!job || !job.id || notifiedDownloadJobs.has(job.id)) return;
  notifiedDownloadJobs.add(job.id);
  if (typeof chrome !== 'undefined' && chrome.notifications?.create) {
    const icon = typeof chrome.runtime?.getURL === 'function' 
      ? chrome.runtime.getURL('icons/icon128.png')
      : 'icons/icon128.png';
    chrome.notifications.create(`dl-error:${job.id}`, {
      type: 'basic',
      iconUrl: icon,
      title: 'Download failed',
      message: job.error || 'The download could not be completed.',
      priority: 0
    }, () => {
      if (chrome.runtime?.lastError) { /* ignore */ }
    });
  }
}

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

    case MESSAGES.DB_RESET:
    case 'DB_RESET':
      db.resetDB()
        .then(async () => {
          try {
            await reminders.refreshBadge();
          } catch (badgeErr) {
            console.error('[KCN Service Worker] Failed to refresh badge after DB reset:', badgeErr);
          }
          sendResponse(createResponse(true));
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to reset database:', err);
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

    // Settings (Phase 5)
    case MESSAGES.SETTINGS_GET:
      getSettings()
        .then((settings) => sendResponse(createResponse(true, settings)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to get settings:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.SETTINGS_SET:
      saveSettings(payload?.settings || payload || {})
        .then((saved) => {
          sendResponse(createResponse(true, saved));
          broadcastToAllTabs({ type: 'SETTINGS_CHANGED', payload: saved });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to save settings:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.SETTINGS_BACKUP_EXPORT:
      (async () => {
        try {
          const todos = await db.getTodos();
          const allNotes = await db.getNotes();
          const textNotes = allNotes.filter((n) => n.kind === 'text');
          const settings = await getSettings();
          const backup = {
            app: 'Kam Chai Nabirsa',
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            todos,
            notes: textNotes,
            settings: exportSettingsData(settings)
          };
          sendResponse(createResponse(true, backup));
        } catch (err) {
          console.error('[KCN Service Worker] Backup export failed:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
      return true;

    case MESSAGES.SETTINGS_BACKUP_IMPORT:
      (async () => {
        try {
          const backup = payload?.backup;
          if (!backup || typeof backup !== 'object') {
            sendResponse(createResponse(false, null, 'Invalid backup data format'));
            return;
          }

          // Strict validation
          if (backup.app !== 'Kam Chai Nabirsa' || backup.schemaVersion !== 1) {
            sendResponse(createResponse(false, null, 'Unrecognized backup application name or unsupported schemaVersion'));
            return;
          }

          if (!Array.isArray(backup.todos) || !Array.isArray(backup.notes)) {
            sendResponse(createResponse(false, null, 'Invalid backup payload: todos and notes must be arrays'));
            return;
          }

          // 20 MB size cap check
          const jsonStr = JSON.stringify(backup);
          if (jsonStr.length > 20 * 1024 * 1024) {
            sendResponse(createResponse(false, null, 'Backup exceeds 20 MB size limit'));
            return;
          }

          const mode = payload?.mode === 'replace' ? 'replace' : 'merge';
          const importResult = await db.importBackupData({
            todos: backup.todos,
            notes: backup.notes
          }, mode);

          // Import settings if present, strictly ignoring helperToken
          if (backup.settings && typeof backup.settings === 'object') {
            const settingsToImport = { ...backup.settings };
            delete settingsToImport.helperToken;
            await saveSettings(settingsToImport);
          }

          // Re-sync reminder alarms and badge
          await reminders.resyncAllReminders();
          await reminders.refreshBadge();

          // Broadcast updates to all open tabs
          broadcastToAllTabs({ type: MESSAGES.TODOS_CHANGED });
          broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
          broadcastToAllTabs({ type: 'SETTINGS_CHANGED' });

          sendResponse(createResponse(true, importResult));
        } catch (err) {
          console.error('[KCN Service Worker] Backup import failed:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
      return true;

    // Helper client (Phase 6 & 7)
    case MESSAGES.HELPER_PING:
      helperClient.pingHelper()
        .then((res) => sendResponse(createResponse(true, res)))
        .catch((err) => {
          console.error('[KCN Service Worker] Helper ping error:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    // Downloader operations (Phase 7)
    case MESSAGES.DOWNLOAD_START:
      (async () => {
        try {
          const { url, type } = payload || {};
          if (!url || typeof url !== 'string' || !url.trim()) {
            sendResponse(createResponse(false, null, 'URL is required'));
            return;
          }
          const trimmed = url.trim();
          if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            sendResponse(createResponse(false, null, 'URL must start with http:// or https://'));
            return;
          }
          if (trimmed.length > 2048) {
            sendResponse(createResponse(false, null, 'URL exceeds maximum length of 2048 characters'));
            return;
          }
          if (trimmed.startsWith('-')) {
            sendResponse(createResponse(false, null, 'URL cannot start with a hyphen'));
            return;
          }

          const mediaType = type === 'audio' ? 'audio' : 'video';
          const helperRes = await helperClient.startDownload(trimmed, mediaType);
          if (!helperRes || !helperRes.jobId) {
            sendResponse(createResponse(false, null, helperRes?.error || 'Failed to start download job'));
            return;
          }

          const record = {
            id: helperRes.jobId,
            url: trimmed,
            type: mediaType,
            state: 'queued',
            progress: 0,
            filename: null,
            error: null,
            createdAt: Date.now()
          };
          await db.saveDownload(record);
          sendResponse(createResponse(true, record));
          broadcastToAllTabs({ type: MESSAGES.DOWNLOADS_CHANGED });
        } catch (err) {
          console.error('[KCN Service Worker] DOWNLOAD_START error:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
      return true;

    case MESSAGES.DOWNLOAD_STATUS:
      (async () => {
        try {
          const { jobId } = payload || {};
          if (!jobId) {
            sendResponse(createResponse(false, null, 'jobId is required'));
            return;
          }
          const statusRes = await helperClient.getDownloadStatus(jobId);
          if (statusRes && statusRes.ok) {
            const updated = await db.saveDownload({
              id: statusRes.id || jobId,
              url: statusRes.url,
              type: statusRes.type,
              state: statusRes.state,
              progress: statusRes.progress,
              filename: statusRes.filename,
              error: statusRes.error
            });

            if (statusRes.state === 'done') {
              notifyDownloadComplete(statusRes);
            } else if (statusRes.state === 'error') {
              notifyDownloadFailed(statusRes);
            }

            sendResponse(createResponse(true, updated));
          } else {
            sendResponse(createResponse(false, null, statusRes?.error || 'Failed to query download status'));
          }
        } catch (err) {
          console.error('[KCN Service Worker] DOWNLOAD_STATUS error:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
      return true;

    case MESSAGES.DOWNLOAD_CANCEL:
      (async () => {
        try {
          const { jobId } = payload || {};
          if (!jobId) {
            sendResponse(createResponse(false, null, 'jobId is required'));
            return;
          }
          await helperClient.cancelDownload(jobId);
          const updated = await db.saveDownload({
            id: jobId,
            state: 'cancelled',
            error: 'Download cancelled by user'
          });
          sendResponse(createResponse(true, updated));
          broadcastToAllTabs({ type: MESSAGES.DOWNLOADS_CHANGED });
        } catch (err) {
          console.error('[KCN Service Worker] DOWNLOAD_CANCEL error:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
      return true;

    case MESSAGES.DOWNLOAD_LIST:
      db.getDownloads()
        .then((list) => sendResponse(createResponse(true, list)))
        .catch((err) => {
          console.error('[KCN Service Worker] DOWNLOAD_LIST error:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.DOWNLOAD_CLEAR:
      db.clearDownloads()
        .then(() => {
          sendResponse(createResponse(true));
          broadcastToAllTabs({ type: MESSAGES.DOWNLOADS_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] DOWNLOAD_CLEAR error:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.DOWNLOAD_OPEN_FOLDER:
      helperClient.openDownloadFolder()
        .then((res) => sendResponse(createResponse(true, res)))
        .catch((err) => {
          console.error('[KCN Service Worker] DOWNLOAD_OPEN_FOLDER error:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.DOWNLOAD_UPDATE_YTDLP:
      helperClient.updateYtDlp()
        .then((res) => sendResponse(createResponse(true, res)))
        .catch((err) => {
          console.error('[KCN Service Worker] DOWNLOAD_UPDATE_YTDLP error:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    // Notes operations (Phase 4)
    case MESSAGES.NOTE_LIST:
      db.getNotes()
        .then((notes) => sendResponse(createResponse(true, notes)))
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to list notes:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.NOTE_ADD:
      (async () => {
        try {
          const { kind, text, dataUrl, mimeType, thumb, fileName, size, pinned } = payload || {};
          if (kind === 'text') {
            if (!text || typeof text !== 'string' || !text.trim()) {
              sendResponse(createResponse(false, null, 'Note text cannot be empty'));
              return;
            }
            if (text.length > 20000) {
              sendResponse(createResponse(false, null, 'Note exceeds 20,000 characters limit'));
              return;
            }
            const note = await db.addNote({
              kind: 'text',
              text: text.trim(),
              mimeType: 'text/plain',
              size: typeof size === 'number' ? size : new Blob([text.trim()]).size,
              pinned: Boolean(pinned)
            });
            sendResponse(createResponse(true, note));
            broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
          } else if (kind === 'image') {
            if (!dataUrl) {
              sendResponse(createResponse(false, null, 'No image data provided'));
              return;
            }
            const allowedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
            const mime = mimeType || (dataUrl.match(/data:(.*?);/)?.[1] || 'image/png');
            if (!allowedMimes.includes(mime)) {
              sendResponse(createResponse(false, null, 'Only PNG, JPEG, GIF, and WEBP images are supported'));
              return;
            }
            const blob = await dataUrlToBlob(dataUrl, mime);
            if (blob.size > 10 * 1024 * 1024) {
              sendResponse(createResponse(false, null, `Image exceeds 10 MB limit (${(blob.size / (1024 * 1024)).toFixed(1)} MB)`));
              return;
            }
            const note = await db.addNote({
              kind: 'image',
              blob,
              mimeType: mime,
              thumb: thumb || null,
              fileName: fileName || null,
              size: blob.size,
              pinned: Boolean(pinned)
            });
            sendResponse(createResponse(true, note));
            broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
          } else {
            sendResponse(createResponse(false, null, 'Invalid note kind'));
          }
        } catch (err) {
          console.error('[KCN Service Worker] Failed to add note:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
      return true;

    case MESSAGES.NOTE_UPDATE:
      (async () => {
        try {
          const { id, text } = payload || {};
          if (!id) {
            sendResponse(createResponse(false, null, 'Note ID is required'));
            return;
          }
          if (!text || typeof text !== 'string' || !text.trim()) {
            sendResponse(createResponse(false, null, 'Note text cannot be empty'));
            return;
          }
          if (text.length > 20000) {
            sendResponse(createResponse(false, null, 'Note exceeds 20,000 characters limit'));
            return;
          }
          const updated = await db.updateNoteText(id, text.trim());
          sendResponse(createResponse(true, updated));
          broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
        } catch (err) {
          console.error('[KCN Service Worker] Failed to update note:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
      return true;

    case MESSAGES.NOTE_DELETE:
      db.deleteNote(payload?.id)
        .then((res) => {
          sendResponse(createResponse(true, res));
          broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to delete note:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.NOTE_PIN:
      db.setNotePin(payload?.id, payload?.pinned)
        .then((res) => {
          sendResponse(createResponse(true, res));
          broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to pin note:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.NOTES_CLEAR:
      db.clearNotes(Boolean(payload?.alsoDeletePinned))
        .then((res) => {
          sendResponse(createResponse(true, res));
          broadcastToAllTabs({ type: MESSAGES.NOTES_CHANGED });
        })
        .catch((err) => {
          console.error('[KCN Service Worker] Failed to clear notes:', err);
          sendResponse(createResponse(false, null, err.message));
        });
      return true;

    case MESSAGES.NOTE_GET_FULL:
      (async () => {
        try {
          const note = await db.getNoteById(payload?.id);
          if (!note) {
            sendResponse(createResponse(false, null, 'Note not found'));
            return;
          }
          if (note.kind !== 'image' || !note.blob) {
            sendResponse(createResponse(false, null, 'Note does not contain an image'));
            return;
          }
          const dataUrl = await blobToDataUrl(note.blob, note.mimeType);
          sendResponse(createResponse(true, {
            id: note.id,
            dataUrl,
            mimeType: note.mimeType,
            fileName: note.fileName
          }));
        } catch (err) {
          console.error('[KCN Service Worker] Failed to get full note image:', err);
          sendResponse(createResponse(false, null, err.message));
        }
      })();
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
