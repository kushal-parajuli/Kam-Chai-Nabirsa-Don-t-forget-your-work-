// © 2026 Kushal Parajuli

/**
 * Pure functions for notes export formatting and file name generation.
 * Handles Windows line endings (\r\n) and safe slug generation.
 */

/**
 * Generates a safe file slug from text.
 * Truncates to maxLen, converts to lowercase, preserves only a-z, 0-9, and hyphens.
 * @param {string} text 
 * @param {number} [maxLen=30] 
 * @returns {string}
 */
export function slugify(text, maxLen = 30) {
  if (!text || typeof text !== 'string') return '';
  return text
    .slice(0, maxLen)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Formats a date into YYYY-MM-DD or YYYY-MM-DD-HHmm format.
 * @param {Date|number} date 
 * @param {boolean} [includeTime=true] 
 * @returns {string}
 */
export function formatDateSlug(date, includeTime = true) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  if (!includeTime) {
    return `${yyyy}-${mm}-${dd}`;
  }
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

/**
 * Builds a safe file name for downloaded notes.
 * @param {string} prefix e.g. "note", "note-image", "kam-chai-nabirsa-notes"
 * @param {Date|number} date 
 * @param {string} ext e.g. "txt", "png", "jpg"
 * @param {string} [slugText] optional text snippet to slugify
 * @returns {string}
 */
export function safeFileName(prefix, date, ext, slugText = '') {
  const cleanExt = (ext || 'txt').replace(/^\./, '');
  const slug = slugify(slugText, 30);
  const isAllNotes = prefix === 'kam-chai-nabirsa-notes';
  const dateStr = formatDateSlug(date, !isAllNotes);

  if (slug) {
    return `${prefix}-${slug}-${dateStr}.${cleanExt}`;
  }
  return `${prefix}-${dateStr}.${cleanExt}`;
}

/**
 * Formats a single text note into UTF-8 text with Windows line endings (\r\n).
 * @param {{ text?: string }} note 
 * @returns {string}
 */
export function buildNoteTxt(note) {
  if (!note || typeof note.text !== 'string') return '';
  return note.text.replace(/\r?\n/g, '\r\n') + '\r\n';
}

/**
 * Formats a collection of notes into one master .txt export.
 * Follows the spec:
 * 1. Header: "Kam Chai Nabirsa - notes export - © 2026 Kushal Parajuli\r\n"
 * 2. Export date
 * 3. Every note separated by 40 dashes, pinned first, then newest first
 * 4. Image notes listed as "[image note: <fileName or 'pasted image'>, <date>]\r\n"
 * 5. Uses \r\n line endings throughout
 * @param {Array<object>} notes 
 * @param {Date|number} [now=new Date()] 
 * @returns {string}
 */
export function buildAllNotesTxt(notes = [], now = new Date()) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const exportDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  let out = `Kam Chai Nabirsa - notes export - © 2026 Kushal Parajuli\r\n`;
  out += `Export Date: ${exportDateStr}\r\n`;
  out += `----------------------------------------\r\n`;

  // Sort pinned first, then newest first
  const sorted = [...notes].sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) {
      return b.pinned ? 1 : -1;
    }
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  for (const note of sorted) {
    const noteDate = new Date(note.createdAt || Date.now());
    const noteDateStr = `${noteDate.getFullYear()}-${pad(noteDate.getMonth() + 1)}-${pad(noteDate.getDate())} ${pad(noteDate.getHours())}:${pad(noteDate.getMinutes())}`;

    if (note.kind === 'image') {
      const imgName = note.fileName || 'pasted image';
      out += `[image note: ${imgName}, ${noteDateStr}]\r\n`;
    } else {
      const pinTag = note.pinned ? ' [Pinned]' : '';
      out += `Date: ${noteDateStr}${pinTag}\r\n\r\n`;
      const body = (note.text || '').replace(/\r?\n/g, '\r\n');
      out += `${body}\r\n`;
    }
    out += `----------------------------------------\r\n`;
  }

  return out;
}
