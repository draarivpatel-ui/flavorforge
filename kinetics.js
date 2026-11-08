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

  function clamp(x, lo, hi) {
    if (hi < lo) { throw new RangeError('clamp: hi must be >= lo'); }
    return Math.min(hi, Math.max(lo, x));
  }

  function celsiusToKelvin(c) { return c + 273.15; }
  function kelvinToCelsius(k) { return k - 273.15; }

  // -- Arrhenius kinetics ---------------------------------------------------
  // k = A * exp(-Ea / (R * T))
  //   A  : pre-exponential factor (same units as k, here 1/min)
  //   Ea : activation energy, J/mol
  //   T  : absolute temperature, K

  function arrheniusRate(A, Ea, T, Rgas) {
    var Rg = (typeof Rgas === 'number') ? Rgas : R;
    if (!isFiniteNumber(A) || !isFiniteNumber(Ea) || !isFiniteNumber(T)) {
      throw new TypeError('arrheniusRate: A, Ea and T must be finite numbers');
    }
    if (T <= 0) { throw new RangeError('arrheniusRate: T must be > 0 K'); }
    if (Rg <= 0) { throw new RangeError('arrheniusRate: R must be > 0'); }
    return A * Math.exp(-Ea / (Rg * T));
  }

  // Ratio k(T2)/k(T1). A cancels, so it is independent of the prefactor.
  function rateRatio(Ea, T1, T2, Rgas) {
    var Rg = (typeof Rgas === 'number') ? Rgas : R;
    if (T1 <= 0 || T2 <= 0) {
      throw new RangeError('rateRatio: temperatures must be > 0 K');
    }
    return Math.exp((-Ea / Rg) * (1 / T2 - 1 / T1));
  }

  // Temperature coefficient Q10 = k(Tc + 10) / k(Tc), Tc in Celsius.
  function q10(Ea, Tc, Rgas) {
    var T1 = celsiusToKelvin(Tc);
    return rateRatio(Ea, T1, T1 + 10, Rgas);
  }

  // Recover activation energy from two measured rates:
  //   Ea = R * ln(k2/k1) / (1/T1 - 1/T2)
  function activationEnergyFromRates(k1, T1, k2, T2, Rgas) {
    var Rg = (typeof Rgas === 'number') ? Rgas : R;
    if (!(k1 > 0) || !(k2 > 0) || !(T1 > 0) || !(T2 > 0) || T1 === T2) {
      throw new RangeError('activationEnergyFromRates: need positive rates and distinct positive temperatures');
    }
    return Rg * Math.log(k2 / k1) / (1 / T1 - 1 / T2);
  }

  // -- First-order conversion (browning / reaction progress) ---------------

  // Fraction of reactant converted after time t: 1 - exp(-k t).
  function browningFraction(k, t) {
    if (k < 0 || t < 0) { throw new RangeError('browningFraction: k and t must be >= 0'); }
    return 1 - Math.exp(-k * t);
  }

  // Time needed to reach a given conversion fraction (0 < fraction < 1).
  function timeToFraction(k, fraction) {
    if (!(k > 0)) { throw new RangeError('timeToFraction: k must be > 0'); }
    if (!(fraction > 0 && fraction < 1)) {
      throw new RangeError('timeToFraction: fraction must be in (0, 1)');
    }
    return -Math.log(1 - fraction) / k;
  }

  function halfLife(k) {
    if (!(k > 0)) { throw new RangeError('halfLife: k must be > 0'); }
    return Math.LN2 / k;
  }

  // -- Maillard browning ----------------------------------------------------

  var MAILLARD_DEFAULT = {
    A: 7.2e7,       // 1/min, representative pre-exponential factor
    Ea: 100000,     // J/mol, typical apparent activation energy for browning
    refC: 150       // deg C, reference browning temperature
  };

  function maillardRate(tempC, opts) {
    var o = opts || MAILLARD_DEFAULT;
    return arrheniusRate(o.A, o.Ea, celsiusToKelvin(tempC));
  }

  // Browning rate relative to the reference temperature (1.0 at refC).
  function relativeBrowning(tempC, opts) {
    var o = opts || MAILLARD_DEFAULT;
    return maillardRate(tempC, o) / maillardRate(o.refC, o);
  }

  function browningCurve(minC, maxC, steps, opts) {
    var out = [];
    var n = steps || 60;
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

  // -- Baker's percentage and hydration ------------------------------------

  // Baker's percentage = ingredient weight / flour weight * 100.
  function bakersPercentage(ingredientWeight, flourWeight) {
    if (!(flourWeight > 0)) { throw new RangeError('bakersPercentage: flourWeight must be > 0'); }
    return 100 * ingredientWeight / flourWeight;
  }

  function hydration(waterWeight, flourWeight) {
    return bakersPercentage(waterWeight, flourWeight);
  }

  function weightFromPercentage(percent, flourWeight) {
    if (!(flourWeight > 0)) { throw new RangeError('weightFromPercentage: flourWeight must be > 0'); }
    return flourWeight * percent / 100;
  }

  // Scale a formula. percentages maps ingredient name -> percent of flour.
  function scaleRecipe(flourWeight, percentages) {
    if (!(flourWeight > 0)) { throw new RangeError('scaleRecipe: flourWeight must be > 0'); }
    var weights = { flour: flourWeight };
    var totalPct = 100;
    Object.keys(percentages).forEach(function (name) {
      var p = percentages[name];
      if (!isFiniteNumber(p) || p < 0) {
        throw new TypeError('scaleRecipe: percentage for ' + name + ' must be a finite non-negative number');
      }
      weights[name] = flourWeight * p / 100;
      totalPct += p;
    });
    return {
      weights: weights,
      totalPercent: totalPct,
      totalWeight: flourWeight * totalPct / 100
    };
  }

  function totalYieldPercent(percentages) {
    return 100 + Object.keys(percentages).reduce(function (acc, k) {
      return acc + percentages[k];
    }, 0);
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
    return p.baseTmC - p.waterShiftC * (clamp(hydrationPct, 0, 100) / 100);
  }

  function gelatinizationDegree(tempC, hydrationPct, profile) {
    var p = profile || STARCH_PROFILES.tapioca;
    var Tm = gelatinizationMidpoint(hydrationPct, p);
    return 1 / (1 + Math.exp(-p.steepness * (tempC - Tm)));
  }

  function gelatinizationCurve(profile, hydrationPct, minC, maxC, steps) {
    var out = [];
    var n = steps || 60;
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
    var o = opts || FERMENT_DEFAULT;
    var k = arrheniusRate(o.A, o.Ea, celsiusToKelvin(tempC));
    var denat = 1 / (1 + Math.exp((tempC - o.killC) / o.killWidth));
    return k * denat;
  }

  // Rate relative to the value at 28 deg C.
  function fermentationRelative(tempC, opts) {
    var o = opts || FERMENT_DEFAULT;
    return fermentationRate(tempC, o) / fermentationRate(28, o);
  }

  // Minutes for a dough to double, inversely proportional to the rate.
  function doublingTime(tempC, opts) {
    var o = opts || FERMENT_DEFAULT;
    return (o.refDoublingMin || 120) / fermentationRelative(tempC, o);
  }

  // Logistic dough volume rise (0..1) over time at a fixed temperature.
  function doughRise(timeMin, tempC, opts) {
    var o = opts || FERMENT_DEFAULT;
    var dt = doublingTime(tempC, o);
    var r = Math.LN2 / dt;
    var tMid = dt * 1.5;
    return 1 / (1 + Math.exp(-r * (timeMin - tMid)));
  }

  function fermentationCurve(tempC, maxMin, steps, opts) {
    var out = [];
    var n = steps || 60;
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

  function extractionYield(grindMicrons, opts) {
    var o = opts || ESPRESSO_DEFAULT;
    if (!isFiniteNumber(grindMicrons) || grindMicrons < 0) {
      throw new RangeError('extractionYield: grindMicrons must be a finite non-negative number');
    }
    return o.Emin + (o.Emax - o.Emin) / (1 + Math.pow(grindMicrons / o.g0, o.p));
  }

  // Invert the yield model with bisection. E(g) is strictly decreasing, so
  // convergence over [gmin, gmax] is guaranteed for reachable targets.
  function solveGrindForYield(targetYield, opts) {
    var o = opts || ESPRESSO_DEFAULT;
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
      var mid = (lo + hi) / 2;
      var e = extractionYield(mid, o);
      if (e > targetYield) { lo = mid; } // need coarser grind to lower yield
      else { hi = mid; }                 // need finer grind to raise yield
    }
    return (lo + hi) / 2;
  }

  function extractionWindow(yieldPct) {
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
    var n = steps || 60;
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
    'starterPct', 'targetYieldPct', 'grindMicrons', 'brewTempC', 'notes'
  ];
  var RECIPE_NUMERIC = [
    'flourGrams', 'hydrationPct', 'saltPct', 'starterPct',
    'targetYieldPct', 'grindMicrons', 'brewTempC'
  ];

  function createRecipe(overrides) {
    var base = {
      schema: RECIPE_SCHEMA,
      version: RECIPE_VERSION,
      name: 'House Sourdough and Boba Lab Card',
      style: 'sourdough',
      flourGrams: 1000,
      hydrationPct: 70,
      saltPct: 2,
      starterPct: 20,
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
    return base;
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
      if (RECIPE_NUMERIC.indexOf(f) !== -1) {
        if (!isFiniteNumber(v) || v < 0) {
          throw new TypeError('validateRecipe: field ' + f + ' must be a finite non-negative number');
        }
        out[f] = v;
      } else {
        if (typeof v !== 'string') {
          throw new TypeError('validateRecipe: field ' + f + ' must be a string');
        }
        out[f] = v;
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
    var parsed = JSON.parse(text); // throws SyntaxError on malformed JSON
    return validateRecipe(parsed);
  }

  // -- public API -----------------------------------------------------------

  return {
    R: R,
    STARCH_PROFILES: STARCH_PROFILES,
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
    bakersPercentage: bakersPercentage,
    hydration: hydration,
    weightFromPercentage: weightFromPercentage,
    scaleRecipe: scaleRecipe,
    totalYieldPercent: totalYieldPercent,
    gelatinizationMidpoint: gelatinizationMidpoint,
    gelatinizationDegree: gelatinizationDegree,
    gelatinizationCurve: gelatinizationCurve,
    fermentationRate: fermentationRate,
    fermentationRelative: fermentationRelative,
    doublingTime: doublingTime,
    doughRise: doughRise,
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
