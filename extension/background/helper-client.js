// © 2026 Kushal Parajuli

/**
 * Client module for communicating with the local Python helper server.
 * All HTTP requests to 127.0.0.1 originate exclusively from the background service worker.
 */

const DEFAULT_HELPER_PORT = 8765;
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Fetches current helper settings from chrome.storage.local.
 * @returns {Promise<{ port: number, token: string }>}
 */
async function getHelperConfig() {
  try {
    const data = await chrome.storage.local.get({
      helperPort: DEFAULT_HELPER_PORT,
      helperToken: ''
    });
    const port = Number(data.helperPort) || DEFAULT_HELPER_PORT;
    const token = typeof data.helperToken === 'string' ? data.helperToken.trim() : '';
    return { port, token };
  } catch (_) {
    return { port: DEFAULT_HELPER_PORT, token: '' };
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
