// WeatherHack — loading, offline and error states plus cached results.
// OWNER: Dighal. Replace the placeholder below.
//
// Subscribe to these events (they already fire):
//   "city:changed"    cityRef
//   "weather:loaded"  normalized weather object
//   "weather:failed"  WeatherApiError with a .code:
//                     NETWORK | TIMEOUT | HTTP | PARSE | SHAPE | ABORT | INPUT
//   "state:changed"   { keys, state } — state.status is idle|loading|ready|error|offline
//
// Useful hooks: WX.api.isCached(city), WX.api.peekCache(city), WX.api.clearCache(),
// WX.storage.KEYS.CACHE, WX.time.relative(weather.fetchedAt).
(function (WX) {
  "use strict";

  WX.status = {
    init: function () {},

    render: function () {
      var mount = WX.$("#status-banner");
      if (!mount) return;
      mount.innerHTML = "";
      mount.className = "wx-region wx-region--status";
    }
  };
})(window.WX = window.WX || {});
