'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const F = require('./kinetics.js');

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, (msg || 'value') + ': expected ' + expected + ' +/- ' + tol + ', got ' + actual);
}
function closeRel(actual, expected, relTol, msg) {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relTol, (msg || 'value') + ': expected ' + expected + ' rel ' + relTol + ', got ' + actual);
}

// -- Deterministic SHA-256 -------------------------------------------------

test('sha256 matches published vectors', () => {
  assert.equal(F.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(F.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(F.sha256('The quick brown fox jumps over the lazy dog'), 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  assert.equal(F.sha256('The quick brown fox jumps over the lazy dog.'), 'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c');
  assert.equal(F.sha256('message digest'), 'f7846f55cf23e14eebeab5b4e1550cad5b509e3348fbc4efa3a1413d393cb650');
});

test('sha256 matches node:crypto for multi-block and unicode inputs', () => {
  const samples = [
    'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(119), 'a'.repeat(128),
    'Café 水 boba', 'emoji \u{1f37a}\u{1f35e} tail', 'x'.repeat(100000),
    'FlavorForge {"schema":"flavorforge/recipe"}', 'tab\tnewline\nreturn\r'
  ];
  for (const s of samples) {
    assert.equal(F.sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), 'len ' + s.length);
  }
});

test('sha256 is deterministic and coerces non-strings like String()', () => {
  assert.equal(F.sha256('flavor'), F.sha256('flavor'));
  assert.equal(F.sha256(42), F.sha256('42'));
  assert.equal(F.sha256(null), F.sha256('null'));
  assert.notEqual(F.sha256('a'), F.sha256('b'));
  assert.match(F.sha256('z'), /^[0-9a-f]{64}$/);
});

test('recipeChecksum is the sha256 of the canonical JSON export', () => {
  const r = F.createRecipe({ name: 'Checksum check' });
  assert.equal(F.recipeChecksum(r), F.sha256(F.exportRecipe(r)));
  assert.equal(F.recipeChecksum(r), F.recipeChecksum(r));
  assert.notEqual(F.recipeChecksum(r), F.recipeChecksum(F.createRecipe({ name: 'Other' })));
});

// -- Formula-safe CSV -------------------------------------------------------

test('csvEscape emits numbers raw and rejects non-finite values', () => {
  assert.equal(F.csvEscape(0), '0');
  assert.equal(F.csvEscape(-5.25), '-5.25');
  assert.equal(F.csvEscape(1e21), '1e+21');
  assert.equal(F.csvEscape(''), '');
  assert.equal(F.csvEscape(null), '');
  assert.equal(F.csvEscape(undefined), '');
  assert.throws(() => F.csvEscape(NaN), TypeError);
  assert.throws(() => F.csvEscape(Infinity), TypeError);
});

test('csvEscape guards spreadsheet formula prefixes', () => {
  for (const payload of ['=1+1', '+cmd', '-2+3', '@SUM(1)', '\t=1']) {
    assert.equal(F.csvEscape(payload), "'" + payload);
  }
  assert.equal(F.csvEscape('\r=1'), '"\'\r=1"', 'a guarded CR payload also gets quoted');
  assert.equal(F.csvEscape('safe'), 'safe');
  assert.equal(F.csvEscape('a=b'), 'a=b');
});

test('csvEscape still guards formula chars hidden behind whitespace', () => {
  assert.equal(F.csvEscape(' =1'), "' =1");
  assert.equal(F.csvEscape(' =SUM(1)'), "' =SUM(1)");
  assert.equal(F.csvEscape('  +x'), "'  +x");
  assert.equal(F.csvEscape('\t =cmd'), "'\t =cmd");
  assert.equal(F.csvEscape('   '), "'   ");
  assert.equal(F.csvEscape('plain text'), 'plain text');
});

test('csvEscape also guards payloads hidden behind invisible format chars', () => {
  assert.equal(F.csvEscape("\u200B=1+1"), "\x27\u200B=1+1");
  assert.equal(F.csvEscape("\u200D=x"), "\x27\u200D=x");
  assert.equal(F.csvEscape("\uFEFF\@x"), "\x27\uFEFF\@x");
  assert.equal(F.csvEscape("\u2060-1"), "\x27\u2060-1");
  assert.equal(F.csvEscape("\u202A+x"), "\x27\u202A+x");
});
test('csvEscape guards the second sweep of invisible format chars', () => {
  // Bidi isolates, soft hyphen, Arabic letter mark, Mongolian vowel
  // separator, and the interlinear annotation anchors.
  for (const ch of ["\u2066", "\u2067", "\u2068", "\u2069", "\u00AD", "\u061C", "\u180E", "\uFFF9", "\uFFFA", "\uFFFB"]) {
    assert.equal(F.csvEscape(ch + "=1"), "\x27" + ch + "=1", "guarded after " + JSON.stringify(ch));
  }
});

test('csvEscape quotes cells with commas, quotes, and newlines', () => {
  assert.equal(F.csvEscape('a,b'), '"a,b"');
  assert.equal(F.csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(F.csvEscape('line1\nline2'), '"line1\nline2"');
  assert.equal(F.csvEscape('=x,y'), '"\'=x,y"');
});

test('toCSV joins rows with CRLF and a trailing line break', () => {
  const text = F.toCSV([['a', 'b'], [1, 2]]);
  assert.equal(text, 'a,b\r\n1,2\r\n');
  assert.throws(() => F.toCSV('x'), TypeError);
  assert.throws(() => F.toCSV([['ok'], 'bad']), TypeError);
  assert.throws(() => F.toCSV(null), TypeError);
});

test('recipeCSV has a stable long-format structure with numeric cells', () => {
  const lines = F.recipeCSV(F.createRecipe()).split('\r\n');
  assert.equal(lines[0], 'section,item,baker_pct,mass_g');
  assert.equal(lines[1], 'formula,flour,100,1000');
  assert.equal(lines[2], 'formula,water,70,700');
  assert.equal(lines[3], 'formula,salt,2,20');
  assert.equal(lines[4], 'formula,starter,20,200');
  assert.equal(lines[5], 'formula,total,192,1920');
  assert.equal(lines.length, 17);
  assert.equal(lines.at(-1), '');
});

test('recipeCSV carries the starter split and effective hydration honestly', () => {
  const r = F.createRecipe({ flourGrams: 500, hydrationPct: 62, starterPct: 30, starterHydrationPct: 75 });
  const lines = F.recipeCSV(r).split('\r\n');
  const a = F.analyzeDoughRecipe(r);
  assert.equal(lines[6], 'starter,flour,,' + a.starterFlour);
  assert.equal(lines[7], 'starter,water,,' + a.starterWater);
  assert.equal(lines[10], 'summary,effective hydration pct,,' + a.effectiveHydrationPct);
});

test('recipeCSV neutralizes hostile recipe text and stays deterministic', () => {
  const hostile = F.createRecipe({ name: '=HYPERLINK("http://x")', notes: 'line\n+ @ -' });
  const text = F.recipeCSV(hostile);
  assert.match(text, /meta,name,,"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.match(text, /meta,notes,,"line\n\+ @ -"/);
  assert.equal(text, F.recipeCSV(hostile));
  assert.throws(() => F.recipeCSV({ bogus: true }));
});

test('recipeCSV embeds the matching sha256 checksum', () => {
  const r = F.createRecipe({ name: 'Pinned' });
  assert.match(F.recipeCSV(r), new RegExp('meta,sha256,,' + F.recipeChecksum(r)));
});

// -- Arrhenius core ---------------------------------------------------------

test('gas constant R is exact and shared', () => {
  assert.equal(F.R, 8.314462618);
  assert.equal(F.constants.R, 8.314462618);
});

test('arrheniusRate is monotonic in temperature across a wide grid', () => {
  for (const Ea of [1, 30000, 80000, 150000, 250000]) {
    let prev = -1;
    for (const T of [200, 273.15, 320, 373.15, 450, 700, 1200]) {
      const k = F.arrheniusRate(1e9, Ea, T);
      assert.ok(k >= prev, 'nondecreasing at Ea=' + Ea + ' T=' + T);
      prev = k;
    }
  }
});

test('arrheniusRate follows log k = log A - Ea/RT without overflow', () => {
  for (const [A, Ea, T] of [[1e8, 80000, 400], [3e6, 50000, 373.15], [7.7e11, 120000, 600], [0.05, 20000, 250]]) {
    close(Math.log(F.arrheniusRate(A, Ea, T)), Math.log(A) - Ea / (F.R * T), 1e-9, 'log k');
  }
});

test('arrheniusRate approaches A at extreme temperature and collapses cold', () => {
  closeRel(F.arrheniusRate(42, 50000, 1e9), 42, 1e-4, 'hot limit');
  assert.equal(F.arrheniusRate(42, 5e7, 300), 0);
  assert.throws(() => F.arrheniusRate(1, 1, -1), RangeError);
  assert.throws(() => F.arrheniusRate(1, 1, NaN), TypeError);
});

test('rateRatio inverts under temperature swap and scales with Ea', () => {
  for (const [Ea, T1, T2] of [[50000, 300, 400], [100000, 373.15, 423.15], [20000, 280, 350]]) {
    close(F.rateRatio(Ea, T1, T2) * F.rateRatio(Ea, T2, T1), 1, 1e-9, 'inverse pair');
    assert.ok(F.rateRatio(Ea, T1, T2) > 1, 'heating speeds up');
  }
  assert.equal(F.rateRatio(0, 100, 500), 1);
  assert.equal(F.rateRatio(1e7, 1000, 1), 0);
  close(F.rateRatio(80000, 300, 400, 8.0), F.arrheniusRate(1e6, 80000, 400, 8.0) / F.arrheniusRate(1e6, 80000, 300, 8.0), 1e-9);
});

test('q10 stays physical across temperatures and rejects below absolute zero', () => {
  for (const Tc of [0, 20, 60, 100, 150, 200]) {
    const q = F.q10(80000, Tc);
    assert.ok(q > 1 && q < 4, 'Q10 sane at ' + Tc + ': ' + q);
  }
  assert.equal(F.q10(0, 25), 1);
  assert.throws(() => F.q10(80000, -280), RangeError);
});

test('activationEnergyFromRates recovers Ea across a parameter sweep', () => {
  for (const Ea of [40000, 62000, 100000, 180000]) {
    for (const [T1, T2] of [[290, 330], [373.15, 453.15]]) {
      const k1 = F.arrheniusRate(5e8, Ea, T1), k2 = F.arrheniusRate(5e8, Ea, T2);
      closeRel(F.activationEnergyFromRates(k1, T1, k2, T2), Ea, 1e-9, 'Ea ' + Ea);
    }
  }
  assert.throws(() => F.activationEnergyFromRates(1, 300, 1, 300), RangeError);
  assert.throws(() => F.activationEnergyFromRates(1, 300, 1, 400, -8), RangeError);
});

// -- First-order conversion --------------------------------------------------

test('browningFraction stays in [0, 1] and grows with k and t', () => {
  for (const k of [1e-4, 0.01, 0.2, 3]) {
    let prev = -1;
    for (const t of [0, 1, 10, 100, 1000]) {
      const f = F.browningFraction(k, t);
      assert.ok(f >= 0 && f <= 1 && f >= prev, 'bounded at k=' + k + ' t=' + t);
      prev = f;
    }
  }
  assert.equal(F.browningFraction(3, 1000), 1, 'saturates honestly at huge doses');
  assert.ok(F.browningFraction(0.01, 10) < 1, 'finite dose stays below saturation');
});

test('timeToFraction and browningFraction round-trip on a grid', () => {
  for (const k of [0.005, 0.03, 0.7]) {
    for (const f of [0.05, 0.25, 0.5, 0.9, 0.99]) {
      close(F.browningFraction(k, F.timeToFraction(k, f)), f, 1e-9, 'k=' + k + ' f=' + f);
    }
  }
});

test('halfLife gives 50% conversion across magnitudes', () => {
  for (const k of [1e-6, 1e-3, 0.0347, 1, 60]) {
    close(F.browningFraction(k, F.halfLife(k)), 0.5, 1e-9, 'k=' + k);
  }
  assert.throws(() => F.halfLife(0), RangeError);
  assert.throws(() => F.halfLife(-1), RangeError);
  assert.throws(() => F.halfLife('x'), TypeError);
});

// -- Maillard model ------------------------------------------------------------

test('the Maillard calibration lands exactly a 20 minute half-life at 150 C', () => {
  close(F.maillardRate(150), Math.LN2 / 20, 1e-14);
  assert.ok(F.maillardRate(140) < F.maillardRate(150) && F.maillardRate(160) > F.maillardRate(150));
});

test('maillardRate and relativeBrowning reject hostile temperatures and options', () => {
  assert.throws(() => F.maillardRate(-300), RangeError);
  assert.throws(() => F.maillardRate('hot'), TypeError);
  assert.throws(() => F.maillardRate(150, []), TypeError);
  assert.throws(() => F.maillardRate(150, { Ea: -1 }), RangeError);
  close(F.relativeBrowning(200, { refC: 200 }), 1, 1e-9, 'custom refC');
  assert.throws(() => F.relativeBrowning(-300), RangeError);
});

test('browningCurve is monotonic with exact endpoints and honors options', () => {
  const curve = F.browningCurve(120, 200, 41);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].rate >= curve[i - 1].rate, 'monotonic rate');
    assert.ok(curve[i].relative >= curve[i - 1].relative, 'monotonic relative');
  }
  assert.equal(curve[0].tempC, 120);
  assert.equal(curve[40].tempC, 200);
  const steep = F.browningCurve(120, 200, 11, { Ea: 200000 });
  assert.ok(steep.at(-1).relative > curve.at(-1).relative, 'higher Ea steepens the curve');
});

test('browningOnsetTemp is affine inside the domain and clamps outside', () => {
  for (const h of [0, 25, 50, 75, 100]) close(F.browningOnsetTemp(h), 120 + 0.55 * h, 1e-9, 'h=' + h);
  assert.equal(F.browningOnsetTemp(-5), 120);
  assert.equal(F.browningOnsetTemp(999), 175);
  assert.throws(() => F.browningOnsetTemp('x'), TypeError);
});

// -- Browning schedules ---------------------------------------------------------

test('schedule dose is additive across concatenated stage lists', () => {
  const s1 = [{ tempC: 140, durationMin: 8 }, { tempC: 190, durationMin: 6 }];
  const s2 = [{ tempC: 150, durationMin: 20 }];
  const whole = F.browningSchedule(s1.concat(s2));
  close(whole.totalDose, F.browningSchedule(s1).totalDose + F.browningSchedule(s2).totalDose, 1e-9);
  close(whole.totalMin, 34, 1e-9);
});

test('schedule stage bookkeeping is sequential, cumulative, and bounded', () => {
  const result = F.browningSchedule([{ tempC: 150, durationMin: 10 }, { tempC: 150, durationMin: 20 }, { tempC: 150, durationMin: 10 }]);
  assert.deepEqual(result.stages.map(s => s.index), [0, 1, 2]);
  assert.deepEqual(result.stages.map(s => s.endMin), [10, 30, 40]);
  assert.ok(result.stages[1].cumulativeDose > result.stages[0].cumulativeDose);
  assert.ok(result.stages.every(s => Math.abs(s.fraction - (-Math.expm1(-s.cumulativeDose))) < 1e-12));
  close(result.timeTo50Min, 20, 1e-9, '50% crossing lands inside stage 1');
});

test('schedule limits hold at exact boundaries', () => {
  assert.doesNotThrow(() => F.browningSchedule(Array.from({ length: 32 }, () => ({ tempC: 150, durationMin: 1 }))));
  assert.throws(() => F.browningSchedule(Array.from({ length: 33 }, () => ({ tempC: 150, durationMin: 1 }))), RangeError);
  assert.doesNotThrow(() => F.browningSchedule([{ tempC: 300, durationMin: 1440 }]));
  assert.doesNotThrow(() => F.browningSchedule([{ tempC: 0, durationMin: 5 }]));
  assert.throws(() => F.browningSchedule([{ tempC: -0.01, durationMin: 5 }]), RangeError);
  assert.throws(() => F.browningSchedule([{ tempC: 300.01, durationMin: 5 }]), RangeError);
  assert.throws(() => F.browningSchedule([{ tempC: 150, durationMin: 1440.01 }]), RangeError);
});

test('schedule rejects malformed stage payloads of every shape', () => {
  const bad = [5, 'stage', null, {}, { tempC: 150 }, { durationMin: 5 }, { tempC: 'x', durationMin: 5 }, { tempC: 150, durationMin: 'x' }, { tempC: 150, durationMin: -2 }, { tempC: Infinity, durationMin: 5 }];
  for (const stage of bad) assert.throws(() => F.browningSchedule([stage]), 'stage ' + JSON.stringify(stage));
});

test('a cold-stage schedule never reaches 50% and stays honest', () => {
  const result = F.browningSchedule([{ tempC: 0, durationMin: 60 }]);
  assert.equal(result.timeTo50Min, null);
  assert.ok(result.fraction < 1e-6 && result.fraction >= 0, 'tiny conversion at 0 C');
  assert.ok(F.browningSchedule([{ tempC: 150, durationMin: 60 }]).fraction > 0.5, 'hot schedule converts');
});

// -- Starch gelatinization --------------------------------------------------------

test('every starch profile is exactly 50% gelatinized at its own midpoint', () => {
  for (const key of Object.keys(F.STARCH_PROFILES)) {
    const p = F.STARCH_PROFILES[key];
    for (const h of [0, 25, 55, 80, 100]) {
      close(F.gelatinizationDegree(F.gelatinizationMidpoint(h, p), h, p), 0.5, 1e-9, key + ' h=' + h);
    }
  }
});

test('gelatinization midpoint shifts linearly with hydration and clamps', () => {
  const p = F.STARCH_PROFILES.wheat;
  close(F.gelatinizationMidpoint(0, p), p.baseTmC, 1e-9);
  close(F.gelatinizationMidpoint(100, p), p.baseTmC - p.waterShiftC, 1e-9);
  close(F.gelatinizationMidpoint(50, p), p.baseTmC - p.waterShiftC / 2, 1e-9);
  assert.equal(F.gelatinizationMidpoint(-10, p), p.baseTmC);
  assert.equal(F.gelatinizationMidpoint(250, p), p.baseTmC - p.waterShiftC);
});

test('gelatinization degree is a bounded monotone sigmoid', () => {
  for (const key of Object.keys(F.STARCH_PROFILES)) {
    const p = F.STARCH_PROFILES[key];
    let prev = -1;
    for (let t = 40; t <= 100; t += 5) {
      const d = F.gelatinizationDegree(t, 60, p);
      assert.ok(d > prev && d > 0 && d < 1, key + ' t=' + t);
      prev = d;
    }
    assert.ok(F.gelatinizationDegree(300, 60, p) > 0.999999, key + ' fully cooked');
    assert.ok(F.gelatinizationDegree(-50, 60, p) < 1e-6, key + ' frozen stays raw');
  }
});

test('custom starch profiles are validated field by field', () => {
  const custom = { baseTmC: 60, waterShiftC: 10, steepness: 0.2 };
  close(F.gelatinizationDegree(60, 0, custom), 0.5, 1e-9);
  assert.throws(() => F.gelatinizationMidpoint(50, { baseTmC: 'x', waterShiftC: 1, steepness: 1 }), TypeError);
  assert.throws(() => F.gelatinizationMidpoint(50, { baseTmC: 60, waterShiftC: -1, steepness: 1 }), RangeError);
  assert.throws(() => F.gelatinizationMidpoint(50, { baseTmC: 60, waterShiftC: 1, steepness: 0 }), RangeError);
  close(F.gelatinizationDegree(60, 50, null), F.gelatinizationDegree(60, 50, F.STARCH_PROFILES.tapioca), 1e-12, 'null profile falls back to tapioca');
});

test('gelatinization below absolute zero throws while near-zero is finite', () => {
  assert.throws(() => F.gelatinizationDegree(-273.16, 50), RangeError);
  const d = F.gelatinizationDegree(-273.15, 50);
  assert.ok(d >= 0 && d < 1e-20, 'degree at 0 K is a finite near-zero');
  assert.throws(() => F.gelatinizationDegree('hot', 50), TypeError);
});

// -- Fermentation ------------------------------------------------------------------

test('fermentation rate peaks at an interior optimum before denaturation', () => {
  let best = 0, arg = 0;
  for (let t = 10; t <= 60; t += 0.25) {
    const r = F.fermentationRate(t);
    if (r > best) { best = r; arg = t; }
  }
  assert.ok(arg > 35 && arg < 46, 'optimum in the mesophilic band, got ' + arg);
});

test('denaturation halves the rate exactly at killC', () => {
  const o = F.constants.FERMENT_DEFAULT;
  const raw = F.arrheniusRate(o.A, o.Ea, F.celsiusToKelvin(o.killC));
  closeRel(F.fermentationRate(o.killC, o) / raw, 0.5, 1e-9, 'sigmoid half-point');
});

test('relative fermentation is consistent with absolute rates where both are finite', () => {
  for (const t of [4, 15, 28, 38, 45, 55, 60]) {
    closeRel(F.fermentationRelative(t), F.fermentationRate(t) / F.fermentationRate(28), 1e-9, 'rel ' + t);
  }
  assert.ok(F.fermentationRelative(38) > 1.5, 'warm proofs run faster');
  assert.ok(F.fermentationRelative(4) < 0.5, 'cold proofs crawl');
  assert.ok(F.fermentationRelative(55) < 0.6, 'near-kill slows hard');
});

test('logistic dough volume honors the carrying capacity everywhere', () => {
  for (const tempC of [4, 20, 28, 38, 60]) {
    const dt = F.doublingTime(tempC);
    let prev = 0.99;
    for (const m of [0, dt * 0.5, dt, dt * 2, dt * 4, dt * 40]) {
      const v = F.doughVolume(m, tempC);
      assert.ok(v >= 1 && v <= 4 && v > prev, 'bounded volume t=' + tempC + ' m=' + m);
      prev = v;
    }
    close(F.doughVolume(dt, tempC), 2, 1e-9, 'exact doubling at ' + tempC);
    close(F.doughVolume(dt * 2, tempC), 3, 1e-9, 'exact tripling at ' + tempC);
  }
});

test('doughRise is the normalized view of doughVolume', () => {
  for (const m of [0, 30, 120, 600, 1e6]) {
    close(F.doughRise(m, 30), (F.doughVolume(m, 30) - 1) / 3, 1e-12, 'm=' + m);
    assert.ok(F.doughRise(m, 30) >= 0 && F.doughRise(m, 30) <= 1);
  }
});

test('fermentation options shift the optimum and validate individually', () => {
  let arg = 0, best = 0;
  for (let t = 10; t <= 50; t += 0.5) { const r = F.fermentationRate(t, { killC: 36 }); if (r > best) { best = r; arg = t; } }
  assert.ok(arg < 36, 'lower killC pulls the optimum down, got ' + arg);
  assert.throws(() => F.fermentationRate(30, { killC: 'x' }), TypeError);
  assert.throws(() => F.fermentationRate(30, { killWidth: -2 }), RangeError);
  assert.throws(() => F.doublingTime(30, { refDoublingMin: 0 }), RangeError);
  assert.throws(() => F.fermentationRate(30, { Ea: -1 }), RangeError);
});

test('deep-cold fermentation bottoms out honestly instead of returning NaN', () => {
  const coldRate = F.fermentationRate(-260);
  assert.ok(coldRate >= 0 && coldRate < 1e-200, 'denormal, finite, near zero: ' + coldRate);
  const coldRel = F.fermentationRelative(-260);
  assert.ok(coldRel >= 0 && coldRel < 1e-200, 'relative also bottoms out: ' + coldRel);
  assert.ok(F.doublingTime(-260) > 1e200, 'doubling time becomes astronomical but finite');
  assert.equal(F.fermentationRate(-272), 0, 'rate underflows to exactly 0');
  assert.throws(() => F.doublingTime(-272), RangeError);
  assert.throws(() => F.fermentationRate(-273.15), RangeError);
  assert.throws(() => F.fermentationRelative(150, { Ea: 1e7 }), RangeError);
  assert.throws(() => F.fermentationCurve(28, -5), RangeError);
  assert.throws(() => F.fermentationCurve(28, 60, 1), RangeError);
});

// -- Espresso extraction ------------------------------------------------------------

test('extractionYield sits at the model midpoint at g0', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  close(F.extractionYield(o.g0, o), (o.Emin + o.Emax) / 2, 1e-9);
  assert.equal(F.extractionYield(0, o), o.Emax);
});

