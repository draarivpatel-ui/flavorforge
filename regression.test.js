'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./kinetics.js');
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('all rate inputs and gas constants require finite numbers', () => {
  for (const bad of [NaN, Infinity, -Infinity, '300', null]) {
    assert.throws(() => F.arrheniusRate(1, 1, 300, bad));
    assert.throws(() => F.rateRatio(1000, 300, bad));
    assert.throws(() => F.activationEnergyFromRates(1, 300, bad, 400));
    assert.throws(() => F.browningFraction(1, bad));
  }
  assert.throws(() => F.arrheniusRate(-1, 1, 300), RangeError);
  assert.throws(() => F.arrheniusRate(1, -1, 300), RangeError);
});

test('zero activation energy and equal temperatures avoid underflow-induced NaN', () => {
  assert.equal(F.arrheniusRate(5, 0, Number.MIN_VALUE, Number.MIN_VALUE), 5);
  assert.equal(F.rateRatio(1e300, 300, 300, Number.MIN_VALUE), 1);
});

test('temperature conversions reject absolute-zero violations and string coercion', () => {
  close(F.celsiusToKelvin(-273.15), 0);
  close(F.kelvinToCelsius(0), -273.15);
  assert.throws(() => F.celsiusToKelvin(-273.16), RangeError);
  assert.throws(() => F.kelvinToCelsius(-1), RangeError);
  assert.throws(() => F.celsiusToKelvin('20'), TypeError);
});

test('first-order conversion preserves very small nonzero progress', () => {
  close(F.browningFraction(1e-16, 1) / 1e-16, 1, 1e-15);
  close(F.timeToFraction(0.3, 1e-16) / (1e-16 / 0.3), 1, 1e-15);
  assert.equal(F.browningFraction(0, 100), 0);
  assert.equal(F.browningFraction(1e300, 1e300), 1);
});

test('default Maillard teaching calibration gives a 20 minute half-life at 150 C', () => {
  close(F.halfLife(F.maillardRate(150)), 20, 1e-10);
  close(F.browningFraction(F.maillardRate(150), 20), 0.5);
});

test('relative Arrhenius rates remain defined when individual rates underflow', () => {
  assert.equal(F.maillardRate(0, { A: 1, Ea: 1e7 }), 0);
  assert.equal(F.relativeBrowning(150, { A: 1, Ea: 1e7, refC: 150 }), 1);
  assert.throws(() => F.rateRatio(1e9, 1, 1000), RangeError);
});

test('activation-energy recovery uses log differences for extreme rate ratios', () => {
  const actual = F.activationEnergyFromRates(1e-250, 300, 1e250, 400);
  const expected = F.R * (500 * Math.LN10) / (1 / 300 - 1 / 400);
  close(actual / expected, 1, 1e-12);
});

test('model options merge documented defaults without mutating them', () => {
  const before = JSON.stringify(F.constants);
  assert.ok(Number.isFinite(F.maillardRate(180, { Ea: 90000 })));
  assert.ok(Number.isFinite(F.doublingTime(28, { refDoublingMin: 90 })));
  close(F.doublingTime(28, { refDoublingMin: 90 }), 90);
  assert.equal(JSON.stringify(F.constants), before);
  assert.throws(() => F.maillardRate(180, 'bad'), TypeError);
});

test('curve samplers reject zero, one, fractional, and excessive point counts', () => {
  const samplers = [n => F.browningCurve(100, 200, n), n => F.gelatinizationCurve(F.STARCH_PROFILES.rice, 60, 40, 100, n), n => F.fermentationCurve(28, 240, n), n => F.extractionCurve(180, 1400, n)];
  for (const sampler of samplers) for (const count of [0, 1, 2.5, NaN, 10001]) assert.throws(() => sampler(count), RangeError);
  assert.throws(() => F.browningCurve(200, 100, 10), RangeError);
});

test('all curve samplers include exact finite endpoints', () => {
  const curves = [F.browningCurve(100, 240, 17), F.gelatinizationCurve(F.STARCH_PROFILES.rice, 70, 40, 100, 17), F.fermentationCurve(28, 240, 17), F.extractionCurve(180, 1400, 17)];
  const keys = ['tempC', 'tempC', 'timeMin', 'grindMicrons'];
  curves.forEach((curve, index) => { assert.equal(curve.length, 17); assert.ok(curve.every(point => Object.values(point).every(Number.isFinite))); });
  assert.deepEqual(curves.map((curve, index) => [curve[0][keys[index]], curve.at(-1)[keys[index]]]), [[100, 240], [40, 100], [0, 240], [180, 1400]]);
});

