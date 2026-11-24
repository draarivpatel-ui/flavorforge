'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const F = require('./kinetics.js');
const { createPage, auditPage } = require('./dom-harness.cjs');

// -- Content Security Policy -------------------------------------------------

test('the page declares a restrictive content security policy', () => {
  const page = createPage(__dirname);
  const meta = page.document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  assert.ok(meta, 'CSP meta tag present');
  const content = meta.getAttribute('content');
  assert.match(content, /default-src 'self'/);
  assert.match(content, /script-src 'self'/);
  assert.match(content, /object-src 'none'/);
  assert.match(content, /base-uri 'none'/);
  assert.match(content, /form-action 'none'/);
  assert.doesNotMatch(content, /frame-ancestors/, 'frame-ancestors is ignored inside a meta CSP');
  assert.doesNotMatch(page.html, /<script>(?!<\/script>)[\s\S]*?<\/script>/, 'no inline scripts for CSP to police');
});

test('an inline favicon keeps the page from requesting /favicon.ico', () => {
  const page = createPage(__dirname);
  const icon = page.document.querySelector('link[rel="icon"]');
  assert.ok(icon, 'favicon link present');
  assert.match(icon.getAttribute('href'), /^data:/, 'favicon is inline, no network request');
});

// -- Recipe checksum -----------------------------------------------------------

test('the recipe checksum renders as 64 lowercase hex matching the JSON', () => {
  const page = createPage(__dirname);
  const sha = page.get('recipe-sha').textContent;
  assert.match(sha, /^[0-9a-f]{64}$/);
  const recipe = F.importRecipe(page.get('json-area').value);
  assert.equal(sha, F.recipeChecksum(recipe));
  assert.equal(sha, crypto.createHash('sha256').update(page.get('json-area').value, 'utf8').digest('hex'));
});

test('the checksum tracks manual edits inside the JSON box itself', () => {
  const page = createPage(__dirname);
  const area = page.get('json-area');
  area.value = '{"edited":true}';
  page.fire(area, 'input');
  assert.equal(page.get('recipe-sha').textContent, F.sha256('{"edited":true}'));
});

test('the checksum tracks recipe edits', () => {
  const page = createPage(__dirname);
  const before = page.get('recipe-sha').textContent;
  const input = page.get('range-hydration-lab');
  input.value = '55'; page.fire(input, 'input'); page.flushFrame();
  const after = page.get('recipe-sha').textContent;
  assert.notEqual(after, before);
  assert.equal(after, crypto.createHash('sha256').update(page.get('json-area').value, 'utf8').digest('hex'));
});

// -- WCAG 2.1.4 character-key shortcuts -----------------------------------------

test('digit shortcuts switch all six tabs and move roving focus', () => {
  const page = createPage(__dirname);
  const ids = ['lab', 'dough', 'espresso', 'card', 'phase', 'data'];
  ids.forEach((name, i) => {
    page.key('Digit' + (i + 1));
    ids.forEach((other, j) => assert.equal(page.get('tab-' + other).hidden, j !== i, 'tab ' + other));
    assert.equal(page.document.activeElement, page.get('tabbtn-' + name));
    assert.equal(page.get('tabbtn-' + name).getAttribute('tabindex'), '0');
  });
});

test('unmapped digit and letter keys leave the active tab alone', () => {
  const page = createPage(__dirname);
  for (const code of ['Digit0', 'Digit7', 'Digit8', 'Digit9', 'KeyA', 'Enter', 'Space']) {
    page.key(code);
    assert.equal(page.get('tab-lab').hidden, false, 'stayed on lab for ' + code);
  }
});

test('shortcuts never fire while typing in inputs, selects, or textareas', () => {
  const page = createPage(__dirname);
  for (const id of ['in-flour', 'json-area', 'select-starch', 'in-notes', 'schedule-json']) {
    page.key('Digit2', 'keydown', page.get(id));
    assert.equal(page.get('tab-lab').hidden, false, 'guarded by ' + id);
    assert.equal(page.document.activeElement === page.get('tabbtn-dough'), false);
  }
});

