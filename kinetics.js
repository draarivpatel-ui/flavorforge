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
      if (['flour', '__proto__', 'constructor', 'prototype'].indexOf(name) !== -1) throw new TypeError('reserved ingredient name: ' + name);
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
    for (var i = 0; i < 200; i++) {
      var mid = lo + (hi - lo) / 2;
      var e = extractionYield(mid, o);
      if (e > targetYield) { lo = mid; } // need coarser grind to lower yield
      else { hi = mid; }                 // need finer grind to raise yield
    }
    return lo + (hi - lo) / 2;
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
        if (f === 'name' && (!v.trim() || v.length > 120 || /[\x00-\x1f\x7f]/.test(v))) throw new RangeError('recipe name needs 1 to 120 characters without control characters');
        if (f === 'notes' && v.length > 4000) throw new RangeError('recipe notes exceed 4000 characters');
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
    importRecipe: importRecipe
  };
});
