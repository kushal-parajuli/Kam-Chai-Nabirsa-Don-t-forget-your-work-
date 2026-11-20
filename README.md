# Kam Chai Nabirsa (Don't Forget Your Work)

A personal Chrome extension (Manifest V3) that provides an unobtrusive floating productivity companion across web pages. It includes task management with alarm-style alerts, scratchpad notes with image support, and an optional local media downloader.

## Key Features

- **Todo Tab**: Create, organize, and tick off tasks. Set precise time reminders with snoozing and alarm notifications.
- **Notes Tab**: Quickly jot down thoughts or paste clipboard images directly into persistent offline storage.
- **Downloader Tab**: Download personal video (MP4) or audio (MP3) tracks locally via an optional Python helper.

## Preview

<!-- Screenshots will be added here -->
_Screenshots coming soon._

## Installation

1. Clone or download this repository to your machine:
   `ash
   git clone https://github.com/kushal-parajuli/Kam-Chai-Nabirsa-Don-t-forget-your-work-.git
   `
2. Open Google Chrome and navigate to chrome://extensions.
3. Enable **Developer mode** using the toggle switch in the upper-right corner.
4. Click **Load unpacked** in the top toolbar.
5. Select the extension directory inside this project folder.
6. The extension is now active and ready. Click the extension reload button after any source updates.

## Local Helper Setup (Downloader)

The downloader requires a lightweight local companion server (helper/):
1. Ensure Python 3.10+ is installed and available in PATH.
2. Ensure fmpeg is installed and verified via fmpeg -version.
3. Open a terminal in the helper/ directory and set up a virtual environment:
   `ash
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   `
4. Start the server:
   `ash
   python server.py
   `
5. On the first launch, a secure token is generated in helper/token.txt. Copy this token into the extension Settings panel.

## Usage Guide

- **Floating Widget**: Hover or click the edge pill icon to expand the panel. Press Esc or click outside to close. Drag vertically to reposition.
- **Tasks & Reminders**: Enter your task description and optional due time. Notifications ring with snooze and completion buttons.
- **Notes**: Paste text or clipboard images (Ctrl+V). Pin critical notes to the top.
- **Downloader**: Paste a URL, choose MP4 or MP3, and track download progress.

## Architecture

Data is stored locally in IndexedDB managed strictly by the background service worker. This isolates storage to the extension's origin, ensuring todos and notes stay synchronized regardless of which web page is active.

## Privacy & Local Storage

All data stays strictly on your local computer. There are no analytics, tracking, telemetry, or remote servers.

## Responsible Use

This tool is designed strictly for local personal use and educational practice. Media downloads must only be performed on content you own, that is in the public domain, or for which you have explicit rights.

## Known Limitations

- Content scripts cannot execute on browser internal pages (e.g., chrome:// URLs, Chrome Web Store). Use the toolbar popup fallback on these pages.
- Alarms require the Chrome browser process to be active.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
