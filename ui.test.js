'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./kinetics.js');
const { createPage, auditPage } = require('./dom-harness.cjs');

test('real HTML and controllers boot with disabled storage and all four starch curves', () => {
  const page = createPage(__dirname, { storageBlocked: true });
  auditPage(page);
  assert.equal(page.get('chart-gel').querySelectorAll('path').length, 4);
  for (const id of ['chart-lab', 'chart-gel', 'chart-rise', 'chart-esp', 'phase-browning', 'phase-gel', 'phase-esp']) {
    assert.ok(page.get(id).querySelector('svg'));
    assert.doesNotMatch(page.get(id).innerHTML, /NaN|Infinity/);
  }
  assert.match(page.get('schedule-summary').textContent, /10\.0 min/);
});

test('invalid numeric input preserves the valid recipe and recovers without uncaught errors', () => {
  const page = createPage(__dirname), before = page.get('json-area').value;
  for (const invalid of ['', '0', '-1', '1e999', '1000junk']) {
    page.get('in-flour').value = invalid;
    page.fire(page.get('in-flour'), 'input'); page.flushFrame();
    assert.equal(page.get('json-area').value, before);
    assert.equal(page.get('in-flour').getAttribute('aria-invalid'), 'true');
    assert.equal(page.get('download-json').disabled, true);
  }
  page.get('in-flour').value = '850'; page.fire(page.get('in-flour'), 'change'); page.flushFrame();
  assert.equal(F.importRecipe(page.get('json-area').value).flourGrams, 850);
  assert.equal(page.get('download-json').disabled, false);
});

test('shared hydration inputs and starter inspector remain synchronized', () => {
  const page = createPage(__dirname);
  const input = page.get('range-hydration-lab'); input.value = '62.5'; page.fire(input, 'input'); page.flushFrame();
  assert.equal(page.get('range-hydration-dough').value, '62.5');
  assert.equal(F.importRecipe(page.get('json-area').value).hydrationPct, 62.5);
  assert.match(page.document.querySelector('[data-tile="effectiveHydration"]').textContent, /65\.91%/);
  page.get('in-starter').value = '0'; page.fire(page.get('in-starter'), 'input'); page.flushFrame();
  assert.equal(page.document.querySelector('[data-tile="effectiveHydration"]').textContent, '62.50%');
});

test('typing multiword names preserves the active input while canonical JSON trims it', () => {
  const page = createPage(__dirname), name = page.get('in-name');
  name.value = 'House '; page.fire(name, 'input'); page.flushFrame(); assert.equal(name.value, 'House ');
  name.value = 'House loaf'; page.fire(name, 'input'); page.flushFrame();
  assert.equal(F.importRecipe(page.get('json-area').value).name, 'House loaf');
});

test('fractional recipe imports retain their exact slider values', () => {
  const page = createPage(__dirname);
  page.get('import-area').value = F.exportRecipe(F.createRecipe({ hydrationPct: 62.55, grindMicrons: 540.25 }));
  page.get('import-json').click();
  assert.equal(page.get('range-hydration-lab').getAttribute('step'), 'any');
  assert.equal(page.get('range-grind').getAttribute('step'), 'any');
  assert.equal(page.get('range-hydration-lab').value, '62.55');
  assert.equal(page.get('range-grind').value, '540.25');
});

test('unreachable extraction targets disable the solver and reachable targets apply exactly', () => {
  const page = createPage(__dirname);
  page.get('range-target-yield').value = '15'; page.fire(page.get('range-target-yield'), 'input'); page.flushFrame();
  assert.equal(page.get('apply-grind').disabled, true);
  assert.match(page.get('solver-status').textContent, /Reachable yield/);
  page.get('range-target-yield').value = '22'; page.fire(page.get('range-target-yield'), 'input'); page.flushFrame();
  page.get('apply-grind').click();
  assert.equal(page.get('range-grind').value, '300');
  assert.equal(F.importRecipe(page.get('json-area').value).grindMicrons, 300);
});

