// © 2026 Kushal Parajuli

/**
 * Settings module for Kam Chai Nabirsa.
 * Manages defaults, validation, clamping, and storage in chrome.storage.local.
 */

export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  theme: 'auto', // 'auto' | 'light' | 'dark'
  widgetOpacity: 35, // 20 - 100 (%)
  edgeSide: 'right', // 'left' | 'right'
  widgetSize: 'medium', // 'small' | 'medium' | 'large'
  soundEnabled: true, // boolean
  alarmVolume: 80, // 10 - 100 (%)
  ringSeconds: 60, // 10 - 300 (seconds)
  repeatMinutes: 5, // 1 - 60 (minutes)
  maxRepeats: 10, // 1 - 20 (count)
  snoozeMinutes: 5, // 1 - 60 (minutes)
  preAlertMinutes: 5, // 0 - 30 (minutes, 0 = off)
  notesAutoDeleteDays: 0, // 0 - 365 (days, 0 = off)
  helperPort: 8765, // 1024 - 65535
  helperToken: '', // string (never logged, never exported)
  lastMaintenanceAt: null // timestamp of last notes cleanup
});

/**
 * Helper to clamp a numeric value within [min, max], falling back to fallback if invalid.
 * @param {any} val 
 * @param {number} min 
 * @param {number} max 
 * @param {number} fallback 
 * @returns {number}
 */
export function clamp(val, min, max, fallback) {
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

/**
 * Validates, clamps, and repairs an incoming raw settings object.
 * @param {any} raw 
 * @returns {object} Clean, schema-compliant settings object
 */
export function sanitizeSettings(raw = {}) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  // Theme: auto | light | dark
  const theme = ['auto', 'light', 'dark'].includes(src.theme) ? src.theme : DEFAULT_SETTINGS.theme;

  // Widget Opacity: 20 to 100
  const widgetOpacity = clamp(src.widgetOpacity, 20, 100, DEFAULT_SETTINGS.widgetOpacity);

  // Edge Side: left | right
  const edgeSide = ['left', 'right'].includes(src.edgeSide) ? src.edgeSide : DEFAULT_SETTINGS.edgeSide;

  // Widget Size: small | medium | large
  const widgetSize = ['small', 'medium', 'large'].includes(src.widgetSize) ? src.widgetSize : DEFAULT_SETTINGS.widgetSize;

  // Sound Enabled: boolean
  const soundEnabled = typeof src.soundEnabled === 'boolean' ? src.soundEnabled : DEFAULT_SETTINGS.soundEnabled;

  // Alarm Volume: 10 to 100
  const alarmVolume = clamp(src.alarmVolume, 10, 100, DEFAULT_SETTINGS.alarmVolume);

  // Ring Seconds: 10 to 300
  const ringSeconds = clamp(src.ringSeconds, 10, 300, DEFAULT_SETTINGS.ringSeconds);

  // Repeat Minutes: 1 to 60
  const repeatMinutes = clamp(src.repeatMinutes, 1, 60, DEFAULT_SETTINGS.repeatMinutes);

  // Max Repeats: 1 to 20
  const maxRepeats = clamp(src.maxRepeats, 1, 20, DEFAULT_SETTINGS.maxRepeats);

  // Snooze Minutes: 1 to 60
  const snoozeMinutes = clamp(src.snoozeMinutes, 1, 60, DEFAULT_SETTINGS.snoozeMinutes);

  // Pre-alert Minutes: 0 to 30 (0 = off)
  const preAlertMinutes = clamp(src.preAlertMinutes, 0, 30, DEFAULT_SETTINGS.preAlertMinutes);

  // Notes Auto Delete Days: 0 to 365 (0 = off)
  const notesAutoDeleteDays = clamp(src.notesAutoDeleteDays, 0, 365, DEFAULT_SETTINGS.notesAutoDeleteDays);

  // Helper Port: 1024 to 65535
  const helperPort = clamp(src.helperPort, 1024, 65535, DEFAULT_SETTINGS.helperPort);

  // Helper Token: string, max 256 chars, never logged
  const helperToken = typeof src.helperToken === 'string' ? src.helperToken.trim().slice(0, 256) : '';

  // Last Maintenance: timestamp or null
  const lastMaintenanceAt = (typeof src.lastMaintenanceAt === 'number' && src.lastMaintenanceAt > 0)
    ? src.lastMaintenanceAt
    : null;

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    theme,
    widgetOpacity,
    edgeSide,
    widgetSize,
    soundEnabled,
    alarmVolume,
    ringSeconds,
    repeatMinutes,
    maxRepeats,
    snoozeMinutes,
    preAlertMinutes,
    notesAutoDeleteDays,
    helperPort,
    helperToken,
    lastMaintenanceAt
  };
}

/**
 * Loads current settings from chrome.storage.local, repairing invalid values if necessary.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  try {
    const data = await chrome.storage.local.get('settings');
    const clean = sanitizeSettings(data.settings);
    // If stored data was missing or had different schema, persist repaired clean settings
    if (!data.settings || data.settings.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
      await chrome.storage.local.set({ settings: clean });
    }
    return clean;
  } catch (err) {
    console.error('[KCN Settings] Failed to load settings:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Updates settings with partial values, sanitizes, and persists to chrome.storage.local.
 * @param {object} partial 
 * @returns {Promise<object>} Saved clean settings
 */
export async function saveSettings(partial = {}) {
  try {
    const current = await getSettings();
    const updated = sanitizeSettings({ ...current, ...partial });
    await chrome.storage.local.set({ settings: updated });
    return updated;
  } catch (err) {
    console.error('[KCN Settings] Failed to save settings:', err);
    throw err;
  }
}

/**
 * Prepares settings for JSON backup export, strictly removing helperToken.
 * @param {object} settings 
 * @returns {object} Exportable settings without secrets
 */
export function exportSettingsData(settings) {
  const clean = sanitizeSettings(settings);
  const exported = { ...clean };
  delete exported.helperToken;
  return exported;
}
