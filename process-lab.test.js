'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const F = require('./kinetics.js');
const L = require('./process-lab.js');

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, (msg || 'value') + ': expected ' + expected + ' +/- ' + tol + ', got ' + actual);
}

const STARCH_KEYS = ['tapioca', 'wheat', 'potato', 'rice'];

// -- profile registry -------------------------------------------------------

test('the lab ships exactly five ordered thermal profiles with unique keys', () => {
  assert.equal(L.THERMAL_PROFILES.length, 5);
  const keys = L.THERMAL_PROFILES.map(p => p.key);
  assert.deepEqual(keys, ['steady-180', 'warm-hot', 'steam-deck', 'low-slow', 'sear']);
  assert.equal(new Set(keys).size, 5);
});

test('every profile schedule is inside the browningSchedule domain', () => {
  for (const p of L.THERMAL_PROFILES) {
    assert.ok(Array.isArray(p.stages) && p.stages.length >= 1 && p.stages.length <= 32, p.key);
    const total = p.stages.reduce((a, s) => a + s.durationMin, 0);
    assert.ok(total > 0 && total <= 1440, p.key);
    for (const s of p.stages) {
      assert.ok(Number.isFinite(s.tempC) && s.tempC >= 0 && s.tempC <= 300, p.key + ' tempC');
      assert.ok(Number.isFinite(s.durationMin) && s.durationMin > 0, p.key + ' duration');
    }
    assert.ok(typeof p.name === 'string' && p.name.length > 0);
    assert.ok(typeof p.note === 'string' && p.note.length > 0);
  }
});

L.THERMAL_PROFILES.forEach(p => {
  test('profileByKey resolves ' + p.key + ' and its stages match the registry', () => {
    const found = L.profileByKey(p.key);
    assert.equal(found, p);
    assert.deepEqual(found.stages, p.stages);
  });
});

test('profileByKey fails closed for unknown and hostile keys', () => {
  for (const bad of ['nope', '', 'STEADY-180', 'steady-180 ', '__proto__', 'constructor', 0, null, undefined]) {
    assert.equal(L.profileByKey(bad), null, String(bad));
  }
});

// -- thermal comparator -----------------------------------------------------

L.THERMAL_PROFILES.forEach((p, i) => {
  test('comparator row ' + p.key + ' reproduces the exact schedule dose and conversion', () => {
    const rows = L.compareProfiles(L.STATE_DEFAULTS);
    const r = rows[i];
    const direct = F.browningSchedule(p.stages, L.maillardOpts(L.STATE_DEFAULTS));
    assert.equal(r.key, p.key);
    assert.equal(r.name, p.name);
    close(r.totalDose, direct.totalDose, 1e-12, 'dose');
    close(r.conversionX, -Math.expm1(-direct.totalDose), 1e-15, 'X = -expm1(-dose)');
    close(r.conversionX, direct.fraction, 1e-15, 'fraction');
    close(r.totalMin, direct.totalMin, 1e-12, 'totalMin');
  });
});

L.THERMAL_PROFILES.forEach((p, i) => {
  test('comparator row ' + p.key + ' reports a consistent 50% crossing', () => {
    const r = L.compareProfiles(L.STATE_DEFAULTS)[i];
    if (r.crosses50) {
      assert.ok(r.timeTo50Min > 0 && r.timeTo50Min <= r.totalMin + 1e-9, p.key + ' crossing window');
      const xAt = -Math.expm1(-L.doseAt(F.browningSchedule(p.stages, L.maillardOpts(L.STATE_DEFAULTS)), r.timeTo50Min));
      close(xAt, 0.5, 1e-9, 'dose at crossing is 50%');
    } else {
      assert.ok(r.conversionX < 0.5, p.key + ' must sit below 50% when it never crosses');
      assert.equal(r.timeTo50Min, null);
    }
  });
});

test('the low-slow profile reports the 50% crossing exactly on the 20 min boundary', () => {
  const r = L.compareProfiles(L.STATE_DEFAULTS).find(x => x.key === 'low-slow');
  assert.equal(r.crosses50, true);
  close(r.timeTo50Min, 20, 1e-9, 'boundary crossing');
  close(r.conversionX, 0.5, 1e-9, 'calibrated conversion');
});

L.THERMAL_PROFILES.forEach((p, i) => {
  test('comparator row ' + p.key + ' effective Q10 is evaluated at the dose-weighted temperature', () => {
    const st = L.STATE_DEFAULTS;
    const r = L.compareProfiles(st)[i];
    const sched = F.browningSchedule(p.stages, L.maillardOpts(st));
    let weighted = 0, dose = 0;
    sched.stages.forEach(s => { weighted += s.rate * s.durationMin * s.tempC; dose += s.rate * s.durationMin; });
    close(r.doseTempC, weighted / dose, 1e-9, 'dose-weighted temp');
    close(r.effectiveQ10, F.q10(st.EaKj * 1000, r.doseTempC), 1e-9, 'effective Q10');
    assert.ok(r.effectiveQ10 > 1, 'Q10 above 1 for browning');
  });
});

L.THERMAL_PROFILES.forEach((p, i) => {
  test('comparator row ' + p.key + ' yeast margin is 46 C minus the peak stage temp', () => {
    const r = L.compareProfiles(L.STATE_DEFAULTS)[i];
    const peak = Math.max(...p.stages.map(s => s.tempC));
    assert.equal(r.peakTempC, peak);
    close(r.yeastMarginC, 46 - peak, 1e-12, 'yeast margin');
    assert.equal(r.yeastMarginC, L.YEAST_KILL_C - peak);
  });
});

