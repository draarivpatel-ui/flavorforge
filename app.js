/*
 * FlavorForge UI controller and SVG scientific plot renderer.
 * Connects kinetics.js to the six-tab culinary laboratory notebook.
 */
(function () {
  'use strict';

  var F = window.FlavorForge;
  var C = F.constants;

  // ---- state -------------------------------------------------------------
  var recipe = F.createRecipe();
  var view = {
    surfaceTempC: 180,
    fermentTempC: 28,
    EaKj: 100,
    starchProfile: 'tapioca'
  };
  var invalidFields = new Set();
  var scheduleStages = F.BROWNING_PRESETS[0].stages.map(function (stage) { return Object.assign({}, stage); });
  var scheduleValid = true;
  var pinned = null;

  // The Process & Sensitivity Lab is optional: if process-lab.js failed to
  // load, its tab and panel hide and every lab hook stays inert.
  var LAB = window.FlavorForgeLab || null;
  var labProfileKey = LAB ? LAB.STATE_DEFAULTS.profile : 'steady-180';
  var LAB_COLORS = ['--s1', '--s2', '--s3', '--s4', '--muted'];
  var LAB_SHORT = ['180', '140/200', '230/190', '150', '220'];

  // ---- small helpers -----------------------------------------------------
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) {
    if (!isFinite(n)) { return '-'; }
    var dec = (typeof d === 'number') ? d : 1;
    return Number(n).toFixed(dec);
  }
  function fmtDuration(min) {
    if (!isFinite(min)) { return '-'; }
    if (min < 600) { return fmt(min, 1) + ' min'; }
    var hours = min / 60;
    if (hours < 72) { return fmt(hours, 1) + ' h'; }
    var days = hours / 24;
    if (days < 400) { return fmt(days, 1) + ' d'; }
    var years = days / 365.25;
    if (years < 10000) { return fmt(years, 1) + ' y'; }
    return years.toExponential(2) + ' y';
  }
  function fmtTick(n) {
    if (Math.abs(n) >= 1e9) { return n.toExponential(1); }
    if (Math.abs(n) >= 1e6) { return (n / 1e6) + 'M'; }
    if (Math.abs(n) >= 1000) { return (n / 1000) + 'k'; }
    if (Number.isInteger(n)) { return String(n); }
    if (Math.abs(n) >= 1) { return n.toFixed(1); }
    return String(Math.round(n * 100) / 100);
  }
  function clampNum(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function niceStep(range, target) {
    var raw = range / target;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step;
    if (norm <= 1) { step = 1; }
    else if (norm <= 2) { step = 2; }
    else if (norm <= 2.5) { step = 2.5; }
    else if (norm <= 5) { step = 5; }
    else { step = 10; }
    return step * mag;
  }

  function ticks(min, max, target) {
    var step = niceStep(max - min, target || 5);
    var out = [];
    var start = Math.ceil(min / step) * step;
    for (var v = start; v <= max + step * 0.001; v += step) {
      if (v >= min - step * 0.001) { out.push(Math.round(v * 1e6) / 1e6); }
    }
    return out;
  }

  // ---- line chart --------------------------------------------------------
  var VW = 760, VH = 360;
  var ML = 64, MR = 104, MT = 24, MB = 52;
  var PW = VW - ML - MR, PH = VH - MT - MB;

  var chartStore = {};

  function buildLineChart(cfg) {
    var ink = cssVar('--ink'), ink2 = cssVar('--ink-2'),
      grid = cssVar('--grid'), axis = cssVar('--rule-heavy'),
      surface = cssVar('--surface');
    var xMin = cfg.xMin, xMax = cfg.xMax, yMin = cfg.yMin, yMax = cfg.yMax;

    function sx(v) { return ML + (v - xMin) / (xMax - xMin) * PW; }
    function sy(v) { return MT + (1 - (v - yMin) / (yMax - yMin)) * PH; }

    var s = [];
    s.push('<svg viewBox="0 0 ' + VW + ' ' + VH + '" class="ff-chart" role="img" aria-label="' + esc(cfg.ariaLabel || cfg.yLabel + ' vs ' + cfg.xLabel) + '">');
    s.push('<rect x="0" y="0" width="' + VW + '" height="' + VH + '" fill="' + surface + '"/>');

    // horizontal gridlines + y ticks
    ticks(yMin, yMax, 5).forEach(function (t) {
      var y = sy(t);
      s.push('<line x1="' + ML + '" y1="' + y.toFixed(1) + '" x2="' + (ML + PW) + '" y2="' + y.toFixed(1) + '" stroke="' + grid + '" stroke-width="1"/>');
      s.push('<text x="' + (ML - 10) + '" y="' + y.toFixed(1) + '" text-anchor="end" dominant-baseline="middle" class="ff-tick">' + fmtTick(t) + '</text>');
    });

    // vertical gridlines + x ticks
    ticks(xMin, xMax, 6).forEach(function (t) {
      var x = sx(t);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + MT + '" x2="' + x.toFixed(1) + '" y2="' + (MT + PH) + '" stroke="' + grid + '" stroke-width="1"/>');
      s.push('<text x="' + x.toFixed(1) + '" y="' + (MT + PH + 19) + '" text-anchor="middle" class="ff-tick">' + fmtTick(t) + '</text>');
    });

    // shaded regions (behind the lines)
    (cfg.regions || []).forEach(function (r) {
      var x0 = sx(clampNum(r.x0, xMin, xMax)), x1 = sx(clampNum(r.x1, xMin, xMax));
      var y0 = sy(clampNum(r.y1, yMin, yMax)), y1 = sy(clampNum(r.y0, yMin, yMax));
      s.push('<rect x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + (x1 - x0).toFixed(1) + '" height="' + (y1 - y0).toFixed(1) + '" fill="' + r.color + '" fill-opacity="' + (r.opacity || 0.11) + '"/>');
      if (r.label) {
        s.push('<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (y0 + 16) + '" text-anchor="middle" class="ff-region-label">' + esc(r.label) + '</text>');
      }
    });

    // axes
    s.push('<line x1="' + ML + '" y1="' + MT + '" x2="' + ML + '" y2="' + (MT + PH) + '" stroke="' + axis + '" stroke-width="1.4"/>');
    s.push('<line x1="' + ML + '" y1="' + (MT + PH) + '" x2="' + (ML + PW) + '" y2="' + (MT + PH) + '" stroke="' + axis + '" stroke-width="1.4"/>');

    // series paths
    cfg.series.forEach(function (ser) {
      var d = '';
      ser.values.forEach(function (v, i) {
        var px = sx(cfg.xValues[i]).toFixed(1);
        var py = sy(v).toFixed(1);
        d += (i === 0 ? 'M' : 'L') + px + ' ' + py + ' ';
      });
      s.push('<path d="' + d.trim() + '" fill="none" stroke="' + ser.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"' + (ser.dash ? ' stroke-dasharray="' + ser.dash + '"' : '') + '/>');
    });

    // markers with a surface ring
    (cfg.markers || []).forEach(function (m) {
      var x = sx(m.x), y = sy(m.y);
      s.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5" fill="' + m.color + '" stroke="' + surface + '" stroke-width="2"/>');
      if (m.label) {
        var dx = m.dir === 'left' ? -10 : 10, anchor = m.dir === 'left' ? 'end' : 'start';
        s.push('<text x="' + (x + dx).toFixed(1) + '" y="' + (y - 9) + '" text-anchor="' + anchor + '" class="ff-mark-label">' + esc(m.label) + '</text>');
      }
    });

    // selective end labels
    (cfg.endLabels || []).forEach(function (e) {
      var ser = cfg.series[e.index];
      var x = sx(cfg.xValues[cfg.xValues.length - 1]);
      var y = sy(ser.values[ser.values.length - 1]);
      s.push('<text x="' + (x + 8).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="start" class="ff-end-label">' + esc(e.text) + '</text>');
    });

    // axis titles
    s.push('<text x="' + (ML + PW / 2) + '" y="' + (VH - 7) + '" text-anchor="middle" class="ff-axis-title">' + esc(cfg.xLabel) + '</text>');
    s.push('<text transform="translate(15 ' + (MT + PH / 2) + ') rotate(-90)" text-anchor="middle" class="ff-axis-title">' + esc(cfg.yLabel) + '</text>');

    // crosshair + hover overlay
    s.push('<line class="ff-crosshair" x1="0" y1="' + MT + '" x2="0" y2="' + (MT + PH) + '" stroke="' + ink + '" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>');
    s.push('<rect class="ff-hover" x="' + ML + '" y="' + MT + '" width="' + PW + '" height="' + PH + '" fill="transparent"/>');
    s.push('</svg>');

    chartStore[cfg.id] = {
      xValues: cfg.xValues, xMin: xMin, xMax: xMax, sx: sx,
      series: cfg.series, xLabel: cfg.xLabel, yLabel: cfg.yLabel
    };

    var stepN = cfg.tableSample || Math.max(1, Math.ceil(cfg.xValues.length / 10));
    var cols = [{ label: cfg.xLabel, key: 'x' }].concat(cfg.series.map(function (ser) {
      return { label: ser.name, key: ser.name };
    }));
    var rows = [];
    for (var i = 0; i < cfg.xValues.length; i += stepN) {
      var row = { x: fmtTick(Math.round(cfg.xValues[i] * 100) / 100) };
      cfg.series.forEach(function (ser) { row[ser.name] = fmt(ser.values[i], 3); });
      rows.push(row);
    }
    return { svg: s.join(''), table: buildTable(cols, rows) };
  }

  function buildTable(cols, rows) {
    var h = '<table class="data-table"><thead><tr>';
    cols.forEach(function (c) { h += '<th scope="col">' + esc(c.label) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>';
      cols.forEach(function (c) { h += '<td>' + esc(r[c.key]) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function attachHover(containerId) {
    var el = document.getElementById(containerId);
    if (!el) { return; }
    var svg = el.querySelector('svg');
    var overlay = el.querySelector('.ff-hover');
    var cross = el.querySelector('.ff-crosshair');
    if (!svg || !overlay) { return; }
    var data = chartStore[containerId];
    var tip = document.getElementById('chart-tooltip');

    overlay.addEventListener('pointermove', function (ev) {
      var rect = svg.getBoundingClientRect();
      var vbX = (ev.clientX - rect.left) * VW / rect.width;
      var xVal = data.xMin + (vbX - ML) / PW * (data.xMax - data.xMin);
      var best = 0, bd = Infinity;
      for (var i = 0; i < data.xValues.length; i++) {
        var d = Math.abs(data.xValues[i] - xVal);
        if (d < bd) { bd = d; best = i; }
      }
      var px = data.sx(data.xValues[best]);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      cross.setAttribute('visibility', 'visible');
      var html = '<strong>' + esc(data.xLabel) + ': ' + fmtTick(Math.round(data.xValues[best] * 100) / 100) + '</strong>';
      data.series.forEach(function (ser) {
        html += '<div class="tt-row"><span class="tt-swatch" style="background:' + ser.color + '"></span>' +
          esc(ser.name) + ': <b>' + fmt(ser.values[best], 3) + '</b></div>';
      });
      tip.innerHTML = html;
      tip.hidden = false;
      var tipW = tip.offsetWidth || 240;
      var maxLeft = (window.scrollX || 0) + (window.innerWidth || document.documentElement.clientWidth || 10000) - tipW - 10;
      tip.style.left = Math.max(0, Math.min(ev.pageX + 14, maxLeft)) + 'px';
      tip.style.top = (ev.pageY + 12) + 'px';
    });
    overlay.addEventListener('pointerleave', function () {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    });
  }

  function setChart(containerId, cfg) {
    var result = buildLineChart(cfg);
    document.getElementById(containerId).innerHTML = result.svg;
    var tableId = containerId.replace('chart-', 'table-');
    var t = document.getElementById(tableId);
    if (t) { t.innerHTML = result.table; }
    attachHover(containerId);
  }

  function setLegend(id, series) {
    var el = document.getElementById(id);
    if (!el) { return; }
    el.innerHTML = series.map(function (s) {
      return '<span class="legend-item"><span class="legend-key" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>';
    }).join('');
  }

  // ---- phase diagrams (region maps) -------------------------------------
  function phaseFrame(opts) {
    var axis = cssVar('--rule-heavy'),
      grid = cssVar('--grid'), surface = cssVar('--surface');
    var W = 560, H = 370, L = 62, R = 22, T = 24, B = 50;
    var pw = W - L - R, ph = H - T - B;
    var xMin = opts.xMin, xMax = opts.xMax, yMin = opts.yMin, yMax = opts.yMax;
    function sx(v) { return L + (v - xMin) / (xMax - xMin) * pw; }
    function sy(v) { return T + (1 - (v - yMin) / (yMax - yMin)) * ph; }
    var s = [];
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" class="ff-phase" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(opts.ariaLabel || opts.title) + '">');
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + surface + '"/>');
    s.push('<text x="' + L + '" y="' + (T - 7) + '" class="ff-phase-title">' + esc(opts.title) + '</text>');

    opts.regions.forEach(function (r) {
      var pts = r.poly.map(function (p) { return sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1); }).join(' ');
      s.push('<polygon points="' + pts + '" fill="' + r.color + '" fill-opacity="' + (r.opacity || 0.14) + '"/>');
    });

    ticks(yMin, yMax, 5).forEach(function (t) {
      var y = sy(t);
      s.push('<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (L + pw) + '" y2="' + y.toFixed(1) + '" stroke="' + grid + '" stroke-width="1"/>');
      s.push('<text x="' + (L - 8) + '" y="' + y.toFixed(1) + '" text-anchor="end" dominant-baseline="middle" class="ff-tick">' + fmtTick(t) + '</text>');
    });
    ticks(xMin, xMax, 6).forEach(function (t) {
      var x = sx(t);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + T + '" x2="' + x.toFixed(1) + '" y2="' + (T + ph) + '" stroke="' + grid + '" stroke-width="1"/>');
      s.push('<text x="' + x.toFixed(1) + '" y="' + (T + ph + 18) + '" text-anchor="middle" class="ff-tick">' + fmtTick(t) + '</text>');
    });

    (opts.lines || []).forEach(function (ln) {
      var d = ln.pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join(' ');
      s.push('<path d="' + d + '" fill="none" stroke="' + ln.color + '" stroke-width="2" stroke-dasharray="' + (ln.dash || '0') + '"/>');
    });

    (opts.labels || []).forEach(function (lb) {
      s.push('<text x="' + sx(lb.x).toFixed(1) + '" y="' + sy(lb.y).toFixed(1) + '" text-anchor="middle" class="ff-region-label strong">' + esc(lb.text) + '</text>');
    });

    (opts.markers || []).forEach(function (m) {
      s.push('<circle cx="' + sx(m.x).toFixed(1) + '" cy="' + sy(m.y).toFixed(1) + '" r="5.5" fill="' + m.color + '" stroke="' + surface + '" stroke-width="2"/>');
      if (m.text) {
        s.push('<text x="' + (sx(m.x) + 9).toFixed(1) + '" y="' + (sy(m.y) - 8).toFixed(1) + '" class="ff-mark-label">' + esc(m.text) + '</text>');
      }
    });

    s.push('<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ph) + '" stroke="' + axis + '" stroke-width="1.4"/>');
    s.push('<line x1="' + L + '" y1="' + (T + ph) + '" x2="' + (L + pw) + '" y2="' + (T + ph) + '" stroke="' + axis + '" stroke-width="1.4"/>');
    s.push('<text x="' + (L + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="ff-axis-title">' + esc(opts.xLabel) + '</text>');
    s.push('<text transform="translate(15 ' + (T + ph / 2) + ') rotate(-90)" text-anchor="middle" class="ff-axis-title">' + esc(opts.yLabel) + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  function browningPhaseSVG() {
    var s2 = cssVar('--s2'), s1 = cssVar('--s1');
    var xMin = 0, xMax = 100, yMin = 100, yMax = 240;
    function onset(h) { return F.browningOnsetTemp(h); }
    function scorch(h) { return Math.min(yMax, onset(h) + 70); }
    var pale = [[xMin, yMin], [xMax, yMin], [xMax, onset(xMax)], [xMin, onset(xMin)]];
    var mill = [[xMin, onset(xMin)], [xMax, onset(xMax)], [xMax, scorch(xMax)], [xMin, scorch(xMin)]];
    var burn = [[xMin, scorch(xMin)], [xMax, scorch(xMax)], [xMax, yMax], [xMin, yMax]];
    var opts = {
      title: 'Maillard browning regimes vs surface moisture',
      xLabel: 'Dough hydration (% of flour mass)', yLabel: 'Surface temperature (deg C)',
      xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax,
      ariaLabel: 'Maillard browning phase map: surface temperature versus hydration with evaporative steaming, Maillard browning, and pyrolysis regions',
      regions: [
        { poly: pale, color: cssVar('--muted'), opacity: 0.10 },
        { poly: mill, color: s2, opacity: 0.16 },
        { poly: burn, color: s1, opacity: 0.16 }
      ],
      lines: [
        { pts: [[xMin, onset(xMin)], [xMax, onset(xMax)]], color: cssVar('--ink-2'), dash: '5 4' },
        { pts: [[xMin, scorch(xMin)], [xMax, scorch(xMax)]], color: s1, dash: '5 4' }
      ],
      labels: [
        { x: 32, y: 118, text: 'Evaporative steaming (< onset)' },
        { x: 50, y: onset(50) + 30, text: 'Active Maillard browning' },
        { x: 50, y: Math.min(232, scorch(50) + 14), text: 'Pyrolysis and scorching' }
      ],
      markers: [{ x: recipe.hydrationPct, y: clampNum(view.surfaceTempC, yMin, yMax), color: s1, text: 'lab set point' }]
    };
    return phaseFrame(opts);
  }

  function gelPhaseSVG() {
    var p = F.STARCH_PROFILES[view.starchProfile] || F.STARCH_PROFILES.tapioca;
    var s2 = cssVar('--s2'), s1 = cssVar('--s1');
    var xMin = 0, xMax = 100, yMin = 40, yMax = 100;
    function tm(h) { return F.gelatinizationMidpoint(h, p); }
    function top(h) { return Math.min(yMax, tm(h) + 9); }
    function bot(h) { return Math.max(yMin, tm(h) - 9); }
    var raw = [[xMin, yMin], [xMax, yMin], [xMax, bot(xMax)], [xMin, bot(xMin)]];
    var band = [[xMin, bot(xMin)], [xMax, bot(xMax)], [xMax, top(xMax)], [xMin, top(xMin)]];
    var done = [[xMin, top(xMin)], [xMax, top(xMax)], [xMax, yMax], [xMin, yMax]];
    return phaseFrame({
      title: p.label + ' crystallinity phase map',
      xLabel: 'Water hydration (% of dry starch)', yLabel: 'Core temperature (deg C)',
      xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax,
      ariaLabel: 'Starch gelatinization phase map: temperature versus hydration with native crystalline, swelling transition, and fully gelatinized regions',
      regions: [
        { poly: raw, color: cssVar('--muted'), opacity: 0.10 },
        { poly: band, color: s1, opacity: 0.15 },
        { poly: done, color: s2, opacity: 0.16 }
      ],
      lines: [{ pts: [[xMin, tm(xMin)], [xMax, tm(xMax)]], color: cssVar('--ink'), dash: '5 4' }],
      labels: [
        { x: 28, y: 48, text: 'Native birefringent granules' },
        { x: 50, y: tm(50), text: 'Gelatinization transition (Tm)' },
        { x: 50, y: 94, text: 'Amorphous swollen gel' }
      ],
      markers: [{ x: recipe.hydrationPct, y: clampNum(view.fermentTempC, yMin, yMax), color: s1, text: 'dough set point' }]
    });
  }

  function espPhaseSVG() {
    var o = C.ESPRESSO_DEFAULT;
    var s1 = cssVar('--s1'), s2 = cssVar('--s2'), s3 = cssVar('--s3');
    var xMin = o.gmin, xMax = o.gmax, yMin = 14, yMax = 24;
    var curve = [];
    for (var g = xMin; g <= xMax; g += 20) { curve.push([g, F.extractionYield(g, o)]); }
    return phaseFrame({
      title: 'Espresso solubles extraction compass',
      xLabel: 'Median burr grind size (microns)', yLabel: 'Solubles extraction yield (%)',
      xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax,
      ariaLabel: 'Espresso extraction compass: grind size versus extraction yield with under-extracted, balanced 18 to 22 percent, and over-extracted zones',
      regions: [
        { poly: [[xMin, 18], [xMax, 18], [xMax, 22], [xMin, 22]], color: s2, opacity: 0.18 },
        { poly: [[xMin, 22], [xMax, 22], [xMax, 24], [xMin, 24]], color: s1, opacity: 0.12 }
      ],
      lines: [
        { pts: [[xMin, 18], [xMax, 18]], color: s2, dash: '5 4' },
        { pts: [[xMin, 22], [xMax, 22]], color: s1, dash: '5 4' },
        { pts: curve, color: s3, dash: '0' }
      ],
      labels: [
        { x: 1120, y: 16.2, text: 'Under-extracted (< 18%)' },
        { x: 1120, y: 20.0, text: 'Balanced sweet window (18 to 22%)' },
        { x: 1120, y: 23.1, text: 'Astringent / over-extracted (> 22%)' }
      ],
      markers: [{ x: recipe.grindMicrons, y: clampNum(F.extractionYield(recipe.grindMicrons, o), yMin, yMax), color: s1, text: 'active grind' }]
    });
  }

  // ---- derived values ----------------------------------------------------
  function computeDerived() {
    var o = C.MAILLARD_DEFAULT;
    var maillard = { A: o.A, Ea: view.EaKj * 1000, refC: o.refC };
    var rel = F.relativeBrowning(view.surfaceTempC, maillard);
    var k = F.maillardRate(view.surfaceTempC, maillard);
    var onset = F.browningOnsetTemp(recipe.hydrationPct);
    var p = F.STARCH_PROFILES[view.starchProfile] || F.STARCH_PROFILES.tapioca;
    var tm = F.gelatinizationMidpoint(recipe.hydrationPct, p);
    var t90 = tm + Math.log(9) / p.steepness;
    var doubling = F.doublingTime(view.fermentTempC);
    var yieldPct = F.extractionYield(recipe.grindMicrons);
    var ewin = F.extractionWindow(yieldPct);
    var solved = null;
    try { solved = F.solveGrindForYield(recipe.targetYieldPct); } catch (e) { solved = null; }
    var scaled = F.analyzeDoughRecipe(recipe);
    return {
      maillard: maillard, rel: rel, k: k, onset: onset, q10v: F.q10(maillard.Ea, view.surfaceTempC),
      halfLife: F.halfLife(k), p: p, tm: tm, t90: t90, doubling: doubling,
      fermentRel: F.fermentationRelative(view.fermentTempC),
      yieldPct: yieldPct, ewin: ewin, solved: solved, scaled: scaled
    };
  }

  // ---- render ------------------------------------------------------------
  var rafPending = false;
  function scheduleRender() {
    if (rafPending) { return; }
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; render(); });
  }

  function tile(name, value) {
    document.querySelectorAll('[data-tile="' + name + '"]').forEach(function (el) {
      el.textContent = value;
    });
  }

  function render() {
    var d = computeDerived();
    var s1 = cssVar('--s1'), s2 = cssVar('--s2'), s3 = cssVar('--s3');

    // ----- stat tiles: reaction lab
    var ghostInk = cssVar('--ink-2');
    tile('relativeBrowning', fmt(d.rel, 2) + 'x');
    var relNote = d.rel >= 1 ? 'faster than 150 C baseline' : 'slower than 150 C baseline';
    if (pinned) {
      var pinMail = { A: C.MAILLARD_DEFAULT.A, Ea: pinned.EaKj * 1000, refC: C.MAILLARD_DEFAULT.refC };
      relNote += '; pinned ' + fmt(F.relativeBrowning(pinned.surfaceTempC, pinMail), 2) + 'x at ' + pinned.surfaceTempC + ' C';
    }
    tile('relativeBrowningNote', relNote);
    tile('q10', fmt(d.q10v, 2) + 'x');
    tile('onset', fmt(d.onset, 0) + ' C');
    tile('onsetNote', view.surfaceTempC >= d.onset ? 'above evaporative threshold' : 'pinned by surface moisture');
    tile('halfLife', fmtDuration(d.halfLife));

    // ----- stat tiles: dough
    tile('tm', fmt(d.tm, 1) + ' C');
    tile('tmProfile', d.p.label);
    tile('doubling', fmtDuration(d.doubling));
    tile('doublingNote', view.fermentTempC > 46 ? 'thermal yeast denaturation' : 'active metabolic fermentation');
    tile('fermentRel', fmt(d.fermentRel, 2) + 'x');
    tile('t90', fmt(d.t90, 1) + ' C');

    // ----- stat tiles: espresso
    tile('yield', fmt(d.yieldPct, 1) + '%');
    tile('yieldWindow', d.ewin.label);
    tile('yieldNote', d.ewin.note);
    tile('solvedGrind', d.solved === null ? 'outside domain' : fmt(d.solved, 0) + ' um');
    tile('effectiveHydration', fmt(d.scaled.effectiveHydrationPct, 2) + '%');
    tile('prefermentedFlour', fmt(d.scaled.prefermentedFlourPct, 2) + '%');
    document.getElementById('apply-grind').disabled = d.solved === null || invalidFields.size > 0;
    document.getElementById('solver-status').textContent = d.solved === null
      ? 'Reachable yield: ' + fmt(F.extractionYield(C.ESPRESSO_DEFAULT.gmax), 2) + ' to ' + fmt(F.extractionYield(C.ESPRESSO_DEFAULT.gmin), 2) + '%. Adjust the target.'
      : 'Solved yield: ' + fmt(F.extractionYield(d.solved), 3) + '%. Slider uses the nearest whole micron.';

    // ----- chart: browning
    var btemps = [], brels = [];
    for (var t = 100; t <= 240; t += 2) { btemps.push(t); brels.push(F.relativeBrowning(t, d.maillard)); }
    var bMax = Math.max(2, Math.ceil(brels[brels.length - 1]));
    var labSeries = [{ name: 'Relative rate', color: s1, values: brels }];
    var labMarkers = [
      { x: view.surfaceTempC, y: clampNum(d.rel, 0, bMax), color: s1, label: 'set point ' + view.surfaceTempC + ' C', dir: (view.surfaceTempC > 200 ? 'left' : 'right') },
      { x: d.onset, y: 0.1, color: s2, label: 'onset ' + fmt(d.onset, 0) + ' C', dir: 'right' }
    ];
    if (pinned) {
      var pinBrels = btemps.map(function (tt) { return F.relativeBrowning(tt, pinMail); });
      bMax = Math.max(bMax, Math.ceil(pinBrels[pinBrels.length - 1]));
      labSeries.push({ name: 'Pinned reference', color: ghostInk, dash: '4 4', values: pinBrels });
      labMarkers.push({ x: pinned.surfaceTempC, y: clampNum(F.relativeBrowning(pinned.surfaceTempC, pinMail), 0, bMax), color: ghostInk, label: 'pinned ' + pinned.surfaceTempC + ' C', dir: (pinned.surfaceTempC > 200 ? 'left' : 'right') });
    }
    setChart('chart-lab', {
      id: 'chart-lab', xValues: btemps, xMin: 100, xMax: 240, yMin: 0, yMax: bMax,
      xLabel: 'Surface temperature (deg C)', yLabel: 'Relative Maillard rate (150 C = 1x)',
      ariaLabel: 'Relative Maillard browning rate versus surface temperature',
      series: labSeries,
      regions: [{ x0: 100, x1: 240, y0: 0, y1: 1, color: s2, opacity: 0.08 }],
      markers: labMarkers,
      endLabels: [{ index: 0, text: fmt(brels[brels.length - 1], 1) + 'x' }],
      tableSample: 7
    });

    // ----- chart: gelatinization
    var gtemp = [], gelSeries = [];
    var profKeys = ['tapioca', 'wheat', 'potato', 'rice'];
    var profColors = [s1, s2, s3, cssVar('--s4')];
    var profDashes = ['', '6 3', '2 3', '8 3 2 3'];
    for (var gt = 40; gt <= 100; gt += 1) { gtemp.push(gt); }
    profKeys.forEach(function (key, idx) {
      var prof = F.STARCH_PROFILES[key];
      gelSeries.push({
        name: prof.label.split(' / ')[0], color: profColors[idx], dash: profDashes[idx],
        values: gtemp.map(function (tt) { return F.gelatinizationDegree(tt, recipe.hydrationPct, prof); })
      });
    });
    if (pinned) {
      var pinProf = F.STARCH_PROFILES[pinned.starchProfile] || d.p;
      gelSeries.push({
        name: pinProf.label.split(' / ')[0] + ' pinned', color: ghostInk, dash: '4 4',
        values: gtemp.map(function (tt) { return F.gelatinizationDegree(tt, pinned.hydrationPct, pinProf); })
      });
    }
    setLegend('legend-gel', gelSeries);
    setChart('chart-gel', {
      id: 'chart-gel', xValues: gtemp, xMin: 40, xMax: 100, yMin: 0, yMax: 1,
      xLabel: 'Core temperature (deg C)', yLabel: 'Gelatinized fraction alpha (0 to 1)',
      ariaLabel: 'Degree of starch gelatinization versus temperature for tapioca, wheat, potato, and rice starch',
      series: gelSeries,
      markers: [{ x: d.tm, y: 0.5, color: cssVar('--ink'), label: 'Tm ' + fmt(d.tm, 1) + ' C' }],
      tableSample: 6
    });

    // ----- chart: dough rise
    var rtimes = [], rvals = [];
    var pinDoubling = pinned ? F.doublingTime(pinned.fermentTempC) : 0;
    var rMax = Math.max(240, d.doubling * 4, pinDoubling * 4);
    for (var ri = 0; ri <= 80; ri++) { var rt = rMax * ri / 80; rtimes.push(rt); rvals.push(F.doughVolume(rt, view.fermentTempC)); }
    var riseSeries = [{ name: 'Relative dough volume', color: s2, values: rvals }];
    var riseMarkers = [{ x: d.doubling, y: 2, color: s1, label: '2x at ' + fmtDuration(d.doubling), dir: 'right' }];
    if (pinned) {
      riseSeries.push({ name: 'Pinned reference', color: ghostInk, dash: '4 4', values: rtimes.map(function (tt) { return F.doughVolume(tt, pinned.fermentTempC); }) });
      riseMarkers.push({ x: pinDoubling, y: 2, color: ghostInk, label: 'pinned 2x at ' + fmtDuration(pinDoubling), dir: 'left' });
    }
    setChart('chart-rise', {
      id: 'chart-rise', xValues: rtimes, xMin: 0, xMax: rMax, yMin: 1, yMax: 4,
      xLabel: 'Proofing time (minutes)', yLabel: 'Volume relative to initial dough',
      ariaLabel: 'Relative dough volume rise versus time at the chosen fermentation temperature',
      series: riseSeries,
      markers: riseMarkers,
      endLabels: [{ index: 0, text: 'toward 4x' }],
      tableSample: 8
    });

    // ----- chart: extraction
    var o = C.ESPRESSO_DEFAULT;
    var egrinds = [], eys = [];
    for (var g = o.gmin; g <= o.gmax; g += 20) { egrinds.push(g); eys.push(F.extractionYield(g, o)); }
    setChart('chart-esp', {
      id: 'chart-esp', xValues: egrinds, xMin: o.gmin, xMax: o.gmax, yMin: 14, yMax: 24,
      xLabel: 'Median burr particle size (microns)', yLabel: 'Solubles extraction yield (%)',
      ariaLabel: 'Espresso extraction yield versus grind size with the balanced 18 to 22 percent window shaded',
      series: [{ name: 'Extraction yield', color: s3, values: eys }],
      regions: [{ x0: o.gmin, x1: o.gmax, y0: 18, y1: 22, color: s2, opacity: 0.14, label: 'Balanced extraction window (18 to 22%)' }],
      markers: [{ x: recipe.grindMicrons, y: clampNum(d.yieldPct, 14, 24), color: s1, label: fmt(d.yieldPct, 1) + '% at ' + recipe.grindMicrons + ' um', dir: (recipe.grindMicrons > 1000 ? 'left' : 'right') }]
        .concat(pinned ? [{ x: pinned.grindMicrons, y: clampNum(F.extractionYield(pinned.grindMicrons, o), 14, 24), color: ghostInk, label: 'pinned ' + fmt(pinned.grindMicrons, 0) + ' um', dir: (pinned.grindMicrons > 1000 ? 'left' : 'right') }] : []),
      endLabels: [{ index: 0, text: fmt(eys[eys.length - 1], 1) + '%' }],
      tableSample: 6
    });

    // ----- phase diagrams
    document.getElementById('phase-browning').innerHTML = browningPhaseSVG();
    document.getElementById('phase-gel').innerHTML = gelPhaseSVG();
    document.getElementById('phase-esp').innerHTML = espPhaseSVG();

    // ----- recipe card
    renderRecipeCard(d);
    renderSchedule(d.maillard);

    // ----- JSON
    var jsonArea = document.getElementById('json-area');
    if (jsonArea && document.activeElement !== jsonArea) {
      jsonArea.value = F.exportRecipe(recipe);
    }
    var shaEl = document.getElementById('recipe-sha');
    if (shaEl && document.activeElement !== jsonArea) { shaEl.textContent = F.recipeChecksum(recipe); }

    // ----- process & sensitivity lab
    if (LAB) { renderProcessLab(); }

    // ----- pinned reference readout
    var pinEl = document.getElementById('pinReadout');
    if (pinned) {
      var pinProfName = (F.STARCH_PROFILES[pinned.starchProfile] || {}).label || pinned.starchProfile;
      var deltas = [];
      var pushDelta = function (label, cur, pin, suffix) {
        var diff = Math.round((cur - pin) * 100) / 100;
        if (diff !== 0) { deltas.push(label + ' ' + (diff > 0 ? '+' : '') + diff + suffix); }
      };
      pushDelta('surface', view.surfaceTempC, pinned.surfaceTempC, ' C');
      pushDelta('Ea', view.EaKj, pinned.EaKj, ' kJ');
      pushDelta('ferment', view.fermentTempC, pinned.fermentTempC, ' C');
      pushDelta('hydration', recipe.hydrationPct, pinned.hydrationPct, '%');
      pushDelta('grind', recipe.grindMicrons, pinned.grindMicrons, ' um');
      if (view.starchProfile !== pinned.starchProfile) deltas.push('starch ' + pinProfName.split(' / ')[0]);
      pinEl.textContent = 'Pinned: ' + pinned.surfaceTempC + ' C surface, ' + pinned.EaKj + ' kJ, ' +
        pinned.fermentTempC + ' C ferment, ' + pinned.hydrationPct + '% hydration, ' + pinProfName.split(' / ')[0] +
        ', ' + pinned.grindMicrons + ' um' +
        (deltas.length ? ' - live deltas: ' + deltas.join(', ') : ' - identical to live settings');
    } else {
      pinEl.textContent = '';
    }
  }

  function renderRecipeCard(d) {
    tile('rcId', 'FF-' + String(Math.round(recipe.flourGrams + recipe.hydrationPct * 7 + recipe.grindMicrons)).slice(-4).padStart(4, '0'));
    tile('rcDate', new Date().toISOString().slice(0, 10));
    document.getElementById('rc-name').textContent = recipe.name || 'Untitled formula';
    var styleLabels = { sourdough: 'Sourdough boule', boba: 'Tapioca boba pearls', espresso: 'Espresso shot', hybrid: 'Hybrid culinary protocol' };
    document.getElementById('rc-style').textContent = styleLabels[recipe.style] || recipe.style;
    document.getElementById('rc-notes').textContent = recipe.notes || 'No bench observations recorded yet.';

    var w = d.scaled.weights;
    var rows = [
      ['Flour or dry starch base', '100.0', fmt(w.flour, 0) + ' g'],
      ['Water', fmt(recipe.hydrationPct, 1), fmt(w.water, 0) + ' g'],
      ['Salt', fmt(recipe.saltPct, 1), fmt(w.salt, 0) + ' g'],
      ['Levain / starter culture', fmt(recipe.starterPct, 1), fmt(w.starter, 0) + ' g']
    ];
    document.getElementById('rc-formula').innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '%</td><td>' + esc(r[2]) + '</td></tr>';
    }).join('');
    tile('rcTotal', 'Total formula yield: ' + fmt(d.scaled.totalPercent, 1) + '% (' + fmt(d.scaled.totalWeight, 0) + ' g)');

    var targets = [
      ['Hydration ratio', fmt(recipe.hydrationPct, 1) + ' %'],
      ['Hydration including starter', fmt(d.scaled.effectiveHydrationPct, 2) + ' %'],
      ['Starter flour / water', fmt(d.scaled.starterFlour, 1) + ' g / ' + fmt(d.scaled.starterWater, 1) + ' g'],
      ['Flour already fermented', fmt(d.scaled.prefermentedFlourPct, 2) + ' %'],
      ['Gelatinization midpoint Tm', fmt(d.tm, 1) + ' deg C (' + d.p.label.split(' / ')[0] + ')'],
      ['Proofing temperature', fmt(view.fermentTempC, 0) + ' deg C'],
      ['Predicted doubling time', fmtDuration(d.doubling)],
      ['Maillard browning onset', fmt(d.onset, 0) + ' deg C at ' + fmt(recipe.hydrationPct, 0) + '% hydration'],
      ['Burr grind median setting', fmt(recipe.grindMicrons, 0) + ' um'],
      ['Predicted solubles yield', fmt(d.yieldPct, 1) + ' % (' + d.ewin.label + ')'],
      ['Brew water temperature', fmt(recipe.brewTempC, 0) + ' deg C']
    ];
    document.getElementById('rc-targets').innerHTML = targets.map(function (r) {
      return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>';
    }).join('');

    document.getElementById('rc-phase').innerHTML = browningPhaseSVG();
  }

  // ---- control binding ---------------------------------------------------
  function readout(val, ds) {
    var suffix = ds.suffix || '';
    var decimals = ds.decimals;
    var num = Number(val);
    var text = (decimals !== undefined) ? num.toFixed(Number(decimals)) : (Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100));
    return text + suffix;
  }

  function applyField(el) {
    var scope = el.dataset.target === 'view' ? view : recipe;
    var val;
    if (el.type === 'number' || el.type === 'range') {
      val = Number(el.value);
    } else {
      val = el.value;
    }
    try {
      if (el.type === 'number' || el.type === 'range') {
        if (!el.value.trim() || !Number.isFinite(val)) throw new RangeError('Enter a finite number');
        if (el.min !== '' && val < Number(el.min)) throw new RangeError('Minimum is ' + el.min);
        if (el.max !== '' && val > Number(el.max)) throw new RangeError('Maximum is ' + el.max);
      }
      if (scope === recipe) {
        var candidate = Object.assign({}, recipe);
        candidate[el.dataset.field] = val;
        recipe = F.validateRecipe(candidate);
      } else {
        if (el.dataset.field === 'starchProfile' && !Object.prototype.hasOwnProperty.call(F.STARCH_PROFILES, val)) throw new RangeError('Choose a starch profile');
        scope[el.dataset.field] = val;
      }
      invalidFields.delete(el.id);
      el.setAttribute('aria-invalid', 'false');
      syncControls(el);
      document.getElementById('control-status').textContent = invalidFields.size ? 'Correct the marked fields. The notebook keeps the last valid values.' : '';
    } catch (error) {
      invalidFields.add(el.id);
      el.setAttribute('aria-invalid', 'true');
      document.getElementById('control-status').textContent = 'Invalid input: ' + error.message + '. The notebook keeps the last valid values.';
    }
    ['download-json', 'print-card', 'download-card-svg', 'download-csv'].forEach(function (id) { document.getElementById(id).disabled = invalidFields.size > 0; });
    scheduleRender();
  }

  document.querySelectorAll('[data-field]').forEach(function (el) {
    var limits = el.dataset.target === 'recipe' ? F.RECIPE_LIMITS[el.dataset.field] : null;
    if (limits) { el.setAttribute('min', limits[0]); el.setAttribute('max', limits[1]); }
    el.addEventListener('input', function () { applyField(el); });
    el.addEventListener('change', function () { applyField(el); });
  });

  function syncControls(source) {
    document.querySelectorAll('[data-field]').forEach(function (el) {
      if (invalidFields.has(el.id)) return;
      var scope = el.dataset.target === 'view' ? view : recipe;
      var val = scope[el.dataset.field];
      if (val === undefined) { return; }
      if (el !== source) el.value = val;
      var out = el.parentElement ? el.parentElement.querySelector('output.readout') : null;
      if (out && el.dataset.suffix !== undefined) { out.textContent = readout(val, el.dataset); }
    });
  }

  // ---- tabs --------------------------------------------------------------
  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.setAttribute('tabindex', btn.getAttribute('aria-selected') === 'true' ? '0' : '-1');
    btn.addEventListener('click', function () {
      var name = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
      });
      document.querySelectorAll('.tab-panel').forEach(function (p) {
        var on = p.id === 'tab-' + name;
        p.classList.toggle('active', on);
        p.hidden = !on;
      });
    });
    btn.addEventListener('keydown', function (event) {
      var tabs = Array.from(document.querySelectorAll('.tab')).filter(function (t) { return !t.hidden; });
      var index = tabs.indexOf(btn), next = index;
      if (event.code === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.code === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.code === 'Home') next = 0;
      else if (event.code === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); tabs[next].click(); tabs[next].focus();
    });
  });

  // ---- table toggles -----------------------------------------------------
  document.querySelectorAll('.table-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var t = document.getElementById(btn.dataset.table);
      if (!t) { return; }
      var willShow = t.hidden;
      t.hidden = !willShow;
      btn.textContent = willShow ? 'Hide tabular data' : 'Show tabular data';
      btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
    });
  });

  // ---- theme -------------------------------------------------------------
  var themeBtn = document.getElementById('theme-toggle');
  function setTheme(mode) {
    if (mode !== 'light' && mode !== 'dark') mode = 'light';
    document.documentElement.setAttribute('data-theme', mode);
    var dark = mode === 'dark';
    themeBtn.textContent = dark ? 'Parchment notebook' : 'Espresso slate';
    themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    try { localStorage.setItem('ff-theme', mode); } catch (e) { /* ignore */ }
    render();
  }
  themeBtn.addEventListener('click', function () {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  (function initTheme() {
    var saved = 'light';
    try { saved = localStorage.getItem('ff-theme') || 'light'; } catch (e) { /* ignore */ }
    setTheme(saved);
  })();

  // ---- pin reference compare --------------------------------------------
  var pinBtn = document.getElementById('pin-reference');
  pinBtn.addEventListener('click', function () {
    pinned = pinned ? null : {
      surfaceTempC: view.surfaceTempC,
      EaKj: view.EaKj,
      fermentTempC: view.fermentTempC,
      hydrationPct: recipe.hydrationPct,
      grindMicrons: recipe.grindMicrons,
      starchProfile: view.starchProfile
    };
    pinBtn.textContent = pinned ? 'Clear pinned reference' : 'Pin current as reference';
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    render();
  });

  // ---- keyboard shortcuts ------------------------------------------------
  // Single-character shortcuts get a persisted off switch (WCAG 2.1.4) and
  // never fire while the user is typing in a field or composing text.
  var shortcutBox = document.getElementById('shortcuts-toggle');
  var shortcutsEnabled = true;
  try { shortcutsEnabled = localStorage.getItem('ff-shortcuts') !== 'off'; } catch (e) { /* ignore */ }
  if (shortcutBox) {
    shortcutBox.checked = shortcutsEnabled;
    shortcutBox.addEventListener('change', function () {
      shortcutsEnabled = shortcutBox.checked;
      try { localStorage.setItem('ff-shortcuts', shortcutsEnabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
    });
  }
  window.addEventListener('keydown', function (event) {
    if (!shortcutsEnabled || event.isComposing || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey) { return; }
    var target = event.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable]')) { return; }
    // Digits match the typed character so layouts that need Shift for digits
    // (AZERTY) and the numpad both work; on QWERTY Shift+1 types '!' and
    // naturally misses this check.
    if (/^[1-6]$/.test(event.key || '')) {
      var tabs = document.querySelectorAll('.tab');
      var btn = tabs[Number(event.key) - 1];
      if (btn) { event.preventDefault(); btn.click(); btn.focus(); }
      return;
    }
    if (event.shiftKey) { return; }
    var letter = (event.key || '').toLowerCase();
    if (letter === 't') { event.preventDefault(); themeBtn.click(); }
    else if (letter === 'p') { event.preventDefault(); pinBtn.click(); }
  });

  // ---- espresso solver apply --------------------------------------------
  document.getElementById('apply-grind').addEventListener('click', function () {
    var d = computeDerived();
    if (d.solved === null) { return; }
    recipe.grindMicrons = Math.round(d.solved);
    syncControls();
    render();
  });

  // ---- print -------------------------------------------------------------
  document.getElementById('print-card').addEventListener('click', function () { window.print(); });

  // ---- SVG download ------------------------------------------------------
  function downloadSVG(containerId, filename) {
    var svgEl = document.querySelector('#' + containerId + ' svg');
    if (!svgEl) { return; }
    var clone = svgEl.cloneNode(true);
    clone.querySelectorAll('.ff-hover, .ff-crosshair').forEach(function (n) { n.remove(); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = '.ff-tick,.ff-mark-label,.ff-end-label{fill:' + cssVar('--ink') + ';font:12px monospace}' +
      '.ff-axis-title,.ff-region-label,.ff-phase-title{fill:' + cssVar('--ink-2') + ';font:13px Georgia,serif}';
    clone.appendChild(style);
    var source = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
    var blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  document.querySelectorAll('.dl-svg').forEach(function (btn) {
    btn.addEventListener('click', function () {
      downloadSVG(btn.dataset.svg, 'flavorforge-' + btn.dataset.svg + '.svg');
    });
  });
  document.getElementById('download-card-svg').addEventListener('click', function () {
    downloadSVG('rc-phase', 'flavorforge-recipe-phase.svg');
  });

  // ---- JSON actions ------------------------------------------------------
  // Keep the checksum line glued to whatever text the box displays.
  function writeJsonArea(text) {
    document.getElementById('json-area').value = text;
    var shaEl = document.getElementById('recipe-sha');
    if (shaEl) { shaEl.textContent = F.sha256(text); }
  }
  document.getElementById('json-area').addEventListener('input', function (event) {
    var shaEl = document.getElementById('recipe-sha');
    if (shaEl) { shaEl.textContent = F.sha256(event.target.value); }
  });
  document.getElementById('refresh-json').addEventListener('click', function () {
    writeJsonArea(F.exportRecipe(recipe));
  });
  document.getElementById('copy-json').addEventListener('click', function () {
    var area = document.getElementById('json-area');
    var text = F.exportRecipe(recipe);
    writeJsonArea(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashStatus('Copied recipe JSON to clipboard.', true);
      }, function () { selectAndFallback(area); });
    } else { selectAndFallback(area); }
  });
  function selectAndFallback(area) {
    area.focus(); area.select();
    flashStatus('Select and copy the highlighted JSON.', true);
  }
  document.getElementById('download-json').addEventListener('click', function () {
    var text = F.exportRecipe(recipe);
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'flavorforge-recipe.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  document.getElementById('download-csv').addEventListener('click', function () {
    var text = F.recipeCSV(recipe);
    var blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'flavorforge-formula.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  document.getElementById('import-json').addEventListener('click', function () {
    var area = document.getElementById('import-area');
    var text = (area.value.trim() || document.getElementById('json-area').value);
    try {
      var parsed = F.importRecipe(text);
      recipe = parsed;
      invalidFields.clear();
      document.querySelectorAll('[data-field]').forEach(function (el) { el.setAttribute('aria-invalid', 'false'); });
      ['download-json', 'print-card', 'download-card-svg', 'download-csv'].forEach(function (id) { document.getElementById(id).disabled = false; });
      document.getElementById('control-status').textContent = '';
      syncControls();
      writeJsonArea(F.exportRecipe(recipe));
      area.value = '';
      render();
      flashStatus('Imported "' + parsed.name + '" into the lab notebook.', true);
    } catch (e) {
      flashStatus('Import rejected: ' + e.message, false);
    }
  });
  document.getElementById('load-example').addEventListener('click', function () {
    var ex = F.createRecipe({
      name: 'Tapioca boba dough',
      style: 'boba', flourGrams: 500, hydrationPct: 62, saltPct: 0,
      starterPct: 0, targetYieldPct: 20.5, grindMicrons: 520, brewTempC: 92,
      notes: 'The illustrative tapioca model has a 62.3 C midpoint at 62% hydration. Record actual observations separately.'
    });
    document.getElementById('import-area').value = F.exportRecipe(ex);
    flashStatus('Sample formula loaded into the import buffer. Click Import JSON to apply.', true);
  });
  function flashStatus(msg, ok) {
    var el = document.getElementById('import-status');
    el.textContent = msg;
    el.className = 'import-status ' + (ok ? 'ok' : 'bad');
  }
  document.getElementById('schema-block').textContent = [
    '{',
    '  "schema": "flavorforge/recipe",',
    '  "version": 1,',
    '  "name": "string",',
    '  "style": "sourdough | boba | espresso | hybrid",',
    '  "flourGrams": 1000,',
    '  "hydrationPct": 70,',
    '  "saltPct": 2,',
    '  "starterPct": 20,',
    '  "starterHydrationPct": 100,',
    '  "targetYieldPct": 20,',
    '  "grindMicrons": 600,',
    '  "brewTempC": 93,',
    '  "notes": "string"',
    '}'
  ].join('\n');

  function renderSchedule(options) {
    if (!scheduleValid) return;
    var result = F.browningSchedule(scheduleStages, options);
    document.getElementById('schedule-summary').textContent = fmt(result.totalMin, 1) + ' min; ' + fmt(result.fraction * 100, 2) + '% model conversion. ' +
      (result.timeTo50Min === null ? '50% is not reached.' : '50% reached at ' + fmt(result.timeTo50Min, 2) + ' min.');
    document.getElementById('schedule-table').innerHTML = buildTable([
      { label: 'Surface (C)', key: 'tempC' }, { label: 'Stage (min)', key: 'durationMin' }, { label: 'End (min)', key: 'endMin' }, { label: 'Conversion (%)', key: 'conversion' }
    ], result.stages.map(function (stage) { return Object.assign({}, stage, { conversion: fmt(stage.fraction * 100, 2) }); }));
  }

  F.BROWNING_PRESETS.forEach(function (preset, index) {
    var option = document.createElement('option'); option.value = index; option.textContent = preset.name;
    document.getElementById('schedule-preset').appendChild(option);
  });
  document.getElementById('schedule-json').value = JSON.stringify(scheduleStages, null, 2);
  document.getElementById('load-schedule').addEventListener('click', function () {
    var preset = F.BROWNING_PRESETS[Number(document.getElementById('schedule-preset').value)];
    if (!preset) return;
    scheduleStages = preset.stages.map(function (stage) { return Object.assign({}, stage); });
    scheduleValid = true;
    document.getElementById('schedule-json').value = JSON.stringify(scheduleStages, null, 2);
    renderSchedule(computeDerived().maillard);
  });
  document.getElementById('analyze-schedule').addEventListener('click', function () {
    try {
      var text = document.getElementById('schedule-json').value;
      if (text.length > 65536) throw new RangeError('Schedule JSON exceeds 64 KiB');
      var stages = JSON.parse(text);
      F.browningSchedule(stages, computeDerived().maillard);
      scheduleStages = stages; scheduleValid = true;
      renderSchedule(computeDerived().maillard);
    } catch (error) {
      scheduleValid = false;
      document.getElementById('schedule-summary').textContent = 'Schedule rejected: ' + error.message;
      document.getElementById('schedule-table').innerHTML = '';
    }
  });

  // ---- process & sensitivity lab ----------------------------------------
  function labState() {
    return {
      profile: labProfileKey,
      EaKj: view.EaKj,
      starch: view.starchProfile,
      hyd: recipe.hydrationPct,
      fermT: view.fermentTempC,
      yieldT: recipe.targetYieldPct,
      flourGrams: recipe.flourGrams,
      saltPct: recipe.saltPct,
      starterPct: recipe.starterPct,
      starterHydrationPct: recipe.starterHydrationPct
    };
  }

  function labFlash(msg, ok) {
    var el = document.getElementById('lab-export-status');
    if (!el) { return; }
    el.textContent = msg;
    el.className = 'import-status ' + (ok ? 'ok' : 'bad');
  }

  function labDownload(text, filename, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Compact chart with keyboard-focusable curves and point markers. Unlike
  // buildLineChart, each series carries its own point list, so it can draw
  // piecewise curves at their exact stage-boundary kinks.
  function labChartSVG(cfg) {
    var W = 760, H = 340, Lm = 56, Rm = 128, Tm = 20, Bm = 44;
    var pw = W - Lm - Rm, ph = H - Tm - Bm;
    var axis = cssVar('--rule-heavy'), grid = cssVar('--grid'), surface = cssVar('--surface');
    function sx(v) { return Lm + (v - cfg.xMin) / (cfg.xMax - cfg.xMin) * pw; }
    function sy(v) { return Tm + (1 - (v - cfg.yMin) / (cfg.yMax - cfg.yMin)) * ph; }
    var s = [];
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" class="ff-chart" role="img" aria-label="' + esc(cfg.ariaLabel) + '">');
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + surface + '"/>');
    ticks(cfg.yMin, cfg.yMax, 5).forEach(function (t) {
      var y = sy(t);
      s.push('<line x1="' + Lm + '" y1="' + y.toFixed(1) + '" x2="' + (Lm + pw) + '" y2="' + y.toFixed(1) + '" stroke="' + grid + '" stroke-width="1"/>');
      s.push('<text x="' + (Lm - 9) + '" y="' + y.toFixed(1) + '" text-anchor="end" dominant-baseline="middle" class="ff-tick">' + fmtTick(t) + '</text>');
    });
    ticks(cfg.xMin, cfg.xMax, 6).forEach(function (t) {
      var x = sx(t);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + Tm + '" x2="' + x.toFixed(1) + '" y2="' + (Tm + ph) + '" stroke="' + grid + '" stroke-width="1"/>');
      s.push('<text x="' + x.toFixed(1) + '" y="' + (Tm + ph + 18) + '" text-anchor="middle" class="ff-tick">' + fmtTick(t) + '</text>');
    });
    (cfg.hlines || []).forEach(function (hl) {
      var y = sy(hl.y);
      s.push('<line x1="' + Lm + '" y1="' + y.toFixed(1) + '" x2="' + (Lm + pw) + '" y2="' + y.toFixed(1) + '" stroke="' + hl.color + '" stroke-width="1.3" stroke-dasharray="5 4"/>');
      if (hl.label) {
        s.push('<text x="' + (Lm + 5) + '" y="' + (y - 6) + '" class="ff-mark-label">' + esc(hl.label) + '</text>');
      }
    });
    s.push('<line x1="' + Lm + '" y1="' + Tm + '" x2="' + Lm + '" y2="' + (Tm + ph) + '" stroke="' + axis + '" stroke-width="1.4"/>');
    s.push('<line x1="' + Lm + '" y1="' + (Tm + ph) + '" x2="' + (Lm + pw) + '" y2="' + (Tm + ph) + '" stroke="' + axis + '" stroke-width="1.4"/>');

    cfg.series.forEach(function (ser) {
      var d = '';
      ser.points.forEach(function (p, i) {
        d += (i === 0 ? 'M' : 'L') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1) + ' ';
      });
      s.push('<path class="lab-curve" tabindex="0" d="' + d.trim() + '" fill="none" stroke="' + ser.color +
        '" stroke-width="' + (ser.active ? 3.2 : 2.1) + '" stroke-linejoin="round" stroke-linecap="round"' +
        (ser.dash ? ' stroke-dasharray="' + ser.dash + '"' : '') + '><title>' + esc(ser.name) + '</title></path>');
    });

    // Spread series end labels so stacked end points stay readable.
    var ends = cfg.series.map(function (ser) {
      var last = ser.points[ser.points.length - 1];
      return { ser: ser, x: sx(last.x), y: sy(last.y) };
    }).sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 13) { ends[i].y = ends[i - 1].y + 13; }
    }
    ends.forEach(function (e) {
      s.push('<text x="' + (e.x + 7).toFixed(1) + '" y="' + (e.y + 4).toFixed(1) + '" class="ff-end-label" fill="' + e.ser.color + '">' + esc(e.ser.short) + '</text>');
    });

    (cfg.markers || []).forEach(function (m) {
      s.push('<circle class="lab-pt" tabindex="0" cx="' + sx(m.x).toFixed(1) + '" cy="' + sy(m.y).toFixed(1) +
        '" r="' + (m.active ? 6 : 4.6) + '" fill="' + m.color + '" stroke="' + surface + '" stroke-width="2"><title>' + esc(m.label) + '</title></circle>');
    });

    s.push('<text x="' + (Lm + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="ff-axis-title">' + esc(cfg.xLabel) + '</text>');
    s.push('<text transform="translate(15 ' + (Tm + ph / 2) + ') rotate(-90)" text-anchor="middle" class="ff-axis-title">' + esc(cfg.yLabel) + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  function renderProcessLab() {
    var st = labState();
    var stamped = LAB.stampedReport(st);
    var report = stamped.report;
    var opts = LAB.maillardOpts(st);
    var colors = LAB_COLORS.map(function (v) { return cssVar(v); });

    var digestEl = document.getElementById('lab-digest');
    if (digestEl) { digestEl.textContent = stamped.digest; }

    // ----- comparator table
    var tbl = '<table class="data-table"><thead><tr>' +
      ['Profile', 'Stages', 'Total min', 'Dose', 'X final', '50% at min', 'Dose temp C', 'Q10', 'Yeast margin C', 'Actions']
        .map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    report.thermal.forEach(function (r) {
      var stageTxt = r.stages.map(function (s) { return s.tempC + ' C x ' + s.durationMin + ' min'; }).join('; ');
      tbl += '<tr' + (r.active ? ' class="lab-active-row"' : '') + '>' +
        '<td>' + esc(r.name) + '<div class="lab-note">' + esc(r.note) + '</div></td>' +
        '<td>' + esc(stageTxt) + '</td>' +
        '<td>' + fmt(r.totalMin, 1) + '</td>' +
        '<td>' + fmt(r.totalDose, 4) + '</td>' +
        '<td>' + fmt(r.conversionX, 4) + '</td>' +
        '<td>' + (r.crosses50 ? fmt(r.timeTo50Min, 2) : 'never') + '</td>' +
        '<td>' + fmt(r.doseTempC, 1) + '</td>' +
        '<td>' + fmt(r.effectiveQ10, 3) + '</td>' +
        '<td>' + fmt(r.yeastMarginC, 0) + '</td>' +
        '<td class="lab-profile-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm lab-use" data-profile="' + esc(r.key) + '"' +
            (r.active ? ' disabled aria-pressed="true"' : '') + '>' + (r.active ? 'Active' : 'Use') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm lab-load" data-profile="' + esc(r.key) + '">Load</button>' +
        '</td></tr>';
    });
    tbl += '</tbody></table>';
    var tableEl = document.getElementById('lab-profile-table');
    tableEl.innerHTML = tbl;
    tableEl.querySelectorAll('.lab-use').forEach(function (btn) {
      btn.addEventListener('click', function () {
        labProfileKey = btn.dataset.profile;
        renderProcessLab();
      });
    });
    tableEl.querySelectorAll('.lab-load').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = LAB.profileByKey(btn.dataset.profile);
        if (!p) { return; }
        scheduleStages = p.stages.map(function (stage) { return Object.assign({}, stage); });
        scheduleValid = true;
        document.getElementById('schedule-json').value = JSON.stringify(scheduleStages, null, 2);
        renderSchedule(computeDerived().maillard);
        document.getElementById('tabbtn-lab').click();
      });
    });

    // ----- conversion chart X(t)
    var times = LAB.unionChartTimes(LAB.THERMAL_PROFILES, 140);
    var xMax = times[times.length - 1];
    var convSeries = report.thermal.map(function (r, i) {
      var curve = LAB.conversionCurve(r.stages, opts, times);
      return {
        name: r.name, short: LAB_SHORT[i], color: colors[i], active: r.active,
        points: curve.map(function (p) { return { x: p.t, y: p.x }; })
      };
    });
    var convMarkers = report.thermal.map(function (r, i) {
      if (!r.crosses50) { return null; }
      return { x: r.timeTo50Min, y: 0.5, color: colors[i], active: r.active, label: r.name + ': 50% at ' + fmt(r.timeTo50Min, 2) + ' min' };
    }).filter(Boolean);
    setLegend('lab-legend-conv', convSeries.map(function (ser) { return { name: ser.name, color: ser.color }; }));
    document.getElementById('lab-chart-conversion').innerHTML = labChartSVG({
      xMin: 0, xMax: xMax, yMin: 0, yMax: 1,
      xLabel: 'Elapsed time (minutes)', yLabel: 'Browning conversion X(t)',
      ariaLabel: 'Browning conversion versus time for the five thermal process profiles',
      series: convSeries, markers: convMarkers,
      hlines: [{ y: 0.5, color: cssVar('--ink-2'), label: 'X = 0.5' }]
    });
    var stepN = Math.max(1, Math.floor(times.length / 9));
    var convRows = [];
    for (var ti = 0; ti < times.length; ti += stepN) {
      var row = { t: fmtTick(Math.round(times[ti] * 100) / 100) };
      convSeries.forEach(function (ser) { row[ser.name] = fmt(ser.points[ti].y, 4); });
      convRows.push(row);
    }
    document.getElementById('lab-conversion-table').innerHTML = buildTable(
      [{ label: 'Time (min)', key: 't' }].concat(convSeries.map(function (ser) { return { label: ser.name, key: ser.name }; })),
      convRows);

    // ----- Tm sensitivity chart + matrix
    var sens = report.sensitivity;
    var starchKeys = Object.keys(sens.starchTm);
    var tmAll = [];
    starchKeys.forEach(function (k) { tmAll = tmAll.concat(sens.starchTm[k].tm); });
    var tmMin = Math.floor(Math.min.apply(null, tmAll) - 3);
    var tmMax = Math.ceil(Math.max.apply(null, tmAll) + 3);
    var tmSeries = starchKeys.map(function (k, i) {
      var entry = sens.starchTm[k];
      return {
        name: entry.label, short: entry.label.split(' / ')[0].split(' ')[0], color: colors[i], active: k === st.starch,
        points: sens.hydrations.map(function (h, j) { return { x: h, y: entry.tm[j] }; })
      };
    });
    var tmMarkers = [];
    tmSeries.forEach(function (ser) {
      ser.points.forEach(function (p, j) {
        tmMarkers.push({ x: p.x, y: p.y, color: ser.color, active: ser.active, label: ser.short + ' Tm at ' + sens.hydrations[j] + '% hydration: ' + fmt(p.y, 1) + ' C' });
      });
    });
    setLegend('lab-legend-tm', tmSeries.map(function (ser) { return { name: ser.name, color: ser.color }; }));
    document.getElementById('lab-chart-tm').innerHTML = labChartSVG({
      xMin: sens.hydrations[0], xMax: sens.hydrations[sens.hydrations.length - 1], yMin: tmMin, yMax: tmMax,
      xLabel: 'Hydration (% of dry starch)', yLabel: 'Gelatinization midpoint Tm (deg C)',
      ariaLabel: 'Starch gelatinization midpoint versus hydration for all four botanical starches',
      series: tmSeries, markers: tmMarkers
    });

    var mcols = [{ label: 'Hydration %', key: 'h' }].concat(starchKeys.map(function (k) {
      return { label: sens.starchTm[k].label.split(' / ')[0], key: k };
    }));
    var mrows = sens.hydrations.map(function (h, j) {
      var row = { h: h };
      starchKeys.forEach(function (k) { row[k] = fmt(sens.starchTm[k].tm[j], 2); });
      return row;
    });
    var ecols = [{ label: 'Grind (um)', key: 'g' }, { label: 'Yield (%)', key: 'y' }];
    var erows = sens.espresso.grinds.map(function (g, j) {
      return { g: fmt(g, 1), y: fmt(sens.espresso.yields[j], 3) };
    });
    document.getElementById('lab-matrix-table').innerHTML =
      '<p class="lab-matrix-title">Starch gelatinization midpoint Tm (deg C) vs hydration</p>' + buildTable(mcols, mrows) +
      '<p class="lab-matrix-title">Espresso grind-to-yield sensitivity</p>' + buildTable(ecols, erows);
  }

  if (LAB) {
    ['json', 'csv', 'md'].forEach(function (fmt2) {
      document.getElementById('lab-export-' + fmt2).addEventListener('click', function () {
        var text = fmt2 === 'json' ? LAB.exportJSON(labState())
          : fmt2 === 'csv' ? '\uFEFF' + LAB.exportCSV(labState())
          : LAB.exportMarkdown(labState());
        var mime = fmt2 === 'json' ? 'application/json' : fmt2 === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
        labDownload(text, 'flavorforge-lab-brief.' + fmt2, mime);
        labFlash('Exported ' + fmt2.toUpperCase() + ' brief stamped with the canonical digest.', true);
      });
    });
    document.getElementById('lab-copy-link').addEventListener('click', function () {
      var hash = LAB.encodeHash(labState());
      var base = '';
      try { base = (location.href || '').split('#')[0]; } catch (e) { /* ignore */ }
      var link = base + hash;
      if (typeof history !== 'undefined' && history.replaceState) {
        try { history.replaceState(null, '', hash); } catch (e2) { /* ignore */ }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () {
          labFlash('Copied the #ff= share link for this lab state.', true);
        }, function () { labFlash('Copy this #ff= share link: ' + link, true); });
      } else {
        labFlash('Copy this #ff= share link: ' + link, true);
      }
    });
    document.getElementById('lab-verify-demo').addEventListener('click', function () {
      var demo = LAB.tamperDemo(labState());
      labFlash(
        'Intact JSON: ' + (demo.intact.ok ? 'verified' : 'REJECTED (' + demo.intact.detail + ')') +
        '. After one edited field: ' + (demo.tampered.ok ? 'verified (unexpected)' : 'correctly rejected (' + demo.tampered.detail + ')') + '.',
        demo.ok);
    });
    document.getElementById('lab-selftest-run').addEventListener('click', function () {
      var run = LAB.runSelfTests();
      var el = document.getElementById('lab-selftest-result');
      el.textContent = run.passed + '/' + run.total + ' deterministic self-tests passing.';
      el.className = 'import-status ' + (run.allPassed ? 'ok' : 'bad');
      document.getElementById('lab-selftest-list').innerHTML =
        '<table class="data-table"><thead><tr><th scope="col">Result</th><th scope="col">Check</th><th scope="col">Detail</th></tr></thead><tbody>' +
        run.results.map(function (r) {
          return '<tr><td class="' + (r.ok ? 'lab-pass' : 'lab-fail') + '">' + (r.ok ? 'PASS' : 'FAIL') + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.detail || 'ok') + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
  }

  // ---- #ff= bookmark restore --------------------------------------------
  function applyBookmarkHash() {
    if (!LAB || typeof location === 'undefined' || typeof location.hash !== 'string') { return; }
    var h = location.hash;
    if (h.indexOf(LAB.HASH_PREFIX) !== 0) { return; }
    var status = document.getElementById('control-status');
    var st = LAB.decodeHash(h);
    if (!st) {
      if (status) { status.textContent = 'Ignored a malformed #ff= bookmark hash.'; }
      return;
    }
    try {
      recipe = F.validateRecipe(Object.assign({}, recipe, { hydrationPct: st.hyd, targetYieldPct: st.yieldT }));
      view.EaKj = st.EaKj;
      view.starchProfile = st.starch;
      view.fermentTempC = st.fermT;
      labProfileKey = st.profile;
      if (status) { status.textContent = 'Restored the lab bookmark from the URL hash.'; }
    } catch (e) {
      if (status) { status.textContent = 'Ignored a malformed #ff= bookmark hash.'; }
    }
  }
  applyBookmarkHash();

  // ---- graceful lab absence ---------------------------------------------
  if (!LAB) {
    var labTab = document.getElementById('tabbtn-process');
    var labPanel = document.getElementById('tab-process');
    if (labTab) { labTab.hidden = true; }
    if (labPanel) { labPanel.hidden = true; }
  }

  // ---- first paint -------------------------------------------------------
  syncControls();
  render();
})();
