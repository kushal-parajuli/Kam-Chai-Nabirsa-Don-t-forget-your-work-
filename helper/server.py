# © 2026 Kushal Parajuli

"""
Kam Chai Nabirsa - Local Helper Server (Phase 6 Skeleton)
Binds strictly to 127.0.0.1 with token-based authentication and extension origin CORS protection.
"""

import hmac
import json
import os
import secrets
import shutil
import sys
from pathlib import Path

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
    defaults = {
        "port": 8765,
        "outputDir": os.path.expandvars(r"%USERPROFILE%\Downloads\KamChaiNabirsa"),
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


def is_origin_allowed(origin: str) -> bool:
    """Validates request origin against allowedOrigin from config."""
    if not origin:
        return True  # Internal / direct requests without origin header

    configured_origin = CONFIG.get("allowedOrigin", "").strip()
    # If a specific origin is set (e.g. chrome-extension://<id>)
    if configured_origin and configured_origin != "chrome-extension://YOUR_EXTENSION_ID_HERE":
        return origin == configured_origin

    # Default fallback: allow any chrome-extension origin if not locked down yet
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


if __name__ == "__main__":
    port = int(CONFIG.get("port", 8765))
    print(f"========================================================")
    print(f"  Kam Chai Nabirsa - Helper Server v{VERSION}")
    print(f"  Listening on: http://{HOST}:{port}")
    print(f"  Token location: {TOKEN_FILE}")
    print(f"========================================================")
    app.run(host=HOST, port=port, debug=False)
