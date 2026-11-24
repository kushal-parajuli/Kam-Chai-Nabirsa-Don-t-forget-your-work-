// © 2026 Kushal Parajuli

/**
 * Kam Chai Nabirsa - Content Script
 * Injects a floating widget into web pages inside an isolated Shadow DOM.
 * Works strictly in normal top-level browser tabs without dynamic imports or URL fetching.
 */

(function initKamChaiNabirsa() {
  // Never run inside iframes
  if (window !== window.top) {
    return;
  }

  // Prevent duplicate injections on the same page
  if (window.__kcnWidgetLoaded || document.getElementById('kam-chai-nabirsa-host')) {
    return;
  }
  window.__kcnWidgetLoaded = true;

  // Verify that the current window is a normal Chrome window (not popup, PiP, or app)
  try {
    if (!chrome?.runtime?.sendMessage) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupWidget, { once: true });
      } else {
        setupWidget();
      }
      return;
    }

    chrome.runtime.sendMessage({ type: 'CHECK_CAN_MOUNT' }, (response) => {
      // Default to mounting if top window and no explicit shouldMount: false
      const shouldMount = response ? Boolean(response.ok && response.data?.shouldMount) : true;
      if (shouldMount) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', setupWidget, { once: true });
        } else {
          setupWidget();
        }
      }
    });
  } catch (_) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupWidget, { once: true });
    } else {
      setupWidget();
    }
  }

  function setupWidget() {
    // Configuration & State
    const STATE = {
      enabled: true,
      edge: 'right', // 'right' | 'left'
      top: 120, // vertical offset in px
      opacity: 0.35,
      theme: 'auto',
      isOpen: false,
      isPinned: false,
      isDragging: false,
      activeTab: 'todo',
      dragStartY: 0,
      dragStartX: 0,
      pillStartTop: 0,
      hasMovedPastThreshold: false,
      pointerActive: false
    };

    let todoApi = null;
    let notesApi = null;
    let downloaderApi = null;
    let currentRingingTodo = null;

    // Create Host Element
    const host = document.createElement('div');
    host.id = 'kam-chai-nabirsa-host';
    const shadowRoot = host.attachShadow({ mode: 'open' });

    // Inject CSS directly as a <style> tag from embedded string (no URL fetch or CSP risk)
    const styleEl = document.createElement('style');
    styleEl.textContent = window.__kcn_css || '';
    shadowRoot.appendChild(styleEl);

    // Widget Markup
    const container = document.createElement('div');
    container.className = 'kcn-root';
    container.innerHTML = `
      <!-- Floating Pill Trigger -->
      <div class="kcn-pill kcn-pill-edge-right" 
           id="kcn-pill" 
           role="button" 
           tabindex="0" 
           aria-label="Toggle Kam Chai Nabirsa panel"
           title="Kam Chai Nabirsa (Drag to move, click to toggle)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 13l4 4L19 7"/>
        </svg>
        <div class="kcn-badge kcn-badge-empty" id="kcn-badge">0</div>
      </div>

      <!-- Floating Panel -->
      <div class="kcn-panel" id="kcn-panel" role="dialog" aria-modal="false" aria-label="Kam Chai Nabirsa productivity panel">
        <!-- Header -->
        <div class="kcn-header">
          <div class="kcn-title-group">
            <img src="${chrome.runtime.getURL('icons/icon32.png')}" alt="Logo" class="kcn-brand-icon">
            <span class="kcn-title">Kam Chai Nabirsa</span>
          </div>
          <div class="kcn-header-actions">
            <button class="kcn-icon-btn" id="kcn-settings-btn" title="Settings" aria-label="Open settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            <button class="kcn-icon-btn" id="kcn-pin-btn" title="Pin panel open" aria-label="Pin panel open">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="17" x2="12" y2="22"/>
                <path d="M5 17h14v-2l-2-3V5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v7l-2 3v2z"/>
              </svg>
            </button>
            <button class="kcn-icon-btn" id="kcn-close-btn" title="Close panel (Esc)" aria-label="Close panel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Alarm Ringing Banner (Active when reminder alarm fires) -->
        <div class="kcn-alarm-banner kcn-hidden" id="kcn-alarm-banner" role="alert" aria-live="assertive">
          <div class="kcn-alarm-banner-top">
            <span class="kcn-alarm-banner-badge" id="kcn-alarm-banner-badge">REMINDER</span>
            <span class="kcn-alarm-banner-title" id="kcn-alarm-banner-title"></span>
          </div>
          <div class="kcn-alarm-banner-actions">
            <button type="button" class="kcn-alarm-action-btn kcn-alarm-stop" id="kcn-alarm-stop-btn">Stop</button>
            <button type="button" class="kcn-alarm-action-btn kcn-alarm-snooze" id="kcn-alarm-snooze-btn">Snooze 5 min</button>
            <button type="button" class="kcn-alarm-action-btn kcn-alarm-done" id="kcn-alarm-done-btn">Mark done</button>
          </div>
        </div>

        <!-- Pre-alert heads up toast -->
        <div class="kcn-pre-toast kcn-hidden" id="kcn-pre-toast" role="status" aria-live="polite">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span id="kcn-pre-toast-text"></span>
        </div>

        <!-- Tab Navigation -->
        <div class="kcn-tabs" role="tablist">
          <button class="kcn-tab-btn kcn-tab-active" data-tab="todo" role="tab" aria-selected="true">Todo</button>
          <button class="kcn-tab-btn" data-tab="notes" role="tab" aria-selected="false">Notes</button>
          <button class="kcn-tab-btn" data-tab="downloader" role="tab" aria-selected="false">Downloader</button>
        </div>

        <!-- Tab Content Area -->
        <div class="kcn-content">
          <!-- Todo Pane -->
          <div class="kcn-tab-pane kcn-pane-active" data-pane="todo" role="tabpanel"></div>

          <!-- Notes Pane -->
          <div class="kcn-tab-pane" data-pane="notes" role="tabpanel">
            <div class="kcn-placeholder-card">
              <div class="kcn-placeholder-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div class="kcn-placeholder-title">Notes & Clips</div>
              <div class="kcn-placeholder-desc">Text notes and direct clipboard image paste will be active here in Phase 4.</div>
            </div>
          </div>

          <!-- Downloader Pane -->
          <div class="kcn-tab-pane" data-pane="downloader" role="tabpanel">
            <div class="kcn-placeholder-card">
              <div class="kcn-placeholder-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </div>
              <div class="kcn-placeholder-title">Local Media Downloader</div>
              <div class="kcn-placeholder-desc">MP4/MP3 downloads via local yt-dlp helper will be active here in Phase 6 & 7.</div>
            </div>
          </div>
        </div>

        <!-- Settings Overlay View (Phase 5) -->
        <div class="kcn-settings-view kcn-hidden" id="kcn-settings-view" role="dialog" aria-modal="false" aria-label="Settings">
          <div class="kcn-settings-header">
            <span class="kcn-settings-title">Settings</span>
            <button class="kcn-icon-btn" id="kcn-settings-close-btn" title="Close settings" aria-label="Close settings">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="kcn-settings-scroll">
            <!-- Appearance Section -->
            <div class="kcn-settings-group">
              <div class="kcn-settings-group-title">Appearance</div>
              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-theme">Theme</label>
                <select class="kcn-settings-select" id="kcn-setting-theme">
                  <option value="auto">System Default (Auto)</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-opacity">Idle Opacity (<span id="kcn-opacity-val">35%</span>)</label>
                <input type="range" class="kcn-settings-range" id="kcn-setting-opacity" min="20" max="100" step="5" value="35">
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-edgeside">Screen Edge</label>
                <select class="kcn-settings-select" id="kcn-setting-edgeside">
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                </select>
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-widgetsize">Panel Size</label>
                <select class="kcn-settings-select" id="kcn-setting-widgetsize">
                  <option value="small">Small (300 × 400)</option>
                  <option value="medium">Medium (340 × 460)</option>
                  <option value="large">Large (380 × 520)</option>
                </select>
              </div>

              <button type="button" class="kcn-settings-btn" id="kcn-reset-pos-btn">Reset Widget Position</button>
            </div>

            <!-- Reminders & Alarms Section -->
            <div class="kcn-settings-group">
              <div class="kcn-settings-group-title">Reminders & Alarms</div>
              <label class="kcn-settings-checkbox-row">
                <input type="checkbox" id="kcn-setting-sound" checked>
                <span>Play sound when reminder rings</span>
              </label>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-volume">Alarm Volume (<span id="kcn-volume-val">80%</span>)</label>
                <input type="range" class="kcn-settings-range" id="kcn-setting-volume" min="10" max="100" step="5" value="80">
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-ringsec">Ring Duration</label>
                <select class="kcn-settings-select" id="kcn-setting-ringsec">
                  <option value="30">30 seconds</option>
                  <option value="60">60 seconds (1 min)</option>
                  <option value="120">120 seconds (2 min)</option>
                  <option value="300">300 seconds (5 min)</option>
                </select>
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-repeatmin">Repeat Every</label>
                <select class="kcn-settings-select" id="kcn-setting-repeatmin">
                  <option value="2">2 minutes</option>
                  <option value="5">5 minutes</option>
                  <option value="10">10 minutes</option>
                  <option value="15">15 minutes</option>
                </select>
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-maxrepeats">Max Repeats</label>
                <select class="kcn-settings-select" id="kcn-setting-maxrepeats">
                  <option value="3">3 times</option>
                  <option value="5">5 times</option>
                  <option value="10">10 times</option>
                  <option value="20">20 times</option>
                </select>
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-snooze">Default Snooze</label>
                <select class="kcn-settings-select" id="kcn-setting-snooze">
                  <option value="5">5 minutes</option>
                  <option value="10">10 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                </select>
              </div>

              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-prealert">Pre-Alert Heads Up</label>
                <select class="kcn-settings-select" id="kcn-setting-prealert">
                  <option value="0">Off</option>
                  <option value="5">5 minutes before</option>
                  <option value="10">10 minutes before</option>
                  <option value="15">15 minutes before</option>
                </select>
              </div>

              <button type="button" class="kcn-settings-btn" id="kcn-test-sound-btn">Test Alarm Sound (3s)</button>
            </div>

            <!-- Notes Retention Section -->
            <div class="kcn-settings-group">
              <div class="kcn-settings-group-title">Notes Retention</div>
              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-notes-retention">Auto-delete Text Notes</label>
                <select class="kcn-settings-select" id="kcn-setting-notes-retention">
                  <option value="0">Never (Off)</option>
                  <option value="30">Older than 30 days</option>
                  <option value="60">Older than 60 days</option>
                  <option value="90">Older than 90 days</option>
                  <option value="180">Older than 180 days</option>
                  <option value="365">Older than 365 days</option>
                </select>
              </div>
              <div class="kcn-settings-hint" id="kcn-last-maintenance-info">Last maintenance: Never</div>
              <div class="kcn-settings-hint">Pinned notes are never auto-deleted. Binary images remain offline.</div>
            </div>

            <!-- Local Helper Companion Section -->
            <div class="kcn-settings-group kcn-settings-helper-group">
              <div class="kcn-settings-group-title">Local Helper Companion</div>
              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-helper-port">Port</label>
                <input type="number" class="kcn-settings-input" id="kcn-setting-helper-port" value="8765" min="1024" max="65535">
              </div>
              <div class="kcn-settings-row">
                <label class="kcn-settings-label" for="kcn-setting-helper-token">Auth Token</label>
                <div class="kcn-input-with-btn">
                  <input type="password" class="kcn-settings-input" id="kcn-setting-helper-token" placeholder="Paste token from helper/token.txt">
                  <button type="button" class="kcn-icon-btn" id="kcn-toggle-token-btn" title="Show/hide token" aria-label="Toggle token visibility">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- Backup & Restore Section -->
            <div class="kcn-settings-group">
              <div class="kcn-settings-group-title">Data Backup & Restore</div>
              <div class="kcn-settings-hint">Backups include all todos, text notes, and settings. Helper tokens and binary images are excluded.</div>
              <div class="kcn-settings-btn-row">
                <button type="button" class="kcn-settings-btn" id="kcn-backup-export-btn">Export JSON</button>
                <button type="button" class="kcn-settings-btn" id="kcn-backup-import-btn">Import JSON</button>
                <input type="file" id="kcn-backup-file-input" accept=".json,application/json" hidden>
              </div>
              <button type="button" class="kcn-settings-btn kcn-danger-btn" id="kcn-reset-data-btn">Reset All Local Data</button>
              <div class="kcn-settings-feedback kcn-hidden" id="kcn-backup-feedback" role="status"></div>
            </div>

            <!-- About Section -->
            <div class="kcn-settings-group">
              <div class="kcn-settings-group-title">About</div>
              <div class="kcn-settings-hint"><strong>Kam Chai Nabirsa</strong> v0.1.0</div>
              <div class="kcn-settings-hint">Personal Manifest V3 Productivity Companion</div>
              <div class="kcn-settings-hint">© 2026 Kushal Parajuli • MIT License</div>
            </div>
          </div>
        </div>

        <!-- Muted Footer Line -->
        <div class="kcn-footer">© 2026 Kushal Parajuli</div>
      </div>
    `;

    shadowRoot.appendChild(container);

    // Mount to documentElement for resistance against SPA body replacements
    (document.documentElement || document.body).appendChild(host);

    // Observe documentElement to keep host attached if an SPA replaces body or rewrites DOM
    const spaObserver = new MutationObserver(() => {
      if (!document.contains(host)) {
        (document.documentElement || document.body).appendChild(host);
      }
    });
    spaObserver.observe(document.documentElement, { childList: true });

    // Element References
    const pill = shadowRoot.getElementById('kcn-pill');
    const pillBadge = shadowRoot.getElementById('kcn-badge');
    const panel = shadowRoot.getElementById('kcn-panel');
    const pinBtn = shadowRoot.getElementById('kcn-pin-btn');
    const closeBtn = shadowRoot.getElementById('kcn-close-btn');
    const tabBtns = shadowRoot.querySelectorAll('.kcn-tab-btn');
    const tabPanes = shadowRoot.querySelectorAll('.kcn-tab-pane');
    const todoPane = shadowRoot.querySelector('[data-pane="todo"]');
    const notesPane = shadowRoot.querySelector('[data-pane="notes"]');
    const downloaderPane = shadowRoot.querySelector('[data-pane="downloader"]');
    const settingsBtn = shadowRoot.getElementById('kcn-settings-btn');
    const settingsView = shadowRoot.getElementById('kcn-settings-view');
    const settingsCloseBtn = shadowRoot.getElementById('kcn-settings-close-btn');

    // Alarm elements
    const alarmBanner = shadowRoot.getElementById('kcn-alarm-banner');
    const alarmBadge = shadowRoot.getElementById('kcn-alarm-banner-badge');
    const alarmTitle = shadowRoot.getElementById('kcn-alarm-banner-title');
    const alarmStopBtn = shadowRoot.getElementById('kcn-alarm-stop-btn');
    const alarmSnoozeBtn = shadowRoot.getElementById('kcn-alarm-snooze-btn');
    const alarmDoneBtn = shadowRoot.getElementById('kcn-alarm-done-btn');
    const preToast = shadowRoot.getElementById('kcn-pre-toast');
    const preToastText = shadowRoot.getElementById('kcn-pre-toast-text');

    // Alarm Banner Control
    function showAlarmBanner(todo, isMissed = false) {
      if (!todo) return;
      currentRingingTodo = todo;
      alarmTitle.textContent = todo.title;
      alarmBadge.textContent = isMissed ? 'MISSED REMINDER' : 'REMINDER';
      alarmBanner.classList.remove('kcn-hidden');
      panel.classList.add('kcn-alarm-pulsing');
      openPanel();
      STATE.isPinned = true;
      pinBtn.classList.add('kcn-pinned');
      pinBtn.title = 'Unpin panel';
    }

    function hideAlarmBanner() {
      currentRingingTodo = null;
      alarmBanner.classList.add('kcn-hidden');
      panel.classList.remove('kcn-alarm-pulsing');
    }

    function showPreAlert(todo) {
      if (!todo || !preToastText) return;
      preToastText.textContent = `${todo.title} in 5 min`;
      preToast.classList.remove('kcn-hidden');
      pill.classList.add('kcn-pill-alert');
      setTimeout(() => {
        preToast.classList.add('kcn-hidden');
        pill.classList.remove('kcn-pill-alert');
      }, 6000);
    }

    alarmStopBtn?.addEventListener('click', () => {
      if (!currentRingingTodo) return;
      chrome.runtime.sendMessage({ type: 'ALARM_STOP', payload: { id: currentRingingTodo.id } });
      hideAlarmBanner();
    });

    alarmSnoozeBtn?.addEventListener('click', () => {
      if (!currentRingingTodo) return;
      chrome.runtime.sendMessage({ type: 'ALARM_SNOOZE', payload: { id: currentRingingTodo.id } });
      hideAlarmBanner();
    });

    alarmDoneBtn?.addEventListener('click', () => {
      if (!currentRingingTodo) return;
      chrome.runtime.sendMessage({ type: 'ALARM_DONE', payload: { id: currentRingingTodo.id } });
      hideAlarmBanner();
    });

    // Listen for alarm broadcasts from background service worker
    chrome.runtime.onMessage.addListener((request) => {
      if (request?.type === 'ALARM_RINGING') {
        showAlarmBanner(request.payload?.todo, request.payload?.isMissed);
      } else if (request?.type === 'ALARM_DISMISSED') {
        hideAlarmBanner();
      } else if (request?.type === 'PRE_ALERT') {
        showPreAlert(request.payload?.todo);
      }
    });

    // Check if an alarm is already ringing on page load
    try {
      chrome.runtime.sendMessage({ type: 'ALARM_STATUS' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.ok && Array.isArray(res.data) && res.data.length > 0) {
          showAlarmBanner(res.data[0]);
        }
      });
    } catch (_) {}

    // Badge Handler (only counts open todos)
    function updateBadge(count) {
      if (!pillBadge) return;
      if (typeof count === 'number' && count > 0) {
        pillBadge.textContent = count > 99 ? '99+' : String(count);
        pillBadge.classList.remove('kcn-badge-empty');
      } else {
        pillBadge.textContent = '0';
        pillBadge.classList.add('kcn-badge-empty');
      }
    }

    // Initialize Todo Tab Component (using direct script reference, no dynamic import)
    if (typeof window.__kcn_initTodoTab === 'function') {
      todoApi = window.__kcn_initTodoTab({
        paneElement: todoPane,
        onBadgeUpdate: updateBadge
      });
    }

    // Initialize Notes Tab Component (Phase 4)
    if (typeof window.__kcn_initNotesTab === 'function') {
      notesApi = window.__kcn_initNotesTab({
        paneElement: notesPane
      });
    }

    // Settings View Toggle (Phase 5)
    function openSettings() {
      settingsView?.classList.remove('kcn-hidden');
      populateSettingsForm();
    }

    function closeSettings() {
      settingsView?.classList.add('kcn-hidden');
    }

    settingsBtn?.addEventListener('click', () => {
      if (settingsView?.classList.contains('kcn-hidden')) {
        openSettings();
      } else {
        closeSettings();
      }
    });

    settingsCloseBtn?.addEventListener('click', closeSettings);

    // Initialize Downloader Tab Component (Phase 6)
    if (typeof window.__kcn_initDownloaderTab === 'function') {
      downloaderApi = window.__kcn_initDownloaderTab({
        paneElement: downloaderPane,
        openSettings
      });
    }

    // Populate & Attach Settings Form Handlers (Phase 5)
    function populateSettingsForm() {
      chrome.runtime.sendMessage({ type: 'SETTINGS_GET' }, (res) => {
        if (!res?.ok || !res.data) return;
        const s = res.data;

        const themeSel = shadowRoot.getElementById('kcn-setting-theme');
        const opacityRng = shadowRoot.getElementById('kcn-setting-opacity');
        const opacityTxt = shadowRoot.getElementById('kcn-opacity-val');
        const edgeSel = shadowRoot.getElementById('kcn-setting-edgeside');
        const sizeSel = shadowRoot.getElementById('kcn-setting-widgetsize');
        const soundChk = shadowRoot.getElementById('kcn-setting-sound');
        const volRng = shadowRoot.getElementById('kcn-setting-volume');
        const volTxt = shadowRoot.getElementById('kcn-volume-val');
        const ringSel = shadowRoot.getElementById('kcn-setting-ringsec');
        const repeatSel = shadowRoot.getElementById('kcn-setting-repeatmin');
        const maxRepSel = shadowRoot.getElementById('kcn-setting-maxrepeats');
        const snoozeSel = shadowRoot.getElementById('kcn-setting-snooze');
        const preAlertSel = shadowRoot.getElementById('kcn-setting-prealert');
        const notesRetSel = shadowRoot.getElementById('kcn-setting-notes-retention');
        const maintInfo = shadowRoot.getElementById('kcn-last-maintenance-info');
        const helperPortInp = shadowRoot.getElementById('kcn-setting-helper-port');
        const helperTokenInp = shadowRoot.getElementById('kcn-setting-helper-token');

        if (themeSel) themeSel.value = s.theme || 'auto';
        if (opacityRng) {
          opacityRng.value = s.widgetOpacity || 35;
          if (opacityTxt) opacityTxt.textContent = `${s.widgetOpacity || 35}%`;
        }
        if (edgeSel) edgeSel.value = s.edgeSide || 'right';
        if (sizeSel) sizeSel.value = s.widgetSize || 'medium';
        if (soundChk) soundChk.checked = s.soundEnabled !== false;
        if (volRng) {
          volRng.value = s.alarmVolume || 80;
          if (volTxt) volTxt.textContent = `${s.alarmVolume || 80}%`;
        }
        if (ringSel) ringSel.value = String(s.ringSeconds || 60);
        if (repeatSel) repeatSel.value = String(s.repeatMinutes || 5);
        if (maxRepSel) maxRepSel.value = String(s.maxRepeats || 10);
        if (snoozeSel) snoozeSel.value = String(s.snoozeMinutes || 5);
        if (preAlertSel) preAlertSel.value = String(s.preAlertMinutes !== undefined ? s.preAlertMinutes : 5);
        if (notesRetSel) notesRetSel.value = String(s.notesAutoDeleteDays || 0);

        if (maintInfo) {
          if (s.lastMaintenanceAt) {
            const d = new Date(s.lastMaintenanceAt);
            maintInfo.textContent = `Last maintenance: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          } else {
            maintInfo.textContent = 'Last maintenance: Never';
          }
        }

        if (helperPortInp) helperPortInp.value = s.helperPort || 8765;
        if (helperTokenInp) helperTokenInp.value = s.helperToken || '';
      });
    }

    function saveSettingKey(key, value) {
      chrome.runtime.sendMessage({
        type: 'SETTINGS_SET',
        payload: { settings: { [key]: value } }
      }, () => {});
    }

    // Appearance Inputs
    const themeSel = shadowRoot.getElementById('kcn-setting-theme');
    themeSel?.addEventListener('change', () => {
      saveSettingKey('theme', themeSel.value);
    });

    const opacityRng = shadowRoot.getElementById('kcn-setting-opacity');
    const opacityTxt = shadowRoot.getElementById('kcn-opacity-val');
    opacityRng?.addEventListener('input', () => {
      const val = parseInt(opacityRng.value, 10);
      if (opacityTxt) opacityTxt.textContent = `${val}%`;
      saveSettingKey('widgetOpacity', val);
    });

    const edgeSel = shadowRoot.getElementById('kcn-setting-edgeside');
    edgeSel?.addEventListener('change', () => {
      saveSettingKey('edgeSide', edgeSel.value);
      STATE.edge = edgeSel.value;
      applyPosition();
    });

    const sizeSel = shadowRoot.getElementById('kcn-setting-widgetsize');
    sizeSel?.addEventListener('change', () => {
      saveSettingKey('widgetSize', sizeSel.value);
      STATE.size = sizeSel.value;
      applySize();
    });

    const resetPosBtn = shadowRoot.getElementById('kcn-reset-pos-btn');
    resetPosBtn?.addEventListener('click', () => {
      chrome.storage.local.set({
        widgetPosition: { edge: 'right', top: 120 }
      });
      STATE.edge = 'right';
      STATE.top = 120;
      applyPosition();
      showBackupFeedback('Position reset to default!');
    });

    // Reminders Inputs
    const soundChk = shadowRoot.getElementById('kcn-setting-sound');
    soundChk?.addEventListener('change', () => {
      saveSettingKey('soundEnabled', soundChk.checked);
    });

    const volRng = shadowRoot.getElementById('kcn-setting-volume');
    const volTxt = shadowRoot.getElementById('kcn-volume-val');
    volRng?.addEventListener('input', () => {
      const val = parseInt(volRng.value, 10);
      if (volTxt) volTxt.textContent = `${val}%`;
      saveSettingKey('alarmVolume', val);
    });

    const ringSel = shadowRoot.getElementById('kcn-setting-ringsec');
    ringSel?.addEventListener('change', () => {
      saveSettingKey('ringSeconds', parseInt(ringSel.value, 10));
    });

    const repeatSel = shadowRoot.getElementById('kcn-setting-repeatmin');
    repeatSel?.addEventListener('change', () => {
      saveSettingKey('repeatMinutes', parseInt(repeatSel.value, 10));
    });

    const maxRepSel = shadowRoot.getElementById('kcn-setting-maxrepeats');
    maxRepSel?.addEventListener('change', () => {
      saveSettingKey('maxRepeats', parseInt(maxRepSel.value, 10));
    });

    const snoozeSel = shadowRoot.getElementById('kcn-setting-snooze');
    snoozeSel?.addEventListener('change', () => {
      saveSettingKey('snoozeMinutes', parseInt(snoozeSel.value, 10));
    });

    const preAlertSel = shadowRoot.getElementById('kcn-setting-prealert');
    preAlertSel?.addEventListener('change', () => {
      saveSettingKey('preAlertMinutes', parseInt(preAlertSel.value, 10));
    });

    const testSoundBtn = shadowRoot.getElementById('kcn-test-sound-btn');
    testSoundBtn?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'TEST_SOUND' });
      showBackupFeedback('Playing alarm sound for 3s...');
    });

    // Notes Retention
    const notesRetSel = shadowRoot.getElementById('kcn-setting-notes-retention');
    notesRetSel?.addEventListener('change', () => {
      saveSettingKey('notesAutoDeleteDays', parseInt(notesRetSel.value, 10));
    });

    // Helper Companion Inputs
    const helperPortInp = shadowRoot.getElementById('kcn-setting-helper-port');
    helperPortInp?.addEventListener('change', () => {
      const p = parseInt(helperPortInp.value, 10) || 8765;
      saveSettingKey('helperPort', p);
      downloaderApi?.reload?.();
    });

    const helperTokenInp = shadowRoot.getElementById('kcn-setting-helper-token');
    helperTokenInp?.addEventListener('input', () => {
      saveSettingKey('helperToken', helperTokenInp.value.trim());
      downloaderApi?.reload?.();
    });

    const toggleTokenBtn = shadowRoot.getElementById('kcn-toggle-token-btn');
    toggleTokenBtn?.addEventListener('click', () => {
      if (!helperTokenInp) return;
      helperTokenInp.type = helperTokenInp.type === 'password' ? 'text' : 'password';
    });

    // Reset Data
    const resetDataBtn = shadowRoot.getElementById('kcn-reset-data-btn');
    resetDataBtn?.addEventListener('click', () => {
      const confirmed = window.confirm(
        'Are you sure you want to reset all local data?\n\nThis will permanently delete all stored todos and notes, reset alarms, and recreate a clean database.'
      );
      if (!confirmed) return;

      chrome.runtime.sendMessage({ type: 'DB_RESET' }, (res) => {
        if (res?.ok) {
          showBackupFeedback('All local data was reset successfully!');
          todoApi?.reload?.();
          notesApi?.reload?.();
          populateSettingsForm();
        } else {
          showBackupFeedback('Failed to reset data: ' + (res?.error || 'Unknown error'), true);
        }
      });
    });

    // Backup & Restore
    const backupExportBtn = shadowRoot.getElementById('kcn-backup-export-btn');
    const backupImportBtn = shadowRoot.getElementById('kcn-backup-import-btn');
    const backupFileInput = shadowRoot.getElementById('kcn-backup-file-input');
    const backupFeedback = shadowRoot.getElementById('kcn-backup-feedback');

    function showBackupFeedback(msg, isError = false) {
      if (!backupFeedback) return;
      backupFeedback.textContent = msg;
      backupFeedback.className = `kcn-settings-feedback ${isError ? 'kcn-feedback-error' : 'kcn-feedback-success'}`;
      backupFeedback.classList.remove('kcn-hidden');
      setTimeout(() => backupFeedback?.classList.add('kcn-hidden'), 4500);
    }

    backupExportBtn?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SETTINGS_BACKUP_EXPORT' }, (res) => {
        if (!res?.ok || !res.data) {
          showBackupFeedback('Failed to export backup: ' + (res?.error || 'Unknown error'), true);
          return;
        }
        const jsonStr = JSON.stringify(res.data, null, 2);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fname = `kam-chai-nabirsa-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        a.click();
        URL.revokeObjectURL(url);
        showBackupFeedback('Backup exported successfully!');
      });
    });

    backupImportBtn?.addEventListener('click', () => {
      backupFileInput?.click();
    });

    backupFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 20 * 1024 * 1024) {
        showBackupFeedback('Backup file exceeds 20 MB size limit', true);
        e.target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const replace = window.confirm(
            'Import Mode:\n\nClick OK to REPLACE all current tasks and notes with this backup.\nClick CANCEL to MERGE (keep your current tasks and notes, only adding new ones).'
          );
          const mode = replace ? 'replace' : 'merge';

          chrome.runtime.sendMessage({
            type: 'SETTINGS_BACKUP_IMPORT',
            payload: { backup: parsed, mode }
          }, (res) => {
            if (!res?.ok) {
              showBackupFeedback('Failed to import backup: ' + (res?.error || 'Invalid file'), true);
              return;
            }
            showBackupFeedback(`Imported ${res.data?.importedTodos || 0} tasks & ${res.data?.importedNotes || 0} notes (${mode} mode)!`);
            todoApi?.reload?.();
            notesApi?.reload?.();
            populateSettingsForm();
          });
        } catch (_) {
          showBackupFeedback('Invalid JSON file format', true);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Load Saved Preferences
    chrome.storage.local.get(['settings', 'widgetEnabled', 'widgetPosition', 'widgetOpacity', 'theme', 'lastActiveTab'], (items) => {
      const s = items.settings || {};
      if (items.widgetEnabled !== undefined) {
        STATE.enabled = items.widgetEnabled;
      }
      if (items.widgetPosition) {
        STATE.edge = items.widgetPosition.edge || s.edgeSide || 'right';
        STATE.top = typeof items.widgetPosition.top === 'number' ? items.widgetPosition.top : 120;
      } else if (s.edgeSide) {
        STATE.edge = s.edgeSide;
      }
      if (typeof s.widgetOpacity === 'number') {
        STATE.opacity = s.widgetOpacity / 100;
      } else if (typeof items.widgetOpacity === 'number') {
        STATE.opacity = items.widgetOpacity;
      }
      if (s.theme) {
        STATE.theme = s.theme;
      } else if (items.theme) {
        STATE.theme = items.theme;
      }
      if (s.widgetSize) {
        STATE.size = s.widgetSize;
      }
      if (items.lastActiveTab) {
        STATE.activeTab = items.lastActiveTab;
      }

      applyEnabledState();
      applyPosition();
      applyOpacity();
      applyTheme();
      applySize();
      switchTab(STATE.activeTab);
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes.widgetEnabled !== undefined) {
        STATE.enabled = changes.widgetEnabled.newValue !== false;
        applyEnabledState();
      }
      if (changes.widgetPosition) {
        STATE.edge = changes.widgetPosition.newValue?.edge || 'right';
        STATE.top = changes.widgetPosition.newValue?.top ?? 120;
        applyPosition();
      }
      if (changes.settings) {
        const s = changes.settings.newValue || {};
        if (s.theme) {
          STATE.theme = s.theme;
          applyTheme();
        }
        if (typeof s.widgetOpacity === 'number') {
          STATE.opacity = s.widgetOpacity / 100;
          applyOpacity();
        }
        if (s.edgeSide) {
          STATE.edge = s.edgeSide;
          applyPosition();
        }
        if (s.widgetSize) {
          STATE.size = s.widgetSize;
          applySize();
        }
        populateSettingsForm();
      }
    });

    function applyEnabledState() {
      if (!STATE.enabled) {
        host.classList.add('kcn-hidden');
        closePanel(true);
      } else {
        host.classList.remove('kcn-hidden');
      }
    }

    // Apply Positioning
    function applyPosition() {
      const maxTop = window.innerHeight - 50;
      STATE.top = Math.max(10, Math.min(STATE.top, maxTop));

      pill.style.top = `${STATE.top}px`;

      if (STATE.edge === 'left') {
        pill.style.left = '0px';
        pill.style.right = 'auto';
        pill.classList.remove('kcn-pill-edge-right');
        pill.classList.add('kcn-pill-edge-left');
      } else {
        pill.style.left = 'auto';
        pill.style.right = '0px';
        pill.classList.remove('kcn-pill-edge-left');
        pill.classList.add('kcn-pill-edge-right');
      }

      updatePanelPosition();
    }

    function updatePanelPosition() {
      const panelHeight = 460;
      const windowHeight = window.innerHeight;
      let panelTop = STATE.top - 10;

      if (panelTop + panelHeight > windowHeight - 16) {
        panelTop = windowHeight - panelHeight - 16;
      }
      if (panelTop < 10) {
        panelTop = 10;
      }

      panel.style.top = `${panelTop}px`;

      if (STATE.edge === 'left') {
        panel.style.left = '52px';
        panel.style.right = 'auto';
        panel.style.transformOrigin = 'top left';
      } else {
        panel.style.right = '52px';
        panel.style.left = 'auto';
        panel.style.transformOrigin = 'top right';
      }
    }

    function applyOpacity() {
      pill.style.setProperty('--kcn-user-opacity', STATE.opacity);
    }

    function applyTheme() {
      host.classList.remove('kcn-theme-light', 'kcn-theme-dark');
      if (STATE.theme === 'light') {
        host.classList.add('kcn-theme-light');
      } else if (STATE.theme === 'dark') {
        host.classList.add('kcn-theme-dark');
      }
    }

    function applySize() {
      panel.classList.remove('kcn-size-small', 'kcn-size-medium', 'kcn-size-large');
      panel.classList.add(`kcn-size-${STATE.size || 'medium'}`);
    }

    // Panel Open / Close Actions (CLICK TO OPEN ONLY)
    function openPanel() {
      STATE.isOpen = true;
      updatePanelPosition();
      panel.classList.add('kcn-open');
      pill.classList.add('kcn-active');
      todoApi?.startRefresh?.();
      if (STATE.activeTab === 'downloader') {
        downloaderApi?.startPing?.();
      }
    }

    function closePanel(force = false) {
      if (STATE.isPinned && !force) return;
      STATE.isOpen = false;
      panel.classList.remove('kcn-open');
      pill.classList.remove('kcn-active');
      todoApi?.stopRefresh?.();
      downloaderApi?.stopPing?.();
      closeSettings();
    }

    function togglePanel() {
      if (STATE.isOpen) {
        closePanel(true);
      } else {
        openPanel();
      }
    }

    // Tab Switching
    function switchTab(tabName) {
      STATE.activeTab = tabName;
      tabBtns.forEach((btn) => {
        const match = btn.getAttribute('data-tab') === tabName;
        btn.classList.toggle('kcn-tab-active', match);
        btn.setAttribute('aria-selected', match ? 'true' : 'false');
      });

      tabPanes.forEach((pane) => {
        const match = pane.getAttribute('data-pane') === tabName;
        pane.classList.toggle('kcn-pane-active', match);
      });

      if (tabName === 'notes') {
        notesApi?.reload?.();
        downloaderApi?.stopPing?.();
      } else if (tabName === 'todo') {
        todoApi?.reload?.();
        downloaderApi?.stopPing?.();
      } else if (tabName === 'downloader') {
        downloaderApi?.startPing?.();
      }

      chrome.storage.local.set({ lastActiveTab: tabName }).catch(() => {});
    }

    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        if (target) switchTab(target);
      });
    });

    // Pin Button Toggle
    pinBtn.addEventListener('click', () => {
      STATE.isPinned = !STATE.isPinned;
      pinBtn.classList.toggle('kcn-pinned', STATE.isPinned);
      pinBtn.title = STATE.isPinned ? 'Unpin panel' : 'Pin panel open';
      pinBtn.setAttribute('aria-label', pinBtn.title);
    });

    // Close Button
    closeBtn.addEventListener('click', () => {
      STATE.isPinned = false;
      pinBtn.classList.remove('kcn-pinned');
      closePanel(true);
    });

    // Dragging & Click Handling
    pill.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      STATE.pointerActive = true;
      STATE.hasMovedPastThreshold = false;
      STATE.dragStartY = e.clientY;
      STATE.dragStartX = e.clientX;
      STATE.pillStartTop = STATE.top;

      pill.setPointerCapture(e.pointerId);
    });

    pill.addEventListener('pointermove', (e) => {
      if (!STATE.pointerActive) return;

      const deltaY = e.clientY - STATE.dragStartY;
      const deltaX = e.clientX - STATE.dragStartX;
      const distance = Math.hypot(deltaX, deltaY);

      if (!STATE.hasMovedPastThreshold && distance > 5) {
        STATE.hasMovedPastThreshold = true;
        STATE.isDragging = true;
        pill.classList.add('kcn-dragging');
        closePanel(true);
      }

      if (STATE.hasMovedPastThreshold) {
        const maxTop = window.innerHeight - 50;
        const newTop = Math.max(10, Math.min(STATE.pillStartTop + deltaY, maxTop));
        pill.style.top = `${newTop}px`;
        STATE.top = newTop;

        if (e.clientX < window.innerWidth / 2) {
          if (STATE.edge !== 'left') {
            STATE.edge = 'left';
            pill.style.left = '0px';
            pill.style.right = 'auto';
            pill.classList.remove('kcn-pill-edge-right');
            pill.classList.add('kcn-pill-edge-left');
          }
        } else {
          if (STATE.edge !== 'right') {
            STATE.edge = 'right';
            pill.style.left = 'auto';
            pill.style.right = '0px';
            pill.classList.remove('kcn-pill-edge-left');
            pill.classList.add('kcn-pill-edge-right');
          }
        }
      }
    });

    pill.addEventListener('pointerup', (e) => {
      if (!STATE.pointerActive) return;
      STATE.pointerActive = false;

      try {
        pill.releasePointerCapture(e.pointerId);
      } catch (_) {}

      pill.classList.remove('kcn-dragging');

      if (STATE.hasMovedPastThreshold) {
        chrome.storage.local.set({
          widgetPosition: { edge: STATE.edge, top: STATE.top }
        }).catch((err) => console.error('[KCN] Failed to save position:', err));
        applyPosition();
      } else {
        togglePanel();
      }

      STATE.isDragging = false;
      STATE.hasMovedPastThreshold = false;
    });

    pill.addEventListener('pointercancel', () => {
      STATE.pointerActive = false;
      STATE.isDragging = false;
      STATE.hasMovedPastThreshold = false;
      pill.classList.remove('kcn-dragging');
      applyPosition();
    });

    // Keyboard Accessibility
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePanel();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (settingsView && !settingsView.classList.contains('kcn-hidden')) {
          closeSettings();
        } else if (STATE.isOpen) {
          closePanel(true);
          pill.focus();
        }
      }
    });

    // Click outside collapses
    document.addEventListener('pointerdown', (e) => {
      if (!STATE.isOpen || STATE.isPinned) return;
      const path = e.composedPath();
      if (!path.includes(host)) {
        closePanel();
      }
    });

    // Fullscreen Detection
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        host.classList.add('kcn-hidden');
      } else if (STATE.enabled) {
        host.classList.remove('kcn-hidden');
      }
    });

    // Window Resize
    window.addEventListener('resize', () => {
      applyPosition();
    });
  }
})();