test('extractionYield is strictly decreasing and bounded across the domain', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  let prev = Infinity;
  for (let g = o.gmin; g <= o.gmax; g += 40) {
    const y = F.extractionYield(g, o);
    assert.ok(y < prev && y > o.Emin && y <= o.Emax, 'monotone at ' + g);
    prev = y;
  }
  assert.ok(F.extractionYield(1e9, o) >= o.Emin - 1e-9, 'asymptote respected');
});

test('solveGrindForYield lands within bisection tolerance of the analytic inverse', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  for (const target of [16, 17, 18, 19, 20, 21, 22, 23]) {
    const g = F.solveGrindForYield(target, o);
    const analytic = o.g0 * Math.pow((o.Emax - o.Emin) / (target - o.Emin) - 1, 1 / o.p);
    close(g, analytic, 1e-4, 'target ' + target);
    close(F.extractionYield(g, o), target, 1e-9, 'yield at ' + target);
  }
});

test('solveGrindForYield reports out-of-range targets honestly', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  const eLo = F.extractionYield(o.gmax, o), eHi = F.extractionYield(o.gmin, o);
  assert.throws(() => F.solveGrindForYield(eLo - 1e-6, o), /outside the reachable range/);
  assert.throws(() => F.solveGrindForYield(eHi + 1e-6, o), /outside the reachable range/);
  assert.throws(() => F.solveGrindForYield(NaN, o), TypeError);
  assert.throws(() => F.solveGrindForYield(Infinity, o), TypeError);
  close(F.solveGrindForYield(eLo, o), o.gmax, 1e-6, 'lowest reachable pins gmax');
  close(F.solveGrindForYield(eHi, o), o.gmin, 1e-6, 'highest reachable pins gmin');
});