test('modifier chords fall through to the browser instead of hijacking keys', () => {
  const page = createPage(__dirname);
  page.key('Digit2', 'keydown', page.document.body, { ctrlKey: true });
  page.key('Digit3', 'keydown', page.document.body, { metaKey: true });
  page.key('Digit4', 'keydown', page.document.body, { altKey: true });
  page.key('Digit2', 'keydown', page.document.body, { shiftKey: true, key: '!' });
  page.key('Digit2', 'keydown', page.document.body, { repeat: true });
  page.key('Digit5', 'keydown', page.document.body, { isComposing: true });
  assert.equal(page.get('tab-lab').hidden, false);
});

test('letter shortcuts follow the typed character, not the physical key', () => {
  const page = createPage(__dirname);
  page.key('KeyY', 'keydown', page.document.body, { key: 't' });
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark', 'Dvorak t still toggles theme');
  page.key('KeyT', 'keydown', page.document.body, { key: 'q' });
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark', 'wrong letter does not toggle');
  page.key('Digit2', 'keydown', page.document.body, { key: 'é' });
  assert.equal(page.get('tab-dough').hidden, true, 'AZERTY unshifted key does not switch tabs');
  page.key('Digit2', 'keydown', page.document.body, { key: '2' });
  assert.equal(page.get('tab-dough').hidden, false, 'real digit 2 still switches');
});

test('digits fire on AZERTY (Shift-required) and on the numpad', () => {
  const page = createPage(__dirname);
  page.key('Digit2', 'keydown', page.document.body, { shiftKey: true, key: '2' });
  assert.equal(page.get('tab-dough').hidden, false, 'AZERTY Shift+é produces digit 2');
  page.key('Numpad3', 'keydown', page.document.body, { key: '3' });
  assert.equal(page.get('tab-espresso').hidden, false, 'numpad digit works');
  page.key('KeyT', 'keydown', page.document.body, { shiftKey: true, key: 'T' });
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'light', 'Shift+T stays unmapped');
});

test('the T and P shortcuts drive theme and pin without clicking', () => {
  const page = createPage(__dirname);
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'light');
  page.key('KeyT');
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
  page.key('KeyT');
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'light');
  page.key('KeyP');
  assert.equal(page.get('pin-reference').getAttribute('aria-pressed'), 'true');
  page.key('KeyP');
  assert.equal(page.get('pin-reference').getAttribute('aria-pressed'), 'false');
});

test('the shortcuts checkbox disables and persists the off state', () => {
  const page = createPage(__dirname);
  const box = page.get('shortcuts-toggle');
  assert.equal(box.checked, true, 'enabled by default');
  box.checked = false; page.fire(box, 'change');
  page.key('Digit2');
  assert.equal(page.get('tab-lab').hidden, false, 'shortcut suppressed');
  assert.equal(page.storage.get('ff-shortcuts'), 'off');
  box.checked = true; page.fire(box, 'change');
  page.key('Digit2');
  assert.equal(page.get('tab-dough').hidden, false, 're-enabled works');
  assert.equal(page.storage.get('ff-shortcuts'), 'on');
});

test('a persisted off preference keeps shortcuts off on the next visit', () => {
  const off = createPage(__dirname, { storage: { 'ff-shortcuts': 'off' } });
  assert.equal(off.get('shortcuts-toggle').checked, false);
  off.key('Digit2');
  assert.equal(off.get('tab-lab').hidden, false);
  const on = createPage(__dirname, { storage: { 'ff-shortcuts': 'on' } });
  on.key('Digit2');
  assert.equal(on.get('tab-dough').hidden, false);
});

test('blocked storage still defaults shortcuts to on and never crashes', () => {
  const page = createPage(__dirname, { storageBlocked: true });
  page.key('Digit2');
  assert.equal(page.get('tab-dough').hidden, false);
  const box = page.get('shortcuts-toggle');
  box.checked = false; page.fire(box, 'change');
  page.key('Digit1');
  assert.equal(page.get('tab-dough').hidden, false, 'session toggle still works without storage');
});

