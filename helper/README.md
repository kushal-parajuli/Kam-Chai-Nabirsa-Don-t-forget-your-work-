# Kam Chai Nabirsa - Local Helper Server Setup
### Windows Installation and Quickstart Guide
**Author:** Kushal Parajuli  
**Copyright:** © 2026 Kushal Parajuli. All rights reserved.

The Kam Chai Nabirsa Local Helper is a lightweight companion Flask server that runs locally on your machine (`127.0.0.1:8765`). It connects to `yt-dlp` and `ffmpeg` to handle video (MP4) and audio (MP3) downloads without exposing any ports to the local network or external websites.

---

## 1. Prerequisites

### Step A: Install Python 3.10+
1. Download Python 3.10 or newer from [python.org](https://www.python.org/downloads/).
2. **Important:** During installation, check the box **"Add Python to PATH"**.
3. Verify Python in PowerShell:
   ```powershell
   python --version
   ```

### Step B: Install FFmpeg (Required for MP3 audio conversion and 1080p video merging)
1. In Windows PowerShell or Terminal, run:
   ```powershell
   winget install Gyan.FFmpeg
   ```
2. **Close your terminal window** and open a **NEW terminal window** to refresh your PATH.
3. Verify FFmpeg installation:
   ```powershell
   ffmpeg -version
   ```
   You should see output starting with `ffmpeg version ...`.

---

## 2. Virtual Environment & Dependencies Setup

Open PowerShell in the `helper/` directory (`D:\Kam Chai Nabirsa\helper`):

1. Create a Python virtual environment:
   ```powershell
   cd "D:\Kam Chai Nabirsa\helper"
   python -m venv venv
   ```

2. Activate the virtual environment:
   ```powershell
   .\venv\Scripts\Activate.ps1
   ```
   *(Note: If PowerShell shows an Execution Policy restriction, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` or use standard Command Prompt).*

3. Install required packages:
   ```powershell
   pip install -r requirements.txt
   ```

---

## 3. Configuration & Extension Security Setup

1. Copy the example configuration file:
   ```powershell
   copy config.example.json config.json
   ```

2. Find your Chrome Extension ID:
   - In Google Chrome, go to `chrome://extensions`.
   - Enable **Developer mode** (toggle in the top-right corner).
   - Find the card for **Kam Chai Nabirsa**.
   - Copy the string of letters after `ID:` (e.g. `kgibhlpnjgooiocmpmbhbdoeomipggdf`).

3. Open `helper/config.json` in an editor and update `allowedOrigin`:
   ```json
   {
     "port": 8765,
     "outputDir": "%USERPROFILE%\\Downloads\\KamChaiNabirsa",
     "allowedOrigin": "chrome-extension://PASTE_YOUR_EXTENSION_ID_HERE",
     "maxConcurrentJobs": 2
   }
   ```
   *(CORS strictly rejects any origin that does not match this extension ID with HTTP 403).*

---

## 4. Running the Helper Server

You can start the server in two easy ways:

### Option 1: Double-Click (Recommended)
Double-click `start-helper.bat` in the `helper/` folder. This script automatically activates the virtual environment and launches `server.py`.

### Option 2: Command Line
```powershell
cd "D:\Kam Chai Nabirsa\helper"
.\venv\Scripts\activate
python server.py
```

Upon first startup, the server will generate a cryptographically random 32-byte secret into `helper/token.txt`.

---

## 5. Linking Helper Token to the Extension

1. Open `helper/token.txt` and copy the secret token string.
2. In Chrome, click the Kam Chai Nabirsa floating widget or toolbar icon.
3. Open **Settings** (gear icon in the widget panel).
4. Paste the token into the **Local Helper Token** field.
5. In the **Downloader** tab, the status indicator will turn green:  
   🟢 **Helper online** (with `ffmpeg found`).

---

## 6. Running Tests

To verify the server, endpoints, token authentication, and CORS restrictions:
```powershell
cd "D:\Kam Chai Nabirsa"
.\helper\venv\Scripts\pytest helper/tests
```