test('exactly the bookmarked profile is flagged active', () => {
  const rows = L.compareProfiles({ profile: 'sear' });
  assert.equal(rows.filter(r => r.active).length, 1);
  assert.equal(rows.find(r => r.active).key, 'sear');
  const rows2 = L.compareProfiles({ profile: 'steam-deck' });
  assert.equal(rows2.find(r => r.active).key, 'steam-deck');
});

test('comparator rows carry defensive copies of the registry stages', () => {
  const rows = L.compareProfiles(L.STATE_DEFAULTS);
  rows[0].stages[0].tempC = 999;
  assert.equal(L.THERMAL_PROFILES[0].stages[0].tempC, 180);
});

test('a hotter searing profile out-converts the cold calibration profile', () => {
  const rows = L.compareProfiles(L.STATE_DEFAULTS);
  const sear = rows.find(r => r.key === 'sear');
  const low = rows.find(r => r.key === 'low-slow');
  assert.ok(sear.conversionX > low.conversionX, 'sear browns more than 150 C x 20 min');
});

test('Ea extremes still produce finite comparator rows', () => {
  for (const EaKj of [20, 200]) {
    const rows = L.compareProfiles({ EaKj });
    assert.ok(rows.every(r => Number.isFinite(r.conversionX) && Number.isFinite(r.effectiveQ10) && Number.isFinite(r.doseTempC)), 'EaKj=' + EaKj);
  }
});

test('the calibrated conversion ordering holds at the default Ea', () => {
  const rows = L.compareProfiles(L.STATE_DEFAULTS);
  const X = key => rows.find(r => r.key === key).conversionX;
  assert.ok(X('steam-deck') > X('sear'), 'steam-deck browns most');
  assert.ok(X('sear') > X('warm-hot'), 'sear above the two-stage ramp');
  assert.ok(X('warm-hot') > X('steady-180'), 'hot finish beats steady deck');
  assert.ok(X('steady-180') > X('low-slow'), 'steady 180 beats the 150 C calibration');
  assert.ok(X('low-slow') > 0 && X('steam-deck') <= 1, 'bounded conversions');
});

test('raising Ea monotonically lowers every profile conversion', () => {
  for (const p of L.THERMAL_PROFILES) {
    const xs = [50, 100, 150].map(EaKj => L.compareProfiles({ EaKj }).find(r => r.key === p.key).conversionX);
    assert.ok(xs[0] >= xs[1] && xs[1] >= xs[2], p.key + ' conversion should not rise with Ea');
  }
  const lowSlow = [50, 100, 150].map(EaKj => L.compareProfiles({ EaKj }).find(r => r.key === 'low-slow').conversionX);
  assert.ok(lowSlow[0] > lowSlow[1] && lowSlow[1] > lowSlow[2], 'low-slow strictly decreases');
});

test('comparator rejects hostile lab state', () => {
  assert.throws(() => L.compareProfiles({ EaKj: NaN }), TypeError);
  assert.throws(() => L.compareProfiles({ EaKj: 1000 }), RangeError);
  assert.throws(() => L.compareProfiles('steady-180'), TypeError);
});

// -- doseAt and conversionCurve ----------------------------------------------

test('doseAt is exact at the endpoints and inside the first stage', () => {
  const p = L.THERMAL_PROFILES[0];
  const sched = F.browningSchedule(p.stages, L.maillardOpts(L.STATE_DEFAULTS));
  assert.equal(L.doseAt(sched, 0), 0);
  assert.equal(L.doseAt(sched, -5), 0);
  close(L.doseAt(sched, sched.totalMin), sched.totalDose, 1e-12, 'final dose');
  close(L.doseAt(sched, 5), sched.stages[0].rate * 5, 1e-12, 'mid-stage dose');
});

test('doseAt accumulates exactly across a stage boundary', () => {
  const p = L.THERMAL_PROFILES.find(x => x.key === 'warm-hot');
  const sched = F.browningSchedule(p.stages, L.maillardOpts(L.STATE_DEFAULTS));
  const boundary = p.stages[0].durationMin;
  close(L.doseAt(sched, boundary), sched.stages[0].cumulativeDose, 1e-12, 'at boundary');
  const k2 = sched.stages[1].rate;
  close(L.doseAt(sched, boundary + 2), sched.stages[0].cumulativeDose + 2 * k2, 1e-12, 'into stage two');
  assert.throws(() => L.doseAt(sched, NaN), TypeError);
  assert.throws(() => L.doseAt(sched, '5'), TypeError);
});

test('conversionCurve is exact at stage boundaries for every profile', () => {
  const opts = L.maillardOpts(L.STATE_DEFAULTS);
  for (const p of L.THERMAL_PROFILES) {
    const sched = F.browningSchedule(p.stages, opts);
    const times = [0].concat(sched.stages.map(s => s.endMin));
    const curve = L.conversionCurve(p.stages, opts, times);
    assert.equal(curve[0].x, 0, p.key + ' at t=0');
    sched.stages.forEach((s, i) => {
      close(curve[i + 1].x, s.fraction, 1e-15, p.key + ' at ' + s.endMin + ' min');
    });
  }
});

test('conversionCurve is monotone and saturates at the final conversion', () => {
  const opts = L.maillardOpts(L.STATE_DEFAULTS);
  const p = L.THERMAL_PROFILES[0];
  const times = [];
  for (let t = 0; t <= 20; t += 0.5) times.push(t);
  const curve = L.conversionCurve(p, opts, times);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].x >= curve[i - 1].x, 'monotone at index ' + i);
  }
  close(curve[curve.length - 1].x, F.browningSchedule(p.stages, opts).fraction, 1e-15, 'saturated');
});

