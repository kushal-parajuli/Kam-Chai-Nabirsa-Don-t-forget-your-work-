// © 2026 Kushal Parajuli

import { MESSAGES } from '../shared/messages.js';

let audioElement = null;

/**
 * Creates an in-memory 16-bit PCM mono WAV blob URL.
 * Pattern: 200ms 880 Hz tone + 300ms silence (500ms cycle).
 * Generating a PCM WAV binary and playing it via an HTMLAudioElement bypasses
 * the Web Audio API autoplay suspension in extension background/offscreen contexts.
 * @returns {string} Object URL for the generated WAV
 */
function createAlarmWavUrl() {
  const sampleRate = 44100;
  const toneDuration = 0.20; // 200ms
  const silenceDuration = 0.30; // 300ms
  const totalDuration = toneDuration + silenceDuration; // 500ms
  const numSamples = Math.floor(sampleRate * totalDuration);
  const toneSamples = Math.floor(sampleRate * toneDuration);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Helper to write ASCII strings
  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF Chunk
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt Subchunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data Subchunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Synthesize PCM samples (880 Hz sine with 15ms smooth attack/release)
  const attackReleaseSamples = Math.floor(sampleRate * 0.015);
  const freq = 880;
  const volume = 0.35; // Comfortable audible volume
  let offset = 44;

  for (let i = 0; i < numSamples; i++) {
    let sample = 0;
    if (i < toneSamples) {
      const t = i / sampleRate;
      let envelope = 1.0;
      if (i < attackReleaseSamples) {
        envelope = i / attackReleaseSamples;
      } else if (i > toneSamples - attackReleaseSamples) {
        envelope = (toneSamples - i) / attackReleaseSamples;
      }
      sample = Math.sin(2 * Math.PI * freq * t) * envelope * volume;
    }
    // Clamp to 16-bit signed range [-32768, 32767]
    const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Returns the cached Audio element initialized with looped WAV tone.
 * @returns {HTMLAudioElement}
 */
function getAudioElement() {
  if (!audioElement) {
    const wavUrl = createAlarmWavUrl();
    audioElement = new Audio(wavUrl);
    audioElement.loop = true;
  }
  return audioElement;
}

/**
 * Starts alarm sound playback.
 */
function playAlarm() {
  try {
    const audio = getAudioElement();
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.error('[KCN Offscreen Audio] Audio play error:', err.name, err.message);
      });
    }
  } catch (err) {
    console.error('[KCN Offscreen Audio] Failed to play audio:', err);
  }
}

/**
 * Stops alarm sound playback.
 */
function stopAlarm() {
  try {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
  } catch (err) {
    console.error('[KCN Offscreen Audio] Failed to stop audio:', err);
  }
}

// Notify service worker that offscreen document is mounted and ready for commands
chrome.runtime.sendMessage({
  target: 'service_worker',
  type: MESSAGES.OFFSCREEN_READY || 'OFFSCREEN_READY'
}).catch((err) => {
  // Service worker might already be listening or woke up
});

// Targeted message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') {
    return false;
  }

  if (message.type === MESSAGES.AUDIO_PLAY_ALARM) {
    playAlarm();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MESSAGES.AUDIO_STOP_ALARM) {
    stopAlarm();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
