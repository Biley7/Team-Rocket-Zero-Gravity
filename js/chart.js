// WeatherHack — hourly temperature & rainfall chart.
// OWNER: Pawan. Region owned: #hourly-chart (ids: #chart-canvas, #chart-legend,
// #chart-empty — ARCHITECTURE.md 6.1).
//
// Contract: init() builds this region's DOM once; render(mount, weather, units)
// paints it. Data is read from the shared normalized object (weather.hourly.*),
// never from the raw Open-Meteo payload, and every temperature label goes
// through WX.units so Dighal's C/F toggle applies here too.
(function (WX) {
  "use strict";

  WX.hourly = WX.hourly || {};

  var HOURS = 24;        // window shown in the chart
  var LABEL_EVERY = 4;   // an x-axis label every 4 hours
  var FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

  var bound = false;
  var resizeTimer = null;

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  function series(source, key) {
    var arr = source && source[key];
    return Array.isArray(arr) ? arr : [];
  }

  function maxOf(values) {
    return values.reduce(function (top, value) { return value > top ? value : top; }, -Infinity);
  }

  // Canvas cannot read CSS custom properties, so grab the few colours we need
  // off <body> at paint time. Keeps the chart in step with the day/night theme
  // instead of hard-coding a hex that would be wrong in the other mode.
  function token(name, fallback) {
    try {
      var value = getComputedStyle(document.body).getPropertyValue(name);
      value = value ? value.trim() : "";
      return value || fallback;
    } catch (err) {
      return fallback;
    }
  }

  // ------------------------------------------------------------------ build

  function buildCard(mount) {
    var card = WX.el("section", "wx-card wx-chart");
    card.setAttribute("aria-labelledby", "chart-title");

    var head = WX.el("header", "wx-chart__head");
    var title = WX.el("h2", "wx-chart__title", "Next 24 hours");
    title.id = "chart-title";
    head.appendChild(title);

    // Doubles as the legend and as the canvas' accessible text description.
    var legend = WX.el("p", "wx-chart__legend");
    legend.id = "chart-legend";
    head.appendChild(legend);
    card.appendChild(head);

    var empty = WX.el("p", "wx-empty wx-chart__empty", "Hourly forecast data is not available yet.");
    empty.id = "chart-empty";
    card.appendChild(empty);

    var plot = WX.el("div", "wx-chart__plot");
    var canvas = document.createElement("canvas");
    canvas.id = "chart-canvas";
    canvas.className = "wx-chart__canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-labelledby", "chart-legend");
    plot.appendChild(canvas);
    card.appendChild(plot);

    mount.appendChild(card);
  }

  function keyNode(kind, text) {
    return WX.el("span", "wx-chart__key wx-chart__key--" + kind, text);
  }

  // ------------------------------------------------------------------- draw

  function draw(canvas, times, temps, rain, count) {
    if (!canvas || typeof canvas.getContext !== "function") return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var width = Math.max(280, canvas.clientWidth || 600);
    var height = Math.max(200, canvas.clientHeight || 260);
    var ratio = Math.min(window.devicePixelRatio || 1, 2); // cap: 3x wastes memory
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var validTemps = temps.filter(isNum);
    if (!validTemps.length) return;

    var low = Math.floor(Math.min.apply(null, validTemps) - 2);
    var high = Math.max(low + 1, Math.ceil(Math.max.apply(null, validTemps) + 2));
    var maxRain = Math.max(1, maxOf(rain.filter(isNum)));

    var gridColor = token("--wx-border", "rgba(13, 27, 42, .10)");
    var labelColor = token("--wx-muted", "#5a6b80");
    // Warm for temperature, accent-blue for rain — reused tokens, so both adapt
    // automatically to the night palette.
    var tempColor = token("--wx-sev-high", "#e0642e");
    var rainColor = token("--wx-accent", "#2f6fed");

    var pad = { top: 16, right: 14, bottom: 34, left: 46 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    function xAt(i) {
      return pad.left + (count === 1 ? plotW / 2 : (i / (count - 1)) * plotW);
    }
    function yAt(value) {
      return pad.top + ((high - value) / (high - low)) * plotH;
    }

    // Horizontal gridlines + temperature axis labels.
    ctx.font = "11px " + FONT;
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = labelColor;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.top + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(width - pad.right, gy);
      ctx.stroke();
      ctx.fillText(WX.units.formatTemp(high - ((high - low) * g) / 4), 4, gy + 4);
    }

    // Rainfall bars, drawn behind the temperature line.
    ctx.fillStyle = rainColor;
    var barW = Math.max(2, (plotW / count) * 0.5);
    for (var b = 0; b < count; b++) {
      var amount = isNum(rain[b]) ? rain[b] : 0;
      if (amount <= 0) continue;
      var barH = plotH * 0.42 * (amount / maxRain);
      ctx.fillRect(xAt(b) - barW / 2, pad.top + plotH - barH, barW, barH);
    }

    // Temperature polyline — a null value breaks the line instead of faking a 0.
    ctx.beginPath();
    ctx.strokeStyle = tempColor;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    var started = false;
    for (var i = 0; i < count; i++) {
      if (!isNum(temps[i])) { started = false; continue; }
      if (!started) {
        ctx.moveTo(xAt(i), yAt(temps[i]));
        started = true;
      } else {
        ctx.lineTo(xAt(i), yAt(temps[i]));
      }
    }
    ctx.stroke();

    // Point markers.
    ctx.fillStyle = tempColor;
    for (var d = 0; d < count; d++) {
      if (!isNum(temps[d])) continue;
      ctx.beginPath();
      ctx.arc(xAt(d), yAt(temps[d]), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hour labels in the CITY's timezone (never the viewer's).
    ctx.fillStyle = labelColor;
    for (var h = 0; h < count; h += LABEL_EVERY) {
      var label = WX.time.formatHour(times[h]);
      ctx.fillText(label, Math.min(width - 40, Math.max(pad.left - 6, xAt(h) - 15)), height - 10);
    }
  }

  // ----------------------------------------------------------------- render

  function render(mount, weather) {
    mount = mount || WX.$("#hourly-chart");
    if (!mount) return;
    if (!mount.querySelector(".wx-chart")) buildCard(mount);

    var canvas = WX.$("#chart-canvas", mount);
    var legend = WX.$("#chart-legend", mount);
    var empty = WX.$("#chart-empty", mount);
    var plot = WX.$(".wx-chart__plot", mount);

    var hourly = weather ? weather.hourly : null;
    var times = series(hourly, "time");
    var temps = series(hourly, "temperature").slice(0, HOURS);
    var rain = series(hourly, "precipitation").slice(0, HOURS);
    var count = Math.min(HOURS, times.length, temps.length);
    var validTemps = temps.filter(isNum);

    if (!count || !validTemps.length) {
      legend.textContent = "";
      empty.hidden = false;
      empty.classList.remove("is-hidden");
      plot.hidden = true;
      return;
    }

    empty.hidden = true;
    empty.classList.add("is-hidden");
    plot.hidden = false;

    // Text legend/summary: the accessible fallback required by ARCHITECTURE.md
    // 6.4, a readable summary of the same numbers the canvas draws, and the
    // place that names the active unit (the axis labels alone are just "30°").
    var rainValues = rain.filter(isNum);
    var rainMax = rainValues.length ? maxOf(rainValues) : 0;
    legend.replaceChildren();
    legend.appendChild(keyNode("temp", "Temperature (" + WX.units.DEGREE + WX.units.current + ")"));
    legend.appendChild(keyNode("rain", "Rain (mm)"));
    legend.appendChild(WX.el("span", "wx-chart__summary",
      "Range " + WX.units.formatRange(Math.min.apply(null, validTemps), Math.max.apply(null, validTemps)) +
      " \u00B7 rain up to " + WX.units.formatPrecip(rainMax)));

    draw(canvas, times, temps, rain, count);
  }

  // ------------------------------------------------------------------- init

  function bindResize() {
    if (bound) return;
    bound = true;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        // Redraw from the shared state — the canvas backing store has to be
        // re-measured after the grid reflows.
        render(WX.$("#hourly-chart"), WX.state.weather);
      }, 150);
    });
  }

  WX.hourly.init = function () {
    var mount = WX.$("#hourly-chart");
    if (mount && !mount.querySelector(".wx-chart")) buildCard(mount);
    bindResize();
  };

  WX.hourly.render = render;
})(window.WX = window.WX || {});
