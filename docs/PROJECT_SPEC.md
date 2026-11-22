Kam Chai Nabirsa: Project Specification
Don't forget your work.
Author: Kushal Parajuli
Copyright (c) 2026 Kushal Parajuli. All rights reserved.

A personal Chrome extension (Manifest V3) that combines a floating to-do list with alarm-style reminders, a notes pad for text and images, and a local video/music downloader. Built for practice and personal local use.
0. Instructions for the AI agent (read first)
You are the lead developer on this project. The owner is learning, so work like a patient senior mentor.
1.  Read this whole document before writing any code.
2.  Work one phase at a time (Section 13). After each phase, stop, summarise what you built, tell the owner exactly how to test it in Chrome, and wait for confirmation before starting the next phase.
3.  Use Manifest V3 only. Never generate Manifest V2 code (no background pages, no browser_action, no remote code).
4.  Use plain HTML, CSS and JavaScript (ES modules) for the extension. No frameworks, no bundlers, no external libraries unless the owner approves.
5.  Explain non-obvious decisions in short comments and in your phase summary.
6.  Never put secrets (tokens, keys) in Git. Respect the .gitignore rules in Section 4.
7.  If anything in this document is ambiguous or a decision is needed, ask the owner one clear question instead of guessing.
8.  Start with Phase 0 (Git and repository setup).
1. Project overview
Item
Value
Name
Kam Chai Nabirsa (meaning: Don't forget your work)
Type
Chrome extension (Manifest V3) plus a small local Python helper
Purpose
Personal productivity tool and a practice project
Distribution
Local only. Loaded as an unpacked extension. Not for the Chrome Web Store
Project folder
D:\Kam Chai Nabirsa
GitHub repo
https://github.com/kushal-parajuli/Kam-Chai-Nabirsa-Don-t-forget-your-work-
Three tabs
1.  Todo: add, remove and tick tasks, with optional reminders.
2.  Notes: paste text and images, save them in the browser.
3.  Downloader: paste a video link and download it as mp4 (video) or mp3 (audio).
Core experience
A small, semi-transparent floating icon sits on the edge of every web page. On hover or click it expands into a panel with the three tabs. It is always available once the extension is loaded, like an ad blocker, with nothing to start manually.
2. Goals and non-goals
Goals
• Always-available, unobtrusive floating widget.
• Reliable reminders that behave like a phone alarm (notification, badge, sound).
• Fully offline data storage in IndexedDB. No cloud, no accounts, no backend database.
• A clean, well-documented codebase suitable for learning.
Non-goals (do not build)
• Thumbnail extraction or video frame capture (explicitly dropped by the owner).
• Chrome Web Store publishing, user accounts, sync across devices, analytics or telemetry.
• Downloading inside the extension itself without the helper (see Section 10 for why).
3. Environment and constraints
• Development folder: D:\Kam Chai Nabirsa (Windows-style path). Give terminal commands for PowerShell, and confirm the owner's OS if anything differs.
• Browser: Google Chrome (or another Chromium browser). Load via chrome://extensions > Developer mode > Load unpacked > select the extension folder.
• Helper runtime: Python 3.10+, yt-dlp, ffmpeg (owner installs these when Phase 6 begins; guide them step by step).
• Everything runs on the owner's laptop only.
4. Repository and project setup (Phase 0)
The GitHub repository already exists but is empty (no README, no description). Connect the local folder to it and prepare it.
4.1 Connect Git
Run from inside D:\Kam Chai Nabirsa (create subfolders per Section 6):
git init
git branch -M main
git remote add origin https://github.com/kushal-parajuli/Kam-Chai-Nabirsa-Don-t-forget-your-work-.git
If git is not installed or the owner is not signed in to GitHub, guide them through installing Git and authenticating (GitHub login in the browser or a personal access token). Do not ask the owner to paste a token into the chat or into any file.
4.2 Files to create in Phase 0
• README.md following Section 16.
• .gitignore containing at least: node_modules/, __pycache__/, .venv/, venv/, helper/token.txt, helper/config.json, *.log, .env, downloads/, .DS_Store, Thumbs.db.
• LICENSE: MIT, unless the owner says otherwise. Ask the owner for the name to put in the copyright line.
• docs/PROJECT_SPEC.md: a copy of this document, so the spec lives in the repo.
• Empty folder skeleton from Section 6 (add a .gitkeep to empty folders).
4.3 First commit and push
git add .
git commit -m "chore: initial project structure, README and spec"
git push -u origin main
4.4 Repository description and topics
Tell the owner to set these on GitHub (repo page > About > gear icon), or set them with the GitHub CLI if installed:
• Description: Kam Chai Nabirsa (Don't forget your work): a Chrome extension with a floating to-do list, alarm-style reminders, notes with image paste, and a local mp4/mp3 downloader.
• Topics: chrome-extension, manifest-v3, todo, notes, reminders, indexeddb, yt-dlp, javascript, python, productivity
4.5 Commit conventions
Use small commits with prefixes: feat:, fix:, docs:, refactor:, chore:, test:. Commit at the end of every phase, and push after the owner confirms the phase works.
5. Architecture
 Web page (any site)                 Extension origin                   Local machine
+---------------------+   messages  +-------------------------+  HTTP   +-------------------+
| Content script      | <---------> | Background service      | <-----> | Python helper     |
| Floating widget     |             | worker                  |  127.0.0.1 only   | (Flask)           |
| (Shadow DOM UI)     |             | - IndexedDB (all data)  |         |  -> yt-dlp+ffmpeg |
+---------------------+             | - chrome.alarms         |         +-------------------+
                                    | - notifications, badge  |
                                    | - offscreen doc (sound) |
                                    +-------------------------+
Critical design rules
1.  All IndexedDB access lives in the background service worker (extension origin). A content script's IndexedDB belongs to the website it is injected into, so data would be split per site and appear to vanish. The widget must only talk to storage through messages.
2.  All calls to the local helper go through the service worker, never from the content script, to avoid page-level CORS, mixed-content and security problems.
3.  Never rely on setTimeout or in-memory state in the service worker. It is shut down when idle. Use chrome.alarms for timing and re-read state from IndexedDB on every wake-up.
4.  The widget UI is rendered inside a Shadow DOM so website styles cannot break it and it cannot break websites.
5.  Sound is played from an offscreen document (chrome.offscreen, reason AUDIO_PLAYBACK) because service workers cannot play audio. Alarm sound is synthesized in-memory as a 16-bit PCM WAV (880 Hz sine wave, 200ms tone / 300ms silence looped) and played via an HTMLAudioElement to avoid Web Audio autoplay suspension.
6.  The widget mounts strictly in normal Chrome browser tabs (window.type === 'normal'). Content scripts enforce window === window.top, and the service worker verifies window.type before injection or mounting. Popups, Developer Tools, and app windows are cleanly skipped.
Manifest requirements
• manifest_version: 3, with name Kam Chai Nabirsa, a clear description, and version 0.1.0.
• background.service_worker: background/service-worker.js with type: module.
• permissions: storage, alarms, notifications, offscreen, unlimitedStorage, scripting.
• host_permissions: http://127.0.0.1:8765/* (helper), <all_urls> (for programmatic script injection into existing tabs on install/startup).
• content_scripts: one entry matching <all_urls>, run_at: document_idle, all_frames: false, match_about_blank: true, loading the widget script.
• action: toolbar icon with a popup that provides a "Show floating widget" toggle, status details, and a button to reset widget position.
• icons: 16, 32, 48, 128 px (placeholder PNGs generated from an SVG; customizable).
• web_accessible_resources: only what the widget needs (icons, CSS, shared modules).
• Do not request tabs, history, clipboardRead, downloads or broad permissions unless a phase genuinely needs them. Ask first.
Known platform limits (explain to the owner, show friendly UI)
• Content scripts do not run on chrome:// pages, the Chrome Web Store, or the built-in new tab page. The widget will not appear there. The toolbar popup remains the fallback.
• Reminders fire only while Chrome is running.
6. Folder structure
D:\Kam Chai Nabirsa\
+-- README.md
+-- LICENSE
+-- .gitignore
+-- docs\
|   +-- PROJECT_SPEC.md
|   +-- ARCHITECTURE.md        (short, written in Phase 8)
+-- extension\
|   +-- manifest.json
|   +-- icons\                 (icon16/32/48/128.png, source svg)
|   +-- background\
|   |   +-- service-worker.js  (message router, alarms, badge, notifications)
|   |   +-- db.js              (IndexedDB wrapper)
|   |   +-- reminders.js       (alarm scheduling and rehydration)
|   |   +-- helper-client.js   (talks to the local helper)
|   +-- offscreen\
|   |   +-- offscreen.html
|   |   +-- offscreen.js       (plays alarm sound)
|   |   +-- alarm.mp3          (short royalty-free or generated tone)
|   +-- content\
|   |   +-- widget.js          (creates floating icon + Shadow DOM panel)
|   |   +-- widget.css
|   |   +-- tabs\
|   |       +-- todo.js
|   |       +-- notes.js
|   |       +-- downloader.js
|   +-- popup\
|   |   +-- popup.html
|   |   +-- popup.js
|   +-- shared\
|       +-- messages.js        (message type constants)
|       +-- utils.js
+-- helper\
    +-- server.py
    +-- requirements.txt
    +-- README.md              (helper setup on Windows)
    +-- config.example.json    (real config.json is git-ignored)
7. Data model
IndexedDB database name kcn-db, version 1, owned by background/db.js. Expose small promise-based functions (never leak raw transactions to other files).
Object store todos (keyPath id)
Field
Type
Notes
id
string
crypto.randomUUID()
title
string
required, trimmed, max 200 chars
done
boolean
default false
createdAt
number
epoch ms
updatedAt
number
epoch ms
remindAt
number or null
epoch ms of the reminder
reminded
boolean
true after the reminder fired
snoozedUntil
number or null
epoch ms
preReminded
boolean
true after 5-minute pre-alert fired
ringing
boolean
true while alarm is actively ringing
ringCount
number
number of times alarm has rung
lastRingAt
number or null
epoch ms when ringing started
Indexes on todos: none (booleans like 'done' and nullable values like 'remindAt' are not indexed; all queries scan the store via getAll() or openCursor() and filter in JavaScript).
Object store notes (keyPath id)
Field
Type
Notes
id
string
UUID
kind
string
text or image
text
string or null
for text notes
image
Blob or null
for image notes (store the Blob directly)
mimeType
string or null
e.g. image/png
createdAt
number
epoch ms
pinned
boolean
default false
Index: createdAt.
Object store downloads (keyPath id)
Field
Type
Notes
id
string
helper job id
url
string
source link
type
string
video or audio
status
string
queued, running, done, error
progress
number
0 to 100
filename
string or null
final file name
error
string or null
friendly error message
createdAt
number
epoch ms
chrome.storage.local (settings only)
widgetPosition (edge and vertical offset), widgetOpacity (0.2 to 1, default 0.35), theme (light, dark, auto), helperToken, helperPort (default 8765), soundEnabled (default true), lastActiveTab.
8. Feature specification
8.1 Floating widget
• Small round icon (about 40 px) on the edge of the screen, vertically draggable, snapping to the left or right edge. Position persists.
• Default opacity 0.35. Hover only highlights the button (full opacity, subtle scale, and glow with pointer cursor); hover does NOT open the panel.
• Click to open: the panel (about 340 x 460 px) opens ONLY on click (toggles open/closed on click; Enter and Space also toggle when focused). Pointer movement > 5px is treated strictly as a drag and does not toggle the panel. Click outside or press Esc to collapse. A pin button keeps it open.
• Always-on injection: on install and browser startup, the service worker automatically injects the content script into all open tabs (http, https, file schemes) without requiring page reloads. A toolbar popup toggle allows enabling/disabling the floating widget globally.
• Guarded against duplicate injections via window.__kcnWidgetLoaded and resistant to single-page applications (SPAs) rewriting document.body.
• A badge on the icon shows the number of due or overdue unticked todos.
• Keyboard accessible (focusable, aria-labels, visible focus ring, logical tab order).
• Must not shift page layout, steal focus on load, or block clicks on the page except on its own area. Use a very high but sane z-index and all: initial resets inside the Shadow DOM.
• If the page has a conflicting full-screen element (video player fullscreen), hide the widget.
8.2 Todo tab
• Input to add a todo (Enter to submit). Reminder row supports direct Date and Time inputs (<input type="date"> and <input type="time">), quick chips (+10m, +1h, Tomorrow 9 AM), relative entry ("In [number] [unit]"), and live preview ("Will remind: Fri 21 Nov, 5:30 PM (in 2h 15m)") with minimum 30-second advance enforcement.
• List shows open todos first, then completed todos under an expandable "Completed (N)" collapsible section. Completed tasks remain visible in the section, styled with a soft green tint, green checkmark, strikethrough, 0.55 opacity, 0.4px blur, and are non-editable (no edit button, no double-click, bell disabled).
• Tick a checkbox to complete (moves to Completed section). Untick to restore to open tasks.
• Delete button per item with a brief undo toast (5 seconds).
• Edit title by double-click or an edit button (open tasks only).
• Items with a reminder show a countdown clock chip ("in 12m", "in 2h 15m", "in 1d 3h"), amber when <5 minutes, and red "Overdue" when past due, with an exact timestamp tooltip. The chips refresh automatically every 30 seconds while the panel is open.
• Empty state with a friendly message.
• A Clear completed button with clean transaction handling and error reporting.
8.3 Reminders (alarm behaviour)
When a todo has a valid remindAt (typeof remindAt === 'number' && remindAt > 0):
1.  Timing & Constants (shared/constants.js):
    ◦ PRE_ALERT_MIN = 5, RING_SECONDS = 60, REPEAT_MINUTES = 5, MAX_REPEATS = 10, SNOOZE_MINUTES = 5, MIN_LEAD_SECONDS = 30.
2.  Scheduling:
    ◦ Alarm todo:<id> at remindAt.
    ◦ Alarm pre:<id> at remindAt minus 5 minutes (skipped if reminder is less than 5 minutes away when created).
3.  5-minute pre-alert:
    ◦ pre:<id> fires: marks preReminded: true, broadcasts PRE_ALERT to all tabs (shows toast "<title> in 5 min" and indicator dot on pill), and shows a quiet, non-sticky system notification.
4.  Alarm at exact time:
    ◦ todo:<id> fires: sets ringing: true, increments ringCount, sets lastRingAt, schedules stop:<id> (60s) and repeat:<id> (5 min).
    ◦ Offscreen document (offscreen/offscreen.html + offscreen.js) synthesizes an 880 Hz beep pattern (200ms on / 300ms off) into a 16-bit PCM WAV played through an HTMLAudioElement with loop=true to bypass Web Audio autoplay restrictions.
    ◦ Broadcasts ALARM_RINGING to all tabs: widget auto-opens, pins itself open, pulses red, and displays an alarm banner with Stop, Snooze 5 min, and Mark done buttons.
    ◦ Creates a persistent system notification with requireInteraction: true and buttons Snooze 5 min / Mark done.
    ◦ Sets toolbar badge text to the number of ringing/overdue todos with a red background.
5.  Repeats & Silencing:
    ◦ stop:<id> fires after 60s: stops the sound, but preserves the pinned banner and badge.
    ◦ repeat:<id> fires after 5 min: if still ringing and ringCount < MAX_REPEATS, rings again for 60s. After MAX_REPEATS, stops repeating audio while keeping the banner.
6.  Actions (Stop, Snooze, Mark done):
    ◦ Stop: silences sound, cancels repeats, dismisses alarm (ringing = false).
    ◦ Snooze: dismisses alarm and schedules a new reminder in 5 minutes (snoozedUntil).
    ◦ Mark done: dismisses alarm and completes the todo.
    ◦ Works interchangeably from the widget banner, system notifications, or any tab, synchronizing everywhere.
7.  Rehydration:
    ◦ On service worker start, onInstalled, and onStartup, rehydrates all alarms from IndexedDB. If a reminder time passed while Chrome was closed, it fires immediately as a "Missed" reminder.
    ◦ Deleting, completing, or editing a todo clears all associated alarms and silences sound.
8.  Validation:
    ◦ UI validates reminders to be at least 30 seconds into the future.
8.4 Notes tab
• A text area and a drop/paste zone. Pressing Ctrl+V inside the zone or textarea handles:
    ◦ plain text: inserted into the textarea or saved as a text note (max 20,000 characters).
    ◦ an image from the clipboard: saved automatically as an image note (Blob in IndexedDB).
• Also support dragging an image file onto the zone and a "Choose image" file picker button.
• Allowed image types: PNG, JPEG, GIF, WEBP (SVG is strictly rejected). Max 10 MB per image with a friendly error.
• Reading the clipboard silently is not allowed. Only handle explicit user paste/drop events.
• In-widget thumbnail generation: canvas scales images to max 320 px on the longest side (JPEG/WEBP quality 0.8) and sends the thumbnail data URL with the note.
• Base64 messaging rule: Chrome runtime messaging serializes to JSON, so binary Blobs and ArrayBuffers do not survive message passing. The widget converts images to base64 data URLs (via FileReader.readAsDataURL) before sending; the service worker converts them back to Blobs (via dataUrlToBlob) to store in IndexedDB. NOTE_LIST returns notes without Blobs (only thumbnail data URLs). Full images are fetched on demand via NOTE_GET_FULL.
• Notes render as a list of cards, pinned first, then newest first:
    ◦ Text cards: text content (rendered via textContent only), timestamp, Copy text button, Edit button (inline textarea; Ctrl+Enter saves, Esc cancels), Download .txt, Pin, and Delete (with 5-second undo toast).
    ◦ Image cards: thumbnail preview, file name and size, Copy image button (navigator.clipboard.write with ClipboardItem converting to PNG; friendly error if page refuses), Download image, Pin, and Delete (5-second undo toast).
• Live search box filters text notes case-insensitively.
• "Clear all notes" button displays a confirmation dialog with an "Also delete pinned notes" checkbox.
• Exporting notes (.txt downloads):
    ◦ Single text note download: saved as note-[slug]-YYYY-MM-DD-HHmm.txt or note-YYYY-MM-DD-HHmm.txt with UTF-8 Windows line endings (\r\n).
    ◦ Master notes export: "Download all notes (.txt)" button in the tab header produces kam-chai-nabirsa-notes-YYYY-MM-DD.txt with header "Kam Chai Nabirsa - notes export - © 2026 Kushal Parajuli\r\n", the export date, and 40-dash separators. Images are represented as placeholder lines [image note: <fileName or 'pasted image'>, <date>] because raw images cannot be embedded in a plain text file. If no text notes exist, shows a friendly message.
    ◦ Image download: fetches full image via NOTE_GET_FULL and downloads as note-image-YYYY-MM-DD-HHmm.<ext>.
    ◦ All downloads implemented via temporary <a download> tag and URL.revokeObjectURL without requiring extra permissions. Pure export formatting logic lives in shared/notes-export.js.
8.5 Downloader tab
• Link input, a Video (mp4) or Audio (mp3) toggle, and a Download button.
• Status line: Helper online (green) or Helper offline (red, with a short how-to-start message). Ping the helper when the panel opens, then every 10 seconds while the tab is visible.
• On submit, send DOWNLOAD_START to the service worker, which calls the helper. Show a job list with a progress bar, status, and final file name. Poll /status/<id> every 1 second while a job is running.
• Validate that the link starts with http:// or https:// before sending.
• Friendly errors: helper offline, invalid link, unsupported site, ffmpeg missing, network failure.
• History of the last 20 downloads, with a Clear history button and an Open folder hint (the helper's save location is displayed as text).
• Only the --no-playlist behaviour: one link, one file.
• Show a short notice in the tab: Use only for content you own or have permission to download.
8.6 Settings (gear icon inside the panel)
Opacity, edge side, theme, sound on/off, reminder snooze length, helper token and port, notes auto-delete days, and an Export / Import JSON backup for todos and text notes (images excluded or base64 if size allows; keep it simple).
9. Message protocol (widget <-> service worker)
Define constants in shared/messages.js. Every request returns { ok: true, data } or { ok: false, error }. Handlers must be async-safe (return true from the listener when responding asynchronously).
Type
Purpose
TODO_LIST, TODO_ADD, TODO_UPDATE, TODO_DELETE, TODO_TOGGLE, TODO_CLEAR_DONE
Todo CRUD
NOTE_LIST, NOTE_ADD, NOTE_UPDATE, NOTE_DELETE, NOTE_PIN, NOTES_CLEAR, NOTE_GET_FULL
Notes CRUD and full image fetching (NOTE_LIST returns notes without Blobs; Blobs reconstructed from data URLs)
NOTES_CHANGED, TODOS_CHANGED
Broadcast events notifying all open tabs to synchronize
HELPER_PING
Check helper availability
DOWNLOAD_START, DOWNLOAD_STATUS, DOWNLOAD_LIST, DOWNLOAD_CLEAR
Downloader
SETTINGS_GET, SETTINGS_SET
Preferences
BADGE_REFRESH
Recalculate the badge count
Blobs can be passed in messages in modern Chrome, but if a transfer proves unreliable, convert to ArrayBuffer plus mimeType and rebuild on receive.
10. Local helper (Python)
Why it exists
Browser extensions cannot extract downloadable files from most video sites (streams are signed, segmented, sometimes encrypted) and cannot convert to mp3 without a heavy encoder. A small local program running yt-dlp and ffmpeg does this reliably on the owner's own machine.
Setup (guide the owner step by step in Phase 6)
1.  Install Python 3.10+ (tick Add Python to PATH).
2.  Create a virtual environment inside helper\ and install requirements.txt (flask, yt-dlp).
3.  Install ffmpeg and confirm ffmpeg -version works in a new terminal.
4.  Run python server.py. On the first run it generates a random token into helper\token.txt (git-ignored) and prints it. The owner pastes it into the extension settings.
Configuration (helper/config.json, git-ignored; ship config.example.json)
• port: 8765
• outputDir: default %USERPROFILE%\Downloads\KamChaiNabirsa
• maxConcurrentJobs: 2
Endpoints (JSON)
Method and path
Body
Response
GET /ping
none
{ ok: true, version, ytDlpVersion, ffmpeg: true or false }
POST /download
{ url, type } where type is video or audio
{ jobId }
GET /status/<jobId>
none
{ state, progress, filename, error }
POST /update-ytdlp
none
{ ok, output } (runs yt-dlp -U or pip install -U yt-dlp)
yt-dlp behaviour
• Video: best video plus best audio merged into mp4, capped at 1080p by default (format selector such as bv*[height<=1080]+ba/b, with --merge-output-format mp4).
• Audio: -x --audio-format mp3 --audio-quality 0.
• Always --no-playlist, --newline, and a progress template so progress can be parsed from stdout.
• Output template inside outputDir: %(title).150B [%(id)s].%(ext)s (sanitised file names).
• Run each job in a background thread and store state in memory. Return clear error categories (ffmpeg_missing, unsupported_url, network, unknown).
11. Security requirements (non-negotiable)
1.  The helper binds to 127.0.0.1 only, never 0.0.0.0.
2.  Every request except /ping must include header X-KCN-Token matching helper/token.txt. Compare with a constant-time function. Reject otherwise with 401.
3.  CORS: allow only the extension origin (chrome-extension://<extension-id>). The owner provides the id from chrome://extensions; store it in config.json. Reject other origins.
4.  Run yt-dlp and ffmpeg through subprocess with an argument list. Never shell=True, never build commands by string concatenation.
5.  Validate URLs (http or https only, max length 2048). Reject file:, javascript: and local addresses.
6.  The extension requests no permissions beyond Section 5. No remote code, no eval, no inline scripts, no analytics.
7.  Treat all pasted and stored content as untrusted. When rendering notes, use textContent (never innerHTML with user data).
8.  Never log the token. Never commit it.
12. UI and UX guidelines
• Clean, minimal, rounded design. Light and dark themes (prefers-color-scheme plus manual override).
• Brand: a small checkmark or bell style logo, accent colour of your choosing (propose one), readable font stack with system fonts (no external font requests).
• Smooth, subtle animations (under 200 ms) and respect prefers-reduced-motion.
• Every action gives feedback (toast, disabled state, spinner). Every error has a plain-language message.
• Fully usable with the keyboard. Minimum 4.5:1 text contrast.
13. Build phases and acceptance criteria
Complete each phase fully, then stop for the owner's test and confirmation.
Phase 0: Repository and skeleton
• Git connected to the GitHub repo (Section 4), README.md, .gitignore, LICENSE, docs/PROJECT_SPEC.md, folder skeleton committed and pushed.
• Done when: the GitHub page shows the README, the description and topics are set (guide the owner for the manual part).
Phase 1: Extension shell and floating icon
• manifest.json, icons, service worker stub, content script that injects the Shadow DOM widget.
• Done when: after loading unpacked, a semi-transparent icon appears on normal web pages, expands on hover/click, collapses on Esc, is draggable, and its position persists after reload.
Phase 2: Todo tab with storage
• db.js wrapper, message router, todo CRUD with the UI from 8.2.
• Done when: todos persist across page reloads, across different websites, and after restarting Chrome.
Phase 3: Reminders
• Alarms, notification with Snooze and Done, badge, rehydration, then offscreen sound.
• Done when: a reminder set for two minutes ahead fires a notification, updates the badge and plays sound (with sound on); closing and reopening Chrome re-creates pending alarms; snooze and done work.
Phase 4: Notes tab
• Text paste, image paste, drag and drop, pinning, search, delete, size limit, Copy/Download image.
• Done when: a screenshot pasted with Ctrl+V appears as a card and survives a browser restart; an 11 MB image is refused with a friendly message.
Phase 5: Settings and polish
• Settings panel, themes, opacity, sound toggle, snooze length, JSON export/import, popup fallback page.
• Done when: all settings persist and apply live, and export then import restores todos and text notes.
Phase 6: Downloader UI and helper skeleton
• Downloader tab UI with the status indicator, Python helper with /ping, token and CORS rules, helper/README.md.
• Done when: the tab shows Helper online when server.py is running and offline when stopped, and requests without the token get 401.
Phase 7: Real downloads
• /download, /status, yt-dlp and ffmpeg integration, progress polling, history, friendly errors.
• Done when: a link the owner is permitted to download produces a playable mp4 and an mp3 in the output folder, with progress shown in the tab, and errors (bad link, helper offline, ffmpeg missing) are explained clearly.
Phase 8: Hardening, documentation and release
• Run the Section 15 checklist, fix issues, write docs/ARCHITECTURE.md, finalise README with screenshots placeholders, tag v0.1.0.
• Done when: the checklist passes and the GitHub repository is clean and documented.
14. Coding standards
• ES modules, const/let, async/await, strict equality, no global variables.
• Small single-purpose functions and files. Descriptive names. JSDoc on exported functions.
• Wrap every storage, messaging and network call in try/catch and return friendly errors.
• Python: type hints where sensible, black style formatting, clear docstrings.
• No dead code, no commented-out blocks, no TODOs left without an issue note in the phase summary.
• Keep dependencies at zero for the extension and minimal for the helper.
15. Testing checklist (manual)
[ ] Widget appears on at least five different normal websites and does not break their layout.
[ ] Widget absent on chrome://extensions without errors; popup fallback works.
[ ] Todos are identical across different sites (proves storage is in the extension origin).
[ ] Reminder fires after Chrome restart scenarios and after the service worker has gone idle.
[ ] Deleting or completing a todo cancels its alarm.
[ ] Pasted image survives a restart; large image rejected.
[ ] No innerHTML with user content; XSS test string in a todo shows as plain text.
[ ] Helper rejects missing or wrong token and foreign origins; listens on 127.0.0.1 only.
[ ] Helper offline state handled gracefully in the UI.
[ ] No errors in the service worker console or the page console during normal use.
[ ] Extension works in both light and dark themes.
16. README requirements
The repository README.md must include:
1.  Title Kam Chai Nabirsa with the tagline Don't forget your work, and a one-paragraph description.
2.  Feature list for the three tabs.
3.  Screenshot placeholders (add real images later).
4.  Installation: clone the repo, load unpacked from the extension folder (step by step with Chrome menu names).
5.  Helper setup (optional, for the downloader): Python, venv, requirements, ffmpeg, first run and token, how to paste the token into settings.
6.  Usage guide for each tab and reminders.
7.  Project structure summary and a short Architecture note (why storage lives in the service worker).
8.  Privacy: all data stays on this device. No servers, accounts or tracking.
9.  Responsible use notice from Section 17.
10.  Roadmap / known limits (content scripts not running on chrome:// pages, reminders need Chrome running).
11.  License section and a contributing note (practice project).
17. Responsible use
This is a personal practice project for local use. The downloader must only be used with content the user owns, that is in the public domain or under a permissive licence, or that they have explicit permission to download. Downloading from many streaming platforms violates their Terms of Service, and unauthorised copying can break copyright law. The README and the Downloader tab must show this notice. The project is not intended for the Chrome Web Store.
18. Definition of done (v0.1.0)
• All phases complete and the Section 15 checklist passes.
• The extension survives browser restarts and works without any manual start-up.
• The README, spec and architecture docs are in the repository, with a clean commit history and a v0.1.0 tag pushed to GitHub.
• No secrets in Git history.