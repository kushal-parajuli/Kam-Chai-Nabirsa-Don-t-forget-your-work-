// © 2026 Kushal Parajuli

import { MESSAGES } from '../shared/messages.js';
import { MIN_LEAD_SECONDS } from '../shared/constants.js';
import { getSettings } from '../shared/settings.js';
import * as db from './db.js';

const OFFSCREEN_PATH = 'offscreen/offscreen.html';

let offscreenReadyResolver = null;
let testSoundTimer = null;

/**
 * Predicate to strictly verify whether a todo has a valid future/past reminder epoch.
 * In JS, `null <= Date.now()` evaluates to `0 <= Date.now()` (true), so a strict check is required.
 * @param {object} todo 
 * @returns {boolean}
 */
export function hasValidReminder(todo) {
  return Boolean(todo && typeof todo.remindAt === 'number' && !isNaN(todo.remindAt) && todo.remindAt > 0);
}

/**
 * Called when offscreen document dispatches OFFSCREEN_READY.
 */
export function handleOffscreenReady() {
  if (offscreenReadyResolver) {
    offscreenReadyResolver();
    offscreenReadyResolver = null;
  }
}

/**
 * Ensures the offscreen audio playback document exists and is ready for playback messages.
 */
async function ensureOffscreenDocument() {
  try {
    if (await chrome.offscreen.hasDocument()) {
      return;
    }

    const readyPromise = new Promise((resolve) => {
      offscreenReadyResolver = resolve;
      // Fallback timeout after 2000ms if ready event fails
      setTimeout(() => {
        if (offscreenReadyResolver) {
          offscreenReadyResolver();
          offscreenReadyResolver = null;
        }
      }, 2000);
    });

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Synthesize reminder alarm tone'
    });

    await readyPromise;
  } catch (err) {
    console.error('[KCN Reminders] Failed to create offscreen document:', err);
  }
}

/**
 * Sends a command to play sound in the offscreen document if enabled.
 * @param {number|null} [volumePercent=null] Optional volume override (10-100)
 */
async function playSound(volumePercent = null) {
  try {
    const settings = await getSettings();
    if (!settings.soundEnabled) return;

    const vol = typeof volumePercent === 'number'
      ? Math.max(0.1, Math.min(1.0, volumePercent / 100))
      : (settings.alarmVolume / 100);

    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: MESSAGES.AUDIO_PLAY_ALARM,
      volume: vol
    }).catch((err) => {
      console.error('[KCN Reminders] Failed to dispatch play audio to offscreen:', err);
    });
  } catch (err) {
    console.error('[KCN Reminders] Sound playback error:', err);
  }
}

/**
 * Sends a command to stop sound in the offscreen document, then closes the offscreen document.
 * @param {boolean} force Whether to force stop all sounds.
 */
async function stopSound(force = false) {
  try {
    if (await chrome.offscreen.hasDocument()) {
      try {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: MESSAGES.AUDIO_STOP_ALARM,
          force
        });
      } catch (_) {}

      try {
        await chrome.offscreen.closeDocument();
      } catch (closeErr) {
        // Document may have already closed
      }
    }
  } catch (err) {
    console.error('[KCN Reminders] Stop sound error:', err);
  }
}

/**
 * Plays synthetic alarm sound for 3 seconds to test audio functionality.
 */
export async function testSound() {
  try {
    if (testSoundTimer) {
      clearTimeout(testSoundTimer);
      testSoundTimer = null;
    }
    const settings = await getSettings();
    await playSound(settings.alarmVolume);
    testSoundTimer = setTimeout(async () => {
      await stopSound(true);
      testSoundTimer = null;
    }, 3000);
  } catch (err) {
    console.error('[KCN Reminders] Test sound error:', err);
  }
}

/**
 * Broadcasts an event to all open browser tabs.
 * @param {object} message 
 */
async function broadcast(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (err) {
    console.warn('[KCN Reminders] Tab broadcast failed:', err);
  }
}

/**
 * Updates the toolbar extension badge count with ringing/overdue tasks.
 * Todos without a reminder must NEVER contribute to the badge count.
 */
