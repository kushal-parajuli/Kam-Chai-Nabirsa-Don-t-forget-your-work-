// © 2026 Kushal Parajuli

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('Helper Client (extension/background/helper-client.js)', () => {
  let originalFetch;
  let originalChrome;
  let mockStorage = {};

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalChrome = globalThis.chrome;
    mockStorage = {
      helperPort: 8765,
      helperToken: 'test-secret-token',
      settings: {
        helperPort: 8765,
        helperToken: 'test-secret-token'
      }
    };

    globalThis.chrome = {
      storage: {
        local: {
          get: async (defaults) => {
            return { ...defaults, ...mockStorage };
          },
          set: async (items) => {
            Object.assign(mockStorage, items);
          }
        }
      }
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  });

  test('returns status "online" when /ping and /auth-check both succeed', async () => {
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/ping')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, version: '0.1.0', ffmpeg: true })
        };
      }
      if (url.endsWith('/auth-check')) {
        assert.equal(options.headers['X-KCN-Token'], 'test-secret-token');
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const { pingHelper } = await import('../extension/background/helper-client.js');
    const result = await pingHelper();

    assert.equal(result.status, 'online');
    assert.equal(result.authenticated, true);
    assert.equal(result.ffmpeg, true);
    assert.equal(result.ping.version, '0.1.0');
  });

  test('returns status "offline" when helper server is not reachable', async () => {
    globalThis.fetch = async () => {
      const err = new Error('fetch failed: ECONNREFUSED');
      err.name = 'TypeError';
      throw err;
    };

    const { pingHelper } = await import('../extension/background/helper-client.js');
    const result = await pingHelper();

    assert.equal(result.status, 'offline');
    assert.equal(result.error, 'offline');
    assert.match(result.message, /not running/i);
  });

  test('returns status "offline" with timeout error when AbortError occurs', async () => {
    globalThis.fetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    const { pingHelper } = await import('../extension/background/helper-client.js');
    const result = await pingHelper();

    assert.equal(result.status, 'offline');
    assert.equal(result.error, 'timeout');
    assert.match(result.message, /timed out/i);
  });

  test('returns status "token_missing" when server is online but token is not configured', async () => {
    mockStorage.helperToken = '';
    if (mockStorage.settings) mockStorage.settings.helperToken = '';

    globalThis.fetch = async (url) => {
      if (url.endsWith('/ping')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, version: '0.1.0', ffmpeg: false })
        };
      }
      throw new Error('Should not call /auth-check when token is missing');
    };

    const { pingHelper } = await import('../extension/background/helper-client.js');
    const result = await pingHelper();

    assert.equal(result.status, 'token_missing');
    assert.equal(result.ffmpeg, false);
    assert.match(result.message, /no token is saved/i);
  });

  test('returns status "wrong_token" when /auth-check rejects token with 401', async () => {
    globalThis.fetch = async (url) => {
      if (url.endsWith('/ping')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, version: '0.1.0', ffmpeg: true })
        };
      }
      if (url.endsWith('/auth-check')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ ok: false, error: 'Invalid token' })
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const { pingHelper } = await import('../extension/background/helper-client.js');
    const result = await pingHelper();

    assert.equal(result.status, 'wrong_token');
    assert.equal(result.ffmpeg, true);
    assert.match(result.message, /invalid or rejected/i);
  });

  test('returns status "bad_response" when /ping returns HTTP 500 error', async () => {
    globalThis.fetch = async (url) => {
      if (url.endsWith('/ping')) {
        return {
          ok: false,
          status: 500
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const { pingHelper } = await import('../extension/background/helper-client.js');
    const result = await pingHelper();

    assert.equal(result.status, 'bad_response');
    assert.match(result.error, /HTTP 500/);
  });
});
