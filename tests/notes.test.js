import 'fake-indexeddb/auto';
import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeDB } from '../extension/background/db.js';
import { buildNoteTxt, buildAllNotesTxt, safeFileName, slugify } from '../extension/shared/notes-export.js';

describe('Phase 4: Notes Tab & Export Tests', () => {
  let messageListeners = [];
  let broadcastedMessages = [];

  // Tiny 1x1 valid PNG data URL
  const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Ensure chrome mock is in place
  before(async () => {
    globalThis.chrome = {
      runtime: {
        id: 'mock-kcn-id',
        onMessage: {
          addListener: (fn) => messageListeners.push(fn)
        },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        sendMessage: () => Promise.resolve({ ok: true }),
        getURL: (p) => 'chrome-extension://mock/' + p
      },
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve()
        }
      },
      alarms: {
        create: () => {},
        clear: () => Promise.resolve(true),
        onAlarm: { addListener: () => {} }
      },
      notifications: {
        create: () => {},
        clear: () => Promise.resolve(true),
        onButtonClicked: { addListener: () => {} },
        onClosed: { addListener: () => {} }
      },
      action: {
        setBadgeText: () => Promise.resolve(),
        setBadgeBackgroundColor: () => Promise.resolve()
      },
      tabs: {
        query: () => Promise.resolve([{ id: 1, url: 'https://example.com' }]),
        sendMessage: (id, msg) => {
          broadcastedMessages.push(msg);
          return Promise.resolve();
        }
      },
      windows: {
        getAll: () => Promise.resolve([{ type: 'normal', tabs: [{ id: 1, url: 'https://example.com' }] }]),
        get: () => Promise.resolve({ type: 'normal' }),
        getCurrent: () => Promise.resolve({ type: 'normal' })
      },
      offscreen: {
        hasDocument: () => Promise.resolve(false),
        createDocument: () => Promise.resolve(),
        closeDocument: () => Promise.resolve()
      },
      scripting: {
        executeScript: () => Promise.resolve()
      }
    };

    // Load background service worker
    await import('../extension/background/service-worker.js');
  });

  afterEach(() => {
    closeDB();
    broadcastedMessages = [];
  });

  // Helper to dispatch messages through registered onMessage listener
  function dispatchMessage(msg, sender = { tab: { id: 1, windowId: 10 } }) {
    return new Promise((resolve) => {
      for (const listener of messageListeners) {
        const isAsync = listener(msg, sender, (response) => {
          resolve(response);
        });
        if (isAsync === false) {
          // Handled synchronously
        }
      }
    });
  }

  test('Export functions: safeFileName, slugify, buildNoteTxt, buildAllNotesTxt', () => {
    // 1. Slugify
    assert.equal(slugify('Meeting Notes: Project Alpha!'), 'meeting-notes-project-alpha');
    assert.equal(slugify(''), '');

    // 2. safeFileName
    const fixedDate = new Date(2026, 10, 22, 14, 30);
    const fname = safeFileName('note', fixedDate, 'txt', 'My First Note');
    assert.equal(fname, 'note-my-first-note-2026-11-22-1430.txt');

    const allNotesFname = safeFileName('kam-chai-nabirsa-notes', fixedDate, 'txt');
    assert.equal(allNotesFname, 'kam-chai-nabirsa-notes-2026-11-22.txt');

    // 3. buildNoteTxt
    const singleTxt = buildNoteTxt({ text: 'Line 1\nLine 2\r\nLine 3' });
    assert.ok(singleTxt.includes('Line 1\r\nLine 2\r\nLine 3\r\n'));
    assert.ok(!singleTxt.includes('\n') || singleTxt.split('\r\n').length >= 3);

    // 4. buildAllNotesTxt
    const sampleNotes = [
      {
        id: '1',
        kind: 'text',
        text: 'First normal note',
        pinned: false,
        createdAt: 1763800000000
      },
      {
        id: '2',
        kind: 'text',
        text: 'Important pinned note',
        pinned: true,
        createdAt: 1763700000000
      },
      {
        id: '3',
        kind: 'image',
        fileName: 'screenshot.png',
        pinned: false,
        createdAt: 1763850000000
      }
    ];

    const masterTxt = buildAllNotesTxt(sampleNotes, fixedDate);

    // Verify copyright and header
    assert.ok(masterTxt.startsWith('Kam Chai Nabirsa - notes export - © 2026 Kushal Parajuli\r\n'), 'Must start with exact header line');
    assert.ok(masterTxt.includes('Export Date: 2026-11-22 14:30\r\n'), 'Must include export date');
    assert.ok(masterTxt.includes('----------------------------------------\r\n'), 'Must contain 40-dash separator');

    // Verify Windows line endings throughout
    assert.equal(masterTxt.includes('\r\n'), true, 'Must use \\r\\n');
    assert.equal(masterTxt.replace(/\r\n/g, '').includes('\n'), false, 'Must not contain bare \\n');

    // Verify image placeholder line
    assert.ok(masterTxt.includes('[image note: screenshot.png,'), 'Must contain image placeholder line');

    // Verify pinned note comes before older unpinned note
    const pinnedIdx = masterTxt.indexOf('Important pinned note');
    const normalIdx = masterTxt.indexOf('First normal note');
    assert.ok(pinnedIdx < normalIdx, 'Pinned note must appear before unpinned note in export');
  });

  test('Note messaging: add text note, add image note, list, pin, update, get full, delete, and clear', async () => {
    // Clean database first
    closeDB();
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('kcn-db');
      req.onsuccess = resolve;
      req.onerror = resolve;
    });

    // 1. Add text note
    const textRes = await dispatchMessage({
      type: 'NOTE_ADD',
      payload: {
        kind: 'text',
        text: 'Hello world note'
      }
    });
    assert.equal(textRes.ok, true);
    assert.ok(textRes.data.id);
    assert.equal(textRes.data.kind, 'text');
    assert.equal(textRes.data.text, 'Hello world note');
    assert.equal(textRes.data.pinned, false);
    assert.equal(textRes.data.blob, undefined, 'Blobs must not be returned in API response');

    // Verify NOTES_CHANGED broadcast
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(broadcastedMessages.some((m) => m.type === 'NOTES_CHANGED'));
    broadcastedMessages = [];

    // 2. Add image note using tiny base64 PNG
    const imgRes = await dispatchMessage({
      type: 'NOTE_ADD',
      payload: {
        kind: 'image',
        dataUrl: TINY_PNG_DATA_URL,
        mimeType: 'image/png',
        thumb: TINY_PNG_DATA_URL,
        fileName: 'tiny.png',
        size: 70
      }
    });
    assert.equal(imgRes.ok, true);
    assert.ok(imgRes.data.id);
    assert.equal(imgRes.data.kind, 'image');
    assert.equal(imgRes.data.fileName, 'tiny.png');
    assert.equal(imgRes.data.thumb, TINY_PNG_DATA_URL);
    assert.equal(imgRes.data.blob, undefined, 'Blob must not be returned across message');

    // 3. NOTE_LIST returns no blobs and sorts correctly
    const listRes1 = await dispatchMessage({ type: 'NOTE_LIST' });
    assert.equal(listRes1.ok, true);
    assert.equal(listRes1.data.length, 2);
    assert.ok(listRes1.data.every((n) => n.blob === undefined), 'No blobs returned in NOTE_LIST');

    // 4. NOTE_PIN: pin the text note
    const pinRes = await dispatchMessage({
      type: 'NOTE_PIN',
      payload: { id: textRes.data.id, pinned: true }
    });
    assert.equal(pinRes.ok, true);
    assert.equal(pinRes.data.pinned, true);

    // Verify NOTE_LIST places pinned note first
    const listRes2 = await dispatchMessage({ type: 'NOTE_LIST' });
    assert.equal(listRes2.data[0].id, textRes.data.id, 'Pinned text note must be first');
    assert.equal(listRes2.data[1].id, imgRes.data.id);

    // 5. NOTE_UPDATE: update text of the text note
    const updateRes = await dispatchMessage({
      type: 'NOTE_UPDATE',
      payload: { id: textRes.data.id, text: 'Updated note content' }
    });
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.data.text, 'Updated note content');

    // 6. NOTE_GET_FULL: returns image data URL back
    const fullRes = await dispatchMessage({
      type: 'NOTE_GET_FULL',
      payload: { id: imgRes.data.id }
    });
    assert.equal(fullRes.ok, true);
    assert.ok(fullRes.data.dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(fullRes.data.fileName, 'tiny.png');

    // 7. NOTE_DELETE: delete the image note
    const delRes = await dispatchMessage({
      type: 'NOTE_DELETE',
      payload: { id: imgRes.data.id }
    });
    assert.equal(delRes.ok, true);

    const listRes3 = await dispatchMessage({ type: 'NOTE_LIST' });
    assert.equal(listRes3.data.length, 1);
    assert.equal(listRes3.data[0].id, textRes.data.id);

    // 8. Add an unpinned note to test NOTES_CLEAR with and without pinned notes
    const textRes2 = await dispatchMessage({
      type: 'NOTE_ADD',
      payload: { kind: 'text', text: 'Second unpinned note' }
    });
    assert.equal(textRes2.ok, true);

    // Clear without pinned (alsoDeletePinned: false)
    const clearUnpinnedRes = await dispatchMessage({
      type: 'NOTES_CLEAR',
      payload: { alsoDeletePinned: false }
    });
    assert.equal(clearUnpinnedRes.ok, true);
    assert.equal(clearUnpinnedRes.data.count, 1, 'Should only clear the 1 unpinned note');

    const listRes4 = await dispatchMessage({ type: 'NOTE_LIST' });
    assert.equal(listRes4.data.length, 1, 'Pinned note should remain');
    assert.equal(listRes4.data[0].id, textRes.data.id);

    // Clear with pinned (alsoDeletePinned: true)
    const clearAllRes = await dispatchMessage({
      type: 'NOTES_CLEAR',
      payload: { alsoDeletePinned: true }
    });
    assert.equal(clearAllRes.ok, true);
    assert.equal(clearAllRes.data.count, 1, 'Should clear remaining pinned note');

    const listRes5 = await dispatchMessage({ type: 'NOTE_LIST' });
    assert.equal(listRes5.data.length, 0, 'Store must be empty');
  });

  test('Rejection of image over 10 MB and non-allowed image types', async () => {
    // 1. Non-allowed mimeType (SVG)
    const svgRes = await dispatchMessage({
      type: 'NOTE_ADD',
      payload: {
        kind: 'image',
        dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        mimeType: 'image/svg+xml'
      }
    });
    assert.equal(svgRes.ok, false);
    assert.ok(svgRes.error.includes('Only PNG, JPEG, GIF, and WEBP'), 'Must reject SVG');

    // 2. Over 10 MB image
    // Build a fake data URL payload exceeding 10 MB
    const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x61);
    const largeDataUrl = `data:image/png;base64,${largeBuffer.toString('base64')}`;

    const largeRes = await dispatchMessage({
      type: 'NOTE_ADD',
      payload: {
        kind: 'image',
        dataUrl: largeDataUrl,
        mimeType: 'image/png'
      }
    });
    assert.equal(largeRes.ok, false);
    assert.ok(largeRes.error.includes('exceeds 10 MB'), 'Must reject images over 10 MB');

    // 3. Empty text note
    const emptyTextRes = await dispatchMessage({
      type: 'NOTE_ADD',
      payload: { kind: 'text', text: '   ' }
    });
    assert.equal(emptyTextRes.ok, false);
    assert.ok(emptyTextRes.error.includes('empty'));
  });
});
