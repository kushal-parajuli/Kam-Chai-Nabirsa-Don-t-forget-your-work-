# © 2026 Kushal Parajuli

"""
Kam Chai Nabirsa - Local Helper Server (Phase 7 Real Downloads)
Binds strictly to 127.0.0.1 with token-based authentication, extension origin CORS protection,
URL validation, safe argument list subprocess execution, and background download job queue.
"""

import hmac
import ipaddress
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from flask import Flask, jsonify, make_response, request
import yt_dlp

BASE_DIR = Path(__file__).resolve().parent
TOKEN_FILE = BASE_DIR / "token.txt"
CONFIG_FILE = BASE_DIR / "config.json"
EXAMPLE_CONFIG_FILE = BASE_DIR / "config.example.json"

VERSION = "0.1.0"
HOST = "127.0.0.1"


def load_config() -> dict:
    """Loads config.json if present, otherwise defaults."""
    default_download_dir = os.path.expandvars(r"%USERPROFILE%\Downloads\KamChaiNabirsa")
    defaults = {
        "port": 8765,
        "outputDir": default_download_dir,
        "allowedOrigin": "",
        "maxConcurrentJobs": 2,
    }
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
                defaults.update(user_cfg)
        except Exception as e:
            print(f"[KCN Helper] Failed to read config.json, using defaults: {e}")
    return defaults


def get_or_create_token() -> str:
    """Reads or generates a cryptographically secure 32-byte auth token."""
    if TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            return token

    # Generate new token
    new_token = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(new_token, encoding="utf-8")
    print(f"[KCN Helper] Generated new authentication token at: {TOKEN_FILE}")
    print("[KCN Helper] (Copy this token into the Kam Chai Nabirsa extension Settings)")
    return new_token


# Initialize token and config
CONFIG = load_config()
AUTH_TOKEN = get_or_create_token()

app = Flask(__name__)


# =========================================================================
# URL Safety Validation
# =========================================================================

def is_safe_url(url: str) -> Tuple[bool, str]:
    """
    Validates a URL for security.
    Rules:
    - Must be http:// or https://
    - Length between 1 and 2048 chars
    - Must not start with '-'
    - Must not target loopback or private network addresses
    - Rejects file:, javascript:, chrome:, ftp: schemes
    """
    if not url or not isinstance(url, str):
        return False, "URL is required"

    trimmed = url.strip()

    if len(trimmed) > 2048:
        return False, "URL exceeds maximum permitted length of 2048 characters"

    if trimmed.startswith("-"):
        return False, "URL cannot start with a hyphen (-)"

    try:
        parsed = urllib.parse.urlparse(trimmed)
    except Exception as e:
        return False, f"Malformed URL: {e}"

    if parsed.scheme not in ("http", "https"):
        return False, f"Unsupported scheme '{parsed.scheme}'. Only http:// and https:// are permitted"

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        return False, "URL must contain a valid hostname"

    # Reject localhost or loopback names
    if hostname in ("localhost", "localhost.localdomain", "broadcasthost"):
        return False, "Downloading from local/loopback hostnames is prohibited"

    # Check for IP literal addresses
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_loopback:
            return False, "Downloading from loopback IP addresses is prohibited"
        if ip.is_private:
            return False, "Downloading from private local network IP addresses is prohibited"
        if ip.is_reserved or ip.is_unspecified:
            return False, "Downloading from reserved IP addresses is prohibited"
    except ValueError:
        # Hostname is a domain name, not an IP literal
        pass

    return True, ""


# =========================================================================
# Command Construction
# =========================================================================

def build_ytdlp_command(
    url: str,
    media_type: str,
    output_dir: str,
    custom_binary: Optional[List[str]] = None
) -> List[str]:
    """
    Constructs the exact argument list for yt-dlp execution.
    Never uses shell=True or string concatenation.
    Includes '--' directly before the URL to prevent option injection.
    """
    # Use provided binary or python -m yt_dlp
    binary = custom_binary or [sys.executable, "-m", "yt_dlp"]

    os.makedirs(output_dir, exist_ok=True)
    out_template = os.path.join(output_dir, "%(title).150B [%(id)s].%(ext)s")

    cmd = list(binary)
    cmd.extend([
        "--ignore-config",
        "--no-playlist",
        "--newline",
        "--restrict-filenames",
        "--progress-template", "kcn-progress:%(progress._percent_str)s",
        "-o", out_template,
    ])

    if media_type == "audio":
        cmd.extend([
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
        ])
    else:
        # Default: Video mode capped at 1080p
        cmd.extend([
            "-f", "bv*[height<=1080]+ba/b",
            "--merge-output-format", "mp4",
        ])

    # End of options marker prevents option injection via crafted URLs
    cmd.extend(["--", url])
    return cmd


