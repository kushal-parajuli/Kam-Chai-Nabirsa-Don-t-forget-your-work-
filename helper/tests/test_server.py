# © 2026 Kushal Parajuli

"""
Unit tests for the Kam Chai Nabirsa local helper server.
Uses pytest and Flask's built-in test client.
"""

from pathlib import Path
import sys
import pytest
import shutil

# Ensure helper module is on sys.path
HELPER_DIR = Path(__file__).resolve().parent.parent
if str(HELPER_DIR) not in sys.path:
    sys.path.insert(0, str(HELPER_DIR))

import server


@pytest.fixture
def client(monkeypatch):
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
