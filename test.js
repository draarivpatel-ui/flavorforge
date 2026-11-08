'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./kinetics.js');

function close(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    (msg || 'value') + ': expected ' + expected + ' +/- ' + tol + ', got ' + actual
  );
}

// -- Arrhenius reaction rate ----------------------------------------------

test('arrheniusRate matches the closed-form k = A exp(-Ea/(RT))', () => {
  const A = 1.0e8, Ea = 80000, T = 400;
  close(F.arrheniusRate(A, Ea, T), A * Math.exp(-Ea / (F.R * T)), 1e-6, 'k(400K)');
});

test('arrheniusRate equals A when activation energy is zero', () => {
  close(F.arrheniusRate(5, 0, 300), 5, 1e-12, 'Ea = 0');
});

test('arrheniusRate increases with temperature', () => {
  const low = F.arrheniusRate(1e8, 80000, 350);
  const high = F.arrheniusRate(1e8, 80000, 400);
  assert.ok(high > low, 'a hotter reaction must be faster');
});

test('rateRatio is independent of the prefactor and matches k2/k1', () => {
  const Ea = 100000, T1 = 373.15, T2 = 423.15;
  const r = F.rateRatio(Ea, T1, T2);
  const viaRates = F.arrheniusRate(3.3e9, Ea, T2) / F.arrheniusRate(3.3e9, Ea, T1);
  close(r, viaRates, 1e-9, 'ratio vs direct');
  close(F.rateRatio(Ea, T1, T2), F.rateRatio(Ea, T1, T2, 8.314462618), 1e-12, 'explicit R');
});

test('rateRatio(T, T) is 1', () => {
  close(F.rateRatio(100000, 350, 350), 1, 1e-12, 'same temperature');
});

test('q10 for Maillard activation energy is roughly 2', () => {
  const q = F.q10(100000, 150);
  assert.ok(q > 1.8 && q < 2.4, 'Q10 near 150 deg C should land near 2, got ' + q);
  const manual = F.arrheniusRate(1, 100000, F.celsiusToKelvin(160)) /
    F.arrheniusRate(1, 100000, F.celsiusToKelvin(150));
  close(q, manual, 1e-9, 'Q10 vs manual');
});

test('activationEnergyFromRates recovers a known Ea', () => {
  const Ea = 95000, T1 = 360, T2 = 410;
  const k1 = F.arrheniusRate(2e7, Ea, T1);
  const k2 = F.arrheniusRate(2e7, Ea, T2);
  close(F.activationEnergyFromRates(k1, T1, k2, T2), Ea, 1e-6, 'recovered Ea');
});

test('first-order conversion and half-life are consistent', () => {
  const k = 0.035;
  close(F.browningFraction(k, 0), 0, 1e-12, 'no conversion at t=0');
  close(F.browningFraction(k, F.halfLife(k)), 0.5, 1e-12, 'half-life gives 50%');
  close(F.timeToFraction(k, 0.5), F.halfLife(k), 1e-9, 'time-to-50% equals half-life');
  close(F.browningFraction(k, F.timeToFraction(k, 0.9)), 0.9, 1e-9, 'time-to-90% round trip');
});

test('Maillard relative browning is 1 at the reference temperature', () => {
  const o = F.constants.MAILLARD_DEFAULT;
  close(F.relativeBrowning(o.refC, o), 1, 1e-9, 'reference rate');
  assert.ok(F.relativeBrowning(180, o) > F.relativeBrowning(150, o), 'hotter browns faster');
});

test('invalid Arrhenius inputs throw', () => {
  assert.throws(() => F.arrheniusRate(1, 1, 0), RangeError);
  assert.throws(() => F.arrheniusRate(1, 1, -5), RangeError);
  assert.throws(() => F.arrheniusRate(1, 1, 300, 0), RangeError);
  assert.throws(() => F.arrheniusRate('x', 1, 300), TypeError);
  assert.throws(() => F.activationEnergyFromRates(0, 300, 1, 400), RangeError);
  assert.throws(() => F.timeToFraction(0.1, 1.5), RangeError);
});

// -- Baker's percentage and hydration -------------------------------------

test('hydration is water weight as a percentage of flour', () => {
  close(F.hydration(700, 1000), 70, 1e-9, '70% hydration');
  close(F.bakersPercentage(20, 1000), 2, 1e-9, '2% salt');
});