# =========================================================================
# Download Job Manager
# =========================================================================

class DownloadJob:
    """Represents a download job and its lifecycle state."""

    def __init__(self, job_id: str, url: str, media_type: str, output_dir: str):
        self.id = job_id
        self.url = url
        self.type = media_type
        self.output_dir = output_dir
        self.state = "queued"  # queued | running | done | error | cancelled
        self.progress = 0.0
        self.filename: Optional[str] = None
        self.error: Optional[str] = None
        self.error_code: Optional[str] = None
        self.process: Optional[subprocess.Popen] = None
        self.created_at = time.time()
        self.updated_at = time.time()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "type": self.type,
            "state": self.state,
            "progress": round(self.progress, 1),
            "filename": self.filename,
            "error": self.error,
            "errorCode": self.error_code,
            "createdAt": int(self.created_at * 1000),
            "updatedAt": int(self.updated_at * 1000),
        }


class JobManager:
    """Thread-safe manager for download job queue and execution."""

    def __init__(self, max_concurrent: int = 2):
        self.max_concurrent = max_concurrent
        self.jobs: Dict[str, DownloadJob] = {}
        self.queue: List[str] = []
        self.active_count = 0
        self.lock = threading.Lock()
        self.custom_binary: Optional[List[str]] = None

    def create_job(self, url: str, media_type: str, output_dir: str) -> DownloadJob:
        with self.lock:
            job_id = str(uuid.uuid4())
            job = DownloadJob(job_id, url, media_type, output_dir)
            self.jobs[job_id] = job
            self.queue.append(job_id)
            self._schedule_next()
            return job

    def get_job(self, job_id: str) -> Optional[DownloadJob]:
        with self.lock:
            return self.jobs.get(job_id)

    def cancel_job(self, job_id: str) -> bool:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return False

            if job.state in ("done", "error", "cancelled"):
                return True

            if job.state == "queued":
                if job_id in self.queue:
                    self.queue.remove(job_id)
                job.state = "cancelled"
                job.error = "Download cancelled by user"
                job.error_code = "cancelled"
                job.updated_at = time.time()
                return True

            if job.state == "running":
                if job.process:
                    try:
                        job.process.terminate()
                    except Exception:
                        pass
                job.state = "cancelled"
                job.error = "Download cancelled by user"
                job.error_code = "cancelled"
                job.updated_at = time.time()
                return True

            return False

    def _schedule_next(self):
        """Dispatches queued jobs if under concurrency limit."""
        while self.active_count < self.max_concurrent and self.queue:
            next_id = self.queue.pop(0)
            job = self.jobs.get(next_id)
            if job and job.state == "queued":
                job.state = "running"
                job.updated_at = time.time()
                self.active_count += 1
                worker = threading.Thread(
                    target=self._run_job,
                    args=(job,),
                    daemon=True
                )
                worker.start()

    def _classify_error(self, stderr_text: str, return_code: int) -> Tuple[str, str]:
        """Categorizes yt-dlp error output into friendly error codes."""
        text = stderr_text.lower()
        if "ffmpeg" in text or "ffprobe" in text:
            return "ffmpeg_missing", "FFmpeg is required for conversion or merging but was not found. Please install FFmpeg."
        if "unsupported url" in text:
            return "unsupported_url", "This website or URL format is not supported by yt-dlp."
        if any(w in text for w in ("sign in", "confirm you're not a bot", "private video", "login required")):
            return "private_or_login_required", "This video requires login, age verification, or is private."
        if any(w in text for w in ("unable to download", "connection refused", "timed out", "network")):
            return "network", "Network connection error while downloading media."
        return "unknown", f"Download failed (exit code {return_code}): {stderr_text.strip()[:200]}"

    def _run_job(self, job: DownloadJob):
        """Worker thread executing yt-dlp process."""
        cmd = build_ytdlp_command(
            job.url,
            job.type,
            job.output_dir,
            custom_binary=self.custom_binary
        )

        stderr_lines = []
        progress_re = re.compile(r"kcn-progress:\s*([0-9.]+)%")
        dest_re = re.compile(r'\[(?:download|Merger|ExtractAudio)\]\s+(?:Destination:\s+|Merging formats into\s+)"?([^"\n\r]+)"?')

        try:
            with self.lock:
                if job.state == "cancelled":
                    return

            # Execute safely without shell=True
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True
            )

            with self.lock:
                if job.state == "cancelled":
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                    return
                job.process = proc

            # Read stdout line by line for progress tracking
            if proc.stdout:
                for line in proc.stdout:
                    if job.state == "cancelled":
                        break
                    match = progress_re.search(line)
                    if match:
                        try:
                            job.progress = float(match.group(1))
                            job.updated_at = time.time()
                        except ValueError:
                            pass

                    dest_match = dest_re.search(line)
                    if dest_match:
                        raw_dest = dest_match.group(1).strip()
                        job.filename = os.path.basename(raw_dest)
                        job.updated_at = time.time()

            # Collect any stderr output
            if proc.stderr:
                for line in proc.stderr:
                    stderr_lines.append(line)

            proc.wait()

            with self.lock:
                if job.state != "cancelled":
                    if proc.returncode == 0:
                        job.state = "done"
                        job.progress = 100.0
                        if not job.filename:
                            # Try finding newest file in output directory
                            try:
                                files = [
                                    os.path.join(job.output_dir, f)
                                    for f in os.listdir(job.output_dir)
                                    if os.path.isfile(os.path.join(job.output_dir, f))
                                ]
                                if files:
                                    newest = max(files, key=os.path.getctime)
                                    job.filename = os.path.basename(newest)
                            except Exception:
                                pass
                    else:
                        full_err = "".join(stderr_lines)
                        err_code, friendly_msg = self._classify_error(full_err, proc.returncode)
                        job.state = "error"
                        job.error_code = err_code
                        job.error = friendly_msg
        except Exception as ex:
            with self.lock:
                if job.state != "cancelled":
                    job.state = "error"
                    job.error_code = "unknown"
                    job.error = str(ex)
        finally:
            with self.lock:
                job.updated_at = time.time()
                self.active_count = max(0, self.active_count - 1)
                self._schedule_next()


