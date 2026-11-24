# © 2026 Kushal Parajuli

"""
Unit tests for the Kam Chai Nabirsa local helper server.
Uses pytest, Flask's test client, and mock execution for yt-dlp.
"""

import os
from pathlib import Path
import sys
import time
import pytest
import shutil
from unittest.mock import MagicMock, patch

# Ensure helper module is on sys.path
HELPER_DIR = Path(__file__).resolve().parent.parent
if str(HELPER_DIR) not in sys.path:
    sys.path.insert(0, str(HELPER_DIR))

import server


@pytest.fixture
def client():
    """Provides a configured Flask test client."""
    server.CONFIG["allowedOrigin"] = "chrome-extension://test-mock-extension-id"
    server.app.config["TESTING"] = True
    with server.app.test_client() as client:
        yield client


def test_server_binds_to_localhost_only():
    """Assert server binds strictly to 127.0.0.1, never 0.0.0.0."""
    assert server.HOST == "127.0.0.1", "Helper server must only bind to 127.0.0.1"


def test_token_file_created_and_git_ignored():
    """Assert token.txt exists and is included in .gitignore."""
    assert server.TOKEN_FILE.exists(), "token.txt must exist after initialization"
    token = server.TOKEN_FILE.read_text(encoding="utf-8").strip()
    assert len(token) >= 32, "Auth token must be at least 32 characters"

    gitignore_path = Path(__file__).resolve().parent.parent.parent / ".gitignore"
    assert gitignore_path.exists(), ".gitignore must exist in root"
    gitignore_content = gitignore_path.read_text(encoding="utf-8")
    assert "helper/token.txt" in gitignore_content, "helper/token.txt must be git-ignored"


def test_ping_endpoint_unauthenticated(client):
    """GET /ping should succeed without any auth token."""
    res = client.get("/ping")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data["version"] == "0.1.0"
    assert "ytDlpVersion" in data
    assert isinstance(data["ffmpeg"], bool)


def test_auth_check_requires_token(client):
    """GET /auth-check should reject requests with missing or invalid token."""
    # 1. Missing token
    res1 = client.get("/auth-check")
    assert res1.status_code == 401
    assert res1.get_json()["ok"] is False

    # 2. Wrong token
    res2 = client.get("/auth-check", headers={"X-KCN-Token": "invalid_wrong_token"})
    assert res2.status_code == 401
    assert res2.get_json()["ok"] is False

    # 3. Valid token
    valid_token = server.AUTH_TOKEN
    res3 = client.get("/auth-check", headers={"X-KCN-Token": valid_token})
    assert res3.status_code == 200
    assert res3.get_json()["ok"] is True
    assert res3.get_json()["authenticated"] is True


def test_cors_origin_validation(client):
    """CORS must accept the configured extension origin and reject foreign origins with 403."""
    allowed = "chrome-extension://test-mock-extension-id"
    forbidden = "https://malicious-website.com"

    # Valid origin
    res_allowed = client.get("/ping", headers={"Origin": allowed})
    assert res_allowed.status_code == 200
    assert res_allowed.headers.get("Access-Control-Allow-Origin") == allowed

    # Forbidden origin
    res_forbidden = client.get("/ping", headers={"Origin": forbidden})
    assert res_forbidden.status_code == 403
    assert res_forbidden.get_json()["ok"] is False

    # Preflight OPTIONS on allowed origin
    options_res = client.options(
        "/auth-check",
        headers={
            "Origin": allowed,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-KCN-Token",
        },
    )
    assert options_res.status_code in (200, 204)
    assert options_res.headers.get("Access-Control-Allow-Origin") == allowed
    assert "X-KCN-Token" in options_res.headers.get("Access-Control-Allow-Headers", "")


# =========================================================================
# Phase 7: URL Safety Tests
# =========================================================================

def test_url_safety_validation():
    """Verifies URL security rules: protocol, length, option injection, and IP restrictions."""
    # Valid URLs
    ok1, _ = server.is_safe_url("https://example.com/watch?v=12345")
    assert ok1 is True
    ok2, _ = server.is_safe_url("http://media.test.org/sample.mp3")
    assert ok2 is True

    # Rejection of bad protocols
    bad_proto1, _ = server.is_safe_url("file:///etc/passwd")
    assert bad_proto1 is False
    bad_proto2, _ = server.is_safe_url("javascript:alert(1)")
    assert bad_proto2 is False
    bad_proto3, _ = server.is_safe_url("ftp://ftp.example.com/file.mp4")
    assert bad_proto3 is False
    bad_proto4, _ = server.is_safe_url("chrome://settings")
    assert bad_proto4 is False

    # Rejection of option injection attempts
    hyphen_url, _ = server.is_safe_url("--version")
    assert hyphen_url is False
    hyphen_url2, _ = server.is_safe_url("-o evil.sh")
    assert hyphen_url2 is False

    # Rejection of loopback & private addresses
    loopback1, _ = server.is_safe_url("http://127.0.0.1:8080/secret")
    assert loopback1 is False
    loopback2, _ = server.is_safe_url("http://localhost:3000/api")
    assert loopback2 is False
    private1, _ = server.is_safe_url("http://192.168.1.1/video.mp4")
    assert private1 is False
    private2, _ = server.is_safe_url("http://10.0.0.1/video.mp4")
    assert private2 is False

    # Length limit (2048 chars)
    long_url = "https://example.com/" + "a" * 2050
    too_long, _ = server.is_safe_url(long_url)
    assert too_long is False


# =========================================================================
# Phase 7: Command Construction Tests
# =========================================================================

