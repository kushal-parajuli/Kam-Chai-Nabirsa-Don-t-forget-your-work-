/**
 * Message types for communication between content scripts, popup, and service worker.
 */
export const MESSAGES = {
  // Todo operations
  TODO_LIST: 'TODO_LIST',
  TODO_ADD: 'TODO_ADD',
  TODO_UPDATE: 'TODO_UPDATE',
  TODO_DELETE: 'TODO_DELETE',
  TODO_TOGGLE: 'TODO_TOGGLE',
  TODO_CLEAR_DONE: 'TODO_CLEAR_DONE',

  // Broadcast events
  TODOS_CHANGED: 'TODOS_CHANGED',

  // Notes operations
  NOTE_LIST: 'NOTE_LIST',
  NOTE_ADD: 'NOTE_ADD',
  NOTE_DELETE: 'NOTE_DELETE',
  NOTE_PIN: 'NOTE_PIN',
  NOTES_CLEAR: 'NOTES_CLEAR',

  // Local helper
  HELPER_PING: 'HELPER_PING',

  // Downloader
  DOWNLOAD_START: 'DOWNLOAD_START',
  DOWNLOAD_STATUS: 'DOWNLOAD_STATUS',
  DOWNLOAD_LIST: 'DOWNLOAD_LIST',
  DOWNLOAD_CLEAR: 'DOWNLOAD_CLEAR',

  // Settings
  SETTINGS_GET: 'SETTINGS_GET',
  SETTINGS_SET: 'SETTINGS_SET',

  // Badge count refresh
  BADGE_REFRESH: 'BADGE_REFRESH'
};

/**
 * Standard response helper.
 * @param {boolean} ok 
 * @param {any} [data] 
 * @param {string} [error] 
 */
export function createResponse(ok, data = null, error = null) {
  return { ok, data, error };
}