# Initialize JobManager
MAX_CONCURRENT = int(CONFIG.get("maxConcurrentJobs", 2))
JOB_MANAGER = JobManager(max_concurrent=MAX_CONCURRENT)


# =========================================================================
# CORS & Authentication
# =========================================================================

def is_origin_allowed(origin: str) -> bool:
    """Validates request origin against allowedOrigin from config."""
    if not origin:
        return True  # Internal / direct requests without origin header

    configured_origin = CONFIG.get("allowedOrigin", "").strip()
    if configured_origin and configured_origin != "chrome-extension://YOUR_EXTENSION_ID_HERE":
        return origin == configured_origin

    # Default fallback: allow chrome-extension:// origins
    return origin.startswith("chrome-extension://")


@app.before_request
def handle_cors_and_preflight():
    """Validates origin and handles CORS preflight OPTIONS requests."""
    origin = request.headers.get("Origin")

    if origin and not is_origin_allowed(origin):
        return make_response(
            jsonify({"ok": False, "error": f"Origin not allowed: {origin}"}), 403
        )

    if request.method == "OPTIONS":
        resp = make_response("", 204)
        if origin:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-KCN-Token"
        return resp


@app.after_request
def add_cors_headers(response):
    """Adds CORS headers to outgoing responses if origin is valid."""
    origin = request.headers.get("Origin")
    if origin and is_origin_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-KCN-Token"
    return response


def verify_auth_token() -> bool:
    """Verifies X-KCN-Token using constant-time comparison."""
    provided_token = request.headers.get("X-KCN-Token", "").strip()
    if not provided_token:
        return False
    return hmac.compare_digest(provided_token, AUTH_TOKEN)


# =========================================================================
# Endpoints
# =========================================================================

