// WeatherHack — hourly temperature & rain chart.
// OWNER: Pawan. Replace the placeholder below with the real canvas/SVG chart.
//
// Available data (already normalized, always metric — ARCHITECTURE.md 4.1):
//   weather.hourly.time[]                  168 local ISO strings
//   weather.hourly.temperature[]           168 values in °C
//   weather.hourly.precipitation[]         168 values in mm
//   weather.hourly.precipitationProbability[] 168 values in %
//   weather.hourly.weatherCode[]           168 WMO codes
//   weather.hourly.windSpeed[]             168 values in km/h
//   weather.hourly.isDay[]                 168 booleans
//   weather.city.timezone / weather.city.utcOffsetSeconds
//
// Rules: never call fetch(), never call localStorage, and format labels with
// WX.time.* and WX.units.formatTemp() so the C/F toggle keeps working.
(function (WX) {
  "use strict";

  WX.hourly = {
    init: function () {},

    render: function (mount, weather, units) {
      if (!mount) return;
      if (!weather) {
        mount.innerHTML = '<p class="wx-empty">Hourly chart appears once a city is selected.</p>';
        return;
      }
      mount.innerHTML = '<p class="wx-empty">Chart region ready — owned by Pawan (js/chart.js).</p>';
    }
  };
})(window.WX = window.WX || {});
