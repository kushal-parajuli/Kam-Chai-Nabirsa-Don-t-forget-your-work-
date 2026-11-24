# Kam Chai Nabirsa

> **Don't forget your work**

A lightweight, offline-first personal productivity companion built as a Manifest V3 Chrome extension with an optional local Python helper daemon. Kam Chai Nabirsa injects an unobtrusive floating widget directly onto web pages inside an isolated Shadow DOM container. It provides a reliable task checklist with alarm-style audio reminders, a scratchpad for text snippets and clipboard image pasting, and a local video and audio downloader powered by `yt-dlp` and `ffmpeg`.

---

## Key Features

- **Todo Tab**:
  - Offline-first task management stored in IndexedDB.
  - Set reminder alarms using quick chips (`+10m`, `+1h`, `Tomorrow 9 AM`), direct date/time pickers, or relative time syntax ("In 2 hours") with live preview.
  - 5-minute pre-alert toasts and persistent system notifications.
  - Continuous 880 Hz synthesized audio alarm tones via Web Audio in an offscreen document.
  - Interactive alarm banner with **Stop**, **Snooze 5 min**, and **Mark done** buttons.
  - Collapsible "Completed" tasks section with strikethrough styling and atomic "Clear completed".
- **Notes Tab**:
  - Scratchpad for text notes (up to 20,000 characters) and clipboard images (`Ctrl+V`).
  - Supports image file dropping and picker uploads (PNG, JPEG, GIF, WEBP up to 10 MB; SVG strictly blocked for security).
  - In-widget canvas thumbnail generator and full image downloads.
  - Card pinning, inline text editing (`Ctrl+Enter` saves, `Esc` cancels), and live case-insensitive search.
  - Export single notes or download all notes as structured `.txt` files with Windows line endings (`\r\n`).
- **Downloader Tab**:
  - Download personal media locally via an authenticated Python helper daemon.
  - Format toggle for Video (MP4) and Audio (MP3).
  - Real-time download progress tracking (0–100%) with status pills and cancel buttons.
  - "Open folder" shortcut and download history management.
  - Responsible use warning notice prominently displayed.
- **Settings & Appearance**:
  - Light, Dark, and System Auto theme modes.
  - Resting opacity slider (20% to 100%) and widget sizing presets (`small`, `medium`, `large`).
  - Custom reminder settings (audio toggle, volume, ring duration, snooze time, pre-alert lead time).
  - Automated maintenance to sweep old unpinned notes.
  - JSON data backup export and restore with merge/replace modes.

---

## Preview

<!-- Screenshot placeholders: real images can be added here -->
| Floating Widget & Todo Tab | Alarm Ringing Banner | Notes Tab & Image Paste | Downloader Tab & Helper |
| :---: | :---: | :---: | :---: |
| _[Screenshot Placeholder: Todo Tab]_ | _[Screenshot Placeholder: Alarm Banner]_ | _[Screenshot Placeholder: Notes Tab]_ | _[Screenshot Placeholder: Downloader]_ |

---

## Installation

### Step-by-Step Chrome Setup
1. Clone this repository to your local machine:
   ```bash
   git clone https://github.com/kushal-parajuli/Kam-Chai-Nabirsa-Don-t-forget-your-work-.git
   cd Kam-Chai-Nabirsa-Don-t-forget-your-work-
   ```
2. Open Google Chrome and enter `chrome://extensions` in the address bar.
3. Turn on the **Developer mode** toggle switch in the upper-right corner.
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file selection dialog, choose the `extension` folder inside the cloned repository:
   ```text
   D:\Kam Chai Nabirsa\extension
   ```
6. The extension is now loaded and active. The floating pill button will appear on all open and newly opened web tabs.

---

## Local Helper Setup (Downloader)

The Downloader tab requires the local Python companion server to safely run `yt-dlp` and `ffmpeg` on your machine.

### Prerequisites
1. **Python 3.10+**: Ensure Python is installed with "Add Python to PATH" enabled.
2. **FFmpeg**: Required for audio conversion and video merging. Confirm it works in terminal:
   ```powershell
   ffmpeg -version
   ```
   *(If not installed on Windows, install via: `winget install Gyan.FFmpeg`)*