export async function refreshBadge() {
  try {
    const todos = await db.getTodos();
    const now = Date.now();
    // Count todos that are NOT done AND (are actively ringing OR have a valid remindAt <= now)
    const dueCount = todos.filter((t) => !t.done && (t.ringing || (hasValidReminder(t) && t.remindAt <= now))).length;

    if (dueCount > 0) {
      await chrome.action.setBadgeText({ text: String(dueCount) });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('[KCN Reminders] Failed to update badge:', err);
  }
}

/**
 * Clears all alarms associated with a specific todo ID.
 * @param {string} todoId 
 */
export async function clearTodoAlarms(todoId) {
  if (!todoId) return;
  try {
    await chrome.alarms.clear(`todo:${todoId}`);
    await chrome.alarms.clear(`pre:${todoId}`);
    await chrome.alarms.clear(`stop:${todoId}`);
    await chrome.alarms.clear(`repeat:${todoId}`);
    await stopSound(true);
    await chrome.notifications.clear(`alarm:${todoId}`);
    await chrome.notifications.clear(`pre:${todoId}`);
  } catch (err) {
    console.error(`[KCN Reminders] Failed to clear alarms for todo ${todoId}:`, err);
  }
}

/**
 * Schedules a reminder and optional 5-minute pre-alert for a todo.
 * @param {object} todo 
 */
export async function scheduleReminder(todo) {
  if (!todo || !todo.id) return;

  // Clear any existing alarms for this todo
  await clearTodoAlarms(todo.id);

  if (todo.done || !hasValidReminder(todo)) {
    return;
  }

  const now = Date.now();

  // If reminder is already in the past, trigger immediate alarm labeled Missed
  if (todo.remindAt <= now) {
    await startRinging(todo.id, true);
    return;
  }

  // Exact alarm at remindAt
  chrome.alarms.create(`todo:${todo.id}`, { when: todo.remindAt });

  const settings = await getSettings();

  // Pre-alert (only if preAlertMinutes > 0 and reminder is far enough away)
  if (settings.preAlertMinutes > 0 && !todo.preReminded) {
    const preWhen = todo.remindAt - (settings.preAlertMinutes * 60 * 1000);
    if (preWhen > now + (MIN_LEAD_SECONDS * 1000)) {
      chrome.alarms.create(`pre:${todo.id}`, { when: preWhen });
    }
  }
}

/**
 * Handles the 5-minute pre-alert alarm.
 * @param {string} todoId 
 */
async function handlePreAlert(todoId) {
  try {
    const todos = await db.getTodos();
    const todo = todos.find((t) => t.id === todoId);
    if (!todo || todo.done || !hasValidReminder(todo) || todo.preReminded) return;

    // Update DB
    await db.updateTodo(todoId, { preReminded: true });

    // Broadcast PRE_ALERT to all tabs
    broadcast({
      type: MESSAGES.PRE_ALERT,
      payload: { todo }
    });

    // Quiet notification
    chrome.notifications.create(`pre:${todoId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'Kam Chai Nabirsa',
      message: `Upcoming in 5 min: ${todo.title}`,
      silent: true,
      requireInteraction: false
    });
  } catch (err) {
    console.error('[KCN Reminders] Pre-alert handling failed:', err);
  }
}

/**
 * Starts ringing an alarm for a todo.
 * @param {string} todoId 
 * @param {boolean} isMissed True if the reminder time passed while Chrome was closed.
 */
export async function startRinging(todoId, isMissed = false) {
  try {
    const todos = await db.getTodos();
    const todo = todos.find((t) => t.id === todoId);
    if (!todo || todo.done || !hasValidReminder(todo)) {
      await clearTodoAlarms(todoId);
      return;
    }

    const settings = await getSettings();
    const newRingCount = (todo.ringCount || 0) + 1;
    const now = Date.now();

    await db.updateTodo(todoId, {
      ringing: true,
      ringCount: newRingCount,
      lastRingAt: now,
      reminded: true
    });

    // Schedule stop sound in ringSeconds
    chrome.alarms.create(`stop:${todoId}`, { when: now + (settings.ringSeconds * 1000) });

    // Schedule next repeat in repeatMinutes
    chrome.alarms.create(`repeat:${todoId}`, { when: now + (settings.repeatMinutes * 60 * 1000) });

    // Play synthetic sound
    await playSound(settings.alarmVolume);

    // Broadcast ALARM_RINGING to all tabs
    broadcast({
      type: MESSAGES.ALARM_RINGING,
      payload: {
        todo: { ...todo, ringing: true, ringCount: newRingCount },
        isMissed
      }
    });

    // Persistent system notification
    chrome.notifications.create(`alarm:${todoId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: isMissed ? 'Kam Chai Nabirsa (Missed Reminder)' : 'Kam Chai Nabirsa',
      message: todo.title,
      requireInteraction: true,
      buttons: [
        { title: 'Snooze 5 min' },
        { title: 'Mark done' }
      ]
    });

    await refreshBadge();
  } catch (err) {
    console.error('[KCN Reminders] Failed to start ringing:', err);
  }
}

/**
 * Stops the audio playback when 60s duration expires.
 * (Leaves banner and badge active in widget).
 * @param {string} todoId 
 */
async function handleStopSound(todoId) {
  await stopSound(false);
}

/**
 * Handles repeat alarm cycle (every 5 min up to MAX_REPEATS).
 * @param {string} todoId 
 */
async function handleRepeatRing(todoId) {
  try {
    const todos = await db.getTodos();
    const todo = todos.find((t) => t.id === todoId);
    if (!todo || todo.done || !hasValidReminder(todo) || !todo.ringing) {
      await clearTodoAlarms(todoId);
      return;
    }

    const settings = await getSettings();
    if ((todo.ringCount || 0) < settings.maxRepeats) {
      // Ring again
      const newRingCount = (todo.ringCount || 0) + 1;
      const now = Date.now();

      await db.updateTodo(todoId, {
        ringCount: newRingCount,
        lastRingAt: now
      });

      chrome.alarms.create(`stop:${todoId}`, { when: now + (settings.ringSeconds * 1000) });
      chrome.alarms.create(`repeat:${todoId}`, { when: now + (settings.repeatMinutes * 60 * 1000) });

      await playSound(settings.alarmVolume);

      broadcast({
        type: MESSAGES.ALARM_RINGING,
        payload: {
          todo: { ...todo, ringCount: newRingCount },
          isMissed: false
        }
      });
    } else {
      // Reached maxRepeats: stop sound but keep banner
      await stopSound(true);
    }
  } catch (err) {
    console.error('[KCN Reminders] Repeat handling failed:', err);
  }
}

/**
 * Dismisses / stops an active alarm.
 * @param {string} todoId 
 */
export async function stopAlarm(todoId) {
  try {
    await db.updateTodo(todoId, { ringing: false });
    await clearTodoAlarms(todoId);
    await stopSound(true);

    broadcast({
      type: MESSAGES.ALARM_DISMISSED,
      payload: { id: todoId }
    });
    broadcast({ type: MESSAGES.TODOS_CHANGED });

    await refreshBadge();
  } catch (err) {
    console.error('[KCN Reminders] Failed to stop alarm:', err);
  }
}

/**
 * Snoozes an active alarm.
 * @param {string} todoId 
 * @param {number|null} [customMinutes=null]
 */
export async function snoozeAlarm(todoId, customMinutes = null) {
  try {
    const settings = await getSettings();
    const minutes = (typeof customMinutes === 'number' && customMinutes > 0)
      ? customMinutes
      : settings.snoozeMinutes;
    const now = Date.now();
    const snoozeTime = now + (minutes * 60 * 1000);

    await db.updateTodo(todoId, {
      ringing: false,
      snoozedUntil: snoozeTime,
      remindAt: snoozeTime,
      reminded: false,
      preReminded: true, // No pre-alert for snooze
      ringCount: 0
    });

    await clearTodoAlarms(todoId);
    await stopSound(true);

    // Schedule new alarm
    chrome.alarms.create(`todo:${todoId}`, { when: snoozeTime });

    broadcast({
      type: MESSAGES.ALARM_DISMISSED,
      payload: { id: todoId }
    });
    broadcast({ type: MESSAGES.TODOS_CHANGED });

    await refreshBadge();
  } catch (err) {
    console.error('[KCN Reminders] Failed to snooze alarm:', err);
  }
}

/**
 * Re-synchronizes pending reminder alarms when preAlertMinutes or settings change.
 */
export async function resyncAllReminders() {
  try {
    const todos = await db.getTodos();
    for (const todo of todos) {
      if (!todo.done && hasValidReminder(todo) && !todo.ringing) {
        await scheduleReminder(todo);
      }
    }
  } catch (err) {
    console.error('[KCN Reminders] Failed to re-sync all reminders:', err);
  }
}

/**
 * Marks a ringing todo as done and dismisses the alarm.
 * @param {string} todoId 
 */
export async function markDoneAlarm(todoId) {
  try {
    await db.updateTodo(todoId, {
      ringing: false,
      done: true
    });

    await clearTodoAlarms(todoId);
    await stopSound(true);

    broadcast({
      type: MESSAGES.ALARM_DISMISSED,
      payload: { id: todoId }
    });
    broadcast({ type: MESSAGES.TODOS_CHANGED });

    await refreshBadge();
  } catch (err) {
    console.error('[KCN Reminders] Failed to mark done from alarm:', err);
  }
}

/**
 * Rehydrates all alarms from IndexedDB upon startup or installation.
 * Fires missed reminders immediately and purges stale/orphaned alarm states.
 */
export async function rehydrateAllReminders() {
  try {
    const todos = await db.getTodos();
    const now = Date.now();

    for (const todo of todos) {
      if (todo.done || !hasValidReminder(todo)) {
        if (todo.ringing || todo.preReminded) {
          await db.updateTodo(todo.id, { ringing: false, preReminded: false, reminded: false });
        }
        await clearTodoAlarms(todo.id);
        continue;
      }

      if (todo.ringing) {
        // Still marked ringing from earlier session
        if ((todo.ringCount || 0) < MAX_REPEATS) {
          await startRinging(todo.id, true);
        } else {
          await stopSound(true);
        }
        continue;
      }

      if (todo.remindAt <= now && !todo.reminded) {
        // Passed while Chrome was closed
        await startRinging(todo.id, true);
      } else if (todo.remindAt > now) {
        await scheduleReminder(todo);
      }
    }

    await refreshBadge();
  } catch (err) {
    console.error('[KCN Reminders] Rehydration failed:', err);
  }
}

// Global Chrome Alarms Listener
if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    const name = alarm.name;
    if (!name) return;

    if (name.startsWith('todo:')) {
      const id = name.slice(5);
      await startRinging(id, false);
    } else if (name.startsWith('pre:')) {
      const id = name.slice(4);
      await handlePreAlert(id);
    } else if (name.startsWith('stop:')) {
      const id = name.slice(5);
      await handleStopSound(id);
    } else if (name.startsWith('repeat:')) {
      const id = name.slice(7);
      await handleRepeatRing(id);
    }
  });
}

// Chrome Notifications Button Click Listener
if (typeof chrome !== 'undefined' && chrome.notifications?.onButtonClicked?.addListener) {
  chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (notificationId.startsWith('alarm:')) {
      const todoId = notificationId.slice(6);
      if (buttonIndex === 0) {
        await snoozeAlarm(todoId);
      } else if (buttonIndex === 1) {
        await markDoneAlarm(todoId);
      }
    }
  });
}

// Chrome Notifications Closed Listener (stop audio on notification dismissal)
if (typeof chrome !== 'undefined' && chrome.notifications?.onClosed?.addListener) {
  chrome.notifications.onClosed.addListener(async (notificationId) => {
    if (notificationId.startsWith('alarm:')) {
      await stopSound(false);
    }
  });
}