test('recipe import is atomic and the boba example has no levain or salt', () => {
  const page = createPage(__dirname), before = page.get('json-area').value;
  const invalid = JSON.parse(before); invalid.style = 'unknown';
  page.get('import-area').value = JSON.stringify(invalid); page.get('import-json').click();
  assert.equal(page.get('json-area').value, before);
  assert.match(page.get('import-status').textContent, /Import rejected/);
  page.get('load-example').click(); page.get('import-json').click();
  const recipe = F.importRecipe(page.get('json-area').value);
  assert.equal(recipe.style, 'boba'); assert.equal(recipe.starterPct, 0); assert.equal(recipe.saltPct, 0);
  assert.equal(page.get('in-starter-hydration').value, '100');
  auditPage(page);
});

test('tabs support click, arrow navigation, and roving keyboard focus', () => {
  const page = createPage(__dirname);
  page.get('tabbtn-card').click();
  assert.equal(page.get('tab-card').hidden, false);
  assert.equal(page.get('tab-lab').hidden, true);
  page.fire(page.get('tabbtn-card'), 'keydown', { code: 'End' });
  assert.equal(page.get('tabbtn-data').getAttribute('aria-selected'), 'true');
  assert.equal(page.document.activeElement, page.get('tabbtn-data'));
  page.fire(page.get('tabbtn-data'), 'keydown', { code: 'Home' });
  assert.equal(page.get('tabbtn-lab').getAttribute('tabindex'), '0');
  assert.equal(page.document.querySelectorAll('.tab[tabindex="0"]').length, 1);
});

test('schedule presets, exact analysis, and rejection feedback are wired', () => {
  const page = createPage(__dirname);
  page.get('schedule-preset').value = '1'; page.get('load-schedule').click();
  assert.equal(page.get('schedule-table').querySelectorAll('tbody tr').length, 2);
  page.get('schedule-json').value = '[{"tempC":150,"durationMin":20}]'; page.get('analyze-schedule').click();
  assert.match(page.get('schedule-summary').textContent, /50\.00% model conversion/);
  page.get('schedule-json').value = '[{"tempC":150,"durationMin":-1}]'; page.get('analyze-schedule').click();
  assert.match(page.get('schedule-summary').textContent, /Schedule rejected/);
  assert.equal(page.get('schedule-table').innerHTML, '');
  page.get('schedule-preset').value = '0'; page.get('load-schedule').click();
  assert.match(page.get('schedule-summary').textContent, /10\.0 min/);
});

test('standalone SVG and recipe downloads contain real current state', async () => {
  const page = createPage(__dirname);
  page.get('download-card-svg').click();
  const svgDownload = page.document.downloads.at(-1);
  const svg = await page.blobs.get(svgDownload.href).text();
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<style>.*\.ff-tick/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  page.get('download-json').click();
  const jsonDownload = page.document.downloads.at(-1);
  assert.deepEqual(F.importRecipe(await page.blobs.get(jsonDownload.href).text()), F.importRecipe(page.get('json-area').value));
  page.get('print-card').click(); assert.equal(page.document.printed, true);
});

test('hover, table toggles, and theme redraws remain connected to current SVGs', () => {
  const page = createPage(__dirname, { storage: { 'ff-theme': 'invalid' } });
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'light');
  page.get('theme-toggle').click(); assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
  const overlay = page.get('chart-lab').querySelector('.ff-hover');
  page.fire(overlay, 'pointermove', { clientX: 400, pageX: 400, pageY: 100 });
  assert.equal(page.get('chart-tooltip').hidden, false);
  assert.match(page.get('chart-tooltip').textContent, /Relative rate/);
  page.fire(overlay, 'pointerleave'); assert.equal(page.get('chart-tooltip').hidden, true);
  const toggle = page.document.querySelector('[data-table="table-lab"]'); toggle.click();
  assert.equal(page.get('table-lab').hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  auditPage(page);
});

test('clipboard failure selects valid JSON for a manual copy', async () => {
  const page = createPage(__dirname);
  page.navigator.clipboard = { writeText: () => Promise.reject(new Error('blocked')) };
  page.get('copy-json').click(); await Promise.resolve();
  assert.equal(page.get('json-area').selected, true);
  assert.match(page.get('import-status').textContent, /Select and copy/);
});