@app.route("/ping", methods=["GET"])
def ping():
    """Unauthenticated healthcheck endpoint."""
    ffmpeg_path = shutil.which("ffmpeg")
    return jsonify({
        "ok": True,
        "version": VERSION,
        "ytDlpVersion": yt_dlp.version.__version__,
        "ffmpeg": bool(ffmpeg_path),
        "ffmpegPath": ffmpeg_path or None,
    })


@app.route("/auth-check", methods=["GET"])
def auth_check():
    """Authenticated endpoint to verify token validity from extension."""
    if not verify_auth_token():
        return make_response(
            jsonify({"ok": False, "error": "Unauthorized: invalid or missing X-KCN-Token"}),
            401,
        )
    return jsonify({"ok": True, "authenticated": True})


@app.route("/download", methods=["POST"])
def download():
    """Queues a new download job."""
    if not verify_auth_token():
        return make_response(
            jsonify({"ok": False, "error": "Unauthorized: invalid or missing X-KCN-Token"}),
            401,
        )

    data = request.get_json(silent=True) or {}
    url = data.get("url", "")
    media_type = "audio" if data.get("type") == "audio" else "video"

    is_safe, error_msg = is_safe_url(url)
    if not is_safe:
        return make_response(jsonify({"ok": False, "error": error_msg}), 400)

    output_dir = CONFIG.get("outputDir", os.path.expandvars(r"%USERPROFILE%\Downloads\KamChaiNabirsa"))
    job = JOB_MANAGER.create_job(url, media_type, output_dir)

    return jsonify({
        "ok": True,
        "jobId": job.id,
        "state": job.state
    })


@app.route("/status/<job_id>", methods=["GET"])
def status(job_id):
    """Retrieves status and progress of a download job."""
    if not verify_auth_token():
        return make_response(
            jsonify({"ok": False, "error": "Unauthorized: invalid or missing X-KCN-Token"}),
            401,
        )

    job = JOB_MANAGER.get_job(job_id)
    if not job:
        return make_response(jsonify({"ok": False, "error": "Job not found"}), 404)

    return jsonify({"ok": True, **job.to_dict()})


@app.route("/cancel/<job_id>", methods=["POST"])
def cancel(job_id):
    """Cancels a running or queued download job."""
    if not verify_auth_token():
        return make_response(
            jsonify({"ok": False, "error": "Unauthorized: invalid or missing X-KCN-Token"}),
            401,
        )

    success = JOB_MANAGER.cancel_job(job_id)
    if not success:
        return make_response(jsonify({"ok": False, "error": "Job not found or already finished"}), 404)

    return jsonify({"ok": True, "jobId": job_id, "state": "cancelled"})


@app.route("/open-folder", methods=["POST"])
def open_folder():
    """Opens the configured download directory in the file manager."""
    if not verify_auth_token():
        return make_response(
            jsonify({"ok": False, "error": "Unauthorized: invalid or missing X-KCN-Token"}),
            401,
        )

    output_dir = CONFIG.get("outputDir", os.path.expandvars(r"%USERPROFILE%\Downloads\KamChaiNabirsa"))
    os.makedirs(output_dir, exist_ok=True)

    try:
        if sys.platform == "win32":
            os.startfile(output_dir)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", output_dir])
        else:
            subprocess.Popen(["xdg-open", output_dir])
        return jsonify({"ok": True, "path": output_dir})
    except Exception as e:
        return make_response(jsonify({"ok": False, "error": f"Failed to open folder: {e}"}), 500)


@app.route("/update-ytdlp", methods=["POST"])
def update_ytdlp():
    """Updates yt-dlp to latest version via pip."""
    if not verify_auth_token():
        return make_response(
            jsonify({"ok": False, "error": "Unauthorized: invalid or missing X-KCN-Token"}),
            401,
        )

    try:
        res = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-U", "yt-dlp"],
            capture_output=True,
            text=True,
            timeout=60
        )
        return jsonify({
            "ok": res.returncode == 0,
            "output": res.stdout or res.stderr
        })
    except Exception as e:
        return make_response(jsonify({"ok": False, "error": str(e)}), 500)


if __name__ == "__main__":
    port = int(CONFIG.get("port", 8765))
    print("========================================================")
    print(f"  Kam Chai Nabirsa - Helper Server v{VERSION}")
    print(f"  Listening on: http://{HOST}:{port}")
    print(f"  Token location: {TOKEN_FILE}")
    print("========================================================")
    app.run(host=HOST, port=port, debug=False)