test('conversionCurve clamps out-of-range times and rejects hostile inputs', () => {
  const opts = L.maillardOpts(L.STATE_DEFAULTS);
  const p = L.THERMAL_PROFILES[0];
  const curve = L.conversionCurve(p.stages, opts, [-10, 0, 5, 100]);
  assert.equal(curve[0].t, 0);
  assert.equal(curve[3].t, 10);
  assert.throws(() => L.conversionCurve(p.stages, opts, [NaN]), TypeError);
  assert.throws(() => L.conversionCurve(p.stages, opts, 'nope'), TypeError);
  assert.throws(() => L.conversionCurve(p.stages, opts, null), TypeError);
});

test('unionChartTimes covers every stage boundary, sorted from 0 to max total', () => {
  const times = L.unionChartTimes(L.THERMAL_PROFILES, 40);
  assert.equal(times[0], 0);
  const maxTotal = Math.max(...L.THERMAL_PROFILES.map(p => p.stages.reduce((a, s) => a + s.durationMin, 0)));
  assert.equal(times[times.length - 1], maxTotal);
  for (const p of L.THERMAL_PROFILES) {
    let t = 0;
    for (const s of p.stages) { t += s.durationMin; assert.ok(times.includes(t), p.key + ' boundary ' + t); }
  }
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], 'strictly increasing');
});

test('unionChartTimes validates the grid density', () => {
  assert.throws(() => L.unionChartTimes(L.THERMAL_PROFILES, 4), RangeError);
  assert.throws(() => L.unionChartTimes(L.THERMAL_PROFILES, 5000), RangeError);
  assert.throws(() => L.unionChartTimes(L.THERMAL_PROFILES, 10.5), RangeError);
  assert.ok(Array.isArray(L.unionChartTimes(L.THERMAL_PROFILES)));
});

test('doseWeightedTempC is the stage temp for a single stage and weighted for two', () => {
  const one = F.browningSchedule([{ tempC: 180, durationMin: 10 }], L.maillardOpts(L.STATE_DEFAULTS));
  close(L.doseWeightedTempC(one), 180, 1e-9, 'single stage');
  const two = F.browningSchedule([{ tempC: 100, durationMin: 10 }, { tempC: 200, durationMin: 10 }], L.maillardOpts(L.STATE_DEFAULTS));
  let w = 0, d = 0;
  two.stages.forEach(s => { w += s.rate * s.durationMin * s.tempC; d += s.rate * s.durationMin; });
  close(L.doseWeightedTempC(two), w / d, 1e-9, 'dose weighted');
});

test('doseWeightedTempC falls back to a time average when the dose is zero', () => {
  const fake = { stages: [{ rate: 0, durationMin: 5, tempC: 40, cumulativeDose: 0 }, { rate: 0, durationMin: 5, tempC: 60, cumulativeDose: 0 }] };
  close(L.doseWeightedTempC(fake), 50, 1e-12, 'time-weighted fallback');
});

// -- sensitivity surface -------------------------------------------------------

test('the hydration grid is exactly 40 to 95 percent in steps of five', () => {
  const s = L.sensitivitySurface(L.STATE_DEFAULTS);
  assert.deepEqual(s.hydrations, [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]);
});

L.HYDRATION_GRID.forEach((h, j) => {
  test('Tm matrix row at ' + h + '% hydration matches gelatinizationMidpoint for all four starches', () => {
    const s = L.sensitivitySurface(L.STATE_DEFAULTS);
    for (const key of STARCH_KEYS) {
      close(s.starchTm[key].tm[j], F.gelatinizationMidpoint(h, F.STARCH_PROFILES[key]), 1e-12, key + ' @ ' + h + '%');
    }
  });
});

STARCH_KEYS.forEach(key => {
  test('Tm(H) for ' + key + ' is exactly linear with slope -waterShiftC/100', () => {
    const s = L.sensitivitySurface(L.STATE_DEFAULTS);
    const prof = F.STARCH_PROFILES[key];
    const tm = s.starchTm[key].tm;
    const expectedSlope = -prof.waterShiftC / 100;
    for (let j = 1; j < tm.length; j++) {
      close((tm[j] - tm[j - 1]) / (L.HYDRATION_GRID[j] - L.HYDRATION_GRID[j - 1]), expectedSlope, 1e-9, key + ' slope');
    }
    assert.equal(s.starchTm[key].label, prof.label);
  });
});

test('the espresso sensitivity grid spans 180 to 1400 um monotonically decreasing', () => {
  const s = L.sensitivitySurface(L.STATE_DEFAULTS);
  const g = s.espresso.grinds, y = s.espresso.yields;
  assert.equal(g.length, 12);
  close(g[0], 180, 1e-9, 'first grind');
  close(g[g.length - 1], 1400, 1e-9, 'last grind');
  for (let i = 1; i < g.length; i++) {
    assert.ok(g[i] > g[i - 1], 'grinds increase');
    assert.ok(y[i] < y[i - 1], 'yields decrease');
    assert.ok(y[i] >= F.constants.ESPRESSO_DEFAULT.Emin - 1e-9 && y[i] <= F.constants.ESPRESSO_DEFAULT.Emax + 1e-9, 'bounded yield');
  }
});

test('every espresso sensitivity yield matches extractionYield exactly', () => {
  const s = L.sensitivitySurface(L.STATE_DEFAULTS);
  s.espresso.grinds.forEach((g, i) => {
    close(s.espresso.yields[i], F.extractionYield(g), 1e-12, 'grind ' + g);
  });
});

test('the sensitivity surface validates state before computing', () => {
  assert.throws(() => L.sensitivitySurface({ EaKj: NaN }), TypeError);
  assert.throws(() => L.sensitivitySurface({ hyd: 200 }), RangeError);
  assert.doesNotThrow(() => L.sensitivitySurface({}));
});