def test_ytdlp_command_construction(tmp_path):
    """Verifies that yt-dlp arguments are built safely without shell=True or string concat."""
    out_dir = str(tmp_path / "downloads")
    test_url = "https://example.com/video"

    # 1. Video mode command
    video_cmd = server.build_ytdlp_command(test_url, "video", out_dir)
    assert isinstance(video_cmd, list), "Command must be an argument list"
    assert video_cmd[-1] == test_url, "URL must be the final argument"
    assert video_cmd[-2] == "--", "Double-hyphen marker must precede URL to prevent option injection"
    assert "--ignore-config" in video_cmd
    assert "--no-playlist" in video_cmd
    assert "--newline" in video_cmd
    assert "-f" in video_cmd
    assert "bv*[height<=1080]+ba/b" in video_cmd
    assert "--merge-output-format" in video_cmd
    assert "mp4" in video_cmd

    # 2. Audio mode command
    audio_cmd = server.build_ytdlp_command(test_url, "audio", out_dir)
    assert isinstance(audio_cmd, list)
    assert audio_cmd[-1] == test_url
    assert audio_cmd[-2] == "--"
    assert "-x" in audio_cmd
    assert "--audio-format" in audio_cmd
    assert "mp3" in audio_cmd
    assert "--audio-quality" in audio_cmd
    assert "0" in audio_cmd

    # 3. Output template points inside output directory
    out_idx = video_cmd.index("-o")
    out_val = video_cmd[out_idx + 1]
    assert out_val.startswith(out_dir), "Output template must reside inside outputDir"


# =========================================================================
# Phase 7: Endpoints & Job Execution Tests
# =========================================================================

def test_download_endpoints_require_token(client):
    """POST /download, GET /status, POST /cancel must require valid token."""
    # Missing token
    assert client.post("/download", json={"url": "https://example.com/v"}).status_code == 401
    assert client.get("/status/dummy-id").status_code == 401
    assert client.post("/cancel/dummy-id").status_code == 401
    assert client.post("/open-folder").status_code == 401
    assert client.post("/update-ytdlp").status_code == 401


def test_download_endpoint_rejects_unsafe_urls(client):
    """POST /download must reject invalid or unsafe URLs with HTTP 400."""
    headers = {"X-KCN-Token": server.AUTH_TOKEN}

    res_loopback = client.post("/download", json={"url": "http://127.0.0.1/evil"}, headers=headers)
    assert res_loopback.status_code == 400
    assert "prohibited" in res_loopback.get_json()["error"]

    res_bad_proto = client.post("/download", json={"url": "file:///test.mp4"}, headers=headers)
    assert res_bad_proto.status_code == 400


def test_job_execution_with_fake_ytdlp(tmp_path, client):
    """Simulates job execution and progress tracking using a fake subprocess."""
    out_dir = str(tmp_path / "downloads")
    headers = {"X-KCN-Token": server.AUTH_TOKEN}
    server.CONFIG["outputDir"] = out_dir

    # Mock Popen to simulate fake yt-dlp output
    class FakeProc:
        def __init__(self, *args, **kwargs):
            self.stdout = [
                "[download] Destination: test_sample.mp4\n",
                "kcn-progress:  25.0%\n",
                "kcn-progress:  75.5%\n",
                "kcn-progress: 100.0%\n"
            ]
            self.stderr = []
            self.returncode = 0

        def wait(self):
            return 0

    with patch("subprocess.Popen", side_effect=lambda *args, **kwargs: FakeProc()):
        res = client.post(
            "/download",
            json={"url": "https://example.com/sample-video", "type": "video"},
            headers=headers
        )
        assert res.status_code == 200
        job_id = res.get_json()["jobId"]
        assert job_id

        # Wait briefly for worker thread to finish
        time.sleep(0.15)

        status_res = client.get(f"/status/{job_id}", headers=headers)
        assert status_res.status_code == 200
        data = status_res.get_json()
        assert data["ok"] is True
        assert data["state"] == "done"
        assert data["progress"] == 100.0
        assert data["filename"] == "test_sample.mp4"


def test_job_cancel(tmp_path, client):
    """Verifies that cancelling a queued/running job transitions state to cancelled."""
    headers = {"X-KCN-Token": server.AUTH_TOKEN}
    out_dir = str(tmp_path / "downloads")

    class HangingProc:
        def __init__(self, *args, **kwargs):
            self.stdout = []
            self.stderr = []
            self.returncode = 0
            self.terminated = False

        def terminate(self):
            self.terminated = True

        def wait(self):
            while not self.terminated:
                time.sleep(0.01)
            return 0

    with patch("subprocess.Popen", side_effect=lambda *args, **kwargs: HangingProc()):
        job = server.JOB_MANAGER.create_job("https://example.com/test-cancel", "video", out_dir)

        # Cancel via endpoint
        cancel_res = client.post(f"/cancel/{job.id}", headers=headers)
        assert cancel_res.status_code == 200
        assert cancel_res.get_json()["state"] == "cancelled"

        # Status check
        status_res = client.get(f"/status/{job.id}", headers=headers)
        assert status_res.get_json()["state"] == "cancelled"


def test_error_classification():
    """Verifies error classification for user-friendly error codes."""
    code1, msg1 = server.JOB_MANAGER._classify_error("Error: ffmpeg not found in PATH", 1)
    assert code1 == "ffmpeg_missing"

    code2, msg2 = server.JOB_MANAGER._classify_error("ERROR: Unsupported URL: https://invalid.com", 1)
    assert code2 == "unsupported_url"

    code3, msg3 = server.JOB_MANAGER._classify_error("Sign in to confirm you're not a bot", 1)
    assert code3 == "private_or_login_required"

    code4, msg4 = server.JOB_MANAGER._classify_error("Connection refused by peer", 1)
    assert code4 == "network"