test('recipe scaling rejects reserved keys and invalid ingredient maps', () => {
  for (const percentages of [null, [], { flour: 100 }, JSON.parse('{"__proto__":20}'), { constructor: 1 }, { water: NaN }, { water: Infinity }]) {
    assert.throws(() => F.scaleRecipe(1000, percentages));
    assert.throws(() => F.totalYieldPercent(percentages));
  }
  assert.throws(() => F.hydration(-1, 1000), RangeError);
  assert.throws(() => F.weightFromPercentage(20, Infinity), TypeError);
});

test('scaled mass equals the sum of ingredients across deterministic formulas', () => {
  for (const flour of [1, 237.5, 1000, 10000]) for (const water of [0, 62.5, 100]) {
    const result = F.scaleRecipe(flour, { water, salt: 2, starter: 20 });
    close(Object.values(result.weights).reduce((sum, value) => sum + value, 0), result.totalWeight, 1e-8);
  }
});

test('starter analysis includes starter flour and water in effective hydration', () => {
  const result = F.analyzeDoughRecipe(F.createRecipe());
  assert.equal(result.starterFlour, 100); assert.equal(result.starterWater, 100);
  assert.equal(result.totalFlour, 1100); assert.equal(result.totalWater, 800);
  close(result.effectiveHydrationPct, 800 / 1100 * 100);
  close(result.prefermentedFlourPct, 100 / 1100 * 100);
  assert.equal(result.totalWeight, result.totalFlour + result.totalWater + result.weights.salt);
});

test('dry and liquid starters conserve mass and no-starter hydration matches added water', () => {
  for (const starterHydrationPct of [0, 50, 100, 200]) {
    const result = F.analyzeDoughRecipe(F.createRecipe({ starterHydrationPct }));
    close(result.starterFlour + result.starterWater, result.weights.starter);
    close(result.starterWater / result.starterFlour * 100, starterHydrationPct);
  }
  close(F.analyzeDoughRecipe(F.createRecipe({ starterPct: 0, hydrationPct: 62.5 })).effectiveHydrationPct, 62.5);
});

test('recipe schema enforces every numeric range and supported style', () => {
  for (const [field, [min, max]] of Object.entries(F.RECIPE_LIMITS)) {
    assert.doesNotThrow(() => F.createRecipe({ [field]: min }));
    assert.doesNotThrow(() => F.createRecipe({ [field]: max }));
    assert.throws(() => F.createRecipe({ [field]: min - 0.1 }));
    assert.throws(() => F.createRecipe({ [field]: max + 0.1 }));
  }
  assert.throws(() => F.createRecipe({ style: 'unknown' }), TypeError);
  assert.throws(() => F.createRecipe({ name: ' ' }), RangeError);
  assert.throws(() => F.createRecipe({ name: 'House\nloaf' }), RangeError);
});

test('legacy version 1 recipe cards default to a 100% hydration starter', () => {
  const legacy = F.createRecipe(); delete legacy.starterHydrationPct;
  const restored = F.importRecipe(JSON.stringify(legacy));
  assert.equal(restored.starterHydrationPct, 100);
  assert.equal(F.exportRecipe(restored), F.exportRecipe(F.createRecipe()));
});

test('recipe exports preserve Unicode notes, canonical key order, and text limits', () => {
  const recipe = F.createRecipe({ name: 'Café boba', notes: 'Temperature: 93 °C. 水' });
  assert.deepEqual(F.importRecipe(F.exportRecipe(recipe)), recipe);
  assert.equal(F.exportRecipe(F.importRecipe(F.exportRecipe(recipe))), F.exportRecipe(recipe));
  assert.throws(() => F.createRecipe({ notes: 'x'.repeat(4001) }), RangeError);
  assert.throws(() => F.importRecipe(' '.repeat(65537)), RangeError);
});

test('fermentation volume starts at one and doubles at its calibrated time', () => {
  for (const temperature of [4, 20, 28, 38, 60]) {
    const dt = F.doublingTime(temperature);
    close(F.doughVolume(0, temperature), 1);
    close(F.doughVolume(dt, temperature), 2);
    close(F.doughVolume(dt * 2, temperature), 3);
    assert.ok(F.doughVolume(dt * 20, temperature) <= 4);
  }
  assert.throws(() => F.doughRise(-1, 28), RangeError);
  assert.throws(() => F.fermentationRate(28, { killWidth: 0 }), RangeError);
});

test('relative fermentation uses logarithms when absolute rates underflow', () => {
  assert.equal(F.fermentationRate(28, { Ea: 1e7 }), 0);
  assert.equal(F.fermentationRelative(28, { Ea: 1e7 }), 1);
  close(F.fermentationRelative(38), F.fermentationRate(38) / F.fermentationRate(28), 1e-12);
});