test('the title stands alone with no tagline or eyebrow text around it', () => {
  const page = createPage(__dirname);
  const h1 = page.document.querySelector('h1');
  assert.equal(h1.textContent, 'FlavorForge');
  for (const sibling of h1.parentElement.children) assert.equal(sibling.tagName, 'H1');
  assert.equal(page.document.querySelector('.tagline'), null);
  assert.equal(page.document.querySelector('.eyebrow, .kicker'), null);
});

test('pin reference draws ghost series and markers across all four charts then clears', () => {
  const page = createPage(__dirname);
  const labPaths = () => page.get('chart-lab').querySelectorAll('path').length;
  const gelPaths = () => page.get('chart-gel').querySelectorAll('path').length;
  const risePaths = () => page.get('chart-rise').querySelectorAll('path').length;
  const espCircles = () => page.get('chart-esp').querySelectorAll('circle').length;
  assert.equal(labPaths(), 1); assert.equal(gelPaths(), 4); assert.equal(risePaths(), 1); assert.equal(espCircles(), 1);

  page.get('pin-reference').click();
  assert.equal(page.get('pin-reference').getAttribute('aria-pressed'), 'true');
  assert.equal(labPaths(), 2); assert.equal(gelPaths(), 5); assert.equal(risePaths(), 2); assert.equal(espCircles(), 2);
  assert.match(page.get('chart-lab').innerHTML, /pinned 180 C/);
  const pinRel = F.relativeBrowning(180, { A: F.constants.MAILLARD_DEFAULT.A, Ea: 100000, refC: 150 }).toFixed(2);
  assert.match(page.document.querySelector('[data-tile="relativeBrowningNote"]').textContent, new RegExp('pinned ' + pinRel.replace('.', '\\.') + 'x at 180 C'));
  assert.match(page.get('legend-gel').innerHTML, /Boba pinned/);

  const surface = page.get('range-surface'); surface.value = '200'; page.fire(surface, 'input'); page.flushFrame();
  assert.equal(labPaths(), 2);
  assert.match(page.get('chart-lab').innerHTML, /set point 200 C[\s\S]*pinned 180 C/);
  const ferment = page.get('range-ferment-temp'); ferment.value = '40'; page.fire(ferment, 'input'); page.flushFrame();
  assert.equal(risePaths(), 2);
  assert.match(page.get('chart-rise').innerHTML, /pinned 2x/);
  const grind = page.get('range-grind'); grind.value = '900'; page.fire(grind, 'input'); page.flushFrame();
  assert.match(page.get('chart-esp').innerHTML, /pinned 600 um/);

  page.get('pin-reference').click();
  assert.equal(page.get('pin-reference').getAttribute('aria-pressed'), 'false');
  assert.equal(labPaths(), 1); assert.equal(gelPaths(), 4); assert.equal(risePaths(), 1); assert.equal(espCircles(), 1);
  auditPage(page);
});

test('the gelatinization phase marker tracks dough temperature not surface temperature', () => {
  const page = createPage(__dirname);
  const markerCy = () => Number(page.get('phase-gel').querySelector('circle').getAttribute('cy'));
  const sy = tempC => 24 + (1 - (Math.min(100, Math.max(40, tempC)) - 40) / 60) * 296;
  assert.ok(Math.abs(markerCy() - sy(28)) < 0.1, 'default 28 C dough sits in the native band');
  const ferment = page.get('range-ferment-temp');
  ferment.value = '60'; page.fire(ferment, 'input'); page.flushFrame();
  assert.ok(Math.abs(markerCy() - sy(60)) < 0.1, '60 C dough moves into the band');
  const surface = page.get('range-surface'); surface.value = '240'; page.fire(surface, 'input'); page.flushFrame();
  assert.ok(Math.abs(markerCy() - sy(60)) < 0.1, 'surface temperature does not move the dough marker');
});
