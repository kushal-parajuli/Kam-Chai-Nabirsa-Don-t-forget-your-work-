// © 2026 Kushal Parajuli

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

describe('Downloader & Helper Client (Phase 7)', () => {
  let originalFetch;
  let originalChrome;
  let mockStorage = {};

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalChrome = globalThis.chrome;
    mockStorage = {
      settings: {
        helperPort: 8765,
        helperToken: 'test-secret-token'
      }
    };

    globalThis.chrome = {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...mockStorage }),
          set: async (items) => { Object.assign(mockStorage, items); }
        }
      },
      notifications: {
        create: () => {}
      },
      runtime: {
        getURL: (p) => p,
        lastError: null
      }
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  });

  test('startDownload sends authenticated POST /download request', async () => {
    let capturedUrl = '';
    let capturedOptions = null;

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, jobId: 'job-123-abc' })
      };
    };

    const { startDownload } = await import('../extension/background/helper-client.js');
    const result = await startDownload('https://example.com/video', 'video');

    assert.equal(capturedUrl, 'http://127.0.0.1:8765/download');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers['X-KCN-Token'], 'test-secret-token');
    assert.deepEqual(JSON.parse(capturedOptions.body), { url: 'https://example.com/video', type: 'video' });
    assert.equal(result.jobId, 'job-123-abc');
  });

  test('getDownloadStatus sends GET /status/<jobId>', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          id: 'job-123',
          url: 'https://example.com/video',
          type: 'video',
          state: 'running',
          progress: 45.5,
          filename: 'video.mp4',
          error: null
        })
      };
    };

    const { getDownloadStatus } = await import('../extension/background/helper-client.js');
    const status = await getDownloadStatus('job-123');

    assert.equal(capturedUrl, 'http://127.0.0.1:8765/status/job-123');
    assert.equal(status.state, 'running');
    assert.equal(status.progress, 45.5);
  });

  test('cancelDownload sends POST /cancel/<jobId>', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, id: 'job-123', state: 'cancelled' })
      };
    };

    const { cancelDownload } = await import('../extension/background/helper-client.js');
    const cancelRes = await cancelDownload('job-123');

    assert.equal(capturedUrl, 'http://127.0.0.1:8765/cancel/job-123');
    assert.equal(capturedMethod, 'POST');
    assert.equal(cancelRes.state, 'cancelled');
  });

  test('openDownloadFolder sends POST /open-folder', async () => {
    let capturedUrl = '';

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, message: 'Opened folder' })
      };
    };

    const { openDownloadFolder } = await import('../extension/background/helper-client.js');
    const res = await openDownloadFolder();

    assert.equal(capturedUrl, 'http://127.0.0.1:8765/open-folder');
    assert.equal(res.ok, true);
  });

  test('IndexedDB saveDownload, getDownloads, and clearDownloads operations', async () => {
    const db = await import('../extension/background/db.js');
    db.closeDB();

    await db.clearDownloads();

    // 1. Initial save
    const initial = await db.saveDownload({
      id: 'test-job-1',
      url: 'https://example.com/v1',
      type: 'video',
      state: 'queued',
      progress: 0,
      createdAt: 1000
    });
    assert.equal(initial.id, 'test-job-1');
    assert.equal(initial.state, 'queued');

    // 2. Incremental update (progress and status without overriding url or createdAt)
    const updated = await db.saveDownload({
      id: 'test-job-1',
      state: 'running',
      progress: 60,
      filename: 'sample.mp4'
    });
    assert.equal(updated.url, 'https://example.com/v1');
    assert.equal(updated.state, 'running');
    assert.equal(updated.progress, 60);
    assert.equal(updated.filename, 'sample.mp4');
    assert.equal(updated.createdAt, 1000);

    // 3. Add second job
    await db.saveDownload({
      id: 'test-job-2',
      url: 'https://example.com/v2',
      type: 'audio',
      state: 'done',
      progress: 100,
      createdAt: 2000
    });

    // 4. getDownloads sorts newest first
    const list = await db.getDownloads();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, 'test-job-2');
    assert.equal(list[1].id, 'test-job-1');

    // 5. clearDownloads empties the list
    await db.clearDownloads();
    const emptyList = await db.getDownloads();
    assert.equal(emptyList.length, 0);

    db.closeDB();
  });
});
