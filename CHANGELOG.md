# Changelog

All notable changes to **Kam Chai Nabirsa** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-11-24

### Initial Release: Don't Forget Your Work

First production-ready release of Kam Chai Nabirsa, a Manifest V3 Chrome extension and local Python companion helper for offline-first personal productivity.

### Added

#### Phase 1: Floating Widget Foundation
- Floating edge pill button (40px) with 35% resting opacity and hover highlight.
- Panel (340x460px) toggled strictly on click, `Enter`, or `Space`; pointer movements > 5px treated strictly as drags.
- Vertical edge dragging with left/right edge snapping and persistence in `chrome.storage.local`.
- Closed Shadow DOM isolation with `:host { all: initial; }` and bundled in-memory styles (`content/widget-css.js`) to bypass strict website CSPs.
- Always-on programmatic injection across all tabs on startup and installation via `chrome.scripting.executeScript`.
- Automatic filtering to ensure widget mounts strictly in normal Chrome windows (`CHECK_CAN_MOUNT`).

#### Phase 2: Todo Management
- Offline-first IndexedDB object store `todos` (version 4) managed exclusively inside the background service worker.
- Strict avoidance of secondary indexes on boolean or nullable fields to prevent IndexedDB `DataError`.
- Task addition, editing (double-click or edit button), deletion with a 5-second undo toast.
- Collapsible "Completed (N)" section with soft green tint, strikethrough styling, and de-emphasized contrast.
- Atomic "Clear completed" handler resolving across open tabs with `TODOS_CHANGED` broadcast.
- Zero `innerHTML` usage with user content; complete XSS defense via `textContent`.

#### Phase 3: Reminders & Alarm System
- Scheduled alarms via `chrome.alarms` with support for exact dates, quick chips (+10m, +1h, Tomorrow 9 AM), and relative time syntax ("In [N] [unit]") with live preview.
- 5-minute pre-alert (`pre:<id>`) broadcasting warning toasts and displaying quiet notifications.
- Alarm at exact timestamp (`todo:<id>`) auto-opening the widget, pinning it open, and displaying a pulsing red banner with Stop, Snooze 5 min, and Mark done buttons.
- Continuous audio alarm synthesis in an offscreen document (`offscreen/offscreen.html`) using 880 Hz square wave PCM WAV loops to bypass Web Audio autoplay restrictions.
- Persistent Chrome system notifications with interactive action buttons.
- Repeating alarms (every 5 minutes, up to 10 times) and automatic missed-reminder detection on browser restart.

#### Phase 4: Notes Scratchpad & Exports
- Fast text clipping (up to 20,000 characters) and clipboard image pasting (`Ctrl+V`) directly into the tab.
- Drag & drop image files and "Choose image" picker supporting PNG, JPEG, GIF, and WEBP up to 10 MB. Strict rejection of SVG to prevent XML script injection.
- In-widget canvas thumbnail generator scaling images to max 320px with base64 message transport.
- Card pinning, inline text editing (`Ctrl+Enter` saves, `Esc` cancels), and live case-insensitive search.
- Single note text download (`note-[slug]-YYYY-MM-DD-HHmm.txt`) and Master Notes Export (`kam-chai-nabirsa-notes-YYYY-MM-DD.txt`) with UTF-8 Windows line endings (`\r\n`) and copyright header.
- Full image downloads via temporary `<a download>` anchors and object URL revoking.

#### Phase 5: Settings, Appearance & Backup
- Unified settings schema with validation and clamping (`extension/shared/settings.js`).
- Themes: System Auto, Light, and Dark mode applied live across Shadow DOM components.
- Resting opacity slider (20% to 100%), widget sizing presets (`small`, `medium`, `large`), and edge side preference.
- Dynamic reminder customization: sound toggle, volume slider, ring duration, repeat intervals, max repeats, snooze duration, and custom pre-alert lead time.
- Notes retention policy with daily automated maintenance alarm sweeping unpinned notes older than N days.
- Full JSON backup export and import with Merge vs Replace modes; automatic exclusion of helper auth token from backup files.

#### Phase 6 & 7: Local Media Downloader
- Lightweight local Python helper server (`helper/server.py`) binding strictly to `127.0.0.1:8765`.
- Timing-attack resistant authentication via constant-time `hmac.compare_digest` with generated `helper/token.txt`.
- CORS lockdown permitting only the extension's `chrome-extension://` origin.
- URL safety validation enforcing `http://` or `https://`, length <= 2048 characters, no flag injection (`-`), and rejection of loopback/private IP addresses (SSRF defense).
- Safe subprocess execution via argument lists with `--` parameter separators (zero `shell=True`).
- Thread-safe background download queue with concurrency limit (`maxConcurrentJobs: 2`).
- Real-time progress percentage parsing via `kcn-progress:%(progress._percent_str)s`.
- Downloader tab UI featuring live helper status banner, FFmpeg indicator, Video (MP4) vs Audio (MP3) radio toggle, progress bar tracking, job cancellation, open folder button, and clear history.
- Prominent responsible use notice: *"Use only for content you own or have permission to download."*

#### Phase 8: Hardening & Documentation
- Comprehensive system architecture documentation (`docs/ARCHITECTURE.md`).
- Step-by-step verification checklist for Chrome (`docs/TESTING.md`).
- 33 automated Node.js tests (`npm test`) and 12 automated pytest tests (`pytest`).
- Verified zero secret leakage in git history; copyright headers on all source files.