test('weightFromPercentage inverts bakersPercentage', () => {
  close(F.weightFromPercentage(F.bakersPercentage(235, 940), 940), 235, 1e-9, 'round trip');
});

test('scaleRecipe computes every ingredient and the total weight', () => {
  const r = F.scaleRecipe(1000, { water: 70, salt: 2, starter: 20 });
  close(r.weights.flour, 1000, 1e-9, 'flour');
  close(r.weights.water, 700, 1e-9, 'water');
  close(r.weights.salt, 20, 1e-9, 'salt');
  close(r.weights.starter, 200, 1e-9, 'starter');
  close(r.totalPercent, 192, 1e-9, 'total percentage');
  close(r.totalWeight, 1920, 1e-9, 'total weight');
});

test('totalYieldPercent sums the formula', () => {
  close(F.totalYieldPercent({ water: 70, salt: 2, starter: 20 }), 192, 1e-9, 'yield');
  close(F.totalYieldPercent({}), 100, 1e-9, 'flour only');
});

test('scaleRecipe rejects bad flour weight and negative percentages', () => {
  assert.throws(() => F.scaleRecipe(0, { water: 70 }), RangeError);
  assert.throws(() => F.bakersPercentage(1, 0), RangeError);
  assert.throws(() => F.scaleRecipe(1000, { water: -5 }), TypeError);
  assert.throws(() => F.scaleRecipe(1000, { water: 'x' }), TypeError);
});

// -- Starch gelatinization -------------------------------------------------

test('gelatinization is a bounded sigmoid centered at the midpoint', () => {
  const p = F.STARCH_PROFILES.tapioca;
  const h = 55;
  const tm = F.gelatinizationMidpoint(h, p);
  close(F.gelatinizationDegree(tm, h, p), 0.5, 1e-9, '50% at midpoint');
  assert.ok(F.gelatinizationDegree(tm - 30, h, p) < 0.01, 'raw below midpoint');
  assert.ok(F.gelatinizationDegree(tm + 30, h, p) > 0.99, 'cooked above midpoint');
  assert.ok(F.gelatinizationMidpoint(h, p) < F.gelatinizationMidpoint(0, p),
    'more water lowers the gelatinization midpoint');
});

test('gelatinizationCurve has the expected point count', () => {
  const c = F.gelatinizationCurve(F.STARCH_PROFILES.wheat, 70, 40, 100, 25);
  assert.equal(c.length, 25);
  assert.ok(c.every(pt => pt.degree >= 0 && pt.degree <= 1));
});

// -- Fermentation ----------------------------------------------------------

test('fermentation has an interior optimum and slows near denaturation', () => {
  const o = F.constants.FERMENT_DEFAULT;
  assert.ok(F.fermentationRate(38, o) > F.fermentationRate(20, o), 'warming speeds it up');
  assert.ok(F.fermentationRate(60, o) < F.fermentationRate(38, o), 'excess heat kills it');
  close(F.doublingTime(28, o), o.refDoublingMin, 1e-6, 'ref doubling at 28C');
});

test('doughRise is monotonic and logistic', () => {
  const o = F.constants.FERMENT_DEFAULT;
  const dt = F.doublingTime(28, o);
  const r0 = F.doughRise(0, 28, o);
  const r1 = F.doughRise(dt * 1.5, 28, o);
  const r2 = F.doughRise(dt * 6, 28, o);
  close(r1, 0.5, 1e-9, 'inflection at 1.5 doubling times');
  assert.ok(r0 < r1 && r1 < r2 && r2 <= 1, 'monotonic rise');
});

// -- Espresso extraction yield and solver ----------------------------------

test('extractionYield decreases as grind coarsens', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  const fine = F.extractionYield(200, o);
  const coarse = F.extractionYield(1200, o);
  assert.ok(fine > coarse, 'finer grind extracts more');
  assert.ok(fine <= o.Emax && coarse >= o.Emin, 'bounded by Emin..Emax');
});

test('extractionWindow classifies the classic 18-22% range', () => {
  assert.equal(F.extractionWindow(17).key, 'under');
  assert.equal(F.extractionWindow(20).key, 'ideal');
  assert.equal(F.extractionWindow(23).key, 'strong');
  assert.equal(F.extractionWindow(24).key, 'bitter');
});

