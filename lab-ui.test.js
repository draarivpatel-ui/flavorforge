'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./kinetics.js');
const L = require('./process-lab.js');
const { createPage, auditPage } = require('./dom-harness.cjs');

function pageDigest(page) {
  return page.get('lab-digest').textContent.trim();
}

function labRows(page) {
  return page.get('lab-profile-table').querySelectorAll('tbody tr');
}

test('the process lab tab boots hidden and reveals a complete panel on click', () => {
  const page = createPage(__dirname);
  auditPage(page);
  assert.equal(page.get('tab-process').hidden, true);
  assert.equal(page.get('tabbtn-process').getAttribute('aria-selected'), 'false');
  page.get('tabbtn-process').click();
  assert.equal(page.get('tab-process').hidden, false);
  assert.equal(page.get('tabbtn-process').getAttribute('aria-selected'), 'true');
  assert.equal(page.get('tab-lab').hidden, true);
  page.get('tabbtn-process').click();
  assert.equal(page.get('tab-lab').hidden, true, 'other panels stay hidden');
});

test('the on-page digest is the canonical stamped sha256 of the current state', () => {
  const page = createPage(__dirname);
  const d = pageDigest(page);
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(d, L.stampedReport(L.STATE_DEFAULTS).digest);
});

test('the comparator table renders five profile rows with exact kinetics values', () => {
  const page = createPage(__dirname);
  const rows = labRows(page);
  assert.equal(rows.length, 5);
  const thermal = L.stampedReport(L.STATE_DEFAULTS).report.thermal;
  thermal.forEach((r, i) => {
    const cells = rows[i].querySelectorAll('td');
    assert.match(cells[0].textContent, new RegExp(r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(cells[2].textContent, r.totalMin.toFixed(1));
    assert.equal(cells[3].textContent, r.totalDose.toFixed(4));
    assert.equal(cells[4].textContent, r.conversionX.toFixed(4));
    assert.equal(cells[6].textContent, r.doseTempC.toFixed(1));
    assert.equal(cells[7].textContent, r.effectiveQ10.toFixed(3));
    assert.equal(cells[8].textContent, r.yeastMarginC.toFixed(0));
    assert.equal(cells[9].querySelectorAll('.lab-use').length, 1);
    assert.equal(cells[9].querySelectorAll('.lab-load').length, 1);
  });
});

test('exactly one comparator row is marked active and disabled', () => {
  const page = createPage(__dirname);
  const rows = labRows(page);
  const active = Array.from(rows).filter(tr => tr.className === 'lab-active-row');
  assert.equal(active.length, 1);
  const btn = active[0].querySelector('.lab-use');
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Active');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  const others = Array.from(rows).filter(tr => tr !== active[0]);
  others.forEach(tr => {
    const b = tr.querySelector('.lab-use');
    assert.equal(b.disabled, false);
    assert.equal(b.textContent, 'Use');
  });
});

test('clicking Use on another profile switches the active row and changes the digest', () => {
  const page = createPage(__dirname);
  const before = pageDigest(page);
  const searUse = page.get('lab-profile-table').querySelector('.lab-use[data-profile="sear"]');
  searUse.click();
  assert.notEqual(pageDigest(page), before);
  const rows = labRows(page);
  assert.equal(rows[4].className, 'lab-active-row');
  assert.equal(rows[4].querySelector('.lab-use').textContent, 'Active');
  assert.equal(rows[0].querySelector('.lab-use').disabled, false);
});

test('the Load button pushes profile stages into the schedule analyzer and jumps tabs', () => {
  const page = createPage(__dirname);
  const load = page.get('lab-profile-table').querySelector('.lab-load[data-profile="steam-deck"]');
  load.click();
  assert.equal(page.get('tab-lab').hidden, false);
  const stages = JSON.parse(page.get('schedule-json').value);
  assert.deepEqual(stages, [{ tempC: 230, durationMin: 3 }, { tempC: 190, durationMin: 7 }]);
  assert.match(page.get('schedule-summary').textContent, /10\.0 min/);
});

test('the Load button pushes every profile schedule into the analyzer', () => {
  const page = createPage(__dirname);
  for (const p of L.THERMAL_PROFILES) {
    page.get('tabbtn-process').click();
    const btn = page.get('lab-profile-table').querySelector('.lab-load[data-profile="' + p.key + '"]');
    btn.click();
    const stages = JSON.parse(page.get('schedule-json').value);
    assert.deepEqual(stages, p.stages.map(s => ({ tempC: s.tempC, durationMin: s.durationMin })));
    assert.equal(page.get('tab-lab').hidden, false);
    assert.match(page.get('schedule-summary').textContent, /model conversion/);
  }
});

test('the conversion chart renders five focusable curves with a 0.5 reference line', () => {
  const page = createPage(__dirname);
  const svg = page.get('lab-chart-conversion').querySelector('svg');
  assert.ok(svg);
  const curves = svg.querySelectorAll('.lab-curve');
  assert.equal(curves.length, 5);
  curves.forEach(c => assert.equal(c.getAttribute('tabindex'), '0'));
  assert.match(svg.innerHTML, /X = 0\.5/);
  assert.doesNotMatch(svg.innerHTML, /NaN|Infinity/);
});

test('the conversion chart draws one focusable marker per crossing profile', () => {
  const page = createPage(__dirname);
  const pts = page.get('lab-chart-conversion').querySelectorAll('.lab-pt');
  const crossing = L.compareProfiles(L.STATE_DEFAULTS).filter(r => r.crosses50).length;
  assert.equal(pts.length, crossing);
  assert.ok(crossing >= 3);
  pts.forEach(p => assert.equal(p.getAttribute('tabindex'), '0'));
});

test('the active conversion curve is drawn heavier than inactive curves', () => {
  const page = createPage(__dirname);
  const widths = Array.from(page.get('lab-chart-conversion').querySelectorAll('.lab-curve')).map(c => c.getAttribute('stroke-width'));
  assert.deepEqual(widths.map(Number), [3.2, 2.1, 2.1, 2.1, 2.1]);
});

test('the Tm chart renders four focusable curves with 48 point markers', () => {
  const page = createPage(__dirname);
  const svg = page.get('lab-chart-tm').querySelector('svg');
  const curves = svg.querySelectorAll('.lab-curve');
  assert.equal(curves.length, 4);
  curves.forEach(c => assert.equal(c.getAttribute('tabindex'), '0'));
  assert.equal(svg.querySelectorAll('.lab-pt').length, 48);
  assert.doesNotMatch(svg.innerHTML, /NaN|Infinity/);
});

test('the Tm chart marks the bookmarked starch curve heavier', () => {
  const page = createPage(__dirname);
  const widths = Array.from(page.get('lab-chart-tm').querySelectorAll('.lab-curve')).map(c => Number(c.getAttribute('stroke-width')));
  assert.deepEqual(widths, [3.2, 2.1, 2.1, 2.1]);
  const sel = page.get('select-starch');
  sel.value = 'rice'; page.fire(sel, 'change'); page.flushFrame();
  const widths2 = Array.from(page.get('lab-chart-tm').querySelectorAll('.lab-curve')).map(c => Number(c.getAttribute('stroke-width')));
  assert.deepEqual(widths2, [2.1, 2.1, 2.1, 3.2]);
});

test('the conversion data table toggle reveals a five-column numeric table', () => {
  const page = createPage(__dirname);
  const toggle = page.document.querySelector('[data-table="lab-conversion-table"]');
  assert.ok(toggle, 'toggle exists');
  assert.equal(page.get('lab-conversion-table').hidden, true);
  toggle.click();
  assert.equal(page.get('lab-conversion-table').hidden, false);
  const rows = page.get('lab-conversion-table').querySelectorAll('tbody tr');
  assert.ok(rows.length >= 8);
  const head = page.get('lab-conversion-table').querySelectorAll('thead th');
  assert.equal(head.length, 6);
  assert.doesNotMatch(page.get('lab-conversion-table').innerHTML, /NaN|Infinity/);
});

test('the sensitivity matrix toggle reveals the 12-row Tm grid plus espresso table', () => {
  const page = createPage(__dirname);
  const toggle = page.document.querySelector('[data-table="lab-matrix-table"]');
  toggle.click();
  assert.equal(page.get('lab-matrix-table').hidden, false);
  const tables = page.get('lab-matrix-table').querySelectorAll('table');
  assert.equal(tables.length, 2);
  assert.equal(tables[0].querySelectorAll('tbody tr').length, 12);
  assert.equal(tables[0].querySelectorAll('thead th').length, 5);
  assert.equal(tables[1].querySelectorAll('tbody tr').length, 12);
});

test('the matrix Tm cells match the model at every grid point', () => {
  const page = createPage(__dirname);
  page.document.querySelector('[data-table="lab-matrix-table"]').click();
  const table = page.get('lab-matrix-table').querySelectorAll('table')[0];
  const rows = table.querySelectorAll('tbody tr');
  const sens = L.sensitivitySurface(L.STATE_DEFAULTS);
  const keys = ['tapioca', 'wheat', 'potato', 'rice'];
  rows.forEach((tr, j) => {
    const cells = tr.querySelectorAll('td');
    assert.equal(cells[0].textContent, String(sens.hydrations[j]));
    keys.forEach((k, i) => {
      assert.equal(cells[i + 1].textContent, sens.starchTm[k].tm[j].toFixed(2), k + ' @ ' + sens.hydrations[j]);
    });
  });
});

test('the espresso table inside the matrix lists the monotonic yield curve', () => {
  const page = createPage(__dirname);
  page.document.querySelector('[data-table="lab-matrix-table"]').click();
  const rows = page.get('lab-matrix-table').querySelectorAll('table')[1].querySelectorAll('tbody tr');
  const sens = L.sensitivitySurface(L.STATE_DEFAULTS);
  assert.equal(rows.length, sens.espresso.grinds.length);
  let prev = Infinity;
  rows.forEach((tr, i) => {
    const cells = tr.querySelectorAll('td');
    assert.equal(cells[0].textContent, sens.espresso.grinds[i].toFixed(1));
    const y = Number(cells[1].textContent);
    assert.ok(y < prev, 'monotone');
    prev = y;
  });
});

test('lab legends render five thermal and four starch swatches', () => {
  const page = createPage(__dirname);
  assert.equal(page.get('lab-legend-conv').querySelectorAll('.legend-key').length, 5);
  assert.equal(page.get('lab-legend-tm').querySelectorAll('.legend-key').length, 4);
  assert.match(page.get('lab-legend-conv').textContent, /Low-Slow 150 C Half-Life/);
});

test('the JSON export button downloads a stamped canonical brief', async () => {
  const page = createPage(__dirname);
  page.get('lab-export-json').click();
  const dl = page.document.downloads.at(-1);
  assert.equal(dl.filename, 'flavorforge-lab-brief.json');
  const doc = JSON.parse(await page.blobs.get(dl.href).text());
  assert.equal(doc.sha256, pageDigest(page));
  assert.equal(doc.schema, L.SCHEMA);
  assert.equal(doc.thermal.length, 5);
  assert.match(page.get('lab-export-status').textContent, /JSON brief/);
});

test('the CSV export button downloads a BOM-prefixed formula-safe brief', async () => {
  const page = createPage(__dirname);
  page.get('lab-export-csv').click();
  const dl = page.document.downloads.at(-1);
  const blob = page.blobs.get(dl.href);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM leads the file');
  const text = await blob.text();
  assert.match(text, /flavorforge-lab-audit,sha256,/);
  assert.ok(text.includes(pageDigest(page)));
  assert.equal(L.verifyExport(text).ok, true);
});

test('the Markdown export button downloads a footer-stamped brief', async () => {
  const page = createPage(__dirname);
  page.get('lab-export-md').click();
  const dl = page.document.downloads.at(-1);
  const text = await page.blobs.get(dl.href).text();
  assert.match(text, new RegExp('SHA-256: ' + pageDigest(page)));
  assert.equal(L.verifyExport(text).ok, true);
});

test('all three lab exports verify against their own stamped digests', async () => {
  const page = createPage(__dirname);
  for (const id of ['lab-export-json', 'lab-export-csv', 'lab-export-md']) {
    page.get(id).click();
    const dl = page.document.downloads.at(-1);
    const text = await page.blobs.get(dl.href).text();
    const v = L.verifyExport(text);
    assert.equal(v.ok, true, id + ': ' + v.detail);
  }
});

test('the verify and tamper demo reports intact then rejected', () => {
  const page = createPage(__dirname);
  page.get('lab-verify-demo').click();
  const s = page.get('lab-export-status').textContent;
  assert.match(s, /Intact JSON: verified/);
  assert.match(s, /correctly rejected/);
});

test('the copy share link writes a decodable #ff= bookmark', async () => {
  const page = createPage(__dirname);
  let copied = null;
  page.navigator.clipboard = { writeText: t => { copied = t; return Promise.resolve(); } };
  page.get('lab-copy-link').click();
  await Promise.resolve();
  assert.ok(copied && copied.includes('#ff='), 'clipboard got the link');
  const st = L.decodeHash(copied.slice(copied.indexOf('#ff=')));
  assert.deepEqual(st, { profile: 'steady-180', EaKj: 100, starch: 'tapioca', hyd: 70, fermT: 28, yieldT: 20 });
});

test('the copy share link falls back to showing the hash when clipboard is blocked', async () => {
  const page = createPage(__dirname);
  page.navigator.clipboard = { writeText: () => Promise.reject(new Error('blocked')) };
  page.get('lab-copy-link').click();
  await Promise.resolve();
  assert.match(page.get('lab-export-status').textContent, /Copy this #ff= share link: #ff=[A-Za-z0-9_-]+/);
});

test('the in-page self-test runner prints the full pass banner', () => {
  const page = createPage(__dirname);
  page.get('lab-selftest-run').click();
  assert.match(page.get('lab-selftest-result').textContent, /18\/18 deterministic self-tests passing/);
  const rows = page.get('lab-selftest-list').querySelectorAll('tbody tr');
  assert.equal(rows.length, 18);
  rows.forEach(r => assert.match(r.querySelector('td').textContent, /PASS/));
  assert.equal(page.get('lab-selftest-list').querySelectorAll('.lab-fail').length, 0);
});

test('hydration changes re-stamp the digest and the matrix stays consistent', () => {
  const page = createPage(__dirname);
  const before = pageDigest(page);
  const input = page.get('range-hydration-lab');
  input.value = '85'; page.fire(input, 'input'); page.flushFrame();
  assert.notEqual(pageDigest(page), before);
  assert.equal(pageDigest(page), L.stampedReport({ hyd: 85 }).digest);
});

test('Ea changes re-render the comparator with the new activation energy', () => {
  const page = createPage(__dirname);
  const ea = page.get('num-ea');
  ea.value = '150'; page.fire(ea, 'input'); page.flushFrame();
  const thermal = L.stampedReport({ EaKj: 150 }).report.thermal;
  const rows = labRows(page);
  assert.equal(rows[0].querySelectorAll('td')[4].textContent, thermal[0].conversionX.toFixed(4));
});

test('ferment temperature changes re-stamp the digest through the shared slider', () => {
  const page = createPage(__dirname);
  const before = pageDigest(page);
  const t = page.get('range-ferment-temp');
  t.value = '40'; page.fire(t, 'input'); page.flushFrame();
  assert.notEqual(pageDigest(page), before);
});

test('a #ff= hash restores all six fields before first paint', () => {
  const h = L.encodeHash({ profile: 'sear', EaKj: 150, starch: 'rice', hyd: 82.5, fermT: 33, yieldT: 21.25 });
  const page = createPage(__dirname, { hash: h });
  assert.equal(page.get('num-ea').value, '150');
  assert.equal(page.get('select-starch').value, 'rice');
  assert.equal(page.get('range-ferment-temp').value, '33');
  assert.equal(page.get('range-hydration-lab').value, '82.5');
  assert.equal(page.get('range-target-yield').value, '21.25');
  assert.equal(labRows(page)[4].className, 'lab-active-row');
  assert.match(page.get('control-status').textContent, /Restored the lab bookmark/);
  assert.equal(pageDigest(page), L.stampedReport({ profile: 'sear', EaKj: 150, starch: 'rice', hyd: 82.5, fermT: 33, yieldT: 21.25 }).digest);
});

test('a malformed #ff= hash is rejected with an honest status note', () => {
  const page = createPage(__dirname, { hash: '#ff=@@@bad' });
  assert.match(page.get('control-status').textContent, /Ignored a malformed #ff=/);
  assert.equal(page.get('num-ea').value, '100');
  assert.equal(labRows(page)[0].className, 'lab-active-row');
});

test('a hostile #ff= hash with an injected __proto__ key is rejected', () => {
  const json = '{"v":1,"__proto__":{"evil":1},"profile":"sear","EaKj":100,"starch":"wheat","hyd":70,"fermT":28,"yieldT":20}';
  const page = createPage(__dirname, { hash: '#ff=' + L.b64urlEncode(json) });
  assert.match(page.get('control-status').textContent, /Ignored a malformed #ff=/);
  assert.equal({}.evil, undefined);
  assert.equal(page.get('num-ea').value, '100');
});

test('an out-of-range #ff= hash is rejected rather than clamped', () => {
  const h = '#ff=' + L.b64urlEncode(JSON.stringify({ v: 1, profile: 'sear', EaKj: 999, starch: 'wheat', hyd: 70, fermT: 28, yieldT: 20 }));
  const page = createPage(__dirname, { hash: h });
  assert.match(page.get('control-status').textContent, /Ignored a malformed #ff=/);
  assert.equal(page.get('num-ea').value, '100');
});

test('a non-lab hash leaves every lab field at its default', () => {
  const page = createPage(__dirname, { hash: '#something-else' });
  assert.equal(page.get('control-status').textContent, '');
  assert.equal(page.get('num-ea').value, '100');
  assert.equal(labRows(page)[0].className, 'lab-active-row');
});

test('the lab tab is reachable by roving tabindex arrow navigation', () => {
  const page = createPage(__dirname);
  page.get('tabbtn-lab').click();
  page.fire(page.get('tabbtn-lab'), 'keydown', { code: 'End' });
  assert.equal(page.get('tabbtn-process').getAttribute('aria-selected'), 'true');
  assert.equal(page.get('tab-process').hidden, false);
  page.fire(page.get('tabbtn-process'), 'keydown', { code: 'Home' });
  assert.equal(page.get('tabbtn-lab').getAttribute('aria-selected'), 'true');
});

test('numeric shortcuts 1-6 never open the process lab tab', () => {
  const page = createPage(__dirname);
  for (const n of ['1', '2', '3', '4', '5', '6']) {
    page.key('Digit' + n);
    assert.equal(page.get('tab-process').hidden, true, 'Digit' + n);
  }
});

test('theme toggles re-render the lab charts without errors', () => {
  const page = createPage(__dirname);
  page.get('theme-toggle').click();
  assert.ok(page.get('lab-chart-conversion').querySelector('svg'));
  assert.ok(page.get('lab-chart-tm').querySelector('svg'));
  assert.doesNotMatch(page.get('lab-chart-conversion').innerHTML, /NaN|Infinity/);
  page.get('theme-toggle').click();
  assert.equal(page.get('lab-chart-conversion').querySelectorAll('.lab-curve').length, 5);
  auditPage(page);
});

test('pinning a ghost reference does not disturb the lab charts', () => {
  const page = createPage(__dirname);
  const conv = page.get('lab-chart-conversion').innerHTML;
  const tm = page.get('lab-chart-tm').innerHTML;
  page.get('pin-reference').click();
  assert.equal(page.get('lab-chart-conversion').innerHTML, conv);
  assert.equal(page.get('lab-chart-tm').innerHTML, tm);
  page.get('pin-reference').click();
});

test('an invalid recipe field disables recipe exports but lab exports stay live', () => {
  const page = createPage(__dirname);
  page.get('in-flour').value = '-1';
  page.fire(page.get('in-flour'), 'input'); page.flushFrame();
  assert.equal(page.get('download-json').disabled, true);
  assert.equal(page.get('lab-export-json').disabled, false);
  assert.equal(page.get('lab-export-csv').disabled, false);
  assert.doesNotMatch(page.get('lab-chart-conversion').innerHTML, /NaN|Infinity/);
});

test('an unreachable espresso target disables the solver but lab state stays valid', () => {
  const page = createPage(__dirname);
  page.get('range-target-yield').value = '15';
  page.fire(page.get('range-target-yield'), 'input'); page.flushFrame();
  assert.equal(page.get('apply-grind').disabled, true);
  assert.match(page.get('lab-profile-table').innerHTML, /Steady 180 C/);
});

test('the lab section survives storage-blocked boots with a full audit', () => {
  const page = createPage(__dirname, { storageBlocked: true });
  auditPage(page);
  assert.match(pageDigest(page), /^[0-9a-f]{64}$/);
  page.get('tabbtn-process').click();
  page.get('lab-selftest-run').click();
  assert.match(page.get('lab-selftest-result').textContent, /18\/18/);
});

test('the lab section renders without NaN or Infinity anywhere', () => {
  const page = createPage(__dirname);
  for (const id of ['lab-profile-table', 'lab-chart-conversion', 'lab-chart-tm', 'lab-legend-conv', 'lab-legend-tm']) {
    assert.doesNotMatch(page.get(id).innerHTML, /NaN|Infinity/, id);
  }
  page.document.querySelector('[data-table="lab-conversion-table"]').click();
  page.document.querySelector('[data-table="lab-matrix-table"]').click();
  assert.doesNotMatch(page.get('lab-conversion-table').innerHTML, /NaN|Infinity/);
  assert.doesNotMatch(page.get('lab-matrix-table').innerHTML, /NaN|Infinity/);
});

test('the conversion table toggle exposes the chart values at sampled times', () => {
  const page = createPage(__dirname);
  page.document.querySelector('[data-table="lab-conversion-table"]').click();
  const head = Array.from(page.get('lab-conversion-table').querySelectorAll('thead th')).map(th => th.textContent);
  assert.deepEqual(head.slice(1), L.THERMAL_PROFILES.map(p => p.name));
});

test('the 50% reference line sits at the y=0.5 tick height', () => {
  const page = createPage(__dirname);
  const svg = page.get('lab-chart-conversion').innerHTML;
  const m = /stroke-dasharray="5 4"[^>]*y1="([\d.]+)"/.exec(svg) || /y1="([\d.]+)"[^>]*stroke-dasharray="5 4"/.exec(svg);
  assert.ok(m, 'dashed line found');
  const y = Number(m[1]);
  const H = 340, Tm = 20, ph = H - Tm - 44;
  const expected = Tm + (1 - 0.5) * ph;
  assert.ok(Math.abs(y - expected) < 1, 'line at mid-height');
});

test('each profile row end label appears in the conversion chart', () => {
  const page = createPage(__dirname);
  const svg = page.get('lab-chart-conversion').innerHTML;
  for (const short of ['180', '140/200', '230/190', '150', '220']) {
    assert.ok(svg.includes('>' + short + '<'), 'missing label ' + short);
  }
});

test('the lab comparator Use action re-stamps the exported digest', async () => {
  const page = createPage(__dirname);
  page.get('lab-profile-table').querySelector('.lab-use[data-profile="warm-hot"]').click();
  const expected = L.stampedReport({ profile: 'warm-hot' }).digest;
  assert.equal(pageDigest(page), expected);
  page.get('lab-export-json').click();
  const doc = JSON.parse(await page.blobs.get(page.document.downloads.at(-1).href).text());
  assert.equal(doc.sha256, expected);
  assert.equal(doc.state.profile, 'warm-hot');
});

test('the share link reflects the currently selected lab profile', async () => {
  const page = createPage(__dirname);
  let copied = null;
  page.navigator.clipboard = { writeText: t => { copied = t; return Promise.resolve(); } };
  page.get('lab-profile-table').querySelector('.lab-use[data-profile="low-slow"]').click();
  page.get('lab-copy-link').click();
  await Promise.resolve();
  const st = L.decodeHash(copied.slice(copied.indexOf('#ff=')));
  assert.equal(st.profile, 'low-slow');
});

test('the lab stays fully off-screen when process-lab.js is absent', () => {
  const page = createPage(__dirname, { skipScripts: ['process-lab.js'] });
  assert.equal(page.get('tabbtn-process').hidden, true);
  assert.equal(page.get('tab-process').hidden, true);
  auditPage(page);
  assert.equal(page.get('tabbtn-lab').getAttribute('aria-selected'), 'true');
});

test('the lab tab button keeps its roving tabindex contract after hiding', () => {
  const page = createPage(__dirname, { skipScripts: ['process-lab.js'] });
  page.get('tabbtn-lab').click();
  page.fire(page.get('tabbtn-lab'), 'keydown', { code: 'End' });
  const selected = page.document.querySelector('.tab[aria-selected="true"]');
  assert.notEqual(selected.id, 'tabbtn-process');
});