### Setup & Launch
1. Open a terminal in the `helper/` directory:
   ```powershell
   cd helper
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. Start the helper server:
   ```powershell
   python server.py
   ```
   *(Or double-click `helper\start-helper.bat` on Windows)*
3. On first startup, the server automatically generates a secure random token into `helper/token.txt` (git-ignored) and prints it to the console.
4. Open the extension, click the gear icon to open **Settings**, and paste the token into the **Helper Token** field.
5. Switch to the Downloader tab; the status banner will turn green: `Helper online` with `ffmpeg found`.

---

## Usage Guide

- **Floating Widget**: Click the edge pill icon to expand or collapse the panel. Press `Esc` or click outside to close. Drag vertically along the edge to reposition. The widget mounts strictly in normal Chrome browser tabs (popups, Developer Tools, and app windows are cleanly excluded).
- **Tasks & Reminders**: Enter a task description and optional due date/time using direct date & time pickers, quick chips (`+10m`, `+1h`, `Tomorrow 9 AM`), or relative time entry ("In [N] [unit]") with a live preview string. Notifications ring with an in-memory synthesized WAV alarm tone, snooze and completion buttons. Completed tasks remain visible under the collapsible "Completed (N)" section with soft green tint, strikethrough, and de-emphasized contrast.
- **Notes**: Paste text snippets or clipboard images (`Ctrl+V`) directly into the textarea or drop zone. Drag & drop image files or use the "Choose image" picker. Pin important notes to the top, edit text notes inline (`Ctrl+Enter` saves, `Esc` cancels), search notes live, copy text or images, and delete with a 5-second undo toast.
- **Exporting Notes**:
  - **Single Note (.txt)**: Click "Download .txt" on any text card to download a clean UTF-8 text file with Windows line endings (`\r\n`) named `note-[slug]-YYYY-MM-DD-HHmm.txt`.
  - **Master Export**: Click "Download all notes (.txt)" in the Notes tab header to download `kam-chai-nabirsa-notes-YYYY-MM-DD.txt` containing a copyright header (`Kam Chai Nabirsa - notes export - © 2026 Kushal Parajuli`), export timestamp, and all notes separated by 40 dashes (pinned first, then newest first).
  - **Image Downloads**: Click "Download image" on any image card to download the full image as `note-image-YYYY-MM-DD-HHmm.<ext>`.
- **Media Downloader**: Paste any HTTP or HTTPS video or audio link. Choose **Video (MP4)** or **Audio (MP3)** and click **Download**. Monitor real-time progress percentages, cancel active downloads, or click **Open folder** to view downloaded files in File Explorer (`%USERPROFILE%\Downloads\KamChaiNabirsa`).
- **Settings & Preferences**: Click the gear icon in the panel header to customize themes, opacity, widget size, reminder volume/tones, auto-delete policies, helper token, or export/import a JSON backup file.
- **Toolbar Popup**: Toggle widget visibility, reset widget position, or test the alarm sound immediately via the "Test Alarm Sound (3s)" button.

---

## Project Structure & Architecture Note

```text
Kam-Chai-Nabirsa/
├── extension/                     # Chrome Extension (Manifest V3)
│   ├── manifest.json              # Extension manifest & permissions
│   ├── background/
│   │   ├── service-worker.js      # Central background router & alarms
│   │   ├── db.js                  # IndexedDB promise-based data wrapper
│   │   ├── reminders.js           # Alarm scheduler & badge calculations
│   │   └── helper-client.js       # Authenticated HTTP client for helper
│   ├── content/
│   │   ├── widget.js              # Injected UI coordinator & Shadow DOM
│   │   ├── widget-css.js          # In-memory bundled styles
│   │   ├── widget.css             # Base stylesheet
│   │   └── tabs/
│   │       ├── todo.js            # Todo tab view & reminder picker
│   │       ├── notes.js           # Notes scratchpad & thumbnail generator
│   │       └── downloader.js      # Downloader tab view & progress polling
│   ├── offscreen/
│   │   ├── offscreen.html         # Offscreen audio synthesis document
│   │   └── offscreen.js           # 880 Hz PCM WAV audio loop player
│   ├── popup/
│   │   ├── popup.html             # Toolbar fallback popup
│   │   ├── popup.js               # Quick controls & test alarm button
│   │   └── popup.css              # Popup styling
│   └── shared/
│       ├── constants.js           # Timing & alarm constants
│       ├── messages.js            # Type constants & envelope helpers
│       ├── settings.js            # Settings schema, validation & clamping
│       ├── notes-export.js        # Text export formatting helpers
│       └── utils.js               # Blob & data URL converters
├── helper/                        # Local Python Companion Server
│   ├── server.py                  # Flask service (127.0.0.1:8765)
│   ├── config.example.json        # Example configuration
│   ├── requirements.txt           # Python dependencies (flask, yt-dlp)
│   ├── start-helper.bat           # Windows launch script
│   └── tests/
│       └── test_server.py         # Pytest verification suite
├── docs/
│   ├── ARCHITECTURE.md            # Deep system architecture & security spec
│   ├── PROJECT_SPEC.md            # Complete project specification
│   └── TESTING.md                 # Step-by-step verification guide
├── tests/                         # Node.js automated test suites
├── CHANGELOG.md                   # Release version history
├── LICENSE                        # MIT License
└── package.json                   # Test dependencies & scripts
```

### Architecture Note: Storage in the Service Worker
IndexedDB storage (`kcn-db`) is managed exclusively by the background service worker rather than inside content scripts. This architecture guarantees:
1. **Origin Isolation**: Web pages run in their own domain origins (`https://example.com`, etc.). Managing IndexedDB inside the service worker keeps user data isolated within the extension's private origin (`chrome-extension://<id>`), preventing malicious web scripts from accessing your tasks, notes, or credentials.
2. **Instant Multi-Tab Sync**: When tasks or notes change, the service worker broadcasts change events (`TODOS_CHANGED`, `NOTES_CHANGED`, `DOWNLOADS_CHANGED`) to all open tabs simultaneously.
3. **Continuous Alarms & Maintenance**: Reminders and auto-delete maintenance tasks run on schedule via `chrome.alarms` even when no content scripts are open or active.