test('espresso options require ordered yields, positive scale, exponent, and grind bounds', () => {
  for (const opts of [{ Emin: 25 }, { Emax: 101 }, { g0: 0 }, { p: -1 }, { gmin: 1500 }, { gmax: NaN }]) assert.throws(() => F.solveGrindForYield(20, opts));
  for (const yieldPct of [NaN, Infinity, -1, 101]) assert.throws(() => F.extractionWindow(yieldPct));
});

test('espresso solver reaches both domain endpoints without clamping', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  close(F.solveGrindForYield(F.extractionYield(o.gmin)), o.gmin, 1e-8);
  close(F.solveGrindForYield(F.extractionYield(o.gmax)), o.gmax, 1e-8);
});

test('browning schedules match a constant-temperature closed form', () => {
  const result = F.browningSchedule([{ tempC: 150, durationMin: 30 }]);
  close(result.fraction, F.browningFraction(F.maillardRate(150), 30));
  close(result.timeTo50Min, 20, 1e-9);
  assert.equal(result.totalMin, 30);
});

test('schedule integration is invariant under splitting an equal-temperature stage', () => {
  const whole = F.browningSchedule([{ tempC: 180, durationMin: 10 }]);
  const split = F.browningSchedule([{ tempC: 180, durationMin: 4 }, { tempC: 180, durationMin: 6 }]);
  close(whole.totalDose, split.totalDose); close(whole.fraction, split.fraction);
  close(whole.timeTo50Min, split.timeTo50Min);
});

test('piecewise schedules locate the 50% crossing inside the correct stage', () => {
  const result = F.browningSchedule([{ tempC: 150, durationMin: 5 }, { tempC: 150, durationMin: 20 }]);
  close(result.timeTo50Min, 20, 1e-9);
  assert.ok(result.stages[0].fraction < 0.5 && result.stages[1].fraction > 0.5);
  assert.equal(F.browningSchedule([{ tempC: 100, durationMin: 1 }]).timeTo50Min, null);
});

test('schedules reject malformed, excessive, and non-finite stages', () => {
  for (const stages of [[], Array(1), [{ tempC: 150, durationMin: 0 }], [{ tempC: 301, durationMin: 1 }], [{ tempC: NaN, durationMin: 10 }], [{ tempC: 150, durationMin: 1441 }], Array.from({ length: 33 }, () => ({ tempC: 150, durationMin: 1 }))]) assert.throws(() => F.browningSchedule(stages));
});

test('both documented schedule presets are deterministic and independently computed', () => {
  assert.deepEqual(F.BROWNING_PRESETS.map(preset => preset.name), ['Steady surface', 'Warm then hot']);
  for (const preset of F.BROWNING_PRESETS) {
    const result = F.browningSchedule(preset.stages);
    const dose = preset.stages.reduce((sum, stage) => sum + F.maillardRate(stage.tempC) * stage.durationMin, 0);
    close(result.fraction, -Math.expm1(-dose));
    assert.deepEqual(result, F.browningSchedule(preset.stages));
  }
});

test('browning onset rises linearly with hydration and clamps outside 0 to 100', () => {
  close(F.browningOnsetTemp(0), 120);
  close(F.browningOnsetTemp(100), 175);
  close(F.browningOnsetTemp(50), 147.5);
  close(F.browningOnsetTemp(-20), 120);
  close(F.browningOnsetTemp(240), 175);
  assert.throws(() => F.browningOnsetTemp(NaN), TypeError);
});

test('extraction window classifies exact regime boundaries', () => {
  assert.equal(F.extractionWindow(17.99).key, 'under');
  assert.equal(F.extractionWindow(18).key, 'ideal');
  assert.equal(F.extractionWindow(22).key, 'ideal');
  assert.equal(F.extractionWindow(22.01).key, 'strong');
  assert.equal(F.extractionWindow(23.5).key, 'strong');
  assert.equal(F.extractionWindow(23.51).key, 'bitter');
  assert.equal(F.extractionWindow(0).key, 'under');
});

test('extraction yield at zero grind equals the model ceiling', () => {
  close(F.extractionYield(0), F.constants.ESPRESSO_DEFAULT.Emax);
});

test('recipe scaling rejects every inherited Object.prototype member name', () => {
  for (const name of ['toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__', 'constructor']) {
    assert.throws(() => F.scaleRecipe(1000, JSON.parse('{"' + name + '":5}')), TypeError, name);
    assert.throws(() => F.totalYieldPercent(JSON.parse('{"' + name + '":5}')), TypeError, name);
  }
});