// -- mass rollup ----------------------------------------------------------------

test('the default mass rollup conserves mass and matches analyzeDoughRecipe', () => {
  const m = L.massRollup(L.STATE_DEFAULTS);
  assert.equal(m.conserved, true);
  close(m.totalWeightGrams, 1920, 1e-9, 'total');
  close(m.totalFlourGrams, 1100, 1e-9, 'total flour');
  close(m.totalWaterGrams, 800, 1e-9, 'total water');
  close(m.effectiveHydrationPct, 72.72727272727273, 1e-9, 'effective hydration');
  const direct = F.analyzeDoughRecipe(F.createRecipe());
  close(m.componentSumGrams, direct.weights.flour + direct.weights.water + direct.weights.salt + direct.weights.starter, 1e-9, 'component sum');
});

[40, 70, 95].forEach(hyd => {
  test('mass conservation holds at ' + hyd + '% hydration', () => {
    const m = L.massRollup({ hyd });
    assert.equal(m.conserved, true);
    close(m.totalWeightGrams, m.componentSumGrams, 1e-9);
    close(m.totalWeightGrams, m.flourGrams * m.totalPercent / 100, 1e-9);
  });
});

test('mass conservation holds with zero starter and with a wet starter', () => {
  assert.equal(L.massRollup({ starterPct: 0 }).conserved, true);
  const wet = L.massRollup({ starterPct: 50, starterHydrationPct: 150 });
  assert.equal(wet.conserved, true);
  close(wet.starterFlourGrams + wet.starterWaterGrams, wet.starterGrams, 1e-9, 'starter split');
});

test('mass rollup honors flour edges and rejects hostile formula fields', () => {
  assert.equal(L.massRollup({ flourGrams: 1 }).conserved, true);
  assert.equal(L.massRollup({ flourGrams: 10000 }).conserved, true);
  assert.throws(() => L.massRollup({ saltPct: 11 }), RangeError);
  assert.throws(() => L.massRollup({ starterHydrationPct: 201 }), RangeError);
});

// -- normalizeState ----------------------------------------------------------------

test('normalizeState fills every default for empty input', () => {
  assert.deepEqual(L.normalizeState({}), L.STATE_DEFAULTS);
  assert.deepEqual(L.normalizeState(), L.STATE_DEFAULTS);
  assert.deepEqual(L.normalizeState(null), L.STATE_DEFAULTS);
});

test('normalizeState drops unknown keys silently but keeps known fields', () => {
  const st = L.normalizeState({ hyd: 66, bogusField: 'x', extra: [1, 2] });
  assert.equal(st.hyd, 66);
  assert.equal(st.bogusField, undefined);
  assert.equal(st.extra, undefined);
});

const HOSTILE_FIELDS = [
  ['EaKj', [NaN, Infinity, -Infinity, '100', 'x', null], [19.999, 200.001]],
  ['hyd', [NaN, Infinity, '70', [], null], [-0.01, 100.01]],
  ['fermT', [NaN, Infinity, '28', {}, null], [3.99, 60.01]],
  ['yieldT', [NaN, Infinity, '20', 'x', null], [-0.01, 100.01]],
  ['flourGrams', [NaN, '1000', null, {}], [0.5, 10000.5]],
  ['saltPct', [NaN, '2', null], [-0.01, 10.01]],
  ['starterPct', [NaN, '20', null], [-0.01, 100.01]],
  ['starterHydrationPct', [NaN, '100', null], [-0.01, 200.01]]
];

HOSTILE_FIELDS.forEach(([field, types, ranges]) => {
  test('normalizeState rejects hostile values for ' + field, () => {
    for (const v of types) {
      assert.throws(() => L.normalizeState({ [field]: v }), undefined, field + '=' + String(v));
    }
    for (const v of ranges) {
      assert.throws(() => L.normalizeState({ [field]: v }), RangeError, field + '=' + v);
    }
  });
});

test('normalizeState coerces -0 to +0 so digests stay canonical', () => {
  const st = L.normalizeState({ hyd: -0 });
  assert.equal(st.hyd, 0);
  assert.equal(Object.is(st.hyd, -0), false);
});

test('normalizeState validates profile and starch against their registries', () => {
  for (const bad of ['nope', 0, null, '__proto__', []]) {
    assert.throws(() => L.normalizeState({ profile: bad }), undefined, 'profile=' + String(bad));
    assert.throws(() => L.normalizeState({ starch: bad }), undefined, 'starch=' + String(bad));
  }
  for (const p of L.THERMAL_PROFILES) assert.equal(L.normalizeState({ profile: p.key }).profile, p.key);
  for (const s of STARCH_KEYS) assert.equal(L.normalizeState({ starch: s }).starch, s);
});

test('normalizeState accepts exact range edges', () => {
  const st = L.normalizeState({ EaKj: 20, hyd: 0, fermT: 4, yieldT: 0, flourGrams: 1, saltPct: 0, starterPct: 0, starterHydrationPct: 0 });
  assert.equal(st.EaKj, 20); assert.equal(st.hyd, 0); assert.equal(st.fermT, 4);
  const hi = L.normalizeState({ EaKj: 200, hyd: 100, fermT: 60, yieldT: 100, flourGrams: 10000, saltPct: 10, starterPct: 100, starterHydrationPct: 200 });
  assert.equal(hi.EaKj, 200); assert.equal(hi.yieldT, 100); assert.equal(hi.starterHydrationPct, 200);
});

test('normalizeState rejects non-object input shapes', () => {
  for (const bad of [42, 'x', [1, 2], true]) {
    assert.throws(() => L.normalizeState(bad), TypeError, String(bad));
  }
});

// -- canonicalize -----------------------------------------------------------------