---

## Privacy & Local-First

**Kam Chai Nabirsa is completely local-first:**
- All tasks, notes, images, and preferences are stored directly on your computer's local disk in IndexedDB and `chrome.storage.local`.
- There are **no remote tracking servers, analytics, telemetry, or external accounts**.
- All network requests are strictly confined to `127.0.0.1` when communicating with your own local helper daemon.

---

## Responsible Use

> [!IMPORTANT]
> This is a personal practice project designed strictly for local use. The media downloader must **only be used with content you own, that is in the public domain or under a permissive licence, or that you have explicit permission to download**. Downloading from streaming platforms may violate their Terms of Service, and unauthorised copying can break copyright laws. This project is not published to or intended for the Chrome Web Store.

---

## Known Limitations

- **Browser Internal Pages**: Chrome strictly prohibits content script injection on internal pages (e.g. `chrome://` URLs, Chrome Web Store, and the default New Tab page). On these pages, use the toolbar popup fallback.
- **Local File URLs (`file:///...`)**: To use the floating widget on local HTML files, open `chrome://extensions` > Details for Kam Chai Nabirsa > enable **"Allow access to file URLs"**.
- **Browser Startup Alerts**: Scheduled reminders trigger while the Chrome browser process is running. If Chrome was closed when a reminder was scheduled, it fires immediately as a "Missed" alarm upon launching Chrome.
- **Developer Mode Notice**: Because this is an unpacked extension, Chrome may periodically display a standard "Disable developer mode extensions" dialog upon startup.

---

## Contributing & License

This is a personal practice and educational project. Feel free to fork or adapt the code for your own personal workflows.

Copyright (c) 2026 Kushal Parajuli.  
Licensed under the [MIT License](LICENSE).
