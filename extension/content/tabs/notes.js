// © 2026 Kushal Parajuli

/**
 * Notes Tab component for Kam Chai Nabirsa.
 * Injected as a content script inside the Shadow DOM without dynamic imports.
 * Supports text notes, image clips, live search, pinning, inline editing,
 * 5-second undo toast, and UTF-8 .txt / image downloads.
 */

(function () {
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
  const MAX_TEXT_CHARS = 20000;
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  const MESSAGES = {
    NOTE_LIST: 'NOTE_LIST',
    NOTE_ADD: 'NOTE_ADD',
    NOTE_UPDATE: 'NOTE_UPDATE',
    NOTE_DELETE: 'NOTE_DELETE',
    NOTE_PIN: 'NOTE_PIN',
    NOTES_CLEAR: 'NOTES_CLEAR',
    NOTE_GET_FULL: 'NOTE_GET_FULL',
    NOTES_CHANGED: 'NOTES_CHANGED'
  };

  /**
   * Generates a safe file slug from text.
   * @param {string} text 
   * @param {number} [maxLen=30] 
   * @returns {string}
   */
  function slugify(text, maxLen = 30) {
    if (!text || typeof text !== 'string') return '';
    return text
      .slice(0, maxLen)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Formats a date for file names.
   * @param {Date|number} date 
   * @param {boolean} [includeTime=true] 
   * @returns {string}
   */
  function formatDateSlug(date, includeTime = true) {
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
   * Builds a safe file name for downloads.
   * @param {string} prefix 
   * @param {Date|number} date 
   * @param {string} ext 
   * @param {string} [slugText] 
   * @returns {string}
   */
  function safeFileName(prefix, date, ext, slugText = '') {
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
   * Formats a single text note with Windows line endings (\r\n).
   * @param {{ text?: string }} note 
   * @returns {string}
   */
  function buildNoteTxt(note) {
    if (!note || typeof note.text !== 'string') return '';
    return note.text.replace(/\r?\n/g, '\r\n') + '\r\n';
  }

  /**
   * Builds the master .txt export for all notes.
   * @param {Array<object>} notes 
   * @param {Date|number} [now=new Date()] 
   * @returns {string}
   */
  function buildAllNotesTxt(notes = [], now = new Date()) {
    const d = now instanceof Date ? now : new Date(now || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const exportDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    let out = `Kam Chai Nabirsa - notes export - © 2026 Kushal Parajuli\r\n`;
    out += `Export Date: ${exportDateStr}\r\n`;
    out += `----------------------------------------\r\n`;

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

  /**
   * Formats a human-readable file size.
   * @param {number} bytes 
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Formats note timestamp for cards.
   * @param {number} epochMs 
   * @returns {string}
   */
  function formatNoteTime(epochMs) {
    if (!epochMs) return '';
    const d = new Date(epochMs);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());

    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return `Today, ${hh}:${min}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${hh}:${min}`;
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[d.getMonth()]} ${d.getDate()}, ${hh}:${min}`;
  }

  /**
   * Converts a File or Blob to a base64 data URL.
   * @param {Blob|File} file 
   * @returns {Promise<string>}
   */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Generates a thumbnail image (max 320px on longest side, JPEG quality 0.8).
   * @param {string} dataUrl 
   * @returns {Promise<string>}
   */
  function createThumbnail(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 320;
        let width = img.naturalWidth || img.width || maxDim;
        let height = img.naturalHeight || img.height || maxDim;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const thumbUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(thumbUrl);
      };
      img.onerror = () => reject(new Error('Failed to process image thumbnail'));
      img.src = dataUrl;
    });
  }

  /**
   * Converts a data URL to a PNG Blob via canvas for clipboard copying.
   * @param {string} dataUrl 
   * @returns {Promise<Blob>}
   */
  function dataUrlToPngBlob(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to encode PNG for clipboard'));
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Failed to load image for copying'));
      img.src = dataUrl;
    });
  }

  /**
   * Triggers a browser download using a temporary anchor tag.
   * @param {Blob} blob 
   * @param {string} filename 
   */
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /**
   * Initializes the Notes Tab inside the given pane element.
   * @param {{ paneElement: HTMLElement }} config 
   */
  function initNotesTab({ paneElement }) {
    if (!paneElement) return;

    let allNotes = [];
    let searchQuery = '';
    let pendingDeleteTimeout = null;
    let pendingDeleteNote = null;
    let errorClearTimeout = null;

    // Build Component DOM
    paneElement.innerHTML = `
      <div class="kcn-notes-container">
        <!-- Error Banner -->
        <div class="kcn-notes-error kcn-hidden" role="alert" aria-live="assertive"></div>

        <!-- Header Actions: Search, Download All, Clear All -->
        <div class="kcn-notes-header">
          <div class="kcn-notes-search-wrap">
            <svg class="kcn-notes-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" class="kcn-notes-search" placeholder="Search notes..." aria-label="Search notes">
          </div>
          <div class="kcn-notes-header-actions">
            <button class="kcn-icon-btn kcn-download-all-btn" title="Download all notes (.txt)" aria-label="Download all notes as text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
            <button class="kcn-icon-btn kcn-clear-all-btn" title="Clear all notes" aria-label="Clear all notes">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Note Input Area -->
        <div class="kcn-notes-input-area">
          <textarea class="kcn-notes-textarea" placeholder="Write a note... (Ctrl+Enter to save, paste images or text)" rows="2" maxlength="${MAX_TEXT_CHARS}"></textarea>
          
          <!-- Drop / Paste Zone -->
          <div class="kcn-notes-dropzone" tabindex="0" role="region" aria-label="Drop or paste image file here">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span class="kcn-notes-drop-hint">Drop image, paste (Ctrl+V), or</span>
            <label class="kcn-notes-file-btn">
              Choose image
              <input type="file" class="kcn-notes-file-input" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
            </label>
          </div>

          <!-- Input Footer: Character Counter & Save Note Button -->
          <div class="kcn-notes-input-footer">
            <span class="kcn-notes-char-count"></span>
            <button class="kcn-notes-save-btn" disabled>Save note</button>
          </div>
        </div>

        <!-- Scrollable Notes List -->
        <div class="kcn-notes-scroll-area">
          <div class="kcn-notes-list"></div>
          <div class="kcn-notes-empty kcn-hidden">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <div class="kcn-notes-empty-title">No notes yet</div>
            <div class="kcn-notes-empty-desc">Save text snippets or paste clipboard images directly here.</div>
          </div>
        </div>

        <!-- 5-Second Undo Toast -->
        <div class="kcn-toast kcn-hidden" id="kcn-notes-toast" role="status" aria-live="polite">
          <span class="kcn-toast-text" id="kcn-notes-toast-text">Note deleted</span>
          <button type="button" class="kcn-toast-undo-btn" id="kcn-notes-undo-btn">Undo</button>
        </div>

        <!-- Clear Notes Modal Confirmation Dialog -->
        <div class="kcn-notes-modal-overlay kcn-hidden">
          <div class="kcn-notes-modal">
            <div class="kcn-notes-modal-title">Clear All Notes</div>
            <div class="kcn-notes-modal-body">Are you sure you want to delete your notes?</div>
            <label class="kcn-notes-modal-checkbox-label">
              <input type="checkbox" class="kcn-notes-modal-checkbox">
              Also delete pinned notes
            </label>
            <div class="kcn-notes-modal-actions">
              <button class="kcn-modal-btn kcn-modal-cancel">Cancel</button>
              <button class="kcn-modal-btn kcn-modal-confirm-delete">Clear notes</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Element References
    const errorBanner = paneElement.querySelector('.kcn-notes-error');
    const searchInput = paneElement.querySelector('.kcn-notes-search');
    const downloadAllBtn = paneElement.querySelector('.kcn-download-all-btn');
    const clearAllBtn = paneElement.querySelector('.kcn-clear-all-btn');
    const textarea = paneElement.querySelector('.kcn-notes-textarea');
    const dropzone = paneElement.querySelector('.kcn-notes-dropzone');
    const fileInput = paneElement.querySelector('.kcn-notes-file-input');
    const saveBtn = paneElement.querySelector('.kcn-notes-save-btn');
    const charCount = paneElement.querySelector('.kcn-notes-char-count');
    const notesList = paneElement.querySelector('.kcn-notes-list');
    const emptyState = paneElement.querySelector('.kcn-notes-empty');
    const toast = paneElement.querySelector('#kcn-notes-toast');
    const toastText = paneElement.querySelector('#kcn-notes-toast-text');
    const undoBtn = paneElement.querySelector('#kcn-notes-undo-btn');
    const modalOverlay = paneElement.querySelector('.kcn-notes-modal-overlay');
    const modalCheckbox = paneElement.querySelector('.kcn-notes-modal-checkbox');
    const modalCancelBtn = paneElement.querySelector('.kcn-modal-cancel');
    const modalConfirmBtn = paneElement.querySelector('.kcn-modal-confirm-delete');

    /**
     * Sends a runtime message with timeout and context-invalidated handling.
     * @param {string} type 
     * @param {any} [payload] 
     * @returns {Promise<any>}
     */
    function sendMsg(type, payload = null) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Request timed out. Please try again.'));
          }
        }, 6000);

        try {
          if (!chrome.runtime?.id) {
            clearTimeout(timer);
            settled = true;
            reject(new Error('Extension was reloaded. Please refresh this page.'));
            return;
          }

          chrome.runtime.sendMessage({ type, payload }, (res) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message || '';
              if (msg.includes('context invalidated')) {
                reject(new Error('Extension was reloaded. Please refresh this page.'));
              } else {
                reject(new Error(msg));
              }
              return;
            }

            if (!res || !res.ok) {
              reject(new Error(res?.error || 'Unknown error occurred'));
              return;
            }

            resolve(res.data);
          });
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            if (err?.message?.includes('context invalidated')) {
              reject(new Error('Extension was reloaded. Please refresh this page.'));
            } else {
              reject(err);
            }
          }
        }
      });
    }

    /**
     * Displays a friendly error banner in the Notes tab.
     * @param {string} msg 
     */
    function showError(msg) {
      if (!errorBanner) return;
      if (errorClearTimeout) {
        clearTimeout(errorClearTimeout);
        errorClearTimeout = null;
      }
      errorBanner.textContent = msg;
      errorBanner.classList.remove('kcn-hidden');
      errorClearTimeout = setTimeout(() => {
        errorBanner.classList.add('kcn-hidden');
        errorBanner.textContent = '';
      }, 7000);
    }

    /**
     * Loads and renders all notes from the service worker.
     */
    async function loadNotes() {
      try {
        const notes = await sendMsg(MESSAGES.NOTE_LIST);
        allNotes = Array.isArray(notes) ? notes : [];
        renderNotes();
      } catch (err) {
        console.error('[KCN Notes] Failed to load notes:', err);
        showError('Failed to load notes: ' + (err?.message || 'Unknown error'));
      }
    }

    /**
     * Renders note cards according to current list and search filter.
     */
    function renderNotes() {
      if (!notesList) return;
      notesList.innerHTML = '';

      const query = searchQuery.trim().toLowerCase();
      const filtered = allNotes.filter((note) => {
        if (!query) return true;
        if (note.kind === 'text') {
          return (note.text || '').toLowerCase().includes(query);
        }
        if (note.kind === 'image') {
          return (note.fileName || 'image').toLowerCase().includes(query);
        }
        return false;
      });

      if (filtered.length === 0) {
        emptyState?.classList.remove('kcn-hidden');
        if (query) {
          emptyState.querySelector('.kcn-notes-empty-title').textContent = 'No matching notes';
          emptyState.querySelector('.kcn-notes-empty-desc').textContent = `No notes match "${searchQuery}".`;
        } else {
          emptyState.querySelector('.kcn-notes-empty-title').textContent = 'No notes yet';
          emptyState.querySelector('.kcn-notes-empty-desc').textContent = 'Save text snippets or paste clipboard images directly here.';
        }
      } else {
        emptyState?.classList.add('kcn-hidden');
      }

      for (const note of filtered) {
        // Skip rendering if note is pending deletion in toast
        if (pendingDeleteNote && pendingDeleteNote.id === note.id) {
          continue;
        }

        const card = document.createElement('div');
        card.className = `kcn-note-card ${note.pinned ? 'kcn-note-pinned' : ''}`;
        card.setAttribute('data-id', note.id);

        // Header
        const header = document.createElement('div');
        header.className = 'kcn-note-header';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'kcn-note-date';
        dateSpan.textContent = formatNoteTime(note.createdAt);
        header.appendChild(dateSpan);

        if (note.pinned) {
          const pinBadge = document.createElement('span');
          pinBadge.className = 'kcn-note-pin-badge';
          pinBadge.textContent = 'Pinned';
          header.appendChild(pinBadge);
        }

        const headerActions = document.createElement('div');
        headerActions.className = 'kcn-note-header-actions';

        // Pin button
        const pinBtn = document.createElement('button');
        pinBtn.className = `kcn-note-action-btn ${note.pinned ? 'kcn-btn-pinned' : ''}`;
        pinBtn.title = note.pinned ? 'Unpin note' : 'Pin note';
        pinBtn.setAttribute('aria-label', pinBtn.title);
        pinBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-2l-2-3V5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v7l-2 3v2z"></path>
          </svg>
        `;
        pinBtn.addEventListener('click', async () => {
          try {
            await sendMsg(MESSAGES.NOTE_PIN, { id: note.id });
            await loadNotes();
          } catch (err) {
            showError('Failed to pin note: ' + err.message);
          }
        });
        headerActions.appendChild(pinBtn);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'kcn-note-action-btn kcn-note-del-btn';
        delBtn.title = 'Delete note';
        delBtn.setAttribute('aria-label', 'Delete note');
        delBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;
        delBtn.addEventListener('click', () => {
          triggerNoteDelete(note);
        });
        headerActions.appendChild(delBtn);

        header.appendChild(headerActions);
        card.appendChild(header);

        // Body Content
        if (note.kind === 'text') {
          // Text Note Body
          const bodyWrap = document.createElement('div');
          bodyWrap.className = 'kcn-note-body';

          const textEl = document.createElement('div');
          textEl.className = 'kcn-note-text';
          textEl.textContent = note.text || '';
          bodyWrap.appendChild(textEl);

          card.appendChild(bodyWrap);

          // Footer Actions for Text Note
          const footer = document.createElement('div');
          footer.className = 'kcn-note-footer';

          // Copy button
          const copyBtn = document.createElement('button');
          copyBtn.className = 'kcn-note-btn';
          copyBtn.textContent = 'Copy';
          copyBtn.title = 'Copy text to clipboard';
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(note.text || '');
              const prev = copyBtn.textContent;
              copyBtn.textContent = 'Copied!';
              setTimeout(() => { copyBtn.textContent = prev; }, 1500);
            } catch (err) {
              showError('Failed to copy text: ' + err.message);
            }
          });
          footer.appendChild(copyBtn);

          // Edit button
          const editBtn = document.createElement('button');
          editBtn.className = 'kcn-note-btn';
          editBtn.textContent = 'Edit';
          editBtn.title = 'Edit note';
          editBtn.addEventListener('click', () => {
            activateInlineEdit(card, note);
          });
          footer.appendChild(editBtn);

          // Download .txt button
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'kcn-note-btn';
          downloadBtn.textContent = 'Download .txt';
          downloadBtn.title = 'Download as .txt file';
          downloadBtn.addEventListener('click', () => {
            const txt = buildNoteTxt(note);
            const fname = safeFileName('note', note.createdAt, 'txt', (note.text || '').slice(0, 30));
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            triggerDownload(blob, fname);
          });
          footer.appendChild(downloadBtn);

          card.appendChild(footer);
        } else if (note.kind === 'image') {
          // Image Note Body
          const bodyWrap = document.createElement('div');
          bodyWrap.className = 'kcn-note-img-body';

          if (note.thumb) {
            const thumbWrap = document.createElement('div');
            thumbWrap.className = 'kcn-note-thumb-wrap';
            const img = document.createElement('img');
            img.className = 'kcn-note-thumb';
            img.src = note.thumb;
            img.alt = note.fileName || 'Pasted image';
            thumbWrap.appendChild(img);
            bodyWrap.appendChild(thumbWrap);
          }

          const infoRow = document.createElement('div');
          infoRow.className = 'kcn-note-img-info';
          infoRow.textContent = `${note.fileName || 'Pasted image'} (${formatFileSize(note.size)})`;
          bodyWrap.appendChild(infoRow);

          card.appendChild(bodyWrap);

          // Footer Actions for Image Note
          const footer = document.createElement('div');
          footer.className = 'kcn-note-footer';

          // Copy image button
          const copyImgBtn = document.createElement('button');
          copyImgBtn.className = 'kcn-note-btn';
          copyImgBtn.textContent = 'Copy image';
          copyImgBtn.title = 'Copy image to clipboard';
          copyImgBtn.addEventListener('click', async () => {
            const prev = copyImgBtn.textContent;
            copyImgBtn.textContent = 'Copying...';
            try {
              const fullData = await sendMsg(MESSAGES.NOTE_GET_FULL, { id: note.id });
              if (!fullData?.dataUrl) {
                throw new Error('Image data not returned');
              }
              const pngBlob = await dataUrlToPngBlob(fullData.dataUrl);
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob })
              ]);
              copyImgBtn.textContent = 'Copied!';
              setTimeout(() => { copyImgBtn.textContent = prev; }, 1500);
            } catch (err) {
              console.warn('[KCN Notes] Direct image copy failed:', err);
              copyImgBtn.textContent = prev;
              showError("Unable to copy image directly in this tab. Please use 'Download image' instead.");
            }
          });
          footer.appendChild(copyImgBtn);

          // Download image button
          const downloadImgBtn = document.createElement('button');
          downloadImgBtn.className = 'kcn-note-btn';
          downloadImgBtn.textContent = 'Download image';
          downloadImgBtn.title = 'Download image file';
          downloadImgBtn.addEventListener('click', async () => {
            try {
              const fullData = await sendMsg(MESSAGES.NOTE_GET_FULL, { id: note.id });
              if (!fullData?.dataUrl) {
                throw new Error('Image data not returned');
              }
              // Convert dataUrl to blob
              const res = await fetch(fullData.dataUrl);
              const blob = await res.blob();
              let ext = 'png';
              if (note.mimeType === 'image/jpeg') ext = 'jpg';
              else if (note.mimeType === 'image/webp') ext = 'webp';
              else if (note.mimeType === 'image/gif') ext = 'gif';

              const fname = safeFileName('note-image', note.createdAt, ext);
              triggerDownload(blob, fname);
            } catch (err) {
              showError('Failed to download image: ' + err.message);
            }
          });
          footer.appendChild(downloadImgBtn);

          card.appendChild(footer);
        }

        notesList.appendChild(card);
      }
    }

    /**
     * Sets up inline editing mode for a text note.
     * @param {HTMLElement} card 
     * @param {object} note 
     */
    function activateInlineEdit(card, note) {
      const body = card.querySelector('.kcn-note-body');
      const footer = card.querySelector('.kcn-note-footer');
      if (!body) return;

      body.style.display = 'none';
      if (footer) footer.style.display = 'none';

      const editWrap = document.createElement('div');
      editWrap.className = 'kcn-note-edit-wrap';

      const editTextarea = document.createElement('textarea');
      editTextarea.className = 'kcn-note-edit-textarea';
      editTextarea.value = note.text || '';
      editTextarea.rows = 3;
      editTextarea.maxLength = MAX_TEXT_CHARS;
      editWrap.appendChild(editTextarea);

      const editActions = document.createElement('div');
      editActions.className = 'kcn-note-edit-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'kcn-note-btn kcn-note-btn-secondary';
      cancelBtn.textContent = 'Cancel (Esc)';
      cancelBtn.addEventListener('click', () => {
        card.removeChild(editWrap);
        body.style.display = '';
        if (footer) footer.style.display = '';
      });

      const saveEditBtn = document.createElement('button');
      saveEditBtn.className = 'kcn-note-btn kcn-note-btn-primary';
      saveEditBtn.textContent = 'Save (Ctrl+Enter)';

      async function commitEdit() {
        const newText = editTextarea.value.trim();
        if (!newText) {
          showError('Note text cannot be empty');
          return;
        }
        try {
          await sendMsg(MESSAGES.NOTE_UPDATE, { id: note.id, text: newText });
          await loadNotes();
        } catch (err) {
          showError('Failed to update note: ' + err.message);
        }
      }

      saveEditBtn.addEventListener('click', commitEdit);

      editTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelBtn.click();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commitEdit();
        }
      });

      editActions.appendChild(cancelBtn);
      editActions.appendChild(saveEditBtn);
      editWrap.appendChild(editActions);
      card.appendChild(editWrap);

      editTextarea.focus();
    }

    /**
     * Executes note deletion with a 5-second undo toast.
     * @param {object} note 
     */
    function triggerNoteDelete(note) {
      if (pendingDeleteTimeout) {
        clearTimeout(pendingDeleteTimeout);
        // Commit prior deletion immediately
        commitPendingDelete();
      }

      pendingDeleteNote = note;
      renderNotes();

      if (toast && toastText) {
        toastText.textContent = `Deleted note`;
        toast.classList.remove('kcn-hidden');
      }

      pendingDeleteTimeout = setTimeout(() => {
        commitPendingDelete();
      }, 5000);
    }

    /**
     * Commits the pending deletion to the service worker.
     */
    async function commitPendingDelete() {
      if (!pendingDeleteNote) return;
      const noteToDel = pendingDeleteNote;
      pendingDeleteNote = null;
      if (pendingDeleteTimeout) {
        clearTimeout(pendingDeleteTimeout);
        pendingDeleteTimeout = null;
      }
      toast?.classList.add('kcn-hidden');

      try {
        await sendMsg(MESSAGES.NOTE_DELETE, { id: noteToDel.id });
      } catch (err) {
        console.error('[KCN Notes] Failed to delete note:', err);
        showError('Failed to delete note: ' + err.message);
        loadNotes();
      }
    }

    // Undo button click
    undoBtn?.addEventListener('click', () => {
      if (pendingDeleteTimeout) {
        clearTimeout(pendingDeleteTimeout);
        pendingDeleteTimeout = null;
      }
      pendingDeleteNote = null;
      toast?.classList.add('kcn-hidden');
      renderNotes();
    });

    /**
     * Handles saving an image file as an image note.
     * @param {File|Blob} file 
     * @param {string} [fileName] 
     */
    async function handleImageUpload(file, fileName = null) {
      if (!file) return;

      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        showError('Only PNG, JPEG, GIF, and WEBP images are supported (SVG is not allowed).');
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        showError(`Image exceeds 10 MB limit (file is ${sizeMb} MB).`);
        return;
      }

      try {
        const dataUrl = await fileToDataUrl(file);
        const thumb = await createThumbnail(dataUrl);

        await sendMsg(MESSAGES.NOTE_ADD, {
          kind: 'image',
          dataUrl,
          mimeType: file.type,
          thumb,
          fileName: fileName || file.name || 'Pasted image',
          size: file.size,
          pinned: false
        });

        await loadNotes();
      } catch (err) {
        console.error('[KCN Notes] Image upload failed:', err);
        showError('Failed to save image note: ' + (err?.message || 'Unknown error'));
      }
    }

    /**
     * Saves a text note.
     */
    async function handleSaveTextNote() {
      const text = textarea.value.trim();
      if (!text) {
        showError('Note text cannot be empty');
        return;
      }
      if (text.length > MAX_TEXT_CHARS) {
        showError(`Note exceeds ${MAX_TEXT_CHARS} characters limit.`);
        return;
      }

      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        await sendMsg(MESSAGES.NOTE_ADD, {
          kind: 'text',
          text,
          size: new Blob([text]).size,
          pinned: false
        });

        textarea.value = '';
        updateInputState();
        await loadNotes();
      } catch (err) {
        console.error('[KCN Notes] Save note failed:', err);
        showError('Failed to save note: ' + (err?.message || 'Unknown error'));
      } finally {
        saveBtn.textContent = 'Save note';
        updateInputState();
      }
    }

    function updateInputState() {
      const text = textarea?.value || '';
      const len = text.trim().length;
      if (saveBtn) {
        saveBtn.disabled = len === 0;
      }
      if (charCount) {
        if (text.length > 15000) {
          charCount.textContent = `${text.length} / ${MAX_TEXT_CHARS}`;
          charCount.classList.toggle('kcn-char-warning', text.length > 19000);
        } else {
          charCount.textContent = '';
        }
      }
    }

    textarea?.addEventListener('input', updateInputState);

    // Ctrl+Enter to save note
    textarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!saveBtn?.disabled) {
          handleSaveTextNote();
        }
      }
    });

    saveBtn?.addEventListener('click', handleSaveTextNote);

    // File input picker
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImageUpload(file, file.name);
        e.target.value = ''; // Reset
      }
    });

    // Drag & Drop on drop zone
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('kcn-dropzone-active');
    });

    dropzone?.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.classList.remove('kcn-dropzone-active');
    });

    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('kcn-dropzone-active');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        handleImageUpload(file, file.name);
      }
    });

    // Paste handling on textarea and dropzone: checks for image clipboard data
    function handlePasteEvent(e) {
      const clipboard = e.clipboardData;
      if (!clipboard) return;

      // Check if clipboard contains an image file
      const items = clipboard.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              handleImageUpload(file, 'Pasted image');
              return;
            }
          }
        }
      }
      // If plain text was pasted into textarea, standard browser paste occurs
    }

    textarea?.addEventListener('paste', handlePasteEvent);
    dropzone?.addEventListener('paste', handlePasteEvent);

    // Live search input
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value || '';
      renderNotes();
    });

    // Download All Notes (.txt)
    downloadAllBtn?.addEventListener('click', () => {
      const textNotes = allNotes.filter((n) => n.kind === 'text');
      if (textNotes.length === 0) {
        showError('No text notes to export.');
        return;
      }

      const txt = buildAllNotesTxt(allNotes, new Date());
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const fname = `kam-chai-nabirsa-notes-${dateStr}.txt`;

      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      triggerDownload(blob, fname);
    });

    // Clear All Notes Modal
    clearAllBtn?.addEventListener('click', () => {
      modalCheckbox.checked = false;
      modalOverlay.classList.remove('kcn-hidden');
    });

    modalCancelBtn?.addEventListener('click', () => {
      modalOverlay.classList.add('kcn-hidden');
    });

    modalConfirmBtn?.addEventListener('click', async () => {
      const alsoDeletePinned = Boolean(modalCheckbox?.checked);
      modalOverlay.classList.add('kcn-hidden');
      try {
        await sendMsg(MESSAGES.NOTES_CLEAR, { alsoDeletePinned });
        await loadNotes();
      } catch (err) {
        showError('Failed to clear notes: ' + err.message);
      }
    });

    // Broadcast Listener for NOTES_CHANGED
    const onMessageListener = (msg) => {
      if (msg?.type === MESSAGES.NOTES_CHANGED) {
        loadNotes();
      }
    };
    chrome.runtime.onMessage.addListener(onMessageListener);

    // Initial Load
    loadNotes();

    return {
      reload: loadNotes,
      cleanup: () => {
        if (pendingDeleteTimeout) {
          commitPendingDelete();
        }
        chrome.runtime.onMessage.removeListener(onMessageListener);
      }
    };
  }

  // Export to isolated window scope
  window.__kcn_initNotesTab = initNotesTab;
})();