test('canonicalize sorts nested keys and preserves array order', () => {
  const a = { b: [{ d: 1, c: 2 }, 3], a: { z: 1, y: 2 } };
  const b = { a: { y: 2, z: 1 }, b: [{ c: 2, d: 1 }, 3] };
  assert.equal(L.canonicalize(a), L.canonicalize(b));
  assert.equal(L.canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('canonicalize rejects non-finite numbers so digests cannot carry NaN', () => {
  for (const bad of [NaN, Infinity, -Infinity, { x: NaN }, [Infinity]]) {
    assert.throws(() => L.canonicalize(bad), TypeError, String(bad));
  }
});

test('canonicalize handles strings, booleans, null, -0 and unicode', () => {
  assert.equal(L.canonicalize('a"b'), JSON.stringify('a"b'));
  assert.equal(L.canonicalize(true), 'true');
  assert.equal(L.canonicalize(null), 'null');
  assert.equal(L.canonicalize(-0), '0');
  assert.equal(L.canonicalize('café λ'), JSON.stringify('café λ'));
});

test('canonicalize rejects unsupported value types', () => {
  assert.throws(() => L.canonicalize(undefined), TypeError);
  assert.throws(() => L.canonicalize(() => 1), TypeError);
  assert.throws(() => L.canonicalize(Symbol('x')), TypeError);
});

test('a canonical report parses back to an equal structure', () => {
  const stamped = L.stampedReport(L.STATE_DEFAULTS);
  const reparsed = JSON.parse(stamped.canonical);
  assert.deepEqual(reparsed, stamped.report);
});

// -- stamped report caching ---------------------------------------------------------

test('stampedReport caches one digest-stamped payload per state key', () => {
  const st = { profile: 'sear', EaKj: 120, starch: 'wheat', hyd: 65, fermT: 30, yieldT: 19 };
  const a = L.stampedReport(st);
  const b = L.stampedReport(st);
  assert.equal(a, b, 'same state returns the cached entry');
  const reordered = L.stampedReport({ yieldT: 19, fermT: 30, hyd: 65, starch: 'wheat', EaKj: 120, profile: 'sear' });
  assert.equal(a, reordered, 'key order does not fork the cache');
});

test('different states stamp different digests', () => {
  const a = L.stampedReport(L.STATE_DEFAULTS).digest;
  const b = L.stampedReport({ profile: 'sear' }).digest;
  const c = L.stampedReport({ hyd: 71 }).digest;
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
});

test('the stamped digest is the sha256 of the canonical report', () => {
  const stamped = L.stampedReport({ hyd: 77 });
  assert.match(stamped.digest, /^[0-9a-f]{64}$/);
  assert.equal(stamped.digest, F.sha256(stamped.canonical));
  assert.equal(stamped.digest, crypto.createHash('sha256').update(stamped.canonical, 'utf8').digest('hex'));
});

test('the report carries schema, version, disclosure and all sections', () => {
  const r = L.buildReport({ profile: 'warm-hot' });
  assert.equal(r.schema, L.SCHEMA);
  assert.equal(r.version, 1);
  assert.match(r.disclosure, /Teaching approximations/);
  assert.equal(r.thermal.length, 5);
  assert.equal(r.sensitivity.hydrations.length, 12);
  assert.equal(r.mass.conserved, true);
  assert.equal(r.state.profile, 'warm-hot');
});

// -- JSON export ------------------------------------------------------------------

test('exportJSON parses and stamps the canonical digest', () => {
  const st = { hyd: 80, profile: 'sear' };
  const doc = JSON.parse(L.exportJSON(st));
  const stamped = L.stampedReport(st);
  assert.equal(doc.schema, L.SCHEMA);
  assert.equal(doc.sha256, stamped.digest);
  assert.equal(L.canonicalize({ schema: doc.schema, version: doc.version, disclosure: doc.disclosure, state: doc.state, thermal: doc.thermal, sensitivity: doc.sensitivity, mass: doc.mass }), stamped.canonical);
});

test('exportJSON is byte-identical across repeated calls (cached canonical)', () => {
  const a = L.exportJSON({ fermT: 31 });
  const b = L.exportJSON({ fermT: 31 });
  assert.equal(a, b);
});

test('verifyExport accepts an intact JSON export', () => {
  const v = L.verifyExport(L.exportJSON({ starch: 'rice' }));
  assert.equal(v.ok, true);
  assert.equal(v.format, 'json');
  assert.match(v.detail, /matches/);
});

test('verifyExport rejects a JSON export with one edited digit', () => {
  const json = L.exportJSON(L.STATE_DEFAULTS);
  const tampered = json.replace('"EaKj": 100', '"EaKj": 101');
  const v = L.verifyExport(tampered);
  assert.equal(v.ok, false);
  assert.match(v.detail, /modified/);
});

test('verifyExport rejects a swapped sha256 stamp', () => {
  const json = L.exportJSON(L.STATE_DEFAULTS);
  const other = L.stampedReport({ hyd: 1 }).digest;
  const tampered = json.replace(/"sha256": "[0-9a-f]{64}"/, '"sha256": "' + other + '"');
  assert.equal(L.verifyExport(tampered).ok, false);
});

test('verifyExport fails closed on malformed JSON exports', () => {
  assert.equal(L.verifyExport('{ not json').ok, false);
  assert.equal(L.verifyExport('[1,2]').ok, false);
  assert.equal(L.verifyExport('"x"').ok, false);
  assert.equal(L.verifyExport('42').ok, false);
  assert.equal(L.verifyExport('').ok, false);
  assert.equal(L.verifyExport(null).ok, false);
});

test('verifyExport rejects JSON with wrong schema or version', () => {
  const doc = JSON.parse(L.exportJSON(L.STATE_DEFAULTS));
  doc.schema = 'other/schema';
  assert.equal(L.verifyExport(JSON.stringify(doc)).ok, false);
  doc.schema = L.SCHEMA; doc.version = 2;
  assert.equal(L.verifyExport(JSON.stringify(doc)).ok, false);
});

test('verifyExport rejects JSON missing the sha256 stamp', () => {
  const doc = JSON.parse(L.exportJSON(L.STATE_DEFAULTS));
  delete doc.sha256;
  assert.equal(L.verifyExport(JSON.stringify(doc)).ok, false);
});

test('verifyExport survives a hostile __proto__ key inside tampered JSON', () => {
  const tampered = L.exportJSON(L.STATE_DEFAULTS).replace('"state": {', '"state": {\n    "__proto__": {"polluted": true},');
  const v = L.verifyExport(tampered);
  assert.equal(v.ok, false);
  assert.equal({}.polluted, undefined, 'no prototype pollution');
});

// -- CSV export --------------------------------------------------------------------

function csvMeta(text) {
  const meta = {};
  text.split('\r\n').forEach(line => {
    const parts = line.split(',');
    if (parts.length >= 3 && parts[0] === 'flavorforge-lab-audit') meta[parts[1]] = parts.slice(2).join(',');
  });
  return meta;
}

test('exportCSV carries the audit meta rows before the data', () => {
  const st = { profile: 'steam-deck' };
  const text = L.exportCSV(st);
  const meta = csvMeta(text);
  assert.equal(meta.schema, L.SCHEMA);
  assert.equal(meta.version, '1');
  assert.equal(meta.sha256, L.stampedReport(st).digest);
  assert.match(meta.content_sha256, /^[0-9a-f]{64}$/);
  assert.ok(meta.payload && meta.payload.length > 100, 'payload blob present');
  const lines = text.split('\r\n').filter(Boolean);
  assert.ok(lines.slice(0, 5).every(l => l.startsWith('flavorforge-lab-audit,')), 'meta rows lead the file');
  assert.equal(lines.length, 5 + 5 + 4 + 12 + 7, 'thermal + tm + espresso + mass rows');
});

test('exportCSV verifies intact and detects a visible-cell edit', () => {
  const text = L.exportCSV(L.STATE_DEFAULTS);
  const v = L.verifyExport(text);
  assert.equal(v.ok, true);
  assert.equal(v.format, 'csv');
  const tampered = text.replace('Steady 180 C', 'Steady 999 C');
  const bad = L.verifyExport(tampered);
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /visible table content was modified/);
});

test('exportCSV verify detects stamped-digest and payload tampering', () => {
  const text = L.exportCSV(L.STATE_DEFAULTS);
  const other = L.stampedReport({ hyd: 3 }).digest;
  const badDigest = text.replace('sha256,' + L.stampedReport(L.STATE_DEFAULTS).digest, 'sha256,' + other);
  assert.equal(L.verifyExport(badDigest).ok, false);
  const badPayload = text.replace(/flavorforge-lab-audit,payload,([A-Za-z0-9_-]+)/, 'flavorforge-lab-audit,payload,AAAA');
  assert.equal(L.verifyExport(badPayload).ok, false);
});

test('exportCSV tolerates a byte-order mark on verify', () => {
  const text = L.exportCSV(L.STATE_DEFAULTS);
  assert.equal(L.verifyExport('\uFEFF' + text).ok, true);
});

test('every CSV data cell is formula-injection safe', () => {
  const text = L.exportCSV(L.STATE_DEFAULTS);
  const lines = text.split('\r\n').filter(l => l && !l.startsWith('flavorforge-lab-audit,'));
  for (const line of lines) {
    for (const cell of line.split(',')) {
      assert.doesNotMatch(cell, /^[=+@]/, 'cell starts with a formula char: ' + cell);
      if (cell.startsWith('-')) assert.ok(Number.isFinite(Number(cell)), 'leading dash is only legal on a number: ' + cell);
    }
  }
});

test('exportCSV fails closed on wrong schema and missing stamps', () => {
  const text = L.exportCSV(L.STATE_DEFAULTS);
  const wrong = text.replace('flavorforge-lab-audit,schema,' + L.SCHEMA, 'flavorforge-lab-audit,schema,other');
  assert.equal(L.verifyExport(wrong).ok, false);
  const noContent = text.split('\r\n').filter(l => !l.startsWith('flavorforge-lab-audit,content_sha256')).join('\r\n');
  assert.equal(L.verifyExport(noContent).ok, false);
});

// -- Markdown export -----------------------------------------------------------------

test('exportMarkdown stamps the same digest in its footer and verifies intact', () => {
  const st = { profile: 'sear', EaKj: 140 };
  const text = L.exportMarkdown(st);
  assert.match(text, new RegExp('SHA-256: ' + L.stampedReport(st).digest));
  assert.match(text, /fflab-payload:[A-Za-z0-9_-]+ fflab-content:[0-9a-f]{64}/);
  const v = L.verifyExport(text);
  assert.equal(v.ok, true);
  assert.equal(v.format, 'markdown');
});

test('exportMarkdown verify catches a table edit and a footer edit', () => {
  const text = L.exportMarkdown(L.STATE_DEFAULTS);
  const edited = text.replace('Steady 180 C', 'Steady 999 C');
  const v = L.verifyExport(edited);
  assert.equal(v.ok, false);
  assert.match(v.detail, /visible document was modified/);
  const other = L.stampedReport({ hyd: 9 }).digest;
  const swapped = text.replace(/SHA-256: [0-9a-f]{64}/, 'SHA-256: ' + other);
  assert.equal(L.verifyExport(swapped).ok, false);
});

test('exportMarkdown tables cover all five profiles and all four starches', () => {
  const text = L.exportMarkdown(L.STATE_DEFAULTS);
  for (const p of L.THERMAL_PROFILES) assert.ok(text.includes(p.name), p.key);
  for (const k of STARCH_KEYS) assert.ok(text.includes(F.STARCH_PROFILES[k].label), k);
  assert.match(text, /Mass conserved \| yes/);
});

// -- digest parity -------------------------------------------------------------------

test('on-page digest, JSON, CSV provenance and Markdown footer all share one digest', () => {
  const st = { profile: 'warm-hot', EaKj: 110, starch: 'potato', hyd: 74, fermT: 26, yieldT: 20.5 };
  const stamped = L.stampedReport(st).digest;
  assert.equal(JSON.parse(L.exportJSON(st)).sha256, stamped);
  assert.equal(csvMeta(L.exportCSV(st)).sha256, stamped);
  assert.equal(/SHA-256: ([0-9a-f]{64})/.exec(L.exportMarkdown(st))[1], stamped);
});

// -- #ff= bookmark codec ---------------------------------------------------------------

test('encodeHash emits a #ff= base64url payload carrying v and the six fields', () => {
  const h = L.encodeHash({ profile: 'sear', EaKj: 150, starch: 'rice', hyd: 82.5, fermT: 33, yieldT: 21.25 });
  assert.match(h, /^#ff=[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(L.utf8Decode(L.b64urlDecode(h.slice(4))));
  assert.deepEqual(payload, { v: 1, profile: 'sear', EaKj: 150, starch: 'rice', hyd: 82.5, fermT: 33, yieldT: 21.25 });
});

test('encodeHash is deterministic for identical states', () => {
  const st = { profile: 'warm-hot', EaKj: 120, starch: 'wheat', hyd: 65, fermT: 30, yieldT: 19 };
  assert.equal(L.encodeHash(st), L.encodeHash(Object.assign({}, st)));
});

L.THERMAL_PROFILES.forEach(p => {
  test('#ff= round-trips the ' + p.key + ' profile', () => {
    const st = { profile: p.key, EaKj: 111, starch: 'potato', hyd: 66, fermT: 24, yieldT: 18.5 };
    const back = L.decodeHash(L.encodeHash(st));
    assert.deepEqual(back, st);
  });
});

STARCH_KEYS.forEach(s => {
  test('#ff= round-trips the ' + s + ' starch', () => {
    const st = { profile: 'steady-180', EaKj: 95, starch: s, hyd: 55.5, fermT: 22.5, yieldT: 20.75 };
    assert.deepEqual(L.decodeHash(L.encodeHash(st)), st);
  });
});

test('#ff= round-trips boundary values exactly', () => {
  for (const st of [
    { profile: 'sear', EaKj: 20, starch: 'tapioca', hyd: 0, fermT: 4, yieldT: 0 },
    { profile: 'low-slow', EaKj: 200, starch: 'rice', hyd: 100, fermT: 60, yieldT: 100 }
  ]) {
    assert.deepEqual(L.decodeHash(L.encodeHash(st)), st);
  }
});

test('decodeHash accepts a bare base64url body and full #ff= form equally', () => {
  const h = L.encodeHash(L.STATE_DEFAULTS);
  assert.deepEqual(L.decodeHash(h), L.decodeHash(h.slice(4)));
});

test('decodeHash returns null for non-string and empty input', () => {
  for (const bad of [null, undefined, 42, {}, [], NaN]) {
    assert.equal(L.decodeHash(bad), null, String(bad));
  }
  assert.equal(L.decodeHash(''), null);
  assert.equal(L.decodeHash('#'), null);
  assert.equal(L.decodeHash('#ff='), null);
});

test('decodeHash rejects other hash prefixes', () => {
  assert.equal(L.decodeHash('#other=abc'), null);
  assert.equal(L.decodeHash('#ffx=' + 'AAAA'), null);
  assert.equal(L.decodeHash('#f=AAAA'), null);
});

test('decodeHash rejects malformed base64url bodies', () => {
  for (const bad of ['@@@', 'a b c', 'ab=d', 'AAAAA', '#ff=@@@@', '#ff=a b']) {
    assert.equal(L.decodeHash(bad), null, bad);
  }
});

test('decodeHash rejects valid base64 carrying non-object JSON', () => {
  for (const doc of ['null', '42', '"x"', '[1,2,3]', '{"v":1}']) {
    assert.equal(L.decodeHash('#ff=' + L.b64urlEncode(doc)), null, doc);
  }
});

test('decodeHash rejects payloads missing any of the six fields', () => {
  const full = { v: 1, profile: 'sear', EaKj: 100, starch: 'wheat', hyd: 70, fermT: 28, yieldT: 20 };
  for (const k of ['profile', 'EaKj', 'starch', 'hyd', 'fermT', 'yieldT']) {
    const partial = Object.assign({}, full);
    delete partial[k];
    assert.equal(L.decodeHash('#ff=' + L.b64urlEncode(JSON.stringify(partial))), null, 'missing ' + k);
  }
});

test('decodeHash rejects unknown extra keys', () => {
  const full = { v: 1, profile: 'sear', EaKj: 100, starch: 'wheat', hyd: 70, fermT: 28, yieldT: 20, sneaky: 1 };
  assert.equal(L.decodeHash('#ff=' + L.b64urlEncode(JSON.stringify(full))), null);
});

test('decodeHash blocks __proto__, constructor and prototype keys', () => {
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    const json = '{"v":1,"' + k + '":{"evil":true},"profile":"sear","EaKj":100,"starch":"wheat","hyd":70,"fermT":28,"yieldT":20}';
    assert.equal(L.decodeHash('#ff=' + L.b64urlEncode(json)), null, k);
    assert.equal({}.evil, undefined, 'no pollution via ' + k);
  }
});

test('decodeHash rejects a wrong version', () => {
  const doc = { v: 2, profile: 'sear', EaKj: 100, starch: 'wheat', hyd: 70, fermT: 28, yieldT: 20 };
  assert.equal(L.decodeHash('#ff=' + L.b64urlEncode(JSON.stringify(doc))), null);
  doc.v = '1';
  assert.equal(L.decodeHash('#ff=' + L.b64urlEncode(JSON.stringify(doc))), null);
});

test('decodeHash rejects string-typed numbers and out-of-range values', () => {
  const base = { v: 1, profile: 'sear', EaKj: 100, starch: 'wheat', hyd: 70, fermT: 28, yieldT: 20 };
  for (const [k, v] of [['EaKj', '100'], ['EaKj', 999], ['hyd', '70'], ['hyd', 200], ['fermT', 100], ['yieldT', -1], ['profile', 'nope'], ['starch', 'corn']]) {
    const doc = Object.assign({}, base); doc[k] = v;
    assert.equal(L.decodeHash('#ff=' + L.b64urlEncode(JSON.stringify(doc))), null, k + '=' + v);
  }
});

test('decodeHash caps hostile oversized hashes', () => {
  const huge = '#ff=' + 'A'.repeat(5000);
  assert.equal(L.decodeHash(huge), null);
});

test('a decoded bookmark re-normalizes into a clean lab state', () => {
  const back = L.decodeHash(L.encodeHash({ profile: 'sear', EaKj: 150, starch: 'rice', hyd: 82.5, fermT: 33, yieldT: 21.25 }));
  const st = L.normalizeState(back);
  assert.equal(st.profile, 'sear');
  assert.equal(st.hyd, 82.5);
  assert.deepEqual(L.bookmarkState(st), back);
});

// -- tamper demo -------------------------------------------------------------------------

test('tamperDemo verifies intact then rejects a modified export', () => {
  const d = L.tamperDemo(L.STATE_DEFAULTS);
  assert.equal(d.ok, true);
  assert.equal(d.intact.ok, true);
  assert.equal(d.tampered.ok, false);
});

test('verifyExport reports unknown formats honestly', () => {
  const v = L.verifyExport('plain text with no markers');
  assert.equal(v.ok, false);
  assert.equal(v.format, 'unknown');
});

// -- in-page self-tests ---------------------------------------------------------------------

test('the in-page self-test list covers at least 14 named deterministic checks', () => {
  const list = L.selfTestList();
  assert.ok(list.length >= 14, 'need at least 14, got ' + list.length);
  const names = list.map(t => t.name);
  assert.equal(new Set(names).size, names.length, 'unique names');
});

test('every registered in-page self-test passes', () => {
  for (const t of L.selfTestList()) {
    assert.equal(t.run(), true, t.name);
  }
});

test('runSelfTests reports full pass with per-check results', () => {
  const r = L.runSelfTests();
  assert.equal(r.allPassed, true);
  assert.equal(r.passed, r.total);
  assert.equal(r.results.length, r.total);
  assert.ok(r.results.every(x => x.ok && typeof x.name === 'string'));
});

test('runSelfTests is deterministic across repeated runs', () => {
  const a = L.runSelfTests();
  const b = L.runSelfTests();
  assert.deepEqual(a, b);
});

// -- utf8 / base64url helpers ------------------------------------------------------------------

test('base64url round-trips arbitrary byte strings without padding', () => {
  for (const s of ['a', 'ab', 'abc', 'abcd', 'hello world', '']) {
    if (!s) continue;
    const enc = L.b64urlEncode(s);
    assert.doesNotMatch(enc, /[=+/]/);
    assert.equal(L.utf8Decode(L.b64urlDecode(enc)), s);
  }
  assert.equal(L.b64urlEncode(''), '');
});

test('utf8 helpers round-trip unicode including astral characters', () => {
  for (const s of ['café', 'λ ε ν', 'emoji-free text', '𝕏 unicode plane 1']) {
    assert.equal(L.utf8Decode(L.utf8Encode(s)), s);
  }
});

test('b64urlDecode rejects padding, bad alphabets and bad lengths', () => {
  for (const bad of ['QUJD=', 'QUJD*', 'A', '!!!!', 'ab c']) {
    assert.throws(() => L.b64urlDecode(bad), TypeError, bad);
  }
  assert.equal(L.b64urlDecode('QUJD').length, 3);
});

test('utf8Decode rejects truncated and malformed sequences', () => {
  assert.throws(() => L.utf8Decode([0xc2]), RangeError);
  assert.throws(() => L.utf8Decode([0x80, 0x80]), RangeError);
  assert.throws(() => L.utf8Decode([0xe0, 0x80]), RangeError);
});

// -- cross-module consistency -----------------------------------------------------------------

test('maillardOpts matches the application convention of A, scaled Ea and refC', () => {
  const opts = L.maillardOpts({ EaKj: 130 });
  assert.equal(opts.A, F.constants.MAILLARD_DEFAULT.A);
  assert.equal(opts.Ea, 130000);
  assert.equal(opts.refC, F.constants.MAILLARD_DEFAULT.refC);
});

test('comparator conversions equal direct browningSchedule fractions at a custom Ea', () => {
  const st = { EaKj: 140 };
  const rows = L.compareProfiles(st);
  const opts = L.maillardOpts(st);
  L.THERMAL_PROFILES.forEach((p, i) => {
    close(rows[i].conversionX, F.browningSchedule(p.stages, opts).fraction, 1e-15, p.key);
  });
});