test('custom espresso parameters solve the same Hill inverse', () => {
  const o = { Emin: 12, Emax: 26, g0: 500, p: 3, gmin: 200, gmax: 1200 };
  const g = F.solveGrindForYield(19, o);
  const analytic = o.g0 * Math.pow((o.Emax - o.Emin) / (19 - o.Emin) - 1, 1 / o.p);
  close(g, analytic, 1e-4);
  assert.throws(() => F.solveGrindForYield(19, { Emin: 'x' }), TypeError);
  assert.throws(() => F.solveGrindForYield(19, { gmin: -5 }), RangeError);
  assert.throws(() => F.solveGrindForYield(19, { gmin: 1400, gmax: 1400 }), RangeError);
  assert.throws(() => F.solveGrindForYield(19, { Emax: 12 }), RangeError);
});

test('extractionWindow honors every regime boundary exactly', () => {
  assert.equal(F.extractionWindow(17.999).key, 'under');
  assert.equal(F.extractionWindow(18).key, 'ideal');
  assert.equal(F.extractionWindow(21.999).key, 'ideal');
  assert.equal(F.extractionWindow(22.001).key, 'strong');
  assert.equal(F.extractionWindow(23.499).key, 'strong');
  assert.equal(F.extractionWindow(23.501).key, 'bitter');
  assert.throws(() => F.extractionWindow('20'), TypeError);
});

