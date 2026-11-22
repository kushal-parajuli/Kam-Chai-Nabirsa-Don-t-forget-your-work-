// © 2026 Kushal Parajuli

/**
 * Message types for communication between content scripts, popup, offscreen, and service worker.
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

  // Reminders & Alarms
  PRE_ALERT: 'PRE_ALERT',
  ALARM_RINGING: 'ALARM_RINGING',
  ALARM_STOP: 'ALARM_STOP',
  ALARM_SNOOZE: 'ALARM_SNOOZE',
  ALARM_DONE: 'ALARM_DONE',
  ALARM_DISMISSED: 'ALARM_DISMISSED',
  ALARM_STATUS: 'ALARM_STATUS',

  // Offscreen audio synthesis & handshake
  AUDIO_PLAY_ALARM: 'AUDIO_PLAY_ALARM',
  AUDIO_STOP_ALARM: 'AUDIO_STOP_ALARM',
  OFFSCREEN_READY: 'OFFSCREEN_READY',
  TEST_SOUND: 'TEST_SOUND',

  // Window mount check & DB recovery
  CHECK_CAN_MOUNT: 'CHECK_CAN_MOUNT',
  DB_RESET: 'DB_RESET',

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
