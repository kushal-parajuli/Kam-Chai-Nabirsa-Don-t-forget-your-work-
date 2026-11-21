import { MESSAGES } from '../shared/messages.js';
import { PRE_ALERT_MIN, RING_SECONDS, REPEAT_MINUTES, MAX_REPEATS, SNOOZE_MINUTES, MIN_LEAD_SECONDS } from '../shared/constants.js';
import * as db from './db.js';

const OFFSCREEN_PATH = 'offscreen/offscreen.html';

/**
 * Ensures the offscreen audio playback document exists.
 */
async function ensureOffscreenDocument() {
  try {
    if (await chrome.offscreen.hasDocument()) {
      return;
    }
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Synthesize reminder alarm tone via Web Audio API'
    });
  } catch (err) {
    console.warn('[KCN Reminders] Failed to create offscreen document:', err);
  }
}

/**
 * Sends a command to play sound in the offscreen document if enabled.
 */
async function playSound() {
  try {
    const settings = await chrome.storage.local.get({ soundEnabled: true });
    if (!settings.soundEnabled) return;

    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ type: MESSAGES.AUDIO_PLAY_ALARM }).catch(() => {});
  } catch (err) {
    console.warn('[KCN Reminders] Sound playback error:', err);
  }
}

/**
 * Sends a command to stop sound in the offscreen document.
 * @param {boolean} force Whether to force stop all sounds.
 */
async function stopSound(force = false) {
  try {
    if (await chrome.offscreen.hasDocument()) {
      chrome.runtime.sendMessage({ type: MESSAGES.AUDIO_STOP_ALARM, force }).catch(() => {});
    }
  } catch (err) {
    console.warn('[KCN Reminders] Stop sound error:', err);
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
 */
export async function refreshBadge() {
  try {
    const todos = await db.getTodos();
    const now = Date.now();
    // Count todos that are actively ringing or past due and not completed
    const dueCount = todos.filter((t) => !t.done && (t.ringing || (typeof t.remindAt === 'number' && t.remindAt <= now))).length;

    if (dueCount > 0) {
      await chrome.action.setBadgeText({ text: String(dueCount) });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.warn('[KCN Reminders] Failed to update badge:', err);
  }
}

/**
 * Clears all alarms associated with a specific todo ID.
 * @param {string} todoId 
 */
export async function clearTodoAlarms(todoId) {
  try {
    await chrome.alarms.clear(`todo:${todoId}`);
    await chrome.alarms.clear(`pre:${todoId}`);
    await chrome.alarms.clear(`stop:${todoId}`);
    await chrome.alarms.clear(`repeat:${todoId}`);
    await stopSound(true);
    await chrome.notifications.clear(`alarm:${todoId}`);
    await chrome.notifications.clear(`pre:${todoId}`);
  } catch (err) {
    console.warn('[KCN Reminders] Failed to clear alarms:', err);
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

  if (todo.done || !todo.remindAt) {
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

  // 5-minute pre-alert (only if reminder is at least 5 minutes away)
  const preWhen = todo.remindAt - (PRE_ALERT_MIN * 60 * 1000);
  if (preWhen > now + (MIN_LEAD_SECONDS * 1000) && !todo.preReminded) {
    chrome.alarms.create(`pre:${todo.id}`, { when: preWhen });
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
    if (!todo || todo.done || todo.preReminded) return;

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
    if (!todo || todo.done) {
      await clearTodoAlarms(todoId);
      return;
    }

    const newRingCount = (todo.ringCount || 0) + 1;
    const now = Date.now();

    await db.updateTodo(todoId, {
      ringing: true,
      ringCount: newRingCount,
      lastRingAt: now,
      reminded: true
    });

    // Schedule stop sound in 60s
    chrome.alarms.create(`stop:${todoId}`, { when: now + (RING_SECONDS * 1000) });

    // Schedule next repeat in 5 min
    chrome.alarms.create(`repeat:${todoId}`, { when: now + (REPEAT_MINUTES * 60 * 1000) });

    // Play synthetic sound
    await playSound();

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
    if (!todo || todo.done || !todo.ringing) {
      await clearTodoAlarms(todoId);
      return;
    }

    if ((todo.ringCount || 0) < MAX_REPEATS) {
      // Ring again
      const newRingCount = (todo.ringCount || 0) + 1;
      const now = Date.now();

      await db.updateTodo(todoId, {
        ringCount: newRingCount,
        lastRingAt: now
      });

      chrome.alarms.create(`stop:${todoId}`, { when: now + (RING_SECONDS * 1000) });
      chrome.alarms.create(`repeat:${todoId}`, { when: now + (REPEAT_MINUTES * 60 * 1000) });

      await playSound();

      broadcast({
        type: MESSAGES.ALARM_RINGING,
        payload: {
          todo: { ...todo, ringCount: newRingCount },
          isMissed: false
        }
      });
    } else {
      // Reached MAX_REPEATS: stop sound but keep banner
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
 * Snoozes an active alarm for 5 minutes.
 * @param {string} todoId 
 */
export async function snoozeAlarm(todoId) {
  try {
    const now = Date.now();
    const snoozeTime = now + (SNOOZE_MINUTES * 60 * 1000);

    await db.updateTodo(todoId, {
      ringing: false,
      snoozedUntil: snoozeTime,
      remindAt: snoozeTime,
      reminded: false,
      preReminded: true, // No pre-alert for 5m snooze
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
 * Fires missed reminders immediately.
 */
export async function rehydrateAllReminders() {
  try {
    const todos = await db.getTodos();
    const now = Date.now();

    for (const todo of todos) {
      if (todo.done) {
        await clearTodoAlarms(todo.id);
        continue;
      }

      if (todo.ringing) {
        // Still marked ringing from earlier session
        if ((todo.ringCount || 0) < MAX_REPEATS) {
          await startRinging(todo.id, true);
        }
        continue;
      }

      if (typeof todo.remindAt === 'number') {
        if (todo.remindAt <= now && !todo.reminded) {
          // Passed while Chrome was closed
          await startRinging(todo.id, true);
        } else if (todo.remindAt > now) {
          await scheduleReminder(todo);
        }
      }
    }

    await refreshBadge();
  } catch (err) {
    console.error('[KCN Reminders] Rehydration failed:', err);
  }
}

// Global Chrome Alarms Listener
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

// Chrome Notifications Button Click Listener
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

// Chrome Notifications Closed Listener (stop audio on notification dismissal)
chrome.notifications.onClosed.addListener(async (notificationId) => {
  if (notificationId.startsWith('alarm:')) {
    await stopSound(false);
  }
});