test('extractionCurve is decreasing with honest bounds', () => {
  const c = F.extractionCurve(200, 1000, 33);
  assert.equal(c.length, 33);
  assert.equal(c[0].grindMicrons, 200);
  assert.equal(c[32].grindMicrons, 1000);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].yieldPct < c[i - 1].yieldPct);
  assert.throws(() => F.extractionCurve(-10, 500, 10), RangeError);
  assert.throws(() => F.extractionCurve(500, 200, 10), RangeError);
});

// -- Baker math and recipe schema -----------------------------------------------------

test('scaleRecipe conserves mass across a wide parameter sweep', () => {
  for (const flour of [1, 237.5, 500, 1000, 10000]) {
    for (const [water, salt, starter] of [[0, 0, 0], [55.5, 1.8, 15], [100, 10, 100]]) {
      const r = F.scaleRecipe(flour, { water, salt, starter });
      close(Object.values(r.weights).reduce((a, v) => a + v, 0), r.totalWeight, 1e-8, 'mass conserved');
      close(r.totalPercent, 100 + water + salt + starter, 1e-9);
    }
  }
});

test('analyzeDoughRecipe splits a stiff starter correctly', () => {
  const r = F.createRecipe({ flourGrams: 500, hydrationPct: 62, saltPct: 1.5, starterPct: 30, starterHydrationPct: 75 });
  const a = F.analyzeDoughRecipe(r);
  close(a.weights.starter, 150, 1e-9);
  close(a.starterFlour, 150 / 1.75, 1e-9);
  close(a.starterWater, 150 - 150 / 1.75, 1e-9);
  close(a.totalFlour, 500 + 150 / 1.75, 1e-9);
  close(a.totalWater, 310 + (150 - 150 / 1.75), 1e-9);
  close(a.effectiveHydrationPct, a.totalWater / a.totalFlour * 100, 1e-9);
  assert.throws(() => F.analyzeDoughRecipe({ schema: 'nope' }), TypeError);
});

