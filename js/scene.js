// WeatherHack — atmospheric weather animation system.
// OWNER: Core (frontend architect).
//
// Owns: the page backdrop <div class="wx-bg">, the <body> weather attributes and
// WX.theme.apply(). It is the ONLY writer of those attributes.
//
// Contract (ARCHITECTURE.md section 6.3):
//   data-weather    palette key    clear | clouds | rain | thunder | snow | fog
//   data-scene      animation key  clear | partly | clouds | rain | thunder | snow | fog
//   data-intensity  low | med | high | max     drives particle density and speed
//   data-time       day | night
//   data-quality    full | reduced              simplified motion on weak devices
//
// Rules:
//   1. WX.scene.map(code, isDay) is THE single weather-state mapping function.
//      No WMO code table lives here — labels, icons and palette keys stay in
//      js/wmo.js (ARCHITECTURE.md conflict C8).
//   2. Every layer is built exactly once in init(). apply() only writes body
//      attributes, so switching cities can never grow the DOM and repeated
//      animations cannot leak nodes.
//   3. styles/scene.css does all the animating. No canvas, no libraries, no
//      requestAnimationFrame loop.
//   4. Motion pauses while the tab is hidden and simplifies on low-powered
//      devices; styles/scene.css honours prefers-reduced-motion.
//
// Reusable animation classes (all inside .wx-scene, in paint order):
//   .wx-scene__tint    ambient colour from the palette tokens
//   .wx-scene__sun     clear/partly day disk
//   .wx-scene__moon    clear/partly night disk
//   .wx-scene__rays    slow rotating light shafts
//   .wx-scene__stars   > .wx-scene__star    night sky, partly twinkling
//   .wx-scene__motes   > span               drifting sunlit particles
//   .wx-scene__clouds  > .wx-scene__cloud   layered cloud bank
//   .wx-scene__rain    > span               rain streaks
//   .wx-scene__snow    > span               snow flakes
//   .wx-scene__fog     > span               translucent fog bands
//   .wx-scene__flash   lightning pulse (thunder only)
//   .wx-scene__scrim   contrast wash so text above stays readable
(function (WX) {
  "use strict";

  var SCENE_CLASS = "wx-scene";
  var PAUSE_CLASS = "wx-scene-paused";

  // Layer sizes. Fixed counts: the DOM never changes after init().
  var COUNTS = {
    stars: 46,
    motes: 16,
    clouds: 9,
    rain: 64,
    snow: 40,
    fog: 3
  };

  // js/wmo.js icon key -> animation state. The palette key ("theme") is used
  // as-is for data-weather, so base.css stays the single palette definition.
  var SCENE_BY_ICON = {
    clear: "clear",
    night: "clear",
    partly: "partly",
    cloud: "clouds",
    fog: "fog",
    drizzle: "rain",
    rain: "rain",
    thunder: "thunder",
    snow: "snow"
  };

  // Fixed seed keeps the composition identical between loads (and testable).
  var SEED = 20261030;

  var mount = null;
  var built = false;
  var bound = false;
  var current = null;

  // ------------------------------------------------------------- utilities

  function random(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function between(rnd, min, max) {
    return min + rnd() * (max - min);
  }

  function round(value, digits) {
    return Number(value.toFixed(digits === undefined ? 2 : digits));
  }

  function px(value) { return round(value, 2) + "px"; }
  function pct(value) { return round(value, 2) + "%"; }
  function sec(value) { return round(value, 2) + "s"; }

  function particles(rnd, count, className, style) {
    var html = "";
    for (var i = 0; i < count; i++) {
      html += '<span class="' + className + '" style="' + style(rnd, i) + '"></span>';
    }
    return html;
  }

  // -------------------------------------------------------- single mapping

  // Magnitude of the event behind a WMO code. This is a severity scale, not a
  // label table, so js/wmo.js remains the only code -> text/icon source.
  // An unrecognised code is treated as calm rather than as its raw number:
  // "code >= 95" must never promote a junk value to a full thunderstorm.
  function levelFor(code) {
    if (WX.wmo.codes.indexOf(code) === -1) return 0.35;           // unknown / null

    if (code >= 95) return code >= 99 ? 1 : 0.8;                  // thunderstorm
    if (code >= 85) return code === 86 ? 0.9 : 0.55;              // snow showers
    if (code >= 80) return code === 82 ? 1 : (code === 81 ? 0.8 : 0.55);
    if (code >= 71) return code === 75 ? 1 : (code === 73 ? 0.65 : 0.4);
    if (code >= 61) return (code === 65 || code === 67) ? 1 : (code === 63 ? 0.7 : 0.5);
    if (code >= 51) return (code === 55 || code === 57) ? 0.8 : (code === 53 ? 0.5 : 0.3);
    if (code >= 45) return code === 48 ? 1 : 0.7;                 // fog
    if (code === 3) return 1;                                     // overcast
    if (code === 2) return 0.6;                                   // partly cloudy
    return 0.35;                                                  // clear / mainly clear
  }

  function bandFor(level) {
    if (level < 0.4) return "low";
    if (level < 0.65) return "med";
    if (level < 0.85) return "high";
    return "max";
  }

  // THE mapping function: one place turns a weather code + day/night into
  // everything the atmosphere needs.
  function map(code, isDay) {
    var described = WX.wmo.describe(code);
    var level = levelFor(typeof code === "number" ? code : -1);
    return {
      code: typeof code === "number" ? code : null,
      label: described.label,
      theme: described.theme,                                  // palette key
      scene: SCENE_BY_ICON[described.icon] || "clouds",        // animation key
      level: level,
      intensity: bandFor(level),
      night: !isDay
    };
  }

  // ------------------------------------------------------------ layer build

  function starStyle(rnd) {
    return "--x:" + pct(between(rnd, 0, 100)) +
      ";--y:" + pct(between(rnd, 2, 58)) +
      ";--s:" + px(between(rnd, 1, 2.4)) +
      ";--d:" + sec(between(rnd, 3.4, 7.4)) +
      ";--delay:" + sec(-between(rnd, 0, 7.4)) +
      ";--o:" + round(between(rnd, 0.35, 0.95), 2);
  }

  function moteStyle(rnd) {
    return "--x:" + pct(between(rnd, 0, 100)) +
      ";--y:" + pct(between(rnd, 25, 92)) +
      ";--s:" + px(between(rnd, 3, 7)) +
      ";--dx:" + px(between(rnd, -34, 34)) +
      ";--d:" + sec(between(rnd, 18, 34)) +
      ";--delay:" + sec(-between(rnd, 0, 30)) +
      ";--o:" + round(between(rnd, 0.18, 0.4), 2);
  }

  // Three depth tiers: far puffs are wider, fainter and slower than near ones.
  function cloudStyle(rnd, index) {
    var tier = index < 4 ? 0 : (index < 7 ? 1 : 2);
    var width = [26, 20, 15][tier] + between(rnd, 0, 9);        // rem
    var height = width * (tier === 2 ? 0.4 : 0.32);             // rem
    var duration = [170, 120, 88][tier] + between(rnd, 0, 40);  // s
    return "--x:" + pct(between(rnd, -10, 88)) +
      ";--y:" + pct(between(rnd, 2, 40) + tier * 8) +
      ";--w:" + round(width, 2) + "rem" +
      ";--h:" + round(height, 2) + "rem" +
      ";--o:" + round([0.32, 0.48, 0.66][tier] + between(rnd, 0, 0.12), 2) +
      ";--d:" + sec(duration) +
      ";--delay:" + sec(-between(rnd, 0, duration));
  }

  function rainStyle(rnd) {
    return "--x:" + pct(between(rnd, 0, 100)) +
      ";--h:" + px(between(rnd, 24, 76)) +
      ";--d:" + sec(between(rnd, 0.5, 1.05)) +
      ";--delay:" + sec(-between(rnd, 0, 2)) +
      ";--o:" + round(between(rnd, 0.45, 0.95), 2);
  }

  function snowStyle(rnd) {
    return "--x:" + pct(between(rnd, 0, 100)) +
      ";--s:" + px(between(rnd, 3, 9)) +
      ";--sway:" + px(between(rnd, -26, 26)) +
      ";--d:" + sec(between(rnd, 8, 18)) +
      ";--delay:" + sec(-between(rnd, 0, 18)) +
      ";--o:" + round(between(rnd, 0.5, 1), 2);
  }

  function fogStyle(rnd, index) {
    var duration = [150, 118, 88][index] + between(rnd, 0, 30); // s
    return "--y:" + pct([18, 44, 66][index] + between(rnd, -5, 5)) +
      ";--h:" + pct(between(rnd, 24, 40)) +
      ";--d:" + sec(duration) +
      ";--delay:" + sec(-between(rnd, 0, duration)) +
      ";--o:" + round(between(rnd, 0.45, 0.85), 2);
  }

  function buildScene() {
    var rnd = random(SEED);
    return '<div class="' + SCENE_CLASS + '">' +
      '<div class="wx-scene__tint"></div>' +
      '<span class="wx-scene__sun"></span>' +
      '<span class="wx-scene__moon"></span>' +
      '<div class="wx-scene__rays"></div>' +
      '<div class="wx-scene__stars">' + particles(rnd, COUNTS.stars, "wx-scene__star", starStyle) + '</div>' +
      '<div class="wx-scene__motes">' + particles(rnd, COUNTS.motes, "wx-scene__mote", moteStyle) + '</div>' +
      '<div class="wx-scene__clouds">' + particles(rnd, COUNTS.clouds, "wx-scene__cloud", cloudStyle) + '</div>' +
      '<div class="wx-scene__rain">' + particles(rnd, COUNTS.rain, "wx-scene__drop", rainStyle) + '</div>' +
      '<div class="wx-scene__snow">' + particles(rnd, COUNTS.snow, "wx-scene__flake", snowStyle) + '</div>' +
      '<div class="wx-scene__fog">' + particles(rnd, COUNTS.fog, "wx-scene__band", fogStyle) + '</div>' +
      '<span class="wx-scene__flash"></span>' +
      '<span class="wx-scene__flash wx-scene__flash--alt"></span>' +
      '<div class="wx-scene__scrim"></div>' +
      '</div>';
  }

  // --------------------------------------------------------- device budget

  var qualityQueries = [];
  var reducedQuery = null;

  function media(query) {
    return window.matchMedia ? window.matchMedia(query) : null;
  }

  function watched(query) {
    var list = media(query);
    if (!list) return null;
    qualityQueries.push(list);
    return list;
  }

  // "reduced" keeps the atmosphere but thins the particle layers and drops the
  // expensive blur, so a low-powered device never fights the animation.
  function shouldReduce() {
    if (reducedQuery && reducedQuery.matches) return true;

    var cores = window.navigator && window.navigator.hardwareConcurrency;
    if (typeof cores === "number" && cores > 0 && cores <= 4) return true;

    var memory = window.navigator && window.navigator.deviceMemory;
    if (typeof memory === "number" && memory > 0 && memory <= 4) return true;

    var connection = window.navigator && window.navigator.connection;
    if (connection) {
      if (connection.saveData === true) return true;
      if (/2g/i.test(String(connection.effectiveType || ""))) return true;
    }
    return false;
  }

  function applyQuality() {
    if (!document.body) return;
    document.body.setAttribute("data-quality", shouldReduce() ? "reduced" : "full");
  }

  function onQualityChange() {
    applyQuality();
  }

  function watchQuality() {
    var small = watched("(max-width: 640px)");
    var coarse = null;
    reducedQuery = media("(prefers-reduced-motion: reduce)");

    for (var i = 0; i < qualityQueries.length; i++) {
      var list = qualityQueries[i];
      if (list.addEventListener) list.addEventListener("change", onQualityChange);
      else if (list.addListener) list.addListener(onQualityChange);
    }
    return small || coarse;
  }

  // ------------------------------------------------------------- attribute
  // Every value the visual system needs is written here and nowhere else.

  function apply(weather) {
    var body = document.body;
    if (!body) return null;

    if (!weather || !weather.current) {
      body.removeAttribute("data-weather");
      body.removeAttribute("data-time");
      body.removeAttribute("data-scene");
      body.removeAttribute("data-intensity");
      current = null;
      return null;
    }

    var mapped = map(weather.current.weatherCode, weather.current.isDay);
    body.setAttribute("data-weather", mapped.theme);
    body.setAttribute("data-time", mapped.night ? "night" : "day");
    body.setAttribute("data-scene", mapped.scene);
    body.setAttribute("data-intensity", mapped.intensity);
    current = mapped;
    return mapped;
  }

  // ------------------------------------------------------------------ init

  function init() {
    mount = WX.$(".wx-bg");
    // Built once: a second init() must never duplicate the animation layers.
    if (mount && !built) {
      mount.innerHTML = buildScene();
      built = true;
    }

    watchQuality();
    applyQuality();

    if (!bound) {
      bound = true;
      // Hidden tabs stop animating: no wasted battery, no throttled repaints.
      document.addEventListener("visibilitychange", function () {
        var root = document.documentElement;
        if (document.hidden) root.classList.add(PAUSE_CLASS);
        else root.classList.remove(PAUSE_CLASS);
      });
    }

    apply(WX.state.weather);
  }

  WX.scene = {
    init: init,
    map: map,
    apply: apply,
    counts: COUNTS,
    // Current mapping under test/debug; null while nothing is selected.
    state: function () { return current; },
    layers: function () { return mount ? mount.querySelector("." + SCENE_CLASS) : null; }
  };

  // script.js already calls WX.theme.apply(weather) on every repaint, so the
  // atmosphere follows the selected city without any extra wiring.
  WX.theme = { apply: apply };
})(window.WX = window.WX || {});
