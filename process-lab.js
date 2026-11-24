/*
 * FlavorForge Process & Sensitivity Lab - pure lab computations.
 *
 * UMD style: available as module.exports in Node (CommonJS) and as
 * window.FlavorForgeLab / globalThis.FlavorForgeLab in a browser.
 * No DOM, no network, no dependencies. Requires kinetics.js (FlavorForge)
 * for every model call; the module loads without it but model-backed
 * functions then throw a clear error.
 *
 * Everything here is a deterministic teaching approximation, exactly like
 * the models in kinetics.js. Nothing predicts a particular oven, dough
 * culture, or espresso machine.
 */
(function (root, factory) {
  'use strict';
  var FF = root && root.FlavorForge;
  if (!FF && typeof require === 'function') {
    try { FF = require('./kinetics.js'); } catch (ignore) { FF = null; }
  }
  var api = factory(FF);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.FlavorForgeLab = api;
  }
})(typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined' ? window : this), function (F) {
  'use strict';

  function needF() {
    if (!F) throw new Error('process-lab: kinetics.js (FlavorForge) must load first');
    return F;
  }

  function isFiniteNumber(x) {
    return typeof x === 'number' && isFinite(x);
  }

  function finite(x, label) {
    if (!isFiniteNumber(x)) throw new TypeError(label + ' must be a finite number');
    return x;
  }

  function plusZero(x) { return x === 0 ? 0 : x; } // normalize -0 to +0

  var hasOwn = Object.prototype.hasOwnProperty;
  var DANGEROUS_KEYS = { '__proto__': true, 'constructor': true, 'prototype': true };

  var SCHEMA = 'flavorforge/lab-brief';
  var VERSION = 1;
  var YEAST_KILL_C = 46;
  var DISCLOSURE = 'Teaching approximations for exploration, not lab predictions for real ovens, dough cultures, or espresso machines.';

  // -- Five thermal comparison profiles ------------------------------------
  // Each profile is a piecewise-constant surface-temperature schedule run
  // through the same exact Arrhenius dose integration as the analyzer tab.

  var THERMAL_PROFILES = [
    {
      key: 'steady-180',
      name: 'Steady 180 C',
      note: 'constant deck plate',
      stages: [{ tempC: 180, durationMin: 10 }]
    },
    {
      key: 'warm-hot',
      name: 'Warm-Then-Hot 140 to 200 C',
      note: 'gentle start, hot finish',
      stages: [{ tempC: 140, durationMin: 5 }, { tempC: 200, durationMin: 5 }]
    },
    {
      key: 'steam-deck',
      name: 'Steam-Deck Bake 230 to 190 C',
      note: 'steam burst then vented finish',
      stages: [{ tempC: 230, durationMin: 3 }, { tempC: 190, durationMin: 7 }]
    },
    {
      key: 'low-slow',
      name: 'Low-Slow 150 C Half-Life',
      note: 'the 20 minute calibration point',
      stages: [{ tempC: 150, durationMin: 20 }]
    },
    {
      key: 'sear',
      name: 'High-Heat Sear 220 C',
      note: 'short contact sear',
      stages: [{ tempC: 220, durationMin: 4 }]
    }
  ];

  var PROFILE_KEYS = {};
  THERMAL_PROFILES.forEach(function (p) { PROFILE_KEYS[p.key] = p; });

  function profileByKey(key) {
    return hasOwn.call(PROFILE_KEYS, key) ? PROFILE_KEYS[key] : null;
  }

  // Hydration grid for the sensitivity surface (percent of dry starch).
  var HYDRATION_GRID = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
  var ESPRESSO_GRID_POINTS = 12;

  // -- Lab state ------------------------------------------------------------
  // The bookmark codec carries the six interactive fields; the mass rollup
  // additionally reads the four formula fields. Everything else defaults.

  var STATE_DEFAULTS = {
    profile: 'steady-180',
    EaKj: 100,
    starch: 'tapioca',
    hyd: 70,
    fermT: 28,
    yieldT: 20,
    flourGrams: 1000,
    saltPct: 2,
    starterPct: 20,
    starterHydrationPct: 100
  };

  var STATE_RULES = {
    profile: { kind: 'profile' },
    EaKj: { kind: 'number', lo: 20, hi: 200, label: 'EaKj' },
    starch: { kind: 'starch' },
    hyd: { kind: 'number', lo: 0, hi: 100, label: 'hyd' },
    fermT: { kind: 'number', lo: 4, hi: 60, label: 'fermT' },
    yieldT: { kind: 'number', lo: 0, hi: 100, label: 'yieldT' },
    flourGrams: { kind: 'number', lo: 1, hi: 10000, label: 'flourGrams' },
    saltPct: { kind: 'number', lo: 0, hi: 10, label: 'saltPct' },
    starterPct: { kind: 'number', lo: 0, hi: 100, label: 'starterPct' },
    starterHydrationPct: { kind: 'number', lo: 0, hi: 200, label: 'starterHydrationPct' }
  };
  var BOOKMARK_FIELDS = ['profile', 'EaKj', 'starch', 'hyd', 'fermT', 'yieldT'];

  function readField(input, key) {
    if (!input || typeof input !== 'object' || !hasOwn.call(input, key)) return undefined;
    var v = input[key];
    return v === undefined ? undefined : v;
  }

  function checkRange(v, rule) {
    if (!isFiniteNumber(v)) throw new TypeError('lab state ' + rule.label + ' must be a finite number');
    if (v < rule.lo || v > rule.hi) {
      throw new RangeError('lab state ' + rule.label + ' must be between ' + rule.lo + ' and ' + rule.hi);
    }
    return plusZero(v);
  }

  // Whitelist normalize: reads through hasOwnProperty only, drops unknown
  // keys, coerces -0 to +0, and enforces the same ranges as the controls.
  function normalizeState(input) {
    if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
      throw new TypeError('lab state must be an object');
    }
    var out = {};
    Object.keys(STATE_RULES).forEach(function (key) {
      var rule = STATE_RULES[key];
      var v = readField(input, key);
      if (v === undefined) v = STATE_DEFAULTS[key];
      if (rule.kind === 'profile') {
        if (typeof v !== 'string' || !profileByKey(v)) {
          throw new RangeError('lab state profile must be one of: ' + THERMAL_PROFILES.map(function (p) { return p.key; }).join(', '));
        }
        out[key] = v;
      } else if (rule.kind === 'starch') {
        var profiles = needF().STARCH_PROFILES;
        if (typeof v !== 'string' || !hasOwn.call(profiles, v)) {
          throw new RangeError('lab state starch must be one of: ' + Object.keys(profiles).join(', '));
        }
        out[key] = v;
      } else {
        out[key] = checkRange(v, rule);
      }
    });
    return out;
  }

  function bookmarkState(state) {
    var st = normalizeState(state);
    var out = {};
    BOOKMARK_FIELDS.forEach(function (k) { out[k] = st[k]; });
    return out;
  }

  // -- Thermal profile comparator ------------------------------------------

  function maillardOpts(state) {
    var FF = needF();
    var o = FF.constants.MAILLARD_DEFAULT;
    return { A: o.A, Ea: normalizeState(state).EaKj * 1000, refC: o.refC };
  }

  // Cumulative Arrhenius dose at time t inside an analyzed schedule.
  function doseAt(sched, t) {
    finite(t, 'time');
    if (t <= 0) return 0;
    var dose = 0;
    for (var i = 0; i < sched.stages.length; i++) {
      var s = sched.stages[i];
      if (t >= s.endMin) { dose = s.cumulativeDose; continue; }
      if (t > s.startMin) {
        var startDose = isFiniteNumber(s.startDose) ? s.startDose : s.cumulativeDose - s.rate * s.durationMin;
        dose = startDose + s.rate * (t - s.startMin);
      }
      break;
    }
    return dose;
  }

  // Exact conversion X(t) = -expm1(-dose(t)) at the requested sample times.
  // Times outside [0, totalMin] are clamped to the endpoints.
  function conversionCurve(stagesOrProfile, opts, times) {
    var FF = needF();
    var stages = Array.isArray(stagesOrProfile) ? stagesOrProfile : stagesOrProfile.stages;
    if (!Array.isArray(times)) throw new TypeError('conversionCurve: times must be an array');
    var sched = FF.browningSchedule(stages, opts);
    var sorted = times.map(function (t) {
      finite(t, 'sample time');
      return Math.min(sched.totalMin, Math.max(0, t));
    }).sort(function (a, b) { return a - b; });
    return sorted.map(function (t) {
      return { t: t, x: -Math.expm1(-doseAt(sched, t)) };
    });
  }

  // Sorted union of stage-boundary times across profiles plus a uniform
  // grid, so every plotted curve is sampled exactly at its own kinks.
  function unionChartTimes(profiles, gridPoints) {
    var n = gridPoints === undefined ? 160 : gridPoints;
    if (!Number.isInteger(n) || n < 8 || n > 2000) throw new RangeError('gridPoints must be an integer from 8 to 2000');
    var maxT = 0;
    profiles.forEach(function (p) {
      var total = p.stages.reduce(function (acc, s) { return acc + s.durationMin; }, 0);
      if (total > maxT) maxT = total;
    });
    var set = {};
    profiles.forEach(function (p) {
      var t = 0;
      set[0] = true;
      p.stages.forEach(function (s) { t += s.durationMin; set[t] = true; });
    });
    for (var i = 0; i <= n; i++) { set[Math.round(maxT * i / n * 1e9) / 1e9] = true; }
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  // First time the cumulative dose reaches ln(2), walking the same
  // piecewise-linear integration as browningSchedule. A crossing that lands
  // exactly on the final stage boundary reports the boundary time even when
  // the accumulated float sum sits an epsilon below ln(2).
  function crossing50Min(sched) {
    var target = Math.LN2, dose = 0;
    for (var i = 0; i < sched.stages.length; i++) {
      var s = sched.stages[i];
      var stageDose = s.rate * s.durationMin;
      if (dose < target && dose + stageDose >= target) {
        return s.startMin + (target - dose) / s.rate;
      }
      dose += stageDose;
    }
    if (dose >= target * (1 - 1e-12)) return sched.totalMin;
    return null;
  }

  function doseWeightedTempC(sched) {
    var weighted = 0, doseTotal = 0, timeTotal = 0, timeWeighted = 0;
    sched.stages.forEach(function (s) {
      var stageDose = s.rate * s.durationMin;
      weighted += stageDose * s.tempC;
      doseTotal += stageDose;
      timeWeighted += s.tempC * s.durationMin;
      timeTotal += s.durationMin;
    });
    return doseTotal > 0 ? weighted / doseTotal : (timeTotal > 0 ? timeWeighted / timeTotal : 0);
  }

  function compareProfiles(state) {
    var FF = needF();
    var st = normalizeState(state);
    var opts = maillardOpts(st);
    return THERMAL_PROFILES.map(function (p) {
      var sched = FF.browningSchedule(p.stages, opts);
      var peakTempC = p.stages.reduce(function (acc, s) { return Math.max(acc, s.tempC); }, -Infinity);
      var doseTemp = doseWeightedTempC(sched);
      var cross = crossing50Min(sched);
      return {
        key: p.key,
        name: p.name,
        note: p.note,
        active: st.profile === p.key,
        stages: p.stages.map(function (s) { return { tempC: s.tempC, durationMin: s.durationMin }; }),
        totalMin: sched.totalMin,
        totalDose: sched.totalDose,
        conversionX: sched.fraction,
        crosses50: cross !== null,
        timeTo50Min: cross,
        doseTempC: doseTemp,
        effectiveQ10: FF.q10(st.EaKj * 1000, doseTemp),
        peakTempC: peakTempC,
        yeastMarginC: YEAST_KILL_C - peakTempC
      };
    });
  }

  // -- Sensitivity surfaces --------------------------------------------------

  function sensitivitySurface(state) {
    var FF = needF();
    normalizeState(state); // validate even though the surface is state-free
    var starchTm = {};
    Object.keys(FF.STARCH_PROFILES).forEach(function (key) {
      var prof = FF.STARCH_PROFILES[key];
      starchTm[key] = {
        label: prof.label,
        tm: HYDRATION_GRID.map(function (h) { return FF.gelatinizationMidpoint(h, prof); })
      };
    });
    var o = FF.constants.ESPRESSO_DEFAULT;
    var grinds = [], yields = [];
    for (var i = 0; i < ESPRESSO_GRID_POINTS; i++) {
      var g = o.gmin + (o.gmax - o.gmin) * (i / (ESPRESSO_GRID_POINTS - 1));
      grinds.push(Math.round(g * 1000) / 1000);
      yields.push(FF.extractionYield(grinds[i], o));
    }
    return { hydrations: HYDRATION_GRID.slice(), starchTm: starchTm, espresso: { grinds: grinds, yields: yields } };
  }

  // -- Baker's-percentage mass-conservation rollup ---------------------------

  function massRollup(state) {
    var FF = needF();
    var st = normalizeState(state);
    var recipe = FF.createRecipe({
      flourGrams: st.flourGrams,
      hydrationPct: st.hyd,
      saltPct: st.saltPct,
      starterPct: st.starterPct,
      starterHydrationPct: st.starterHydrationPct,
      targetYieldPct: st.yieldT
    });
    var a = FF.analyzeDoughRecipe(recipe);
    var componentSum = a.weights.flour + a.weights.water + a.weights.salt + a.weights.starter;
    var eps = 1e-9;
    var conserved = Math.abs(a.totalWeight - componentSum) <= eps &&
      Math.abs(a.totalWeight - recipe.flourGrams * a.totalPercent / 100) <= eps &&
      Math.abs(a.totalFlour - (recipe.flourGrams + a.starterFlour)) <= eps &&
      Math.abs(a.totalWater - (a.weights.water + a.starterWater)) <= eps;
    return {
      flourGrams: recipe.flourGrams,
      waterGrams: a.weights.water,
      saltGrams: a.weights.salt,
      starterGrams: a.weights.starter,
      starterFlourGrams: a.starterFlour,
      starterWaterGrams: a.starterWater,
      totalFlourGrams: a.totalFlour,
      totalWaterGrams: a.totalWater,
      totalPercent: a.totalPercent,
      totalWeightGrams: a.totalWeight,
      effectiveHydrationPct: a.effectiveHydrationPct,
      prefermentedFlourPct: a.prefermentedFlourPct,
      componentSumGrams: componentSum,
      conserved: conserved
    };
  }

  // -- Canonical audit brief --------------------------------------------------

  function buildReport(state) {
    var st = normalizeState(state);
    return {
      schema: SCHEMA,
      version: VERSION,
      disclosure: DISCLOSURE,
      state: st,
      thermal: compareProfiles(st),
      sensitivity: sensitivitySurface(st),
      mass: massRollup(st)
    };
  }

  // Deterministic JSON with sorted object keys. Rejects non-finite numbers
  // so a hostile value can never smuggle NaN or Infinity into the digest.
  function canonicalize(value) {
    var t = typeof value;
    if (value === null || t === 'boolean' || t === 'string') return JSON.stringify(value);
    if (t === 'number') {
      if (!isFinite(value)) throw new TypeError('canonicalize: non-finite number');
      return JSON.stringify(plusZero(value));
    }
    if (Array.isArray(value)) {
      return '[' + value.map(canonicalize).join(',') + ']';
    }
    if (t === 'object') {
      return '{' + Object.keys(value).sort().map(function (k) {
        return JSON.stringify(k) + ':' + canonicalize(value[k]);
      }).join(',') + '}';
    }
    throw new TypeError('canonicalize: unsupported value of type ' + t);
  }

  // One canonical digest-stamped payload per normalized state key. The same
  // digest lands on the page fingerprint, the JSON export, the CSV
  // provenance header, and the Markdown footer.
  var briefCache = new Map();
  var CACHE_LIMIT = 64;

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }

  function stampedReport(state) {
    var st = normalizeState(state);
    var key = canonicalize(st);
    var hit = briefCache.get(key);
    if (hit) return hit;
    var report = buildReport(st);
    var canonical = canonicalize(report);
    var entry = { report: deepFreeze(report), canonical: canonical, digest: needF().sha256(canonical) };
    if (briefCache.size >= CACHE_LIMIT) {
      briefCache.delete(briefCache.keys().next().value);
    }
    briefCache.set(key, entry);
    return entry;
  }

  // -- UTF-8 and base64url helpers (pure JS, no Buffer/btoa needed) -----------

  function utf8Encode(str) {
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

  function utf8Decode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); continue; }
      var code, extra;
      if (b >= 0xc2 && b < 0xe0) { code = b & 31; extra = 1; }
      else if (b >= 0xe0 && b < 0xf0) { code = b & 15; extra = 2; }
      else if (b >= 0xf0 && b <= 0xf4) { code = b & 7; extra = 3; }
      else throw new RangeError('invalid UTF-8 lead byte');
      if (i + extra >= bytes.length) throw new RangeError('truncated UTF-8 sequence');
      for (var j = 0; j < extra; j++) {
        var cb = bytes[++i];
        if ((cb & 0xc0) !== 0x80) throw new RangeError('invalid UTF-8 continuation byte');
        code = (code << 6) | (cb & 63);
      }
      var minimum = extra === 1 ? 0x80 : (extra === 2 ? 0x800 : 0x10000);
      if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw new RangeError('invalid UTF-8 code point');
      }
      if (code <= 0xffff) {
        out += String.fromCharCode(code);
      } else {
        code -= 0x10000;
        out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
      }
    }
    return out;
  }

  var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_RE = /^[A-Za-z0-9_-]+$/;

  function b64urlEncode(input) {
    var bytes = typeof input === 'string' ? utf8Encode(input) : input;
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : -1, b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
      out += B64_ALPHABET[b0 >> 2];
      out += B64_ALPHABET[((b0 & 3) << 4) | (b1 === -1 ? 0 : b1 >> 4)];
      out += b1 === -1 ? '' : B64_ALPHABET[((b1 & 15) << 2) | (b2 === -1 ? 0 : b2 >> 6)];
      out += b2 === -1 ? '' : B64_ALPHABET[b2 & 63];
    }
    return out;
  }

  function b64urlDecode(str) {
    if (typeof str !== 'string' || str.length === 0 || str.length % 4 === 1 || !B64_RE.test(str)) {
      throw new TypeError('invalid base64url payload');
    }
    var bytes = [];
    for (var i = 0; i < str.length; i += 4) {
      var chunk = str.slice(i, i + 4);
      var vals = chunk.split('').map(function (c) { return B64_ALPHABET.indexOf(c); });
      if (chunk.length === 2 && (vals[1] & 15) !== 0) throw new TypeError('non-canonical base64url padding bits');
      if (chunk.length === 3 && (vals[2] & 3) !== 0) throw new TypeError('non-canonical base64url padding bits');
      var b0 = (vals[0] << 2) | (vals[1] >> 4);
      bytes.push(b0);
      if (chunk.length > 2) bytes.push(((vals[1] & 15) << 4) | (vals[2] >> 2));
      if (chunk.length > 3) bytes.push(((vals[2] & 3) << 6) | vals[3]);
    }
    return bytes;
  }

  // -- Strict #ff= bookmark codec ----------------------------------------------
  // Fail-closed: any malformed encoding, hostile key, missing field, or
  // out-of-range value rejects the whole bookmark and returns null.

  var HASH_PREFIX = '#ff=';
  var HASH_MAX_LENGTH = 4096;
  var ALLOWED_HASH_KEYS = { v: true, profile: true, EaKj: true, starch: true, hyd: true, fermT: true, yieldT: true };

  function encodeHash(state) {
    var st = bookmarkState(state);
    var payload = { v: 1, profile: st.profile, EaKj: st.EaKj, starch: st.starch, hyd: st.hyd, fermT: st.fermT, yieldT: st.yieldT };
    return HASH_PREFIX + b64urlEncode(JSON.stringify(payload));
  }

  function decodeHash(hash) {
    if (typeof hash !== 'string' || hash.length > HASH_MAX_LENGTH) return null;
    var body = hash;
    if (body.charAt(0) === '#') {
      if (body.indexOf(HASH_PREFIX) !== 0) return null;
      body = body.slice(HASH_PREFIX.length);
    }
    if (!body) return null;
    var parsed;
    try {
      parsed = JSON.parse(utf8Decode(b64urlDecode(body)));
    } catch (e) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    var keys = Object.keys(parsed);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (DANGEROUS_KEYS[k] || !hasOwn.call(ALLOWED_HASH_KEYS, k)) return null;
    }
    if (parsed.v !== 1) return null;
    for (i = 0; i < BOOKMARK_FIELDS.length; i++) {
      if (!hasOwn.call(parsed, BOOKMARK_FIELDS[i])) return null;
    }
    try {
      var st = normalizeState(parsed);
      return bookmarkState(st);
    } catch (e2) {
      return null;
    }
  }

  // -- Export formats ------------------------------------------------------------

  function roundN(x, digits) {
    if (!isFiniteNumber(x)) return null;
    var m = Math.pow(10, digits);
    return Math.round(x * m) / m;
  }

  // The data rows shared verbatim by CSV and Markdown exports.
  function labDataRows(report) {
    var rows = [];
    report.thermal.forEach(function (r) {
      rows.push(['thermal', r.key, r.name, r.totalMin, roundN(r.totalDose, 9), roundN(r.conversionX, 9),
        r.timeTo50Min === null ? null : roundN(r.timeTo50Min, 6), roundN(r.doseTempC, 4),
        roundN(r.effectiveQ10, 5), r.peakTempC, r.yeastMarginC, r.active ? 'active' : '']);
    });
    Object.keys(report.sensitivity.starchTm).forEach(function (key) {
      var entry = report.sensitivity.starchTm[key];
      rows.push(['tm', key].concat(entry.tm.map(function (v) { return roundN(v, 4); })));
    });
    report.sensitivity.espresso.grinds.forEach(function (g, i) {
      rows.push(['espresso', g, roundN(report.sensitivity.espresso.yields[i], 6)]);
    });
    var m = report.mass;
    rows.push(['mass', 'totalPercent', roundN(m.totalPercent, 4)]);
    rows.push(['mass', 'totalWeightGrams', roundN(m.totalWeightGrams, 4)]);
    rows.push(['mass', 'totalFlourGrams', roundN(m.totalFlourGrams, 4)]);
    rows.push(['mass', 'totalWaterGrams', roundN(m.totalWaterGrams, 4)]);
    rows.push(['mass', 'effectiveHydrationPct', roundN(m.effectiveHydrationPct, 4)]);
    rows.push(['mass', 'prefermentedFlourPct', roundN(m.prefermentedFlourPct, 4)]);
    rows.push(['mass', 'conserved', m.conserved ? 'yes' : 'no']);
    return rows;
  }

  function exportJSON(state) {
    var stamped = stampedReport(state);
    var doc = {
      schema: SCHEMA,
      version: VERSION,
      disclosure: DISCLOSURE,
      state: stamped.report.state,
      thermal: stamped.report.thermal,
      sensitivity: stamped.report.sensitivity,
      mass: stamped.report.mass,
      sha256: stamped.digest
    };
    return JSON.stringify(doc, null, 2);
  }

  function exportCSV(state) {
    var FF = needF();
    var stamped = stampedReport(state);
    var dataRows = labDataRows(stamped.report);
    var dataText = dataRows.map(function (row) {
      return row.map(function (cell) { return FF.csvEscape(cell); }).join(',');
    }).join('\r\n') + '\r\n';
    var contentDigest = FF.sha256(dataText);
    var meta = [
      ['flavorforge-lab-audit', 'schema', SCHEMA],
      ['flavorforge-lab-audit', 'version', VERSION],
      ['flavorforge-lab-audit', 'sha256', stamped.digest],
      ['flavorforge-lab-audit', 'payload', b64urlEncode(stamped.canonical)],
      ['flavorforge-lab-audit', 'content_sha256', contentDigest]
    ];
    return FF.toCSV(meta) + dataText;
  }

  function exportMarkdown(state) {
    var FF = needF();
    var stamped = stampedReport(state);
    var report = stamped.report;
    var lines = [];
    lines.push('# FlavorForge Process Lab Audit Brief');
    lines.push('');
    lines.push('Schema `' + SCHEMA + '` version ' + VERSION + '. ' + DISCLOSURE);
    lines.push('');
    lines.push('## Thermal profile comparison (Ea ' + report.state.EaKj + ' kJ/mol)');
    lines.push('');
    lines.push('| Profile | Stages | Total min | Dose | X (final) | 50% at min | Dose temp C | Q10 | Peak C | Yeast margin C |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    report.thermal.forEach(function (r) {
      var stages = r.stages.map(function (s) { return s.tempC + ' C x ' + s.durationMin + ' min'; }).join('; ');
      lines.push('| ' + r.name + (r.active ? ' (active)' : '') + ' | ' + stages + ' | ' + roundN(r.totalMin, 2) +
        ' | ' + roundN(r.totalDose, 6) + ' | ' + roundN(r.conversionX, 6) + ' | ' +
        (r.timeTo50Min === null ? 'never' : roundN(r.timeTo50Min, 3)) + ' | ' + roundN(r.doseTempC, 2) +
        ' | ' + roundN(r.effectiveQ10, 4) + ' | ' + r.peakTempC + ' | ' + r.yeastMarginC + ' |');
    });
    lines.push('');
    lines.push('## Starch gelatinization midpoint Tm (deg C) vs hydration');
    lines.push('');
    lines.push('| Starch | ' + report.sensitivity.hydrations.map(function (h) { return h + '%'; }).join(' | ') + ' |');
    lines.push('|' + ' --- |'.repeat(report.sensitivity.hydrations.length + 1));
    Object.keys(report.sensitivity.starchTm).forEach(function (key) {
      var entry = report.sensitivity.starchTm[key];
      lines.push('| ' + entry.label + ' | ' + entry.tm.map(function (v) { return roundN(v, 2); }).join(' | ') + ' |');
    });
    lines.push('');
    lines.push('## Espresso grind-to-yield sensitivity');
    lines.push('');
    lines.push('| Grind (um) | ' + report.sensitivity.espresso.grinds.map(function (g) { return String(roundN(g, 1)); }).join(' | ') + ' |');
    lines.push('|' + ' --- |'.repeat(report.sensitivity.espresso.grinds.length + 1));
    lines.push('| Yield (%) | ' + report.sensitivity.espresso.yields.map(function (y) { return roundN(y, 3); }).join(' | ') + ' |');
    lines.push('');
    lines.push('## Mass-conservation rollup');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    var m = report.mass;
    [['Total baker percent', roundN(m.totalPercent, 2)], ['Total weight g', roundN(m.totalWeightGrams, 2)],
     ['Total flour g', roundN(m.totalFlourGrams, 2)], ['Total water g', roundN(m.totalWaterGrams, 2)],
     ['Effective hydration %', roundN(m.effectiveHydrationPct, 3)], ['Prefermented flour %', roundN(m.prefermentedFlourPct, 3)],
     ['Component sum g', roundN(m.componentSumGrams, 2)], ['Mass conserved', m.conserved ? 'yes' : 'no']
    ].forEach(function (pair) { lines.push('| ' + pair[0] + ' | ' + pair[1] + ' |'); });
    lines.push('');
    var body = lines.join('\n');
    var contentDigest = FF.sha256(body);
    return body + '\n\nSHA-256: ' + stamped.digest +
      '\n\n<!-- fflab-payload:' + b64urlEncode(stamped.canonical) + ' fflab-content:' + contentDigest + ' -->\n';
  }

  // -- Export verification -------------------------------------------------------
  // JSON: structural recompute over the payload minus its sha256 stamp.
  // CSV/Markdown: the embedded canonical payload must hash to the stamped
  // digest, and the visible content text must hash to the stamped
  // content_sha256, so editing any displayed number is caught too.

  function verifyExport(text) {
    var FF = needF();
    if (typeof text !== 'string' || !text.length) {
      return { ok: false, format: 'unknown', detail: 'export is empty or not a string' };
    }
    var src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    var trimmed = src.replace(/^\s+/, '');
    if (trimmed.charAt(0) === '{') return verifyJSON(src, FF);
    if (src.indexOf('flavorforge-lab-audit') !== -1) return verifyCSV(src, FF);
    if (src.indexOf('fflab-payload:') !== -1) return verifyMarkdown(src, FF);
    return { ok: false, format: 'unknown', detail: 'no FlavorForge lab audit markers found' };
  }

  function verifyJSON(text, FF) {
    var doc;
    try { doc = JSON.parse(text); } catch (e) {
      return { ok: false, format: 'json', detail: 'unparseable JSON' };
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return { ok: false, format: 'json', detail: 'JSON root is not an object' };
    }
    if (doc.schema !== SCHEMA || doc.version !== VERSION) {
      return { ok: false, format: 'json', detail: 'schema or version mismatch' };
    }
    if (!hasOwn.call(doc, 'sha256') || typeof doc.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.sha256)) {
      return { ok: false, format: 'json', detail: 'missing or malformed sha256 stamp' };
    }
    // Rebuild the payload with defineProperty so a hostile __proto__ key in a
    // tampered document lands as data (and breaks the digest) instead of
    // mutating this object's prototype.
    var rest = {};
    Object.keys(doc).forEach(function (k) {
      if (k !== 'sha256') {
        Object.defineProperty(rest, k, { value: doc[k], enumerable: true, writable: true, configurable: true });
      }
    });
    var recomputed;
    try { recomputed = FF.sha256(canonicalize(rest)); } catch (e) {
      return { ok: false, format: 'json', detail: 'payload cannot be canonicalized: ' + e.message };
    }
    var ok = recomputed === doc.sha256;
    return {
      ok: ok, format: 'json', digest: doc.sha256, recomputed: recomputed,
      detail: ok ? 'payload digest matches the stamp' : 'payload was modified after stamping'
    };
  }

  function csvMeta(text) {
    var lines = String(text).split('\r\n');
    var meta = {};
    var keys = [];
    var metaLines = 0;
    while (metaLines < lines.length && lines[metaLines].indexOf('flavorforge-lab-audit,') === 0) {
      var parts = lines[metaLines].split(',');
      if (parts.length < 3) return { error: 'malformed provenance row' };
      var key = parts[1];
      if (hasOwn.call(meta, key)) return { error: 'duplicate provenance row' };
      meta[key] = parts.slice(2).join(',');
      keys.push(key);
      metaLines++;
    }
    return { meta: meta, keys: keys, dataText: lines.slice(metaLines).join('\r\n') };
  }

  function verifyCSV(text, FF) {
    var parsedMeta = csvMeta(text);
    if (parsedMeta.error) return { ok: false, format: 'csv', detail: parsedMeta.error };
    var meta = parsedMeta.meta;
    var expectedKeys = ['schema', 'version', 'sha256', 'payload', 'content_sha256'];
    if (parsedMeta.keys.length !== expectedKeys.length || !expectedKeys.every(function (key) { return parsedMeta.keys.indexOf(key) !== -1; })) {
      return { ok: false, format: 'csv', detail: 'provenance rows do not match the audit schema' };
    }
    if (meta.schema !== SCHEMA) return { ok: false, format: 'csv', detail: 'schema mismatch' };
    if (meta.version !== String(VERSION)) return { ok: false, format: 'csv', detail: 'version mismatch' };
    if (!/^[0-9a-f]{64}$/.test(meta.sha256 || '') || !/^[0-9a-f]{64}$/.test(meta.content_sha256 || '')) {
      return { ok: false, format: 'csv', detail: 'missing or malformed digest stamps' };
    }
    var payloadText;
    try {
      payloadText = utf8Decode(b64urlDecode(meta.payload || ''));
      var canonicalAgain = canonicalize(JSON.parse(payloadText));
      if (canonicalAgain !== payloadText) {
        return { ok: false, format: 'csv', digest: meta.sha256, detail: 'embedded payload is not canonical' };
      }
    } catch (e) {
      return { ok: false, format: 'csv', digest: meta.sha256, detail: 'embedded payload is unreadable' };
    }
    var payloadDigest = FF.sha256(payloadText);
    var contentDigest = FF.sha256(parsedMeta.dataText);
    var ok = payloadDigest === meta.sha256 && contentDigest === meta.content_sha256;
    return {
      ok: ok, format: 'csv', digest: meta.sha256, recomputed: payloadDigest, contentDigest: contentDigest,
      detail: ok ? 'payload and visible table both match their stamps'
        : (payloadDigest !== meta.sha256 ? 'payload stamp mismatch' : 'visible table content was modified after stamping')
    };
  }

  function verifyMarkdown(text, FF) {
    var metaMatch = /\n\nSHA-256: ([0-9a-f]{64})\n\n<!-- fflab-payload:([A-Za-z0-9_-]+) fflab-content:([0-9a-f]{64}) -->\n$/.exec(text);
    if (!metaMatch) {
      return { ok: false, format: 'markdown', detail: 'missing or nonterminal SHA-256 footer and payload comment' };
    }
    var stampedDigest = metaMatch[1], contentStamp = metaMatch[3];
    var payloadText;
    try {
      payloadText = utf8Decode(b64urlDecode(metaMatch[2]));
      if (canonicalize(JSON.parse(payloadText)) !== payloadText) {
        return { ok: false, format: 'markdown', digest: stampedDigest, detail: 'embedded payload is not canonical' };
      }
    } catch (e) {
      return { ok: false, format: 'markdown', digest: stampedDigest, detail: 'embedded payload is unreadable' };
    }
    var payloadDigest = FF.sha256(payloadText);
    var contentDigest = FF.sha256(text.slice(0, metaMatch.index));
    var ok = payloadDigest === stampedDigest && contentDigest === contentStamp;
    return {
      ok: ok, format: 'markdown', digest: stampedDigest, recomputed: payloadDigest, contentDigest: contentDigest,
      detail: ok ? 'payload and visible document both match their stamps'
        : (payloadDigest !== stampedDigest ? 'payload stamp mismatch' : 'visible document was modified after stamping')
    };
  }

  // Tamper demonstration: export, verify intact, flip one displayed digit,
  // verify again and confirm rejection.
  function tamperDemo(state) {
    var json = exportJSON(state);
    var intact = verifyExport(json);
    var tamperedText = json.replace(/"hyd": [\d.]+/, function (m) {
      return m.replace(/\d/, function (d) { return d === '9' ? '8' : String(Number(d) + 1); });
    });
    if (tamperedText === json) {
      tamperedText = json.slice(0, -2) + '0' + json.slice(-2);
    }
    var tampered = verifyExport(tamperedText);
    return { intact: intact, tampered: tampered, ok: intact.ok === true && tampered.ok === false };
  }

  // -- Deterministic in-page self-tests -------------------------------------------

  function selfTestList() {
    return [
      { name: 'sha256 empty-string known vector', run: function () {
        return needF().sha256('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      } },
      { name: 'sha256 "abc" known vector', run: function () {
        return needF().sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
      } },
      { name: 'sha256 56-byte multi-block known vector', run: function () {
        var FF = needF();
        return FF.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') ===
          '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1';
      } },
      { name: '150 C for 20 min gives X = 0.5 exactly (calibration)', run: function () {
        var FF = needF();
        var k = FF.maillardRate(150);
        return Math.abs((-Math.expm1(-k * 20)) - 0.5) < 1e-12;
      } },
      { name: 'low-slow profile lands 50% crossing at the 20 min boundary', run: function () {
        var rows = compareProfiles(STATE_DEFAULTS);
        var row = rows.filter(function (r) { return r.key === 'low-slow'; })[0];
        return Math.abs(row.conversionX - 0.5) < 1e-9 && Math.abs(row.timeTo50Min - 20) < 1e-9;
      } },
      { name: 'fermentation V(0) = 1', run: function () {
        return Math.abs(needF().doughVolume(0, 28) - 1) < 1e-12;
      } },
      { name: 'fermentation V(dt) = 2', run: function () {
        var FF = needF();
        return Math.abs(FF.doughVolume(FF.doublingTime(28), 28) - 2) < 1e-9;
      } },
      { name: 'fermentation V(2dt) = 3', run: function () {
        var FF = needF();
        return Math.abs(FF.doughVolume(2 * FF.doublingTime(28), 28) - 3) < 1e-9;
      } },
      { name: 'espresso bisection forward/inverse residual < 1e-6', run: function () {
        var FF = needF();
        var g = FF.solveGrindForYield(20.3);
        return Math.abs(FF.extractionYield(g) - 20.3) < 1e-6;
      } },
      { name: 'baker mass conservation rollup', run: function () {
        var m = massRollup(STATE_DEFAULTS);
        return m.conserved === true && Math.abs(m.totalWeightGrams - 1920) < 1e-9;
      } },
      { name: 'CSV formula escaping guards =CMD() payloads', run: function () {
        var FF = needF();
        var cell = FF.csvEscape('=CMD()');
        return cell.charAt(0) === "'" && FF.csvEscape('  =1+1').charAt(0) === "'";
      } },
      { name: 'digest parity across on-page, JSON, CSV, Markdown', run: function () {
        var st = STATE_DEFAULTS;
        var stamped = stampedReport(st);
        var json = JSON.parse(exportJSON(st));
        if (json.sha256 !== stamped.digest) return false;
        var csvMetaLine = exportCSV(st).split('\r\n').filter(function (l) {
          return l.indexOf('flavorforge-lab-audit,sha256,') === 0;
        })[0];
        if (!csvMetaLine || csvMetaLine.split(',')[2] !== stamped.digest) return false;
        var md = /SHA-256: ([0-9a-f]{64})/.exec(exportMarkdown(st));
        return !!md && md[1] === stamped.digest;
      } },
      { name: 'tamper demo rejects a modified export', run: function () {
        return tamperDemo(STATE_DEFAULTS).ok === true;
      } },
      { name: '#ff= bookmark round-trips all six fields', run: function () {
        var st = { profile: 'steam-deck', EaKj: 150, starch: 'rice', hyd: 82.5, fermT: 33, yieldT: 21.25 };
        var back = decodeHash(encodeHash(st));
        return !!back && back.profile === st.profile && back.EaKj === st.EaKj &&
          back.starch === st.starch && back.hyd === st.hyd && back.fermT === st.fermT &&
          back.yieldT === st.yieldT;
      } },
      { name: '#ff= decode rejects a __proto__ key', run: function () {
        var hostile = b64urlEncode('{"v":1,"__proto__":{"x":1},"profile":"sear","EaKj":100,"starch":"wheat","hyd":70,"fermT":28,"yieldT":20}');
        return decodeHash('#ff=' + hostile) === null;
      } },
      { name: '#ff= decode rejects malformed base64 and JSON', run: function () {
        return decodeHash('#ff=@@@!!!') === null && decodeHash('#ff=' + b64urlEncode('{oops')) === null;
      } },
      { name: 'canonicalize sorts object keys deterministically', run: function () {
        return canonicalize({ b: 1, a: 2 }) === canonicalize({ a: 2, b: 1 });
      } },
      { name: 'all five profiles return finite comparison rows', run: function () {
        return compareProfiles(STATE_DEFAULTS).every(function (r) {
          return isFiniteNumber(r.totalDose) && isFiniteNumber(r.conversionX) &&
            isFiniteNumber(r.effectiveQ10) && isFiniteNumber(r.yeastMarginC);
        });
      } }
    ];
  }

  function runSelfTests() {
    var results = selfTestList().map(function (t) {
      var ok = false, detail = '';
      try {
        ok = t.run() === true;
        if (!ok) detail = 'assertion returned false';
      } catch (e) {
        detail = e && e.message ? e.message : String(e);
      }
      return { name: t.name, ok: ok, detail: detail };
    });
    var passed = results.filter(function (r) { return r.ok; }).length;
    return { total: results.length, passed: passed, results: results, allPassed: passed === results.length };
  }

  // -- public API ---------------------------------------------------------------

  return {
    SCHEMA: SCHEMA,
    VERSION: VERSION,
    YEAST_KILL_C: YEAST_KILL_C,
    DISCLOSURE: DISCLOSURE,
    THERMAL_PROFILES: THERMAL_PROFILES,
    HYDRATION_GRID: HYDRATION_GRID,
    STATE_DEFAULTS: STATE_DEFAULTS,
    BOOKMARK_FIELDS: BOOKMARK_FIELDS,
    HASH_PREFIX: HASH_PREFIX,
    profileByKey: profileByKey,
    normalizeState: normalizeState,
    bookmarkState: bookmarkState,
    maillardOpts: maillardOpts,
    doseAt: doseAt,
    conversionCurve: conversionCurve,
    unionChartTimes: unionChartTimes,
    doseWeightedTempC: doseWeightedTempC,
    compareProfiles: compareProfiles,
    sensitivitySurface: sensitivitySurface,
    massRollup: massRollup,
    buildReport: buildReport,
    canonicalize: canonicalize,
    stampedReport: stampedReport,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    encodeHash: encodeHash,
    decodeHash: decodeHash,
    labDataRows: labDataRows,
    exportJSON: exportJSON,
    exportCSV: exportCSV,
    exportMarkdown: exportMarkdown,
    verifyExport: verifyExport,
    tamperDemo: tamperDemo,
    selfTestList: selfTestList,
    runSelfTests: runSelfTests
  };
});
