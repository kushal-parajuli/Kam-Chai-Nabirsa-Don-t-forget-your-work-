# Kam Chai Nabirsa (Don't Forget Your Work)

A personal Chrome extension (Manifest V3) providing an unobtrusive floating productivity companion directly on web pages. Features a to-do list with alarm-style notifications, a scratchpad for text and image pastes, and a local video/audio downloader powered by an optional Python helper.

## Key Features

- **Todo Tab**: Create, organize, and tick off tasks. Set time reminders with quick chips (+10m, +1h, Tomorrow 9 AM) or custom dates. Includes 5-minute pre-alerts, continuous synthetic alarm beeps via Web Audio API, repeats, snoozing, and missed-reminder detection.
- **Notes Tab**: Quickly save text snippets (up to 20,000 characters) and clipboard images (PNG, JPEG, GIF, WEBP up to 10 MB) directly to offline storage. Features card pinning, inline editing, live search, 5-second undo toast, and single/all .txt exports.
- **Downloader Tab**: Download personal video (MP4) or audio (MP3) files locally via yt-dlp.

## Preview

<!-- Screenshots will be added here -->
_Screenshots coming soon._

## Installation

1. Clone or download this repository to your machine:
```bash
git clone https://github.com/kushal-parajuli/Kam-Chai-Nabirsa-Don-t-forget-your-work-.git
```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the upper-right corner.
4. Click **Load unpacked** in the top toolbar.
5. Select the `extension` folder inside this project directory.
6. The extension is now active. Click the reload icon on the extension card after any code changes.

## Local Helper Setup (Downloader)

The downloader uses a lightweight local companion server in `helper/`:
1. Ensure Python 3.10+ is installed and available in PATH.
2. Ensure `ffmpeg` is installed and verified via `ffmpeg -version`.
3. Open a terminal in the `helper/` directory and set up a virtual environment:
```bash
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```
4. Start the server:
```bash
python server.py
```
5. On the first launch, a secure token is generated in `helper/token.txt`. Copy this token into the extension Settings panel.

## Usage Guide

- **Floating Widget**: Click the edge pill icon to expand or collapse the panel. Press `Esc` or click outside to close. Drag vertically along the edge to reposition. The widget mounts strictly in normal Chrome browser tabs (popups, Developer Tools, and app windows are cleanly excluded).
- **Tasks & Reminders**: Enter a task description and optional due date/time using direct date & time pickers, quick chips (+10m, +1h, Tomorrow 9 AM), or relative time entry ("In [N] [unit]") with a live preview string. Notifications ring with an in-memory synthesized WAV alarm tone, snooze and completion buttons. Completed tasks remain visible under the collapsible "Completed (N)" section with soft green tint, strikethrough, and de-emphasized contrast.
- **Notes**: Paste text snippets or clipboard images (`Ctrl+V`) directly into the textarea or drop zone. Drag & drop image files or use the "Choose image" picker. Pin important notes to the top, edit text notes inline (`Ctrl+Enter` saves, `Esc` cancels), search notes live, copy text or images, and delete with a 5-second undo toast.
- **Exporting Notes**:
  - **Single Note (.txt)**: Click "Download .txt" on any text card to download a clean UTF-8 text file with Windows line endings (`\r\n`) named `note-[slug]-YYYY-MM-DD-HHmm.txt`.
  - **Master Export**: Click "Download all notes (.txt)" in the Notes tab header to download `kam-chai-nabirsa-notes-YYYY-MM-DD.txt` containing a copyright header (`Kam Chai Nabirsa - notes export - © 2026 Kushal Parajuli`), export timestamp, and all notes separated by 40 dashes (pinned first, then newest first).
  - **Image Downloads**: Click "Download image" on any image card to download the full image as `note-image-YYYY-MM-DD-HHmm.<ext>`.
- **Downloader**: Paste a URL, choose MP4 or MP3, and track download progress.
- **Toolbar Popup**: Toggle widget visibility, reset widget position, or test the alarm sound immediately via the "Test Alarm Sound (3s)" button.

## Architecture

Data is stored locally in IndexedDB managed exclusively by the background service worker. This isolates storage to the extension's origin, ensuring tasks and notes stay synchronized regardless of which web page is active.

## Privacy & Local Storage

All data stays strictly on your local computer. There are no analytics, tracking, telemetry, or external database servers.

## Responsible Use

This tool is designed strictly for local personal use and educational practice. Media downloads must only be performed on content you own, that is in the public domain, or for which you have explicit rights.

## Known Limitations

- Content scripts cannot run on internal browser pages (e.g. `chrome://` URLs, Chrome Web Store, and the built-in New Tab page). Use the toolbar popup fallback on these pages.
- To display the widget on local HTML files (`file:///...`), enable **"Allow access to file URLs"** in Chrome's extension details page (`chrome://extensions` > Details for Kam Chai Nabirsa).
- Chrome may show a standard "Disable developer mode extensions" prompt or warning upon browser startup when running unpacked extensions.
- Reminders and alarms fire while the Chrome browser process is running. If Chrome was closed when a reminder was scheduled, it fires immediately as a "Missed" alarm as soon as Chrome is launched.
- Plain text `.txt` exports do not embed binary image files; image notes are documented with placeholder metadata lines (`[image note: <fileName>, <date>]`).
- The "Copy image" button utilizes the browser Clipboard API (`ClipboardItem` with PNG conversion); certain web pages with strict document focus or clipboard permissions may block direct clipboard writing—use "Download image" as a fallback on those sites.

## License

Copyright (c) 2026 Kushal Parajuli. Licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
