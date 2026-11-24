// © 2026 Kushal Parajuli

/**
 * Downloader Tab component for Kam Chai Nabirsa (Phase 7 Real Downloads).
 * Injected as a content script inside the Shadow DOM without dynamic imports.
 * Communicates with the local helper exclusively via the background service worker.
 */

(function () {
  const MESSAGES = {
    HELPER_PING: 'HELPER_PING',
    DOWNLOAD_START: 'DOWNLOAD_START',
    DOWNLOAD_STATUS: 'DOWNLOAD_STATUS',
    DOWNLOAD_CANCEL: 'DOWNLOAD_CANCEL',
    DOWNLOAD_LIST: 'DOWNLOAD_LIST',
    DOWNLOAD_CLEAR: 'DOWNLOAD_CLEAR',
    DOWNLOAD_OPEN_FOLDER: 'DOWNLOAD_OPEN_FOLDER',
    DOWNLOADS_CHANGED: 'DOWNLOADS_CHANGED'
  };

  /**
   * Initializes the Downloader Tab inside the given pane element.
   * @param {{ paneElement: HTMLElement, openSettings: Function }} config 
   */
  function initDownloaderTab({ paneElement, openSettings }) {
    if (!paneElement) return;

    let selectedType = 'video'; // 'video' | 'audio'
    let pingInterval = null;
    let activePollInterval = null;
    let isChecking = false;
    let currentJobs = [];

    paneElement.innerHTML = `
      <div class="kcn-dl-container">
        <!-- Status Indicator Banner -->
        <div class="kcn-dl-status-banner" id="kcn-dl-status-banner">
          <div class="kcn-dl-status-left">
            <span class="kcn-dl-status-dot kcn-dot-checking"></span>
            <span class="kcn-dl-status-text" id="kcn-dl-status-text">Checking helper...</span>
          </div>
          <div class="kcn-dl-status-right" id="kcn-dl-status-right"></div>
        </div>

        <!-- Download Input Form -->
        <div class="kcn-dl-form">
          <div class="kcn-dl-input-wrap">
            <input type="text" class="kcn-dl-input" id="kcn-dl-url-input" 
                   placeholder="Paste video or audio URL (http:// or https://)..." 
                   maxlength="2048" autocomplete="off" spellcheck="false"
                   aria-label="Media URL to download">
          </div>

          <div class="kcn-dl-controls-row">
            <!-- Format Toggle: Video (MP4) / Audio (MP3) -->
            <div class="kcn-dl-type-toggle" role="radiogroup" aria-label="Media format">
              <button type="button" class="kcn-dl-type-btn kcn-type-active" data-type="video" role="radio" aria-checked="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"></polygon>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
                Video (MP4)
              </button>
              <button type="button" class="kcn-dl-type-btn" data-type="audio" role="radio" aria-checked="false">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 18V5l12-2v13"></path>
                  <circle cx="6" cy="18" r="3"></circle>
                  <circle cx="18" cy="16" r="3"></circle>
                </svg>
                Audio (MP3)
              </button>
            </div>

            <!-- Download Button -->
            <button type="button" class="kcn-dl-submit-btn" id="kcn-dl-submit-btn">Download</button>
          </div>
        </div>

        <!-- Notice / Banner Feedback -->
        <div class="kcn-dl-feedback kcn-hidden" id="kcn-dl-feedback" role="alert"></div>

        <!-- Active Jobs / History Section -->
        <div class="kcn-dl-jobs-section">
          <div class="kcn-dl-jobs-header">
            <div class="kcn-dl-jobs-header-left">
              <span class="kcn-dl-jobs-title">Download Activity</span>
              <span class="kcn-dl-jobs-count" id="kcn-dl-jobs-count">0 items</span>
            </div>
            <div class="kcn-dl-header-actions">
              <button type="button" class="kcn-dl-header-btn" id="kcn-dl-open-folder-btn" title="Open download folder in File Explorer">Open folder</button>
              <button type="button" class="kcn-dl-header-btn" id="kcn-dl-clear-history-btn" title="Clear finished download history">Clear</button>
            </div>
          </div>

          <div class="kcn-dl-jobs-list" id="kcn-dl-jobs-list">
            <!-- Jobs or empty state injected dynamically -->
          </div>
        </div>

        <!-- Responsible Use Warning Notice -->
        <div class="kcn-dl-notice">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>Use only for content you own or have permission to download.</span>
        </div>
      </div>
    `;

    // Elements
    const statusBanner = paneElement.querySelector('#kcn-dl-status-banner');
    const statusDot = paneElement.querySelector('.kcn-dl-status-dot');
    const statusText = paneElement.querySelector('#kcn-dl-status-text');
    const statusRight = paneElement.querySelector('#kcn-dl-status-right');
    const urlInput = paneElement.querySelector('#kcn-dl-url-input');
    const typeBtns = paneElement.querySelectorAll('.kcn-dl-type-btn');
    const submitBtn = paneElement.querySelector('#kcn-dl-submit-btn');
    const feedback = paneElement.querySelector('#kcn-dl-feedback');
    const jobsCount = paneElement.querySelector('#kcn-dl-jobs-count');
    const jobsList = paneElement.querySelector('#kcn-dl-jobs-list');
    const openFolderBtn = paneElement.querySelector('#kcn-dl-open-folder-btn');
    const clearHistoryBtn = paneElement.querySelector('#kcn-dl-clear-history-btn');

    let feedbackTimer = null;

    /**
     * Shows feedback banner.
     * @param {string} msg 
     * @param {'info'|'error'|'success'} [type='info'] 
     */
    function showFeedback(msg, type = 'info') {
      if (!feedback) return;
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedback.textContent = msg;
      feedback.className = `kcn-dl-feedback kcn-dl-feedback-${type}`;
      feedback.classList.remove('kcn-hidden');
      feedbackTimer = setTimeout(() => {
        feedback?.classList.add('kcn-hidden');
      }, 5000);
    }

    /**
     * Checks helper status via background service worker.
     */
    async function checkStatus() {
      if (isChecking) return;
      isChecking = true;

      try {
        if (!chrome?.runtime?.id) {
          updateStatusUI({ status: 'offline', message: 'Extension context invalidated. Please refresh.' });
          return;
        }

        chrome.runtime.sendMessage({ type: MESSAGES.HELPER_PING }, (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            updateStatusUI({ status: 'offline' });
            return;
          }
          updateStatusUI(response.data);
        });
      } catch (err) {
        updateStatusUI({ status: 'offline' });
      } finally {
        isChecking = false;
      }
    }

    /**
     * Updates the status banner UI based on ping result.
     * @param {object} data 
     */
    function updateStatusUI(data) {
      if (!statusBanner || !statusDot || !statusText || !statusRight) return;

      statusDot.className = 'kcn-dl-status-dot';
      statusRight.innerHTML = '';

      const status = data?.status || 'offline';

      if (status === 'online') {
        statusDot.classList.add('kcn-dot-online');
        statusText.textContent = 'Helper online';

        // FFmpeg badge
        const ffmpegFound = Boolean(data?.ffmpeg);
        const ffmpegBadge = document.createElement('span');
        ffmpegBadge.className = `kcn-dl-ffmpeg-badge ${ffmpegFound ? 'kcn-badge-found' : 'kcn-badge-missing'}`;
        ffmpegBadge.textContent = ffmpegFound ? 'ffmpeg found' : 'ffmpeg missing: needed for mp3';
        ffmpegBadge.title = ffmpegFound ? 'FFmpeg is installed and verified' : 'FFmpeg is required for MP3 conversion. Install via: winget install Gyan.FFmpeg';
        statusRight.appendChild(ffmpegBadge);
      } else if (status === 'token_missing' || status === 'wrong_token') {
        statusDot.classList.add('kcn-dot-amber');
        statusText.textContent = status === 'token_missing' 
          ? 'Helper online - token missing. ' 
          : 'Helper online - token wrong. ';

        const openBtn = document.createElement('button');
        openBtn.className = 'kcn-dl-link-btn';
        openBtn.textContent = 'Open Settings';
        openBtn.title = 'Open Settings to enter your helper token';
        openBtn.addEventListener('click', () => {
          if (typeof openSettings === 'function') {
            openSettings();
          }
        });
        statusRight.appendChild(openBtn);
      } else {
        statusDot.classList.add('kcn-dot-offline');
        statusText.textContent = 'Helper offline (start helper\\start-helper.bat)';
      }
    }

    /**
     * Fetches download jobs list from service worker.
     */
    function loadJobs() {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: MESSAGES.DOWNLOAD_LIST }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) return;
        currentJobs = Array.isArray(res.data) ? res.data : [];
        renderJobs();
        managePolling();
      });
    }

    /**
     * Polls active running or queued jobs.
     */
    function pollActiveJobs() {
      if (!chrome?.runtime?.id) return;
      const active = currentJobs.filter((j) => j.state === 'queued' || j.state === 'running');
      if (active.length === 0) {
        stopActivePolling();
        return;
      }

      for (const job of active) {
        chrome.runtime.sendMessage({
          type: MESSAGES.DOWNLOAD_STATUS,
          payload: { jobId: job.id }
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.ok || !res.data) return;
          const updated = res.data;
          const idx = currentJobs.findIndex((j) => j.id === updated.id);
          if (idx !== -1) {
            currentJobs[idx] = { ...currentJobs[idx], ...updated };
            updateJobElement(currentJobs[idx]);
          }
          managePolling();
        });
      }
    }

    function managePolling() {
      const hasActive = currentJobs.some((j) => j.state === 'queued' || j.state === 'running');
      if (hasActive) {
        if (!activePollInterval) {
          activePollInterval = setInterval(pollActiveJobs, 1000);
        }
      } else {
        stopActivePolling();
      }
    }

    function stopActivePolling() {
      if (activePollInterval) {
        clearInterval(activePollInterval);
        activePollInterval = null;
      }
    }

    /**
     * Renders the complete jobs list into the container.
     */
    function renderJobs() {
      if (!jobsList || !jobsCount) return;

      jobsCount.textContent = `${currentJobs.length} ${currentJobs.length === 1 ? 'item' : 'items'}`;
      jobsList.innerHTML = '';

      if (currentJobs.length === 0) {
        jobsList.classList.add('kcn-dl-empty');
        const empty = document.createElement('div');
        empty.className = 'kcn-dl-empty-state';
        empty.innerHTML = `
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <div class="kcn-dl-empty-title">Ready for downloads</div>
          <div class="kcn-dl-empty-desc">Paste any video or audio URL above to begin downloading.</div>
        `;
        jobsList.appendChild(empty);
        return;
      }

      jobsList.classList.remove('kcn-dl-empty');

      for (const job of currentJobs) {
        const itemEl = createJobElement(job);
        jobsList.appendChild(itemEl);
      }
    }

    /**
     * Creates a single job item element.
     * @param {object} job 
     * @returns {HTMLElement}
     */
    function createJobElement(job) {
      const el = document.createElement('div');
      el.className = 'kcn-dl-job-item';
      el.id = `kcn-job-${job.id}`;

      // Header row
      const header = document.createElement('div');
      header.className = 'kcn-dl-job-header';

      const title = document.createElement('div');
      title.className = 'kcn-dl-job-title';
      title.textContent = job.filename || job.url;
      title.title = job.filename ? `${job.filename} (${job.url})` : job.url;

      const pill = document.createElement('span');
      pill.className = `kcn-dl-job-pill kcn-pill-${job.state || 'queued'}`;
      pill.textContent = getPillText(job);

      header.appendChild(title);
      header.appendChild(pill);
      el.appendChild(header);

      // Progress bar (if queued or running)
      if (job.state === 'queued' || job.state === 'running') {
        const progWrap = document.createElement('div');
        progWrap.className = 'kcn-dl-progress-wrap';
        const progFill = document.createElement('div');
        progFill.className = 'kcn-dl-progress-fill';
        progFill.style.width = `${Math.min(100, Math.max(0, job.progress || 0))}%`;
        progWrap.appendChild(progFill);
        el.appendChild(progWrap);
      }

      // Footer row
      const footer = document.createElement('div');
      footer.className = 'kcn-dl-job-footer';

      const info = document.createElement('div');
      info.className = 'kcn-dl-job-file';

      if (job.state === 'error') {
        info.textContent = job.error || 'Download failed';
        info.style.color = '#dc2626';
        info.title = job.error || '';
      } else if (job.state === 'done') {
        info.textContent = job.filename ? `Saved: ${job.filename}` : 'Download complete';
        info.style.color = '#16a34a';
      } else if (job.state === 'cancelled') {
        info.textContent = 'Download cancelled';
      } else {
        const typeLabel = job.type === 'audio' ? 'Audio (MP3)' : 'Video (MP4)';
        info.textContent = `${typeLabel} • ${Math.round(job.progress || 0)}%`;
      }

      footer.appendChild(info);

      // Cancel button if active
      if (job.state === 'queued' || job.state === 'running') {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'kcn-dl-job-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          cancelJob(job.id);
        });
        footer.appendChild(cancelBtn);
      }

      el.appendChild(footer);
      return el;
    }

    /**
     * Updates an existing job item DOM element in-place to avoid full list re-renders.
     * @param {object} job 
     */
    function updateJobElement(job) {
      const el = jobsList.querySelector(`#kcn-job-${job.id}`);
      if (!el) {
        renderJobs();
        return;
      }

      const pill = el.querySelector('.kcn-dl-job-pill');
      if (pill) {
        pill.className = `kcn-dl-job-pill kcn-pill-${job.state || 'queued'}`;
        pill.textContent = getPillText(job);
      }

      const title = el.querySelector('.kcn-dl-job-title');
      if (title && job.filename) {
        title.textContent = job.filename;
        title.title = `${job.filename} (${job.url})`;
      }

      const progFill = el.querySelector('.kcn-dl-progress-fill');
      if (progFill) {
        progFill.style.width = `${Math.min(100, Math.max(0, job.progress || 0))}%`;
      }

      // If job is no longer running, re-render to update footer/cancel button
      if (job.state === 'done' || job.state === 'error' || job.state === 'cancelled') {
        const newEl = createJobElement(job);
        el.replaceWith(newEl);
      }
    }

    function getPillText(job) {
      if (job.state === 'running') {
        return (job.progress && job.progress > 0) ? `${Math.round(job.progress)}%` : 'Starting';
      }
      if (job.state === 'done') return 'Done';
      if (job.state === 'error') return 'Failed';
      if (job.state === 'cancelled') return 'Cancelled';
      return 'Queued';
    }

    /**
     * Cancels an active job.
     * @param {string} jobId 
     */
    function cancelJob(jobId) {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({
        type: MESSAGES.DOWNLOAD_CANCEL,
        payload: { jobId }
      }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          showFeedback('Failed to cancel download', 'error');
          return;
        }
        showFeedback('Download cancelled', 'info');
        loadJobs();
      });
    }

    // Format toggle handling
    typeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        if (!type) return;
        selectedType = type;

        typeBtns.forEach((b) => {
          const active = b.getAttribute('data-type') === type;
          b.classList.toggle('kcn-type-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      });
    });

    // Validate link and submit handling
    submitBtn?.addEventListener('click', () => {
      const url = (urlInput?.value || '').trim();

      if (!url) {
        showFeedback('Please enter a URL to download', 'error');
        urlInput?.focus();
        return;
      }

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        showFeedback('Invalid URL. Links must start with http:// or https://', 'error');
        urlInput?.focus();
        return;
      }

      if (url.length > 2048) {
        showFeedback('URL exceeds maximum permitted length of 2048 characters.', 'error');
        return;
      }

      if (url.startsWith('-')) {
        showFeedback('URL cannot start with a hyphen (-)', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Starting...';

      chrome.runtime.sendMessage({
        type: MESSAGES.DOWNLOAD_START,
        payload: {
          url,
          type: selectedType
        }
      }, (res) => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Download';

        if (chrome.runtime.lastError || !res || !res.ok) {
          const err = res?.error || chrome.runtime.lastError?.message || 'Failed to start download';
          showFeedback(err, 'error');
          return;
        }

        if (urlInput) urlInput.value = '';
        showFeedback(`Download started for ${selectedType.toUpperCase()}!`, 'success');
        loadJobs();
      });
    });

    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitBtn?.click();
      }
    });

    // Open Folder Handler
    openFolderBtn?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: MESSAGES.DOWNLOAD_OPEN_FOLDER }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          showFeedback(res?.error || 'Could not open folder (check helper status)', 'error');
        } else {
          showFeedback('Opened download folder in File Explorer', 'info');
        }
      });
    });

    // Clear History Handler
    clearHistoryBtn?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: MESSAGES.DOWNLOAD_CLEAR }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          showFeedback('Failed to clear download history', 'error');
        } else {
          showFeedback('Download history cleared', 'info');
          loadJobs();
        }
      });
    });

    // Broadcast listener for DOWNLOADS_CHANGED
    const onBroadcastMessage = (msg) => {
      if (msg?.type === MESSAGES.DOWNLOADS_CHANGED) {
        loadJobs();
      }
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener(onBroadcastMessage);
    }

    // Pinging interval management
    function startPinging() {
      checkStatus();
      loadJobs();
      if (!pingInterval) {
        pingInterval = setInterval(checkStatus, 10000);
      }
    }

    function stopPinging() {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      stopActivePolling();
    }

    // Initial check and load
    startPinging();

    return {
      reload: () => {
        checkStatus();
        loadJobs();
      },
      startPing: startPinging,
      stopPing: stopPinging,
      cleanup: () => {
        stopPinging();
        if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.removeListener) {
          chrome.runtime.onMessage.removeListener(onBroadcastMessage);
        }
      }
    };
  }

  // Export to isolated window scope
  window.__kcn_initDownloaderTab = initDownloaderTab;
})();