test('recipe export is canonical regardless of incoming key order', () => {
  const a = F.importRecipe(JSON.stringify(F.createRecipe({ name: 'Order' })));
  const shuffled = {};
  ['notes', 'brewTempC', 'grindMicrons', 'targetYieldPct', 'starterHydrationPct', 'starterPct', 'saltPct', 'hydrationPct', 'flourGrams', 'style', 'name', 'version', 'schema'].forEach(k => { shuffled[k] = a[k]; });
  const b = F.importRecipe(JSON.stringify(shuffled));
  assert.equal(F.exportRecipe(a), F.exportRecipe(b));
  assert.deepEqual(Object.keys(F.importRecipe(F.exportRecipe(a))), ['schema', 'version', 'name', 'style', 'flourGrams', 'hydrationPct', 'saltPct', 'starterPct', 'starterHydrationPct', 'targetYieldPct', 'grindMicrons', 'brewTempC', 'notes']);
});

test('recipe validation covers every supported style and text edge', () => {
  for (const style of ['sourdough', 'boba', 'espresso', 'hybrid']) {
    assert.doesNotThrow(() => F.createRecipe({ style }));
  }
  assert.throws(() => F.createRecipe({ style: 'Sourdough' }), TypeError);
  assert.throws(() => F.createRecipe({ style: 4 }), TypeError);
  assert.doesNotThrow(() => F.createRecipe({ notes: 'x'.repeat(4000) }));
  const r = F.createRecipe();
  assert.throws(() => F.importRecipe(JSON.stringify(Object.assign({}, r, { version: '1' }))), TypeError);
});