test('solveGrindForYield inverts extractionYield across the reachable range', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  const eLo = F.extractionYield(o.gmax, o);
  const eHi = F.extractionYield(o.gmin, o);
  const targets = [eLo + 0.1, 16, 18, 19, 20, 21, 22, 23, eHi - 0.1];
  targets.forEach(t => {
    const g = F.solveGrindForYield(t, o);
    assert.ok(g >= o.gmin && g <= o.gmax, 'grind in bounds for target ' + t);
    close(F.extractionYield(g, o), t, 1e-6, 'yield(' + t + ')');
  });
});

test('solveGrindForYield returns a coarser grind for a lower target yield', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  const gLow = F.solveGrindForYield(18, o);
  const gHigh = F.solveGrindForYield(22, o);
  assert.ok(gLow > gHigh, 'lower yield needs a coarser grind');
});

test('solveGrindForYield rejects unreachable targets and bad input', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  assert.throws(() => F.solveGrindForYield(99, o), RangeError);
  assert.throws(() => F.solveGrindForYield(1, o), RangeError);
  assert.throws(() => F.solveGrindForYield('20', o), TypeError);
  assert.throws(() => F.extractionYield(-1, o), RangeError);
});

test('extractionCurve produces bounded sample points', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  const c = F.extractionCurve(o.gmin, o.gmax, 40, o);
  assert.equal(c.length, 40);
  assert.ok(c.every(pt => pt.yieldPct >= o.Emin && pt.yieldPct <= o.Emax));
});

// -- Recipe JSON import / export ------------------------------------------

test('createRecipe returns a valid default recipe', () => {
  const r = F.createRecipe();
  assert.equal(r.schema, F.constants.RECIPE_SCHEMA);
  assert.equal(r.version, F.constants.RECIPE_VERSION);
  assert.equal(typeof r.name, 'string');
  assert.ok(r.flourGrams > 0);
  assert.doesNotThrow(() => F.validateRecipe(r));
});

test('createRecipe applies overrides only for known fields', () => {
  const r = F.createRecipe({ name: 'Boba Test', hydrationPct: 55, bogus: 'ignored' });
  assert.equal(r.name, 'Boba Test');
  assert.equal(r.hydrationPct, 55);
  assert.equal(r.bogus, undefined);
});

test('exportRecipe then importRecipe round-trips exactly', () => {
  const original = F.createRecipe({
    name: 'Midnight Espresso Boule',
    style: 'espresso',
    flourGrams: 850,
    hydrationPct: 68,
    targetYieldPct: 20.5,
    grindMicrons: 540,
    notes: 'Bloom 35 s. Keep notes short.'
  });
  const text = F.exportRecipe(original);
  assert.equal(typeof text, 'string');
  const restored = F.importRecipe(text);
  assert.deepEqual(restored, F.validateRecipe(original));
});

test('exportRecipe drops unknown keys for a stable round-trip', () => {
  const withExtra = Object.assign(F.createRecipe(), { extraField: 'should vanish' });
  const restored = F.importRecipe(F.exportRecipe(withExtra));
  assert.equal(restored.extraField, undefined);
});

test('importRecipe rejects malformed JSON', () => {
  assert.throws(() => F.importRecipe('{ not json'), SyntaxError);
});

test('importRecipe rejects wrong schema or version', () => {
  const r = F.createRecipe();
  assert.throws(() => F.importRecipe(JSON.stringify(Object.assign({}, r, { schema: 'other' }))), TypeError);
  assert.throws(() => F.importRecipe(JSON.stringify(Object.assign({}, r, { version: 99 }))), TypeError);
});

test('validateRecipe rejects missing or invalid numeric fields', () => {
  const r = F.createRecipe();
  assert.throws(() => F.importRecipe(JSON.stringify(Object.assign({}, r, { hydrationPct: -1 }))), TypeError);
  assert.throws(() => F.importRecipe(JSON.stringify(Object.assign({}, r, { flourGrams: '1000' }))), TypeError);
  assert.throws(() => F.importRecipe(JSON.stringify(Object.assign({}, r, { name: 42 }))), TypeError);
  const missing = Object.assign({}, r);
  delete missing.grindMicrons;
  assert.throws(() => F.importRecipe(JSON.stringify(missing)), TypeError);
});

test('importRecipe rejects non-object and non-string input', () => {
  assert.throws(() => F.importRecipe('null'), TypeError);
  assert.throws(() => F.importRecipe(JSON.stringify([])), TypeError);
  assert.throws(() => F.importRecipe(42), TypeError);
});
