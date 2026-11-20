/**
 * Kam Chai Nabirsa - Content Script
 * Injects a floating widget into web pages inside an isolated Shadow DOM.
 */

(function initKamChaiNabirsa() {
  // Prevent duplicate injections on the same page
  if (window.__kcnWidgetLoaded || document.getElementById('kam-chai-nabirsa-host')) {
    return;
  }
  window.__kcnWidgetLoaded = true;

  // Wait for document ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupWidget, { once: true });
  } else {
    setupWidget();
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

    // Create Host Element
    const host = document.createElement('div');
    host.id = 'kam-chai-nabirsa-host';
    const shadowRoot = host.attachShadow({ mode: 'open' });

    // Load Stylesheet inside Shadow DOM
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content/widget.css');
    shadowRoot.appendChild(styleLink);

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

        <!-- Tab Navigation -->
        <div class="kcn-tabs" role="tablist">
          <button class="kcn-tab-btn kcn-tab-active" data-tab="todo" role="tab" aria-selected="true">Todo</button>
          <button class="kcn-tab-btn" data-tab="notes" role="tab" aria-selected="false">Notes</button>
          <button class="kcn-tab-btn" data-tab="downloader" role="tab" aria-selected="false">Downloader</button>
        </div>

        <!-- Tab Content Area -->
        <div class="kcn-content">
          <!-- Todo Pane -->
          <div class="kcn-tab-pane kcn-pane-active" data-pane="todo" role="tabpanel">
            <div class="kcn-placeholder-card">
              <div class="kcn-placeholder-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 11l3 3L22 4"/>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
              </div>
              <div class="kcn-placeholder-title">Todo & Reminders</div>
              <div class="kcn-placeholder-desc">Tasks, due dates, and alarm notifications will be active here in Phase 2 & 3.</div>
            </div>
          </div>

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
    const panel = shadowRoot.getElementById('kcn-panel');
    const pinBtn = shadowRoot.getElementById('kcn-pin-btn');
    const closeBtn = shadowRoot.getElementById('kcn-close-btn');
    const tabBtns = shadowRoot.querySelectorAll('.kcn-tab-btn');
    const tabPanes = shadowRoot.querySelectorAll('.kcn-tab-pane');

    // Load Saved Preferences
    chrome.storage.local.get(['widgetEnabled', 'widgetPosition', 'widgetOpacity', 'theme', 'lastActiveTab'], (items) => {
      if (items.widgetEnabled !== undefined) {
        STATE.enabled = items.widgetEnabled;
      }
      if (items.widgetPosition) {
        STATE.edge = items.widgetPosition.edge || 'right';
        STATE.top = typeof items.widgetPosition.top === 'number' ? items.widgetPosition.top : 120;
      }
      if (typeof items.widgetOpacity === 'number') {
        STATE.opacity = items.widgetOpacity;
      }
      if (items.theme) {
        STATE.theme = items.theme;
      }
      if (items.lastActiveTab) {
        STATE.activeTab = items.lastActiveTab;
      }

      applyEnabledState();
      applyPosition();
      applyOpacity();
      applyTheme();
      switchTab(STATE.activeTab);
    });

    // Listen for storage changes from popup or background
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
      if (changes.widgetOpacity) {
        STATE.opacity = changes.widgetOpacity.newValue;
        applyOpacity();
      }
      if (changes.theme) {
        STATE.theme = changes.theme.newValue;
        applyTheme();
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

    // Panel Open / Close Actions (CLICK TO OPEN ONLY)
    function openPanel() {
      STATE.isOpen = true;
      updatePanelPosition();
      panel.classList.add('kcn-open');
      pill.classList.add('kcn-active');
    }

    function closePanel(force = false) {
      if (STATE.isPinned && !force) return;
      STATE.isOpen = false;
      panel.classList.remove('kcn-open');
      pill.classList.remove('kcn-active');
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
    // If movement > 5px, it is treated as a drag and does NOT toggle the panel.
    pill.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // Primary button only

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
        closePanel(true); // Close panel while moving
      }

      if (STATE.hasMovedPastThreshold) {
        const maxTop = window.innerHeight - 50;
        const newTop = Math.max(10, Math.min(STATE.pillStartTop + deltaY, maxTop));
        pill.style.top = `${newTop}px`;
        STATE.top = newTop;

        // Snapping edge detection
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
        // Drag completed: persist new position and do not toggle panel
        chrome.storage.local.set({
          widgetPosition: { edge: STATE.edge, top: STATE.top }
        }).catch((err) => console.error('[KCN] Failed to save position:', err));
        applyPosition();
      } else {
        // Pointer moved <= 5px: treat strictly as a CLICK
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

    // Keyboard Accessibility (Enter and Space toggle panel)
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePanel();
      }
    });

    // Esc collapses the panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && STATE.isOpen) {
        closePanel(true);
        pill.focus();
      }
    });

    // Click outside collapses the panel (if not pinned)
    document.addEventListener('pointerdown', (e) => {
      if (!STATE.isOpen || STATE.isPinned) return;
      const path = e.composedPath();
      if (!path.includes(host)) {
        closePanel();
      }
    });

    // Handle Fullscreen Video / Elements (hide widget)
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        host.classList.add('kcn-hidden');
      } else if (STATE.enabled) {
        host.classList.remove('kcn-hidden');
      }
    });

    // Handle Window Resize
    window.addEventListener('resize', () => {
      applyPosition();
    });
  }
})();