// -- Dough mass balance --------------------------------------------------------

test('baker percentage algebra inverts on a parameter sweep', () => {
  for (const flour of [1, 250, 777.5, 1000]) {
    for (const pct of [0, 2, 55.5, 70, 110]) {
      const w = F.weightFromPercentage(pct, flour);
      close(F.bakersPercentage(w, flour), pct, 1e-9, 'flour=' + flour + ' pct=' + pct);
      close(F.hydration(w, flour), pct, 1e-9);
    }
  }
  assert.throws(() => F.bakersPercentage(10, 0), RangeError);
  assert.throws(() => F.weightFromPercentage(-1, 500), RangeError);
  assert.throws(() => F.weightFromPercentage(50, -500), RangeError);
  assert.throws(() => F.hydration('a', 500), TypeError);
});

test('scaleRecipe conserves mass and matches totalYieldPercent', () => {
  for (const pcts of [{ water: 70, salt: 2 }, { levain: 30, oil: 4 }, {}]) {
    const s = F.scaleRecipe(640, pcts);
    const sum = Object.keys(s.weights).reduce((acc, k) => acc + s.weights[k], 0);
    close(s.totalWeight, sum, 1e-9, 'mass conserved');
    close(s.totalPercent, F.totalYieldPercent(pcts), 1e-9);
    assert.equal(s.weights.flour, 640);
  }
  assert.throws(() => F.scaleRecipe(100, { water: 60, hasOwnProperty: 5 }), TypeError);
  assert.throws(() => F.scaleRecipe(100, [70]), TypeError);
});

