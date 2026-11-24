// © 2026 Kushal Parajuli

/**
 * Downloader Tab component for Kam Chai Nabirsa.
 * Injected as a content script inside the Shadow DOM without dynamic imports.
 * Communicates with the local helper exclusively via the background service worker.
 */

(function () {
  const MESSAGES = {
    HELPER_PING: 'HELPER_PING'
  };

  /**
   * Initializes the Downloader Tab inside the given pane element.
   * @param {{ paneElement: HTMLElement, openSettings: Function }} config 
   */
  function initDownloaderTab({ paneElement, openSettings }) {
    if (!paneElement) return;

    let selectedType = 'video'; // 'video' | 'audio'
    let pingInterval = null;
    let isChecking = false;

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
            <span class="kcn-dl-jobs-title">Download Activity</span>
            <span class="kcn-dl-jobs-count">0 items</span>
          </div>

          <div class="kcn-dl-jobs-list" id="kcn-dl-jobs-list">
            <!-- Empty state -->
            <div class="kcn-dl-empty-state">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <div class="kcn-dl-empty-title">Ready for downloads</div>
              <div class="kcn-dl-empty-desc">Paste any video or audio URL above. Active downloads and progress tracking will be enabled in Phase 7.</div>
            </div>
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

    /**
     * Shows a temporary feedback notification in the Downloader tab.
     * @param {string} msg 
     * @param {'info'|'error'|'success'} [type='info'] 
     */
    function showFeedback(msg, type = 'info') {
      if (!feedback) return;
      feedback.textContent = msg;
      feedback.className = `kcn-dl-feedback kcn-dl-feedback-${type}`;
      feedback.classList.remove('kcn-hidden');
      setTimeout(() => {
        feedback?.classList.add('kcn-hidden');
      }, 6000);
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

      // Phase 6 acceptance notice (Real downloading is Phase 7)
      showFeedback(`Valid ${selectedType.toUpperCase()} link! Real downloads with yt-dlp & ffmpeg will be active in Phase 7.`, 'info');
    });

    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitBtn?.click();
      }
    });

    // Pinging interval management
    function startPinging() {
      checkStatus();
      if (!pingInterval) {
        pingInterval = setInterval(checkStatus, 10000);
      }
    }

    function stopPinging() {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }

    return {
      reload: checkStatus,
      startPing: startPinging,
      stopPing: stopPinging,
      cleanup: () => {
        stopPinging();
      }
    };
  }

  // Export to isolated window scope
  window.__kcn_initDownloaderTab = initDownloaderTab;
})();
