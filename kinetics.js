/*
 * FlavorForge - reaction kinetics, recipe math, and data handling.
 *
 * Pure functions only. No DOM, no network, no dependencies.
 * UMD style: available as module.exports in Node (CommonJS) and as
 * window.FlavorForge / globalThis.FlavorForge in a browser.
 *
 * Every model here is a compact, documented approximation meant for
 * exploration and teaching, not for process control in a commercial kitchen.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.FlavorForge = api;
  }
})(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  // Universal gas constant, J/(mol K).
  var R = 8.314462618;

  // -- small helpers --------------------------------------------------------

  function isFiniteNumber(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function finite(x, label) {
    if (!isFiniteNumber(x)) throw new TypeError(label + ' must be a finite number');
    return x;
  }

  function positive(x, label) {
    finite(x, label);
    if (x <= 0) throw new RangeError(label + ' must be positive');
    return x;
  }

  function nonnegative(x, label) {
    finite(x, label);
    if (x < 0) throw new RangeError(label + ' must not be negative');
    return x;
  }

  function finiteResult(x) {
    if (!Number.isFinite(x)) throw new RangeError('result is outside the finite numerical range');
    return x;
  }

  function optionsWithDefaults(defaults, options) {
    if (options !== undefined && options !== null && (typeof options !== 'object' || Array.isArray(options))) throw new TypeError('model options must be an object');
    var out = {};
    Object.keys(defaults).forEach(function (key) { out[key] = options && options[key] !== undefined ? options[key] : defaults[key]; });
    return out;
  }

  function sampleCount(steps) {
    var n = steps === undefined ? 60 : steps;
    if (!Number.isInteger(n) || n < 2 || n > 10000) throw new RangeError('curve steps must be an integer from 2 to 10000');
    return n;
  }

  function sampleRange(min, max) {
    finite(min, 'minimum'); finite(max, 'maximum');
    if (max < min) throw new RangeError('maximum must be at least minimum');
  }

  function clamp(x, lo, hi) {
    finite(x, 'value'); finite(lo, 'low bound'); finite(hi, 'high bound');
    if (hi < lo) { throw new RangeError('clamp: hi must be >= lo'); }
    return Math.min(hi, Math.max(lo, x));
  }

  function celsiusToKelvin(c) {
    finite(c, 'Celsius temperature');
    if (c < -273.15) throw new RangeError('temperature is below absolute zero');
    return c + 273.15;
  }
  function kelvinToCelsius(k) { nonnegative(k, 'Kelvin temperature'); return k - 273.15; }

  // -- Arrhenius kinetics ---------------------------------------------------
  // k = A * exp(-Ea / (R * T))
  //   A  : pre-exponential factor (same units as k, here 1/min)
  //   Ea : activation energy, J/mol
  //   T  : absolute temperature, K

  function arrheniusRate(A, Ea, T, Rgas) {
    var Rg = Rgas === undefined ? R : Rgas;
    if (!isFiniteNumber(A) || !isFiniteNumber(Ea) || !isFiniteNumber(T)) {
      throw new TypeError('arrheniusRate: A, Ea and T must be finite numbers');
    }
    nonnegative(A, 'A'); nonnegative(Ea, 'Ea'); positive(T, 'T'); positive(Rg, 'R');
    if (A === 0 || Ea === 0) return A;
    return finiteResult(Math.exp(Math.log(A) - Ea / (Rg * T)));
  }

  // Ratio k(T2)/k(T1). A cancels, so it is independent of the prefactor.
  function rateRatio(Ea, T1, T2, Rgas) {
    var Rg = Rgas === undefined ? R : Rgas;
    nonnegative(Ea, 'Ea'); positive(T1, 'T1'); positive(T2, 'T2'); positive(Rg, 'R');
    if (Ea === 0 || T1 === T2) return 1;
    return finiteResult(Math.exp((-Ea / Rg) * (1 / T2 - 1 / T1)));
  }

  // Temperature coefficient Q10 = k(Tc + 10) / k(Tc), Tc in Celsius.
  function q10(Ea, Tc, Rgas) {
    var T1 = celsiusToKelvin(Tc);
    return rateRatio(Ea, T1, T1 + 10, Rgas);
  }

  // Recover activation energy from two measured rates:
  //   Ea = R * ln(k2/k1) / (1/T1 - 1/T2)
  function activationEnergyFromRates(k1, T1, k2, T2, Rgas) {
    var Rg = Rgas === undefined ? R : Rgas;
    positive(k1, 'k1'); positive(k2, 'k2'); positive(T1, 'T1'); positive(T2, 'T2'); positive(Rg, 'R');
    if (!(k1 > 0) || !(k2 > 0) || !(T1 > 0) || !(T2 > 0) || T1 === T2) {
      throw new RangeError('activationEnergyFromRates: need positive rates and distinct positive temperatures');
    }
    return finiteResult(Rg * (Math.log(k2) - Math.log(k1)) / (1 / T1 - 1 / T2));
  }

  // -- First-order conversion (browning / reaction progress) ---------------

  // Fraction of reactant converted after time t: 1 - exp(-k t).
  function browningFraction(k, t) {
    nonnegative(k, 'k'); nonnegative(t, 'time');
    if (k === 0 || t === 0) return 0;
    return -Math.expm1(-k * t);
  }

  // Time needed to reach a given conversion fraction (0 < fraction < 1).
  function timeToFraction(k, fraction) {
    positive(k, 'k'); finite(fraction, 'fraction');
    if (!(fraction > 0 && fraction < 1)) {
      throw new RangeError('timeToFraction: fraction must be in (0, 1)');
    }
    return finiteResult(-Math.log1p(-fraction) / k);
  }

  function halfLife(k) {
    positive(k, 'k');
    return finiteResult(Math.LN2 / k);
  }

  // -- Maillard browning ----------------------------------------------------

  var MAILLARD_DEFAULT = {
    // Teaching calibration: a 20 minute half-life at 150 C, not measured data.
    A: (Math.LN2 / 20) * Math.exp(100000 / (R * 423.15)),
    Ea: 100000,
    refC: 150,
    refHalfLifeMin: 20
  };

  function maillardRate(tempC, opts) {
    var o = optionsWithDefaults(MAILLARD_DEFAULT, opts);
    return arrheniusRate(o.A, o.Ea, celsiusToKelvin(tempC));
  }

  // Browning rate relative to the reference temperature (1.0 at refC).
  function relativeBrowning(tempC, opts) {
    var o = optionsWithDefaults(MAILLARD_DEFAULT, opts);
    positive(o.A, 'Maillard A');
    return rateRatio(o.Ea, celsiusToKelvin(o.refC), celsiusToKelvin(tempC));
  }

  function browningCurve(minC, maxC, steps, opts) {
    var out = [];
    sampleRange(minC, maxC);
    var n = sampleCount(steps);
    for (var i = 0; i < n; i++) {
      var t = minC + (maxC - minC) * (i / (n - 1));
      out.push({ tempC: t, rate: maillardRate(t, opts), relative: relativeBrowning(t, opts) });
    }
    return out;
  }

  // Simplified regime boundary. Free water holds the surface near 100 deg C
  // and dilutes reactants, so wetter dough needs a hotter surface to brown.
  function browningOnsetTemp(hydrationPct) {
    return 120 + 0.55 * clamp(hydrationPct, 0, 100);
  }

  var BROWNING_PRESETS = [
    { name: 'Steady surface', stages: [{ tempC: 180, durationMin: 10 }] },
    { name: 'Warm then hot', stages: [{ tempC: 140, durationMin: 5 }, { tempC: 200, durationMin: 5 }] }
  ];

  // Exact integration for piecewise constant surface temperatures.
  function browningSchedule(stages, opts) {
    if (!Array.isArray(stages) || stages.length < 1 || stages.length > 32) throw new RangeError('schedule needs 1 to 32 stages');
    var totalMin = 0, dose = 0, timeTo50Min = null;
    var rows = Array.from(stages, function (stage, index) {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw new TypeError('stage must be an object');
      finite(stage.tempC, 'stage temperature'); positive(stage.durationMin, 'stage duration');
      if (stage.tempC < 0 || stage.tempC > 300) throw new RangeError('stage temperature must be between 0 and 300 C');
      var startMin = totalMin;
      var rate = maillardRate(stage.tempC, opts);
      var stageDose = finiteResult(rate * stage.durationMin);
      if (timeTo50Min === null && rate > 0 && dose < Math.LN2 && dose + stageDose >= Math.LN2) timeTo50Min = startMin + (Math.LN2 - dose) / rate;
      dose = finiteResult(dose + stageDose);
      totalMin = finiteResult(totalMin + stage.durationMin);
      if (totalMin > 1440) throw new RangeError('schedule duration must not exceed 1440 minutes');
      return { index: index, tempC: stage.tempC, durationMin: stage.durationMin, startMin: startMin, endMin: totalMin, rate: rate, cumulativeDose: dose, fraction: -Math.expm1(-dose) };
    });
    return { stages: rows, totalMin: totalMin, totalDose: dose, fraction: -Math.expm1(-dose), timeTo50Min: timeTo50Min };
  }

  // -- Baker's percentage and hydration ------------------------------------

  // Baker's percentage = ingredient weight / flour weight * 100.
  function bakersPercentage(ingredientWeight, flourWeight) {
    nonnegative(ingredientWeight, 'ingredientWeight'); positive(flourWeight, 'flourWeight');
    return finiteResult((ingredientWeight / flourWeight) * 100);
  }

  function hydration(waterWeight, flourWeight) {
    return bakersPercentage(waterWeight, flourWeight);
  }

  function weightFromPercentage(percent, flourWeight) {
    nonnegative(percent, 'percent'); positive(flourWeight, 'flourWeight');
    return finiteResult(flourWeight * (percent / 100));
  }

  function validatePercentages(percentages) {
    if (!percentages || typeof percentages !== 'object' || Array.isArray(percentages)) throw new TypeError('percentages must be an object');
    Object.keys(percentages).forEach(function (name) {
      if (name === 'flour' || name === 'prototype' || name in Object.prototype) throw new TypeError('reserved ingredient name: ' + name);
      if (!isFiniteNumber(percentages[name]) || percentages[name] < 0) throw new TypeError('percentage for ' + name + ' must be a finite non-negative number');
    });
  }

  // Scale a formula. percentages maps ingredient name -> percent of flour.
  function scaleRecipe(flourWeight, percentages) {
    positive(flourWeight, 'flourWeight');
    validatePercentages(percentages);
    var weights = { flour: flourWeight };
    var totalPct = 100;
    Object.keys(percentages).forEach(function (name) {
      var p = percentages[name];
      if (!isFiniteNumber(p) || p < 0) {
        throw new TypeError('scaleRecipe: percentage for ' + name + ' must be a finite non-negative number');
      }
      weights[name] = weightFromPercentage(p, flourWeight);
      totalPct += p;
    });
    return {
      weights: weights,
      totalPercent: finiteResult(totalPct),
      totalWeight: finiteResult(flourWeight * (totalPct / 100))
    };
  }

  function totalYieldPercent(percentages) {
    validatePercentages(percentages);
    return finiteResult(100 + Object.keys(percentages).reduce(function (acc, k) {
      return acc + percentages[k];
    }, 0));
  }

  // -- Starch gelatinization ------------------------------------------------
  // Logistic degree of gelatinization (0..1). More available water lowers
  // the midpoint temperature, so hydration is an explicit input.

  var STARCH_PROFILES = {
    tapioca: { label: 'Boba / tapioca starch', baseTmC: 71, waterShiftC: 14, steepness: 0.20 },
    wheat:   { label: 'Sourdough / wheat starch', baseTmC: 63, waterShiftC: 10, steepness: 0.17 },
    potato:  { label: 'Potato starch', baseTmC: 64, waterShiftC: 12, steepness: 0.22 },
    rice:    { label: 'Rice starch', baseTmC: 76, waterShiftC: 9, steepness: 0.19 }
  };

  function gelatinizationMidpoint(hydrationPct, profile) {
    var p = profile || STARCH_PROFILES.tapioca;
    finite(p.baseTmC, 'starch midpoint'); nonnegative(p.waterShiftC, 'starch water shift'); positive(p.steepness, 'starch steepness');
    return finiteResult(p.baseTmC - p.waterShiftC * (clamp(hydrationPct, 0, 100) / 100));
  }

  function gelatinizationDegree(tempC, hydrationPct, profile) {
    var p = profile || STARCH_PROFILES.tapioca;
    celsiusToKelvin(tempC);
    var Tm = gelatinizationMidpoint(hydrationPct, p);
    return 1 / (1 + Math.exp(-p.steepness * (tempC - Tm)));
  }

  function gelatinizationCurve(profile, hydrationPct, minC, maxC, steps) {
    var out = [];
    sampleRange(minC, maxC);
    var n = sampleCount(steps);
    for (var i = 0; i < n; i++) {
      var t = minC + (maxC - minC) * (i / (n - 1));
      out.push({ tempC: t, degree: gelatinizationDegree(t, hydrationPct, profile) });
    }
    return out;
  }

  // -- Fermentation kinetics ------------------------------------------------
  // Yeast metabolism rises with temperature (Arrhenius) until thermal
  // denaturation dominates, producing an interior optimum near 40 to 45 deg C.

  var FERMENT_DEFAULT = {
    A: 4.0e6,       // 1/min
    Ea: 62000,      // J/mol
    killC: 46,      // deg C, denaturation half-point
    killWidth: 3.2, // deg C, width of the denaturation transition
    refDoublingMin: 120 // minutes to double at 28 deg C
  };

  function fermentationRate(tempC, opts) {
    var o = optionsWithDefaults(FERMENT_DEFAULT, opts);
    finite(o.killC, 'killC'); positive(o.killWidth, 'killWidth'); positive(o.refDoublingMin, 'refDoublingMin');
    var k = arrheniusRate(o.A, o.Ea, celsiusToKelvin(tempC));
    var denat = 1 / (1 + Math.exp((tempC - o.killC) / o.killWidth));
    return k * denat;
  }

  // Rate relative to the value at 28 deg C.
  function fermentationRelative(tempC, opts) {
    var o = optionsWithDefaults(FERMENT_DEFAULT, opts);
    positive(o.A, 'fermentation A');
    fermentationRate(tempC, o); // validate temperatures and model parameters
    if (tempC === 28) return 1;
    function softplus(value) { return Math.max(value, 0) + Math.log1p(Math.exp(-Math.abs(value))); }
    var thermalLog = (o.Ea / R) * (1 / celsiusToKelvin(28) - 1 / celsiusToKelvin(tempC));
    var denaturationLog = softplus((28 - o.killC) / o.killWidth) - softplus((tempC - o.killC) / o.killWidth);
    return finiteResult(Math.exp(thermalLog + denaturationLog));
  }

  // Minutes for a dough to double, inversely proportional to the rate.
  function doublingTime(tempC, opts) {
    var o = optionsWithDefaults(FERMENT_DEFAULT, opts);
    return finiteResult(o.refDoublingMin / positive(fermentationRelative(tempC, o), 'relative fermentation rate'));
  }

  // Relative volume starts at 1, doubles at dt, and approaches capacity 4.
  function doughVolume(timeMin, tempC, opts) {
    nonnegative(timeMin, 'time');
    var dt = doublingTime(tempC, opts);
    return 4 / (1 + 3 * Math.exp(-Math.log(3) * timeMin / dt));
  }

  // Normalized expansion starts at 0 and approaches 1.
  function doughRise(timeMin, tempC, opts) {
    return (doughVolume(timeMin, tempC, opts) - 1) / 3;
  }

  function fermentationCurve(tempC, maxMin, steps, opts) {
    var out = [];
    nonnegative(maxMin, 'maximum time');
    var n = sampleCount(steps);
    for (var i = 0; i < n; i++) {
      var t = maxMin * (i / (n - 1));
      out.push({ timeMin: t, rise: doughRise(t, tempC, opts) });
    }
    return out;
  }

  // -- Espresso extraction --------------------------------------------------
  // Extraction yield (%) falls as grind gets coarser (larger median particle
  // size in microns). A decreasing Hill curve:
  //   E(g) = Emin + (Emax - Emin) / (1 + (g / g0)^p)

  var ESPRESSO_DEFAULT = {
    Emin: 14, Emax: 24, g0: 600, p: 2, gmin: 180, gmax: 1400
  };

  function espressoOptions(opts) {
    var o = optionsWithDefaults(ESPRESSO_DEFAULT, opts);
    nonnegative(o.Emin, 'Emin'); positive(o.Emax, 'Emax'); positive(o.g0, 'g0'); positive(o.p, 'p');
    nonnegative(o.gmin, 'gmin'); positive(o.gmax, 'gmax');
    if (o.Emax > 100 || o.Emax <= o.Emin || o.gmax <= o.gmin) throw new RangeError('espresso bounds must define a decreasing yield curve');
    return o;
  }

  function extractionYield(grindMicrons, opts) {
    var o = espressoOptions(opts);
    if (!isFiniteNumber(grindMicrons) || grindMicrons < 0) {
      throw new RangeError('extractionYield: grindMicrons must be a finite non-negative number');
    }
    return o.Emin + (o.Emax - o.Emin) / (1 + Math.pow(grindMicrons / o.g0, o.p));
  }

  // Invert the yield model with bisection. E(g) is strictly decreasing, so
  // convergence over [gmin, gmax] is guaranteed for reachable targets.
  function solveGrindForYield(targetYield, opts) {
    var o = espressoOptions(opts);
    if (!isFiniteNumber(targetYield)) {
      throw new TypeError('solveGrindForYield: targetYield must be a finite number');
    }
    var eLo = extractionYield(o.gmax, o); // lowest reachable yield (coarsest)
    var eHi = extractionYield(o.gmin, o); // highest reachable yield (finest)
    if (targetYield < eLo || targetYield > eHi) {
      throw new RangeError(
        'solveGrindForYield: target yield ' + targetYield +
        '% is outside the reachable range ' + eLo.toFixed(2) + ' to ' + eHi.toFixed(2) + '%'
      );
    }
    var lo = o.gmin, hi = o.gmax;
    // Run to the float fixpoint instead of a fixed count: on a domain wider
    // than ~1e60x the answer, 200 halvings cannot reach the crossing.
    var mid;
    for (var i = 0; i < 2200; i++) {
      mid = lo + (hi - lo) / 2;
      if (mid === lo || mid === hi) { break; }
      var e = extractionYield(mid, o);
      if (e > targetYield) { lo = mid; } // need coarser grind to lower yield
      else { hi = mid; }                 // need finer grind to raise yield
    }
    var g = lo + (hi - lo) / 2;
    // Honesty check: the returned grind must actually land on the target. A
    // step-like curve can straddle the target inside one float bracket with
    // no representable g reaching it; the honest answer there is to throw.
    var err = Math.abs(extractionYield(g, o) - targetYield);
    if (!isFiniteNumber(err) || err > 1e-3) {
      throw new RangeError('solveGrindForYield: no grind reaches the target yield');
    }
    return g;
  }

  function extractionWindow(yieldPct) {
    finite(yieldPct, 'yield');
    if (yieldPct < 0 || yieldPct > 100) throw new RangeError('yield must be between 0 and 100%');
    if (yieldPct < 18) {
      return { key: 'under', label: 'Under-extracted', note: 'Sour, thin, short finish. Grind finer or extend the shot.' };
    }
    if (yieldPct <= 22) {
      return { key: 'ideal', label: 'Balanced / ideal', note: 'Sweet, syrupy, balanced acidity. The classic target window.' };
    }
    if (yieldPct <= 23.5) {
      return { key: 'strong', label: 'Over-extracted', note: 'Drying, a bitter edge begins. Grind slightly coarser.' };
    }
    return { key: 'bitter', label: 'Bitter / harsh', note: 'Over-extracted and astringent. Grind coarser or shorten the shot.' };
  }

  function extractionCurve(minG, maxG, steps, opts) {
    var out = [];
    sampleRange(minG, maxG);
    var n = sampleCount(steps);
    for (var i = 0; i < n; i++) {
      var g = minG + (maxG - minG) * (i / (n - 1));
      out.push({ grindMicrons: g, yieldPct: extractionYield(g, opts) });
    }
    return out;
  }

  // -- Deterministic SHA-256 ------------------------------------------------
  // Pure-implementation digest so recipe checksums work offline with no
  // dependency on Web Crypto or Node crypto.

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  // UTF-8 encode without TextEncoder so the digest works in every host.
  // Lone surrogates become U+FFFD, matching TextEncoder behavior.
  function utf8Bytes(str) {
    var s = String(str);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
        var cp = 0x10000 + ((code - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else if (code >= 0xd800 && code <= 0xdfff) {
        out.push(0xef, 0xbf, 0xbd);
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return out;
  }

  function sha256(text) {
    var bytes = utf8Bytes(text);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hiLen = Math.floor(bitLen / 0x100000000), loLen = bitLen >>> 0;
    bytes.push((hiLen >>> 24) & 255, (hiLen >>> 16) & 255, (hiLen >>> 8) & 255, hiLen & 255);
    bytes.push((loLen >>> 24) & 255, (loLen >>> 16) & 255, (loLen >>> 8) & 255, loLen & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        var S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = '';
    for (i = 0; i < 8; i++) { hex += ('0000000' + H[i].toString(16)).slice(-8); }
    return hex;
  }

  // -- Formula-safe CSV -----------------------------------------------------
  // Spreadsheet formula-injection guard: a string cell whose first
  // non-whitespace, non-format character is =, +, -, or @ gets a leading
  // apostrophe. Numbers are emitted raw so the file stays numeric; they can
  // never carry a payload.

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      if (!isFiniteNumber(value)) throw new TypeError('csvEscape: numeric cells must be finite');
      return String(value);
    }
    var s = String(value);
    // A payload hidden behind whitespace or invisible format chars stays
    // guarded: the apostrophe lands first, so trimming still sees a literal.
    var first = s.replace(/^[\s\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]+/, '').charAt(0);
    if (first !== '' && '=+-@'.indexOf(first) !== -1) { s = "'" + s; }
    if (/[",\n\r]/.test(s)) { s = '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  function toCSV(rows) {
    if (!Array.isArray(rows)) throw new TypeError('toCSV: rows must be an array');
    return rows.map(function (row, index) {
      if (!Array.isArray(row)) throw new TypeError('toCSV: row ' + index + ' must be an array');
      return row.map(csvEscape).join(',');
    }).join('\r\n') + '\r\n';
  }

  // Long-format CSV of the scaled formula and starter analysis. The meta
  // section carries free text (name, notes) through the same injection guard.
  function recipeCSV(recipe) {
    var r = validateRecipe(recipe);
    var a = analyzeDoughRecipe(r);
    return toCSV([
      ['section', 'item', 'baker_pct', 'mass_g'],
      ['formula', 'flour', 100, a.weights.flour],
      ['formula', 'water', r.hydrationPct, a.weights.water],
      ['formula', 'salt', r.saltPct, a.weights.salt],
      ['formula', 'starter', r.starterPct, a.weights.starter],
      ['formula', 'total', a.totalPercent, a.totalWeight],
      ['starter', 'flour', null, a.starterFlour],
      ['starter', 'water', null, a.starterWater],
      ['summary', 'total flour', null, a.totalFlour],
      ['summary', 'total water', null, a.totalWater],
      ['summary', 'effective hydration pct', null, a.effectiveHydrationPct],
      ['summary', 'prefermented flour pct', null, a.prefermentedFlourPct],
      ['meta', 'name', null, r.name],
      ['meta', 'style', null, r.style],
      ['meta', 'notes', null, r.notes],
      ['meta', 'sha256', null, recipeChecksum(r)]
    ]);
  }

  function recipeChecksum(recipe) {
    return sha256(exportRecipe(recipe));
  }

  // -- Recipe schema, import / export --------------------------------------

  var RECIPE_SCHEMA = 'flavorforge/recipe';
  var RECIPE_VERSION = 1;

  var RECIPE_FIELDS = [
    'name', 'style', 'flourGrams', 'hydrationPct', 'saltPct',
    'starterPct', 'starterHydrationPct', 'targetYieldPct', 'grindMicrons', 'brewTempC', 'notes'
  ];
  var RECIPE_NUMERIC = [
    'flourGrams', 'hydrationPct', 'saltPct', 'starterPct', 'starterHydrationPct',
    'targetYieldPct', 'grindMicrons', 'brewTempC'
  ];
  var RECIPE_LIMITS = {
    flourGrams: [1, 10000], hydrationPct: [0, 100], saltPct: [0, 10], starterPct: [0, 100],
    starterHydrationPct: [0, 200], targetYieldPct: [0, 100], grindMicrons: [180, 1400], brewTempC: [80, 100]
  };
  var RECIPE_STYLES = ['sourdough', 'boba', 'espresso', 'hybrid'];

  function createRecipe(overrides) {
    var base = {
      schema: RECIPE_SCHEMA,
      version: RECIPE_VERSION,
      name: 'House sourdough',
      style: 'sourdough',
      flourGrams: 1000,
      hydrationPct: 70,
      saltPct: 2,
      starterPct: 20,
      starterHydrationPct: 100,
      targetYieldPct: 20,
      grindMicrons: 600,
      brewTempC: 93,
      notes: 'Log observations here. Keep water at the target temperature.'
    };
    if (overrides) {
      Object.keys(overrides).forEach(function (k) {
        if (RECIPE_FIELDS.indexOf(k) !== -1) { base[k] = overrides[k]; }
      });
    }
    return validateRecipe(base);
  }

  // Validate and normalize. Unknown keys are dropped so round-trips are stable.
  function validateRecipe(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new TypeError('validateRecipe: expected a recipe object');
    }
    if (obj.schema !== RECIPE_SCHEMA) {
      throw new TypeError('validateRecipe: unrecognized schema (expected ' + RECIPE_SCHEMA + ')');
    }
    if (obj.version !== RECIPE_VERSION) {
      throw new TypeError('validateRecipe: unsupported version ' + obj.version);
    }
    var out = { schema: obj.schema, version: obj.version };
    RECIPE_FIELDS.forEach(function (f) {
      var v = obj[f];
      // Earlier version 1 cards assume a starter with equal flour and water.
      if (f === 'starterHydrationPct' && v === undefined) v = 100;
      if (RECIPE_NUMERIC.indexOf(f) !== -1) {
        if (!isFiniteNumber(v) || v < 0) {
          throw new TypeError('validateRecipe: field ' + f + ' must be a finite non-negative number');
        }
        var limits = RECIPE_LIMITS[f];
        if (v < limits[0] || v > limits[1]) throw new RangeError('validateRecipe: ' + f + ' must be between ' + limits[0] + ' and ' + limits[1]);
        out[f] = v;
      } else {
        if (typeof v !== 'string') {
          throw new TypeError('validateRecipe: field ' + f + ' must be a string');
        }
        if (f === 'style' && RECIPE_STYLES.indexOf(v) === -1) throw new TypeError('validateRecipe: unsupported style');
        if (f === 'name' && (!v.trim() || v.length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(v))) throw new RangeError('recipe name needs 1 to 120 characters without control characters');
        if (f === 'notes' && (v.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(v))) throw new RangeError('recipe notes need at most 4000 characters without control characters');
        out[f] = f === 'name' ? v.trim() : v;
      }
    });
    return out;
  }

  function exportRecipe(recipe) {
    return JSON.stringify(validateRecipe(recipe), null, 2);
  }

  function importRecipe(text) {
    if (typeof text !== 'string') {
      throw new TypeError('importRecipe: expected a JSON string');
    }
    if (text.length > 65536) throw new RangeError('recipe JSON exceeds 64 KiB');
    var parsed = JSON.parse(text); // throws SyntaxError on malformed JSON
    return validateRecipe(parsed);
  }

  function analyzeDoughRecipe(recipe) {
    var r = validateRecipe(recipe);
    var scaled = scaleRecipe(r.flourGrams, { water: r.hydrationPct, salt: r.saltPct, starter: r.starterPct });
    var starterFlour = scaled.weights.starter / (1 + r.starterHydrationPct / 100);
    var starterWater = scaled.weights.starter - starterFlour;
    var totalFlour = r.flourGrams + starterFlour;
    var totalWater = scaled.weights.water + starterWater;
    return {
      weights: scaled.weights, totalWeight: scaled.totalWeight, totalPercent: scaled.totalPercent,
      starterFlour: starterFlour, starterWater: starterWater, totalFlour: totalFlour, totalWater: totalWater,
      effectiveHydrationPct: hydration(totalWater, totalFlour),
      effectiveSaltPct: bakersPercentage(scaled.weights.salt, totalFlour),
      prefermentedFlourPct: bakersPercentage(starterFlour, totalFlour)
    };
  }

  // -- public API -----------------------------------------------------------

  return {
    R: R,
    STARCH_PROFILES: STARCH_PROFILES,
    BROWNING_PRESETS: BROWNING_PRESETS,
    RECIPE_LIMITS: RECIPE_LIMITS,
    constants: {
      R: R,
      MAILLARD_DEFAULT: MAILLARD_DEFAULT,
      STARCH_PROFILES: STARCH_PROFILES,
      FERMENT_DEFAULT: FERMENT_DEFAULT,
      ESPRESSO_DEFAULT: ESPRESSO_DEFAULT,
      RECIPE_SCHEMA: RECIPE_SCHEMA,
      RECIPE_VERSION: RECIPE_VERSION
    },
    clamp: clamp,
    celsiusToKelvin: celsiusToKelvin,
    kelvinToCelsius: kelvinToCelsius,
    arrheniusRate: arrheniusRate,
    rateRatio: rateRatio,
    q10: q10,
    activationEnergyFromRates: activationEnergyFromRates,
    browningFraction: browningFraction,
    timeToFraction: timeToFraction,
    halfLife: halfLife,
    maillardRate: maillardRate,
    relativeBrowning: relativeBrowning,
    browningCurve: browningCurve,
    browningOnsetTemp: browningOnsetTemp,
    browningSchedule: browningSchedule,
    bakersPercentage: bakersPercentage,
    hydration: hydration,
    weightFromPercentage: weightFromPercentage,
    scaleRecipe: scaleRecipe,
    analyzeDoughRecipe: analyzeDoughRecipe,
    totalYieldPercent: totalYieldPercent,
    gelatinizationMidpoint: gelatinizationMidpoint,
    gelatinizationDegree: gelatinizationDegree,
    gelatinizationCurve: gelatinizationCurve,
    fermentationRate: fermentationRate,
    fermentationRelative: fermentationRelative,
    doublingTime: doublingTime,
    doughRise: doughRise,
    doughVolume: doughVolume,
    fermentationCurve: fermentationCurve,
    extractionYield: extractionYield,
    solveGrindForYield: solveGrindForYield,
    extractionWindow: extractionWindow,
    extractionCurve: extractionCurve,
    createRecipe: createRecipe,
    validateRecipe: validateRecipe,
    exportRecipe: exportRecipe,
    importRecipe: importRecipe,
    sha256: sha256,
    csvEscape: csvEscape,
    toCSV: toCSV,
    recipeCSV: recipeCSV,
    recipeChecksum: recipeChecksum
  };
});
