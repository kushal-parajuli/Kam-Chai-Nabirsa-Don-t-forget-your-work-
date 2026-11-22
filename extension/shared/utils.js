// © 2026 Kushal Parajuli

/**
 * Utility functions for formatting, sanitizing, and timing.
 */

/**
 * Debounce a function call.
 * @param {Function} fn 
 * @param {number} delayMs 
 * @returns {Function}
 */
export function debounce(fn, delayMs = 150) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

/**
 * Escape HTML special characters for safe plain text rendering.
 * @param {string} str 
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Clamp a number between min and max.
 * @param {number} val 
 * @param {number} min 
 * @param {number} max 
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Converts a base64 data URL to a Blob.
 * Works in Chrome Service Worker, Offscreen, and Node.js testing environments.
 * @param {string} dataUrl 
 * @param {string} [mimeType] 
 * @returns {Promise<Blob>}
 */
export async function dataUrlToBlob(dataUrl, mimeType) {
  if (typeof fetch === 'function') {
    try {
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch (_) {}
  }
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeType || (mimeMatch ? mimeMatch[1] : 'application/octet-stream');
  const b64 = parts[1] || '';
  const bstr = atob(b64);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Converts a Blob to a base64 data URL.
 * Works in Chrome Service Worker, Offscreen, and Node.js testing environments.
 * @param {Blob} blob 
 * @param {string} [mimeType] 
 * @returns {Promise<string>}
 */
export async function blobToDataUrl(blob, mimeType) {
  if (!blob) return null;
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mime = mimeType || blob.type || 'application/octet-stream';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
