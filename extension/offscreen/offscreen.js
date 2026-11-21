import { MESSAGES } from '../shared/messages.js';

let audioCtx = null;
let beepInterval = null;
let activeAlarmsCount = 0;

/**
 * Initializes or resumes the Web Audio context.
 * @returns {AudioContext}
 */
function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Plays a single synthetic beep (880 Hz, 200ms duration).
 */
function playSingleBeep() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 tone

    // Smooth envelope: 200 ms total duration
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.setValueAtTime(0.18, now + 0.18);
    gain.gain.linearRampToValueAtTime(0, now + 0.20);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.20);
  } catch (err) {
    console.warn('[KCN Offscreen Audio] Failed to play single beep:', err);
  }
}

/**
 * Starts the repeating beep pattern (200 ms on / 300 ms off -> 500 ms period).
 */
function startAlarmSound() {
  activeAlarmsCount++;
  if (beepInterval) {
    return; // Already beeping
  }

  // Play first beep immediately
  playSingleBeep();

  // Repeat every 500ms
  beepInterval = setInterval(() => {
    playSingleBeep();
  }, 500);
}

/**
 * Stops the alarm sound pattern.
 */
function stopAlarmSound() {
  activeAlarmsCount = Math.max(0, activeAlarmsCount - 1);
  if (activeAlarmsCount === 0 && beepInterval) {
    clearInterval(beepInterval);
    beepInterval = null;

    if (audioCtx && audioCtx.state === 'running') {
      audioCtx.suspend().catch(() => {});
    }
  }
}

/**
 * Force-stops all sound immediately.
 */
function forceStopSound() {
  activeAlarmsCount = 0;
  if (beepInterval) {
    clearInterval(beepInterval);
    beepInterval = null;
  }
  if (audioCtx && audioCtx.state === 'running') {
    audioCtx.suspend().catch(() => {});
  }
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGES.AUDIO_PLAY_ALARM) {
    startAlarmSound();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === MESSAGES.AUDIO_STOP_ALARM) {
    if (message.force) {
      forceStopSound();
    } else {
      stopAlarmSound();
    }
    sendResponse({ ok: true });
    return false;
  }
});