test('every shortcut advertises itself through aria-keyshortcuts', () => {
  const page = createPage(__dirname);
  const ids = ['lab', 'dough', 'espresso', 'card', 'phase', 'data'];
  ids.forEach((name, i) => assert.equal(page.get('tabbtn-' + name).getAttribute('aria-keyshortcuts'), String(i + 1)));
  assert.equal(page.get('theme-toggle').getAttribute('aria-keyshortcuts'), 't');
  assert.equal(page.get('pin-reference').getAttribute('aria-keyshortcuts'), 'p');
  const label = page.document.querySelector('label[for="shortcuts-toggle"]');
  assert.ok(label && label.textContent.includes('Shortcuts'), 'visible toggle label exists');
});

test('digit shortcuts work when a tab button itself holds focus', () => {
  const page = createPage(__dirname);
  page.get('tabbtn-lab').focus();
  page.key('Digit3', 'keydown', page.get('tabbtn-lab'));
  assert.equal(page.get('tab-espresso').hidden, false);
});

// -- CSV export ----------------------------------------------------------------

test('the CSV download carries real formula numbers and the checksum', async () => {
  const page = createPage(__dirname);
  page.get('download-csv').click();
  const download = page.document.downloads.at(-1);
  assert.equal(download.filename, 'flavorforge-formula.csv');
  const raw = new Uint8Array(await page.blobs.get(download.href).arrayBuffer());
  assert.deepEqual([raw[0], raw[1], raw[2]], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM keeps Excel from mangling accents');
  const text = await page.blobs.get(download.href).text();
  assert.match(text, /formula,flour,100,1000/);
  assert.match(text, /formula,total,192,1920/);
  assert.match(text, new RegExp('meta,sha256,,' + F.recipeChecksum(F.importRecipe(page.get('json-area').value))));
});

test('a hostile formula name cannot inject spreadsheet formulas through CSV', async () => {
  const page = createPage(__dirname);
  const name = page.get('in-name');
  name.value = '=cmd|calc'; page.fire(name, 'input'); page.flushFrame();
  page.get('download-csv').click();
  const text = await page.blobs.get(page.document.downloads.at(-1).href).text();
  assert.match(text, /meta,name,,'=cmd\|calc/);
  assert.doesNotMatch(text, /meta,name,,=cmd/);
});

test('notes containing commas and quotes are quoted correctly in CSV', async () => {
  const page = createPage(__dirname);
  const notes = page.get('in-notes');
  notes.value = 'day 1, "fold" twice'; page.fire(notes, 'input'); page.flushFrame();
  page.get('download-csv').click();
  const text = await page.blobs.get(page.document.downloads.at(-1).href).text();
  assert.match(text, /meta,notes,,"day 1, ""fold"" twice"/);
});

test('the CSV button disables with other exports while a field is invalid', () => {
  const page = createPage(__dirname);
  const flour = page.get('in-flour');
  flour.value = '0'; page.fire(flour, 'input'); page.flushFrame();
  assert.equal(page.get('download-csv').disabled, true);
  flour.value = '750'; page.fire(flour, 'input'); page.flushFrame();
  assert.equal(page.get('download-csv').disabled, false);
});

// -- Numeric display hardening ----------------------------------------------------

test('giant kinetic timescales collapse to readable duration units', () => {
  const page = createPage(__dirname);
  const ea = page.get('num-ea');
  ea.value = '200'; page.fire(ea, 'input'); page.flushFrame();
  const surface = page.get('range-surface');
  surface.value = '100'; page.fire(surface, 'input'); page.flushFrame();
  const halfLife = page.document.querySelector('[data-tile="halfLife"]').textContent;
  assert.match(halfLife, /e\+\d+ y/, 'absurd half-life shown as exponential years, got ' + halfLife);
  assert.doesNotMatch(halfLife, /NaN|Infinity/);
});

test('moderate durations keep human units across the ferment range', () => {
  const page = createPage(__dirname);
  assert.match(page.document.querySelector('[data-tile="doubling"]').textContent, /120\.0 min/);
  const ferment = page.get('range-ferment-temp');
  ferment.value = '60'; page.fire(ferment, 'input'); page.flushFrame();
  assert.match(page.document.querySelector('[data-tile="doubling"]').textContent, /\d+\.\d h/);
  ferment.value = '4'; page.fire(ferment, 'input'); page.flushFrame();
  assert.match(page.document.querySelector('[data-tile="doubling"]').textContent, /\d+\.\d h/);
});

test('extreme fermentation charts stay finite and label axes in k units', () => {
  const page = createPage(__dirname);
  const ferment = page.get('range-ferment-temp');
  ferment.value = '60'; page.fire(ferment, 'input'); page.flushFrame();
  const html = page.get('chart-rise').innerHTML;
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /[123]k/, 'thousand-minute ticks render as k units');
  assert.match(html, /2x at/);
});

// -- Pin readout and focus ---------------------------------------------------------

test('the pin readout hides deltas that round to zero', () => {
  const page = createPage(__dirname);
  page.get('pin-reference').click();
  const hyd = page.get('range-hydration-lab');
  hyd.value = '70.001'; page.fire(hyd, 'input'); page.flushFrame();
  assert.match(page.get('pinReadout').textContent, /identical to live settings/);
  assert.doesNotMatch(page.get('pinReadout').textContent, /\+0/);
  hyd.value = '72'; page.fire(hyd, 'input'); page.flushFrame();
  assert.match(page.get('pinReadout').textContent, /hydration \+2%/);
});

test('the checksum freezes alongside the JSON box while the user edits it', () => {
  const page = createPage(__dirname);
  const before = page.get('recipe-sha').textContent;
  page.get('json-area').focus();
  const hyd = page.get('range-hydration-lab');
  hyd.value = '61'; page.fire(hyd, 'input'); page.flushFrame();
  assert.equal(page.get('recipe-sha').textContent, before, 'stale textarea keeps its matching checksum');
  page.document.activeElement = page.document.body;
  hyd.value = '63'; page.fire(hyd, 'input'); page.flushFrame();
  const after = page.get('recipe-sha').textContent;
  assert.notEqual(after, before);
  assert.equal(after, F.recipeChecksum(F.importRecipe(page.get('json-area').value)));
});

test('table toggles expose disclosure state and control targets from boot', () => {
  const page = createPage(__dirname);
  const buttons = page.document.querySelectorAll('.table-toggle');
  assert.equal(buttons.length, 6);
  for (const btn of buttons) {
    const tid = btn.getAttribute('aria-controls');
    assert.ok(tid && page.get(tid), 'aria-controls resolves to ' + tid);
    assert.equal(btn.getAttribute('data-table'), tid);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(page.get(tid).hidden, true);
    btn.click();
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.equal(page.get(tid).hidden, false);
    btn.click();
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(page.get(tid).hidden, true);
  }
});

test('refresh, copy, and import keep the checksum glued to the JSON box', () => {
  const page = createPage(__dirname);
  const area = page.get('json-area');
  area.focus();
  const hyd = page.get('range-hydration-lab');
  hyd.value = '66'; page.fire(hyd, 'input'); page.flushFrame();
  const stale = page.get('recipe-sha').textContent;
  page.get('refresh-json').click();
  assert.equal(page.get('recipe-sha').textContent, F.sha256(area.value), 'refresh keeps sha == displayed JSON');
  assert.notEqual(page.get('recipe-sha').textContent, stale);
  page.get('load-example').click(); page.get('import-json').click();
  assert.equal(page.get('recipe-sha').textContent, F.sha256(page.get('json-area').value), 'import keeps sha == displayed JSON');
  assert.match(page.get('json-area').value, /Tapioca boba dough/);
});

test('the JSON area keeps user focus and content across renders', () => {
  const page = createPage(__dirname);
  const area = page.get('json-area');
  area.focus();
  area.value = '{"draft":true}';
  const hyd = page.get('range-hydration-lab');
  hyd.value = '64'; page.fire(hyd, 'input'); page.flushFrame();
  assert.equal(area.value, '{"draft":true}');
  area.blur ? area.blur() : (page.document.activeElement = page.document.body);
  hyd.value = '66'; page.fire(hyd, 'input'); page.flushFrame();
  assert.match(area.value, /"hydrationPct": 66/);
});

// -- Select synchronization --------------------------------------------------------

test('recipe import syncs the style select and leaves view selects alone', () => {
  const page = createPage(__dirname);
  page.get('load-example').click(); page.get('import-json').click();
  assert.equal(page.get('in-style').value, 'boba');
  assert.equal(page.get('select-starch').value, 'tapioca');
  assert.equal(F.importRecipe(page.get('json-area').value).style, 'boba');
});

test('a failed import never corrupts the style select', () => {
  const page = createPage(__dirname), before = page.get('in-style').value;
  const invalid = JSON.parse(page.get('json-area').value);
  invalid.style = 'bogus';
  page.get('import-area').value = JSON.stringify(invalid);
  page.get('import-json').click();
  assert.equal(page.get('in-style').value, before);
});

// -- Regression on the new control surface -------------------------------------------

test('a pending invalid field blocks the espresso apply even when solvable', () => {
  const page = createPage(__dirname);
  assert.equal(page.get('apply-grind').disabled, false, 'solvable default target');
  const flour = page.get('in-flour');
  flour.value = '0'; page.fire(flour, 'input'); page.flushFrame();
  assert.equal(page.get('apply-grind').disabled, true);
  flour.value = '800'; page.fire(flour, 'change'); page.flushFrame();
  assert.equal(page.get('apply-grind').disabled, false);
});

test('schedule analysis rejects payloads over 64 KiB and tolerates extra keys', () => {
  const page = createPage(__dirname);
  page.get('schedule-json').value = ' '.repeat(70000);
  page.get('analyze-schedule').click();
  assert.match(page.get('schedule-summary').textContent, /Schedule rejected/);
  page.get('schedule-json').value = '[{"tempC":150,"durationMin":20,"note":"extra"}]';
  page.get('analyze-schedule').click();
  assert.match(page.get('schedule-summary').textContent, /50\.00% model conversion/);
});

test('theme choice persists to storage across sessions', () => {
  const page = createPage(__dirname);
  page.get('theme-toggle').click();
  assert.equal(page.storage.get('ff-theme'), 'dark');
  const next = createPage(__dirname, { storage: { 'ff-theme': 'dark' } });
  assert.equal(next.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(next.get('theme-toggle').textContent, 'Parchment notebook');
});

test('exported SVGs drop interactive hover and crosshair artifacts', async () => {
  const page = createPage(__dirname);
  page.get('download-card-svg').click();
  const svg = await page.blobs.get(page.document.downloads.at(-1).href).text();
  assert.doesNotMatch(svg, /ff-hover|ff-crosshair/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<path/);
});

test('every interactive id on the hardened page still resolves cleanly', () => {
  const page = createPage(__dirname);
  page.get('pin-reference').click();
  page.key('Digit6');
  page.key('Digit4');
  const hyd = page.get('range-hydration-lab');
  hyd.value = '61'; page.fire(hyd, 'input'); page.flushFrame();
  auditPage(page);
});

// -- L580 accessibility contract ---------------------------------------------

test('a skip link targets the main landmark before all header navigation', () => {
  const page = createPage(__dirname);
  const skip = page.document.querySelector('a.skip-link');
  assert.ok(skip, 'skip link exists');
  assert.equal(skip.getAttribute('href'), '#main-content');
  const main = page.document.querySelector('main#main-content');
  assert.ok(main, 'main landmark carries the skip target id');
  assert.equal(main.getAttribute('tabindex'), '-1');
  const firstElement = page.document.body.children[0];
  assert.equal(firstElement, skip, 'skip link is the first focusable element in body order');
});

test('every tab button declares type button explicitly', () => {
  const page = createPage(__dirname);
  for (const btn of page.document.querySelectorAll('.tab')) {
    assert.equal(btn.getAttribute('type'), 'button', btn.id);
  }
});

test('the stylesheet contains an explicit reduced-motion override', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(css, /transition-duration:\s*0\.01ms\s*!important/);
  assert.match(css, /scroll-behavior:\s*auto\s*!important/);
});

test('schedule analysis enforces the 64 KiB cap in UTF-8 bytes', () => {
  const page = createPage(__dirname);
  const text = '水'.repeat(22000);
  assert.ok(text.length < 65536);
  assert.ok(Buffer.byteLength(text, 'utf8') > 65536);
  page.get('schedule-json').value = text;
  page.get('analyze-schedule').click();
  assert.match(page.get('schedule-summary').textContent, /exceeds 64 KiB/);
});
