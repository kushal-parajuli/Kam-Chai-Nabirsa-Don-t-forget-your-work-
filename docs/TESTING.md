# Kam Chai Nabirsa - Verification & Manual Testing Guide

**Author:** Kushal Parajuli  
**Copyright:** © 2026 Kushal Parajuli  
**Version:** 0.1.0

This document outlines the testing procedures for verifying the **Kam Chai Nabirsa** Chrome extension and local Python helper server across all functional phases.

---

## 1. Automated Test Suites

Before manual verification, ensure all automated unit and integration tests pass cleanly.

### 1.1 Node.js Extension Test Suite
Runs 33 automated tests covering IndexedDB operations, service worker messaging, reminder scheduling, settings clamping, notes export, and static AST syntax verification:
```powershell
npm test
```
**Expected Output:**
```text
✔ IndexedDB db.js Tests
✔ Downloader & Helper Client (Phase 7)
✔ Helper Client (extension/background/helper-client.js)
✔ Phase 4: Notes Tab & Export Tests
✔ Service Worker End-To-End & Upgrade Tests
✔ Phase 5: Settings, Polish, Backup, and Auto-Delete Tests
✔ Static Checks & Manifest Verification
ℹ tests 33
ℹ pass 33
ℹ fail 0
```

### 1.2 Python Helper Test Suite
Runs 12 pytest tests verifying token authentication, URL validation, argument construction, subprocess execution, error classification, and cancellation:
```powershell
.\helper\venv\Scripts\pytest helper/tests
```
**Expected Output:**
```text
helper\tests\test_server.py ............ [100%]
12 passed in 1.02s
```

---

## 2. Chrome Extension Manual Verification Checklist (Section 15)

Follow these steps to manually test the extension inside Google Chrome.

### Step 1: Loading the Unpacked Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** (top-right corner) to **ON**.
3. Click **Load unpacked** (top-left) and select the `extension` folder inside this repository:
   ```text
   D:\Kam Chai Nabirsa\extension
   ```
4. Verify that the extension card appears with:
   - Name: **Kam Chai Nabirsa**
   - Version: **0.1.0**
   - Description: "Don't forget your work - floating to-do list, reminders, notes, and local media downloader."
   - No errors or warning badges on initial load.

---

### Step 2: Widget Mount & Isolation Verification
- [ ] **Appearance across normal websites**:
  1. Open 5 distinct websites in separate tabs:
     - `https://en.wikipedia.org`
     - `https://github.com`
     - `https://developer.mozilla.org`
     - `https://news.ycombinator.com`
     - `https://www.google.com`
  2. Confirm the small floating round pill (40px) appears on the right edge with 35% resting opacity.
  3. Confirm hovering highlights the pill (full opacity, subtle scale, glow) without opening the panel.
  4. Confirm clicking the pill opens the panel smoothly.
  5. Confirm pressing `Esc` or clicking outside collapses the panel.
  6. Confirm dragging the pill vertically moves it smoothly along the edge.
- [ ] **Internal Pages & Popup Fallback**:
  1. Navigate to `chrome://extensions` or `chrome://settings`.
  2. Verify the floating widget is **absent** (content scripts cannot run on internal browser URLs).
  3. Click the extension icon in Chrome's toolbar.
  4. Confirm the toolbar popup opens with quick action controls and the "Test Alarm Sound (3s)" button.

---

### Step 3: Todo Tab Verification
- [ ] **Task Creation & Persistence**:
  1. In any open tab, open the widget, enter `Review documentation`, and press Enter.
  2. Switch to another tab or refresh the page; confirm the task appears in both tabs immediately (origin-isolated storage).
- [ ] **Completion & Collapsible Section**:
  1. Tick the checkbox on `Review documentation`.
  2. Confirm the task moves into the "Completed (1)" section with soft green tint, strikethrough, and de-emphasized opacity.
  3. Click the "Completed" header to collapse and expand the section.
  4. Click **Clear completed**. Verify the completed task is deleted cleanly without errors.
- [ ] **XSS Injection Defense**:
  1. Add a todo with title `<img src=x onerror=alert('xss')>`.
  2. Confirm the text displays verbatim as plain text; no script alert executes.

---

