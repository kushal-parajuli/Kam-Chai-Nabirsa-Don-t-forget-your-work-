// © 2026 Kushal Parajuli

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

describe('Todo Tab Helpers & Countdown Logic (Phase 2 & 3)', () => {
  // Load todo.js into a sandboxed window context
  const code = fs.readFileSync('extension/content/tabs/todo.js', 'utf8');
  const sandbox = {
    window: {},
    document: {
      createElement: () => ({ appendChild: () => {}, querySelector: () => null }),
    },
    navigator: {},
    chrome: { runtime: { onMessage: { addListener: () => {} } } },
    console: { log: () => {}, warn: () => {}, error: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const { formatTimeLeft, formatExactTime, toDateInput, toTimeInput } = sandbox.window.__kcn_todoHelpers;

  test('formatTimeLeft returns empty info for invalid timestamps', () => {
    const invalid = [null, undefined, 0, -100];
    for (const val of invalid) {
      const res = formatTimeLeft(val);
      assert.equal(res.text, '');
      assert.equal(res.isOverdue, false);
      assert.equal(res.isAmber, false);
    }
  });

  test('formatTimeLeft returns Overdue when time has passed', () => {
    const pastTime = Date.now() - 5000;
    const res = formatTimeLeft(pastTime);
    assert.equal(res.isOverdue, true);
    assert.equal(res.text, 'Overdue');
    assert.equal(res.isAmber, false);
  });

  test('formatTimeLeft flags amber when less than 5 minutes remain', () => {
    const futureTime = Date.now() + 3 * 60 * 1000; // 3 minutes ahead
    const res = formatTimeLeft(futureTime);
    assert.equal(res.isOverdue, false);
    assert.equal(res.isAmber, true);
    assert.match(res.text, /^in [1-3]m$/);
  });

  test('formatTimeLeft formats hours and minutes when between 1 and 24 hours', () => {
    const futureTime = Date.now() + (2 * 3600 + 15 * 60) * 1000; // 2h 15m ahead
    const res = formatTimeLeft(futureTime);
    assert.equal(res.isOverdue, false);
    assert.equal(res.isAmber, false);
    assert.match(res.text, /^in 2h 1[4-5]m$/);
  });

  test('formatTimeLeft formats days and hours when over 24 hours', () => {
    const futureTime = Date.now() + (27 * 3600) * 1000; // 1d 3h ahead
    const res = formatTimeLeft(futureTime);
    assert.equal(res.isOverdue, false);
    assert.equal(res.isAmber, false);
    assert.match(res.text, /^in 1d (2|3)h$/);
  });

  test('formatExactTime produces non-empty human readable string', () => {
    const now = Date.now();
    const formatted = formatExactTime(now);
    assert.equal(typeof formatted, 'string');
    assert.ok(formatted.length > 5);
    assert.equal(formatted.includes('NaN'), false);
  });

  test('toDateInput and toTimeInput format Date object accurately', () => {
    const date = new Date(2026, 10, 24, 14, 30); // Nov 24, 2026, 14:30
    assert.equal(toDateInput(date), '2026-11-24');
    assert.equal(toTimeInput(date), '14:30');
  });
});