test('analyzeDoughRecipe obeys mass and hydration invariants across styles', () => {
  for (const style of ['sourdough', 'boba', 'espresso', 'hybrid']) {
    for (const sh of [50, 100, 150]) {
      const a = F.analyzeDoughRecipe(F.createRecipe({ style: style, starterHydrationPct: sh, flourGrams: 800, starterPct: 25 }));
      close(a.starterFlour + a.starterWater, a.weights.starter, 1e-9, 'starter split conserves');
      close(a.totalFlour, a.weights.flour + a.starterFlour, 1e-9);
      close(a.totalWater, a.weights.water + a.starterWater, 1e-9);
      close(a.effectiveHydrationPct, (a.totalWater / a.totalFlour) * 100, 1e-9);
      close(a.prefermentedFlourPct, (a.starterFlour / a.totalFlour) * 100, 1e-9);
      assert.ok(a.prefermentedFlourPct > 0 && a.prefermentedFlourPct < a.weights.starter / a.totalFlour * 100 + 1e-9);
    }
  }
});

test('a dry starter raises effective hydration less than a wet one', () => {
  const dry = F.analyzeDoughRecipe(F.createRecipe({ starterHydrationPct: 60 }));
  const wet = F.analyzeDoughRecipe(F.createRecipe({ starterHydrationPct: 140 }));
  assert.ok(dry.effectiveHydrationPct < wet.effectiveHydrationPct);
  assert.ok(dry.prefermentedFlourPct > wet.prefermentedFlourPct, 'dry starter carries more flour per gram');
});

// -- Fermentation capacity bounds ----------------------------------------------

test('doughVolume respects the 4x carrying capacity forever', () => {
  for (const tempC of [18, 28, 38]) {
    let prev = 0;
    for (const t of [0, 30, 120, 480, 1440, 10000]) {
      const v = F.doughVolume(t, tempC);
      assert.ok(v >= 1 && v <= 4, 'bounded at ' + tempC + 'C t=' + t + ': ' + v);
      assert.ok(v >= prev, 'monotonic rise');
      prev = v;
      assert.equal(F.doughRise(t, tempC), (v - 1) / 3);
    }
  }
  assert.ok(F.doughVolume(1e9, 28) <= 4, 'asymptote never exceeds capacity');
});

test('fermentationCurve returns normalized bounded points at any horizon', () => {
  for (const maxMin of [60, 480, 5000]) {
    const c = F.fermentationCurve(30, maxMin, 25);
    assert.equal(c.length, 25);
    c.forEach((pt, i) => {
      close(pt.timeMin, maxMin * (i / 24), 1e-9);
      assert.ok(pt.rise >= 0 && pt.rise <= 1);
    });
    assert.equal(c[0].rise, 0);
  }
});

// -- Espresso windows and solver ------------------------------------------------

test('extractionWindow classifies every boundary honestly', () => {
  assert.equal(F.extractionWindow(17.99).key, 'under');
  assert.equal(F.extractionWindow(18).key, 'ideal');
  assert.equal(F.extractionWindow(22).key, 'ideal');
  assert.equal(F.extractionWindow(22.01).key, 'strong');
  assert.equal(F.extractionWindow(23.5).key, 'strong');
  assert.equal(F.extractionWindow(23.51).key, 'bitter');
  assert.equal(F.extractionWindow(0).key, 'under');
  assert.equal(F.extractionWindow(100).key, 'bitter');
  assert.throws(() => F.extractionWindow(-0.1), RangeError);
  assert.throws(() => F.extractionWindow(100.1), RangeError);
  assert.throws(() => F.extractionWindow('20'), TypeError);
});

test('solveGrindForYield honors custom espresso options end to end', () => {
  const o = { Emin: 10, Emax: 30, g0: 500, p: 3, gmin: 100, gmax: 2000 };
  for (const target of [12, 20, 29]) {
    const g = F.solveGrindForYield(target, o);
    assert.ok(g >= o.gmin && g <= o.gmax);
    close(F.extractionYield(g, o), target, 1e-6, 'inverts target ' + target);
  }
  assert.throws(() => F.solveGrindForYield(31, o), RangeError);
  assert.throws(() => F.solveGrindForYield(9, o), RangeError);
  assert.throws(() => F.solveGrindForYield(20, { Emin: 30, Emax: 10 }), RangeError);
});

test('solveGrindForYield converges honestly on absurdly wide custom domains', () => {
  for (const gmax of [1400, 1e6, 1e60, 1e100, 1e300]) {
    const o = { Emin: 14, Emax: 24, g0: 600, p: 2, gmin: 180, gmax: gmax };
    const g = F.solveGrindForYield(19, o);
    assert.ok(g >= 180 && g <= gmax);
    assert.ok(Math.abs(F.extractionYield(g, o) - 19) < 1e-6, 'gmax=' + gmax + ' gave ' + F.extractionYield(g, o));
  }
  // A target exactly at a domain endpoint still pins to that endpoint.
  const o2 = F.constants.ESPRESSO_DEFAULT;
  assert.equal(F.solveGrindForYield(F.extractionYield(o2.gmin, o2)), o2.gmin);
  assert.equal(F.solveGrindForYield(F.extractionYield(o2.gmax, o2)), o2.gmax);
});

