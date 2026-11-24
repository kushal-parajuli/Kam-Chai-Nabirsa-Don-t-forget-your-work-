// © 2026 Kushal Parajuli

import { getSettings } from '../shared/settings.js';

/**
 * Client module for communicating with the local Python helper server.
 * All HTTP requests to 127.0.0.1 originate exclusively from the background service worker.
 */

const REQUEST_TIMEOUT_MS = 3000;

/**
 * Fetches current helper settings from chrome.storage.local.
 * Reads from the unified `settings` object with backwards-compatible fallback to top-level keys.
 * @returns {Promise<{ port: number, token: string }>}
 */
async function getHelperConfig() {
  try {
    const settings = await getSettings();
    if (settings && settings.helperToken) {
      return {
        port: settings.helperPort || 8765,
        token: settings.helperToken
      };
    }

    // Fallback to top-level keys if present
    const top = await chrome.storage.local.get({ helperPort: 8765, helperToken: '' });
    return {
      port: top.helperPort || settings.helperPort || 8765,
      token: (top.helperToken || settings.helperToken || '').trim()
    };
  } catch (_) {
    return { port: 8765, token: '' };
  }
}

/**
 * Pings the local helper server to check availability and validate the configured auth token.
 * Uses a strict 3-second timeout via AbortController.
 * 
 * Flow:
 * 1. Checks GET /ping on http://127.0.0.1:<port>
 * 2. If offline or times out, returns { status: 'offline', error: 'offline'|'timeout' }
 * 3. If online, checks if helperToken is configured. If not, returns { status: 'token_missing', ... }
 * 4. If token is configured, calls GET /auth-check with X-KCN-Token.
 * 5. If /auth-check returns 200, returns { status: 'online', authenticated: true, ... }
 * 6. If /auth-check returns 401/403, returns { status: 'wrong_token', ... }
 * 
 * @returns {Promise<{ status: 'online'|'offline'|'wrong_token'|'token_missing'|'bad_response', ping?: object, ffmpeg?: boolean, error?: string }>}
 */
export async function pingHelper() {
  const { port, token } = await getHelperConfig();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Initial /ping check
  const pingController = new AbortController();
  const pingTimeout = setTimeout(() => pingController.abort(), REQUEST_TIMEOUT_MS);

  let pingRes;
  try {
    pingRes = await fetch(`${baseUrl}/ping`, {
      method: 'GET',
      signal: pingController.signal
    });
  } catch (err) {
    clearTimeout(pingTimeout);
    const isTimeout = err.name === 'AbortError';
    return {
      status: 'offline',
      error: isTimeout ? 'timeout' : 'offline',
      message: isTimeout ? 'Request timed out after 3000ms' : 'Local helper is not running'
    };
  } finally {
    clearTimeout(pingTimeout);
  }

  if (!pingRes.ok) {
    return {
      status: 'bad_response',
      error: `Helper /ping returned HTTP ${pingRes.status}`
    };
  }

  let pingData;
  try {
    pingData = await pingRes.json();
  } catch (_) {
    return {
      status: 'bad_response',
      error: 'Invalid JSON returned from /ping'
    };
  }

  const ffmpegFound = Boolean(pingData?.ffmpeg);

  // 2. Token verification via /auth-check
  if (!token) {
    return {
      status: 'token_missing',
      ping: pingData,
      ffmpeg: ffmpegFound,
      message: 'Helper is online, but no token is saved in Settings'
    };
  }

  const authController = new AbortController();
  const authTimeout = setTimeout(() => authController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const authRes = await fetch(`${baseUrl}/auth-check`, {
      method: 'GET',
      headers: {
        'X-KCN-Token': token
      },
      signal: authController.signal
    });

    clearTimeout(authTimeout);

    if (authRes.status === 200) {
      return {
        status: 'online',
        authenticated: true,
        ping: pingData,
        ffmpeg: ffmpegFound
      };
    }

    if (authRes.status === 401 || authRes.status === 403) {
      return {
        status: 'wrong_token',
        ping: pingData,
        ffmpeg: ffmpegFound,
        message: 'Helper is online, but token is invalid or rejected'
      };
    }

    return {
      status: 'bad_response',
      ping: pingData,
      ffmpeg: ffmpegFound,
      error: `Auth check returned HTTP ${authRes.status}`
    };
  } catch (err) {
    clearTimeout(authTimeout);
    return {
      status: 'bad_response',
      ping: pingData,
      ffmpeg: ffmpegFound,
      error: err.name === 'AbortError' ? 'Auth check timed out' : err.message
    };
  }
}

/**
 * Generic helper for executing authenticated requests to the local helper server.
 * @param {string} endpoint 
 * @param {RequestInit} [options] 
 * @param {number} [timeoutMs] 
 * @returns {Promise<any>}
 */
async function helperFetch(endpoint, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { port, token } = await getHelperConfig();
  if (!token) {
    throw new Error('Helper token is not configured in Settings');
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-KCN-Token': token,
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    let data = null;
    try {
      data = await res.json();
    } catch (_) { }

    if (!res.ok) {
      const errMessage = data?.error || `Helper returned HTTP ${res.status}`;
      const err = new Error(errMessage);
      err.status = res.status;
      err.errorCode = data?.error_code || 'http_error';
      throw err;
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Helper request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

/**
 * Starts a download job on the local helper.
 * @param {string} url 
 * @param {'video'|'audio'} type 
 * @returns {Promise<{ ok: boolean, jobId: string }>}
 */
export async function startDownload(url, type = 'video') {
  return helperFetch('/download', {
    method: 'POST',
    body: JSON.stringify({ url, type })
  });
}

/**
 * Retrieves the status and progress of a download job.
 * @param {string} jobId 
 * @returns {Promise<{ ok: boolean, id: string, url: string, type: string, state: string, progress: number, filename: string|null, error: string|null, error_code?: string }>}
 */
export async function getDownloadStatus(jobId) {
  if (!jobId) throw new Error('Job ID is required');
  return helperFetch(`/status/${encodeURIComponent(jobId)}`, {
    method: 'GET'
  });
}

/**
 * Cancels a queued or running download job.
 * @param {string} jobId 
 * @returns {Promise<{ ok: boolean, id: string, state: string }>}
 */
export async function cancelDownload(jobId) {
  if (!jobId) throw new Error('Job ID is required');
  return helperFetch(`/cancel/${encodeURIComponent(jobId)}`, {
    method: 'POST'
  });
}

/**
 * Requests the local helper to open the downloads directory in Explorer/Finder.
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function openDownloadFolder() {
  return helperFetch('/open-folder', {
    method: 'POST'
  });
}

/**
 * Requests the local helper to update yt-dlp to latest version.
 * @returns {Promise<{ ok: boolean, output: string }>}
 */
export async function updateYtDlp() {
  return helperFetch('/update-ytdlp', {
    method: 'POST'
  }, 120000);
}
