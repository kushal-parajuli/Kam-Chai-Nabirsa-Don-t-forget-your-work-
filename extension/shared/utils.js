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