test('recipe text fields reject C1 controls and notes rejects binary junk', () => {
  assert.throws(() => F.createRecipe({ name: "a\x85b" }), RangeError);
  assert.throws(() => F.createRecipe({ name: "x\x9fy" }), RangeError);
  assert.throws(() => F.createRecipe({ notes: "a\x85b" }), RangeError);
  assert.throws(() => F.createRecipe({ notes: "nul\x00byte" }), RangeError);
  assert.throws(() => F.createRecipe({ notes: "bell\x07" }), RangeError);
  assert.doesNotThrow(() => F.createRecipe({ notes: 'line one\nline two\t+CR\r\nend' }));
  assert.doesNotThrow(() => F.createRecipe({ name: "caf\u00e9 \u6c34" }));
  assert.doesNotThrow(() => F.createRecipe({ notes: "emoji \u{1f96f} fine" }));
});

test('solveGrindForYield throws when no grind can reach the target', () => {
  // A step-like curve jumps across the target inside one float bracket;
  // returning any g would be a lie, so the solver must throw.
  const o = { ...F.constants.ESPRESSO_DEFAULT, gmin: 0, p: 1e-6 };
  assert.throws(() => F.solveGrindForYield(21.5, o), /no grind reaches/);
  // A reachable target on the same curve still solves exactly.
  close(F.extractionYield(F.solveGrindForYield(19, o), o), 19, 1e-9);
});

test('solveGrindForYield converges tighter than 1e-6 g for interior targets', () => {
  const o = F.constants.ESPRESSO_DEFAULT;
  for (const target of [16, 18.5, 21.3, 23]) {
    const g = F.solveGrindForYield(target);
    assert.ok(Math.abs(F.extractionYield(g, o) - target) < 1e-6);
  }
});

test('extractionCurve samples custom options and rejects inverted ranges', () => {
  const o = { Emin: 12, Emax: 28, g0: 400, p: 1.5, gmin: 100, gmax: 1600 };
  const c = F.extractionCurve(100, 1600, 9, o);
  assert.equal(c.length, 9);
  close(c[0].yieldPct, F.extractionYield(100, o), 1e-12);
  c.forEach((pt, i) => i === 0 || assert.ok(pt.yieldPct < c[i - 1].yieldPct));
  assert.throws(() => F.extractionCurve(1600, 100, 9, o), RangeError);
  assert.throws(() => F.extractionCurve(100, 1600, 1, o), RangeError);
});

// -- Gelatinization curve -------------------------------------------------------

test('gelatinizationCurve is bounded and monotonic for every profile', () => {
  for (const key of Object.keys(F.STARCH_PROFILES)) {
    const c = F.gelatinizationCurve(F.STARCH_PROFILES[key], 60, 20, 100, 21);
    assert.equal(c.length, 21);
    for (let i = 0; i < c.length; i++) {
      assert.ok(c[i].degree >= 0 && c[i].degree <= 1);
      if (i > 0) assert.ok(c[i].degree >= c[i - 1].degree, 'monotonic for ' + key);
      close(c[i].tempC, 20 + 80 * (i / 20), 1e-9);
    }
  }
  assert.throws(() => F.gelatinizationCurve(F.STARCH_PROFILES.wheat, 60, 100, 20, 21), RangeError);
});

test('every numeric recipe limit enforces both edges', () => {
  for (const [field, [lo, hi]] of Object.entries(F.RECIPE_LIMITS)) {
    assert.doesNotThrow(() => F.createRecipe({ [field]: lo }), field + ' low edge');
    assert.doesNotThrow(() => F.createRecipe({ [field]: hi }), field + ' high edge');
    assert.throws(() => F.createRecipe({ [field]: lo - Math.max(0.001, Math.abs(lo) * 0.001) }), field + ' below');
    assert.throws(() => F.createRecipe({ [field]: hi + Math.max(0.001, hi * 0.001) }), field + ' above');
    assert.throws(() => F.createRecipe({ [field]: String(lo) }), field + ' string');
    assert.throws(() => F.createRecipe({ [field]: NaN }), field + ' NaN');
  }
});

// -- Unit conversions and clamps ---------------------------------------------------------

test('temperature conversions round-trip and guard absolute zero', () => {
  for (const c of [-273.15, -40, 0, 25, 100, 1500]) {
    close(F.kelvinToCelsius(F.celsiusToKelvin(c)), c, 1e-9, 'c=' + c);
  }
  for (const k of [0, 1, 273.15, 373.15, 2000]) {
    close(F.celsiusToKelvin(F.kelvinToCelsius(k)), k, 1e-9, 'k=' + k);
  }
  assert.throws(() => F.celsiusToKelvin(-273.15001), RangeError);
  assert.throws(() => F.kelvinToCelsius(-0.001), RangeError);
});

test('clamp enforces ordering and finiteness', () => {
  assert.equal(F.clamp(5, 0, 10), 5);
  assert.equal(F.clamp(-5, 0, 10), 0);
  assert.equal(F.clamp(50, 0, 10), 10);
  assert.equal(F.clamp(7, 7, 7), 7);
  assert.throws(() => F.clamp(1, 10, 5), RangeError);
  assert.throws(() => F.clamp(NaN, 0, 1), TypeError);
});
