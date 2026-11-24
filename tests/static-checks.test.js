import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

describe('Static Checks & Manifest Verification', () => {

  const extensionDir = path.resolve('extension');

  function getJsFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(getJsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  test('All .js files in extension/ pass node --check syntax validation', () => {
    const jsFiles = getJsFiles(extensionDir);
    assert.ok(jsFiles.length >= 10, 'Should find at least 10 extension JS files');

    for (const filePath of jsFiles) {
      assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
      }, `node --check failed for ${path.relative(process.cwd(), filePath)}`);
    }
  });

  test('Manifest V3 structure, service worker, content scripts, and offscreen paths are valid', () => {
    const manifestPath = path.join(extensionDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Check manifest version
    assert.equal(manifest.manifest_version, 3, 'Must be Manifest V3');

    // Check service worker
    assert.ok(manifest.background, 'background entry must exist');
    assert.equal(manifest.background.type, 'module', 'Service worker must have type: module');
    const swPath = path.join(extensionDir, manifest.background.service_worker);
    assert.ok(fs.existsSync(swPath), `Service worker ${manifest.background.service_worker} must exist on disk`);

    // Check content scripts and exact ordering
    assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
    const cs = manifest.content_scripts[0];
    assert.ok(cs, 'At least one content script config must exist');
    assert.deepEqual(
      cs.js,
      ['content/widget-css.js', 'content/tabs/todo.js', 'content/tabs/notes.js', 'content/tabs/downloader.js', 'content/widget.js'],
      'Content scripts must be loaded in the exact sequence: widget-css.js, todo.js, notes.js, downloader.js, widget.js'
    );

    for (const scriptPath of cs.js) {
      const fullPath = path.join(extensionDir, scriptPath);
      assert.ok(fs.existsSync(fullPath), `Content script ${scriptPath} must exist on disk`);
    }

    // Check offscreen files
    const offscreenHtml = path.join(extensionDir, 'offscreen/offscreen.html');
    const offscreenJs = path.join(extensionDir, 'offscreen/offscreen.js');
    assert.ok(fs.existsSync(offscreenHtml), 'offscreen.html must exist on disk');
    assert.ok(fs.existsSync(offscreenJs), 'offscreen.js must exist on disk');

    // Check permissions
    const requiredPermissions = ['storage', 'alarms', 'notifications', 'offscreen', 'unlimitedStorage', 'scripting'];
    for (const perm of requiredPermissions) {
      assert.ok(manifest.permissions.includes(perm), `Missing permission: ${perm}`);
    }
  });

  test('Every ES module import resolves to an existing file and valid export', async () => {
    // Audit files that use ES import/export
    const esmFiles = [
      'shared/constants.js',
      'shared/messages.js',
      'shared/notes-export.js',
      'shared/settings.js',
      'shared/utils.js',
      'background/db.js',
      'background/reminders.js',
      'background/helper-client.js',
      'background/service-worker.js',
      'offscreen/offscreen.js'
    ];

    for (const rel of esmFiles) {
      const full = path.join(extensionDir, rel);
      const content = fs.readFileSync(full, 'utf8');
      const importRegex = /import\s+(?:(\{[^}]+\})|([a-zA-Z0-9_$*]+))\s+from\s+['"]([^'"]+)['"]/g;
      let match;

      while ((match = importRegex.exec(content)) !== null) {
        const rawNames = match[1];
        const defaultName = match[2];
        const importTarget = match[3];
        const targetResolved = path.resolve(path.dirname(full), importTarget);
        assert.ok(fs.existsSync(targetResolved), `Import target ${importTarget} in ${rel} must exist at ${targetResolved}`);

        const targetContent = fs.readFileSync(targetResolved, 'utf8');
        if (rawNames) {
          const names = rawNames.replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
          for (const n of names) {
            const expNamed = new RegExp('export\\s+(async\\s+)?(const|function|let|var|class)\\s+' + n + '\\b');
            const expList = new RegExp('export\\s*\\{[^}]*\\b' + n + '\\b[^}]*\\}');
            assert.ok(
              expNamed.test(targetContent) || expList.test(targetContent),
              `Export "${n}" must exist in ${importTarget} (imported in ${rel})`
            );
          }
        }
      }
    }
  });

});