### Step 4: Reminders & Alarm Verification
- [ ] **Countdown Chips & Exact Alarms**:
  1. Add a task `Submit status report`.
  2. Click the bell icon and select the `+10m` quick chip or set a custom time 2 minutes into the future.
  3. Confirm the live preview string appears ("Will remind: ... (in 2m)"). Click Add.
  4. Confirm the countdown chip shows `in 2m` (amber if < 5 minutes).
- [ ] **Alarm Ringing & Sound**:
  1. When the reminder time arrives:
     - The widget auto-opens and pins itself open.
     - The panel pulses with a subtle red border.
     - The red alarm banner appears with Stop, Snooze 5 min, and Mark done buttons.
     - Synthetic 880 Hz beep audio plays through the offscreen document.
     - A persistent Chrome system notification appears.
  2. Click **Stop**; confirm audio ceases immediately, but the banner remains until dismissed.
  3. Repeat with **Snooze 5 min**; confirm a new reminder is scheduled 5 minutes ahead.
  4. Repeat with **Mark done**; confirm the alarm is cleared and the task is moved to Completed.
- [ ] **Missed Reminder Detection**:
  1. Add a task with a reminder 1 minute ahead.
  2. Close Google Chrome completely.
  3. Wait 2 minutes, then reopen Chrome.
  4. Confirm the alarm triggers immediately as a "Missed" reminder upon startup.

---

### Step 5: Notes Tab & Export Verification
- [ ] **Text Notes**:
  1. Switch to the **Notes** tab.
  2. Paste a text snippet into the textarea and click **Save note** (or press `Ctrl+Enter`).
  3. Confirm the note card appears with creation timestamp.
  4. Click the Pin icon; confirm the card stays pinned to the top.
  5. Click **Download .txt** on the card; confirm `note-[slug]-YYYY-MM-DD-HHmm.txt` downloads with UTF-8 Windows line endings (`\r\n`).
  6. Click **Download all notes (.txt)** in the tab header; confirm master export file downloads containing copyright header and dashed separators.
- [ ] **Image Pastes & 10 MB Limits**:
  1. Take a screenshot (`Win+Shift+S`) and press `Ctrl+V` inside the Notes drop zone.
  2. Confirm the screenshot appears as an image note with thumbnail preview.
  3. Click **Copy image**; confirm image is copied to clipboard.
  4. Click **Download image**; confirm the full image file downloads.
  5. Attempt to drag an image exceeding 10 MB; confirm a friendly rejection message appears ("Image exceeds 10 MB limit").

---

### Step 6: Settings & Backup Verification
- [ ] **Live Preferences**:
  1. Click the gear icon in the header to open Settings.
  2. Change **Theme** to `Dark`; confirm dark theme applies instantly.
  3. Adjust the **Resting Opacity** slider to `60%`; confirm pill opacity updates live.
  4. Adjust **Widget Size** to `Large`; confirm panel dimensions scale smoothly.
- [ ] **JSON Backup & Restore Round-Trip**:
  1. In Settings > Data, click **Export JSON Backup**.
  2. Confirm file `kam-chai-nabirsa-backup-YYYY-MM-DD.json` downloads.
  3. Inspect the JSON file; verify that `helperToken` is strictly omitted.
  4. Click **Reset Local Data** to clear the database.
  5. Click **Import JSON Backup** and select the downloaded backup file.
  6. Confirm all todos and text notes are fully restored across all tabs.

---

### Step 7: Downloader Tab & Local Helper Verification
- [ ] **Helper Offline State**:
  1. In the Downloader tab, verify the status banner shows `Helper offline (start helper\start-helper.bat)` with a red dot.
- [ ] **Helper Launch & Authentication**:
  1. Start the helper server:
     ```powershell
     cd helper
     .\venv\Scripts\activate
     python server.py
     ```
  2. Copy the generated token from `helper/token.txt`.
  3. In extension Settings > Helper, paste the token.
  4. Switch back to Downloader tab; confirm status banner turns green: `Helper online` with `ffmpeg found`.
- [ ] **Download Execution & Cancellation**:
  1. Enter a valid video or audio URL.
  2. Select **Video (MP4)** or **Audio (MP3)** and click **Download**.
  3. Confirm the job appears in the activity list with status pill and animated progress bar (0–100%).
  4. Click **Cancel** on a running job; verify state transitions to `Cancelled`.
  5. Click **Open folder**; verify File Explorer opens `%USERPROFILE%\Downloads\KamChaiNabirsa`.
  6. Click **Clear**; verify finished download history clears.
