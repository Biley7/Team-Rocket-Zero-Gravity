// WeatherHack — Celsius/Fahrenheit display formatting.
// OWNER: Dighal. Extend as needed; keep this as the ONLY unit-conversion site.
//
// Contract (ARCHITECTURE.md 3.3): the normalized weather object is always metric.
// Alert thresholds are always compared in Celsius. Fahrenheit is display-only.
(function (WX) {
  "use strict";

  function toF(celsius) {
    return (celsius * 9) / 5 + 32;
  }

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  var units = {
    current: "C",
    DEGREE: "\u00B0",

    init: function () {
      var stored = WX.storage.get(WX.storage.KEYS.UNITS, "C");
      units.current = stored === "F" ? "F" : "C";
      units.applyAttribute();
      // CHANGED: keep WX.state.units in step with the saved choice on page load
      // (previously it stayed "C" until the first toggle).
      if (WX.set) WX.set({ units: units.current });
      return units.current;
    },

    set: function (next) {
      var value = next === "F" ? "F" : "C";
      if (value === units.current) return value;
      units.current = value;
      WX.storage.set(WX.storage.KEYS.UNITS, value);
      units.applyAttribute();
      WX.set({ units: value });
      WX.events.emit("units:changed", value);
      return value;
    },

    toggle: function () {
      return units.set(units.current === "C" ? "F" : "C");
    },

    // Reflects the choice on <body data-units> so CSS can react.
    applyAttribute: function () {
      if (document.body) document.body.setAttribute("data-units", units.current.toLowerCase());
    },

    // 30.1 -> "30°"   (null/NaN -> "—", never "NaN°")
    formatTemp: function (celsius, options) {
      if (!isNum(celsius)) return "—";
      var value = units.current === "F" ? toF(celsius) : celsius;
      var rounded = Math.round(value);
      var suffix = units.DEGREE;
      if (options && options.unit) suffix += units.current;
      return rounded + suffix;
    },

    formatRange: function (minC, maxC) {
      return units.formatTemp(minC) + "/" + units.formatTemp(maxC);
    },

    // Wind stays metric (km/h) — the toggle is a temperature control only.
    formatWind: function (kmh) {
      if (!isNum(kmh)) return "—";
      return Math.round(kmh) + " km/h";
    },

    formatPrecip: function (mm) {
      if (!isNum(mm)) return "—";
      if (mm === 0) return "0 mm";
      return (mm < 10 ? mm.toFixed(1) : Math.round(mm)) + " mm";
    },

    formatPercent: function (value) {
      if (!isNum(value)) return "—";
      return Math.round(value) + "%";
    }
  };

  WX.units = units;
})(window.WX = window.WX || {});