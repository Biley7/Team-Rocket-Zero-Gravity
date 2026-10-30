// WeatherHack — rule-based weather alerts.
// OWNER: Pawan. Replace the placeholder below with the real rules.
//
// compute() receives the normalized weather object and must return an array of:
//   { id, severity: "low"|"moderate"|"high"|"severe", title, detail, icon }
//
// IMPORTANT: compare thresholds in Celsius — the data is always metric. Only the
// rendered text should be converted, via WX.units.formatTemp().
// Suggested starting thresholds: heat tempMax >= 35/40/45 °C,
// rain precipitationSum >= 20/50/100 mm, wind windSpeedMax >= 40/60/90 km/h.
(function (WX) {
  "use strict";

  WX.alerts = {
    init: function () {},

    compute: function (weather) {
      return [];
    },

    render: function (mount, alerts) {
      if (!mount) return;
      mount.innerHTML = '<p class="wx-empty">Alert region ready — owned by Pawan (js/alerts.js).</p>';
    }
  };
})(window.WX = window.WX || {});