test('schedule locates an exact stage-boundary 50% crossing and keeps dose order-invariant', () => {
  const boundary = F.browningSchedule([{ tempC: 150, durationMin: 20 }, { tempC: 200, durationMin: 5 }]);
  close(boundary.timeTo50Min, 20, 1e-9);
  assert.ok(boundary.stages[0].fraction >= 0.5 - 1e-12);
  const fwd = F.browningSchedule([{ tempC: 140, durationMin: 10 }, { tempC: 200, durationMin: 10 }]);
  const rev = F.browningSchedule([{ tempC: 200, durationMin: 10 }, { tempC: 140, durationMin: 10 }]);
  close(fwd.totalDose, rev.totalDose);
  close(fwd.fraction, rev.fraction);
});

test('import rejects JSON scalars and objects missing required fields', () => {
  for (const text of ['"text"', '42', 'true', 'null']) assert.throws(() => F.importRecipe(text), TypeError, text);
  const r = F.createRecipe();
  for (const field of ['name', 'style', 'flourGrams', 'targetYieldPct', 'notes']) {
    const missing = Object.assign({}, r);
    delete missing[field];
    assert.throws(() => F.importRecipe(JSON.stringify(missing)), TypeError, field);
  }
});

test('recipe name enforces its exact length window', () => {
  assert.doesNotThrow(() => F.createRecipe({ name: 'x'.repeat(120) }));
  assert.throws(() => F.createRecipe({ name: 'x'.repeat(121) }), RangeError);
  assert.throws(() => F.createRecipe({ name: 'tab\there' }), RangeError);
});

test('zero-length fermentation curves stay at zero rise and volume respects the capacity asymptote', () => {
  const flat = F.fermentationCurve(28, 0, 9);
  assert.equal(flat.length, 9);
  assert.ok(flat.every(point => point.rise === 0 && point.timeMin === 0));
  assert.ok(F.doughVolume(1e9, 28) <= 4);
});

test('Q10 degenerates to one for zero activation energy and A zero gives a zero rate', () => {
  assert.equal(F.q10(0, 150), 1);
  assert.equal(F.arrheniusRate(0, 80000, 400), 0);
});

test('timeToFraction rejects open-interval violations', () => {
  assert.throws(() => F.timeToFraction(0.1, 0), RangeError);
  assert.throws(() => F.timeToFraction(0.1, 1), RangeError);
  assert.throws(() => F.timeToFraction(0, 0.5), RangeError);
  assert.throws(() => F.timeToFraction(-0.1, 0.5), RangeError);
});

test('espresso solver lands on the analytic inverse for a mid-curve target', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  const g = F.solveGrindForYield(19, o);
  const analytic = o.g0 * Math.pow((o.Emax - o.Emin) / (19 - o.Emin) - 1, 1 / o.p);
  close(g, analytic, 0.5);
});

// -- L580 hardened edge regressions -------------------------------------------

test('recipe numeric fields normalize negative zero before deterministic export', () => {
  const r = F.createRecipe({ hydrationPct: -0, saltPct: -0, starterPct: -0, targetYieldPct: -0 });
  for (const field of ['hydrationPct', 'saltPct', 'starterPct', 'targetYieldPct']) {
    assert.equal(Object.is(r[field], -0), false, field + ' must not remain negative zero');
  }
  assert.deepEqual(F.importRecipe(F.exportRecipe(r)), r);
});

test('recipe imports enforce the 64 KiB cap in UTF-8 bytes, not UTF-16 units', () => {
  const text = '水'.repeat(22000);
  assert.ok(text.length < 65536, 'fixture stays below the UTF-16 length cap');
  assert.ok(Buffer.byteLength(text, 'utf8') > 65536, 'fixture exceeds the byte cap');
  assert.throws(() => F.importRecipe(text), RangeError);
});

test('utf8ByteLength matches the host UTF-8 byte count including astral text', () => {
  for (const text of ['', 'ascii', 'café 水', '𝕏 plane one', 'lone\ud800 surrogate']) {
    assert.equal(F.utf8ByteLength(text), Buffer.byteLength(text, 'utf8'), JSON.stringify(text));
  }
});

test('recipe text limits count Unicode code points rather than UTF-16 halves', () => {
  assert.doesNotThrow(() => F.createRecipe({ name: '🥯'.repeat(120) }));
  assert.throws(() => F.createRecipe({ name: '🥯'.repeat(121) }), RangeError);
  assert.doesNotThrow(() => F.createRecipe({ notes: '🥯'.repeat(4000) }));
  assert.throws(() => F.createRecipe({ notes: '🥯'.repeat(4001) }), RangeError);
});

test('createRecipe rejects malformed override containers instead of ignoring them', () => {
  for (const bad of ['sourdough', 42, true, []]) {
    assert.throws(() => F.createRecipe(bad), TypeError, String(bad));
  }
});
