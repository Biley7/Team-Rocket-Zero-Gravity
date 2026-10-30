// WeatherHack — application bootstrap.
// OWNER: Core (frontend architect). This is the only file that knows about
// every module; keep it to wiring and ordering only.
//
// Render contract: every module exposes init() to build its own DOM and
// render() to paint it. renderAll() is the single full repaint and is triggered
// by the shared events below. Modules must NOT self-render on events, otherwise
// the same region gets painted twice.
(function (WX) {
  "use strict";

  function call(path, args) {
    // Tolerates a teammate's module being absent or failing to parse during
    // parallel development — one broken file must not take the whole app down.
    var parts = path.split(".");
    var owner = WX[parts[0]];
    if (!owner || typeof owner[parts[1]] !== "function") return;
    try {
      owner[parts[1]].apply(owner, args || []);
    } catch (err) {
      console.error("[WX] " + path + " failed", err);
    }
  }

  WX.renderAll = function () {
    var weather = WX.state.weather;

    call("current.render");
    call("forecast.render");
    call("theme.apply", [weather]);
    call("hourly.render", [WX.$("#hourly-chart"), weather, WX.units.current]);
    call("prefs.renderFavourites");
    call("prefs.renderUnitsToggle");
    call("status.render");

    // compute() is Pawan's; guard it separately so a broken alerts module
    // cannot take the rest of the dashboard down with it.
    if (WX.alerts && typeof WX.alerts.compute === "function") {
      call("alerts.render", [WX.$("#alerts"), WX.alerts.compute(weather)]);
    }
  };

  var booted = false;

  WX.boot = function () {
    // Idempotent: boot() must never rebuild the regions or double-bind listeners.
    if (booted) return;
    booted = true;

    call("units.init");
    call("status.init");
    call("prefs.init");
    call("current.init");
    call("hourly.init");
    call("alerts.init");

    WX.events.on("units:changed", WX.renderAll);
    WX.events.on("weather:loaded", WX.renderAll);
    WX.events.on("weather:failed", WX.renderAll);
    WX.events.on("city:changed", WX.renderAll);
    WX.events.on("favourites:changed", WX.renderAll);

    WX.renderAll();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", WX.boot);
  } else {
    WX.boot();
  }
})(window.WX = window.WX || {});
