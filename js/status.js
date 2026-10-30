// WeatherHack — loading, offline and error states plus cached results.
// OWNER: Dighal.
// Region owned: #status-banner.
//
// Listens to (already fired by current.js / state.js):
//   "city:changed"   -> arm the "still loading…" hint
//   "weather:loaded" -> save the result to the cache (wx.cache)
//   "weather:failed" -> fall back to the cached result when the failure looks like
//                       connectivity (offline / timeout / 5xx), otherwise show the error
// Painting: script.js renderAll() calls WX.status.render() on those events.
//
// Banner states:  loading · offline (cached data) · error (+Retry) · success (back online) · info
(function (WX) {
  "use strict";

  var SLOW_AFTER_MS = 6000;   // show "taking longer than usual" after this long
  var NOTICE_MS = 4000;       // how long the "back online" message stays

  // After restoring cached data we re-emit "weather:loaded" so Pawan's alerts/chart
  // and the theme repaint from it. Set to false if those modules don't need it.
  var REPLAY_LOADED_ON_RESTORE = true;

  var restoring = false;      // true while we replay "weather:loaded" ourselves
  var recovering = false;     // true after an offline/error state, until data loads again
  var fallbackReason = null;  // "offline" | "unavailable" | null
  var slow = false;
  var slowTimer = null;
  var notice = null;
  var noticeTimer = null;
  var bound = false;

  // ---------------------------------------------------------------- helpers

  function offlineNow() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  function sameCity(a, b) {
    var ka = WX.api.coordKey(a);
    return !!ka && ka === WX.api.coordKey(b);
  }

  function cityName() {
    return WX.state.city && WX.state.city.name ? WX.state.city.name : "";
  }

  function ago(timestamp) {
    if (WX.time && typeof WX.time.relative === "function") return WX.time.relative(timestamp);
    return new Date(timestamp).toLocaleTimeString();
  }

  // Should a failed request fall back to cached data?
  function canFallBack(err) {
    if (!err) return false;
    if (offlineNow()) return true;
    if (err.code === "NETWORK" || err.code === "TIMEOUT") return true;
    return err.code === "HTTP" && err.meta && err.meta.status >= 500;
  }

  function reasonFor(err) {
    return offlineNow() || (err && err.code === "NETWORK") ? "offline" : "unavailable";
  }

  // The data currently on screen for this city, else the last saved copy.
  function findCached(city) {
    if (!city) return null;
    var onScreen = WX.state.weather;
    if (onScreen && sameCity(onScreen.city, city)) return onScreen;
    return WX.storage.readWeather(city);
  }

  // ---------------------------------------------------------- slow / notice

  function clearSlow() {
    clearTimeout(slowTimer);
    slowTimer = null;
    slow = false;
  }

  function armSlow() {
    clearSlow();
    slowTimer = setTimeout(function () {
      if (WX.state.status === "loading") {
        slow = true;
        render();
      }
    }, SLOW_AFTER_MS);
  }

  function flash(text) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      notice = null;
      render();
    }, NOTICE_MS);
    render();
  }

  // --------------------------------------------------------- state changes

  // Show cached data with the offline warning.
  function restore(weather, reason) {
    fallbackReason = reason;
    recovering = true;
    clearSlow();

    var isNewObject = WX.state.weather !== weather;
    restoring = true;
    try {
      WX.set({ weather: weather, city: weather.city, status: "offline", source: "cache", error: null });
      if (REPLAY_LOADED_ON_RESTORE && isNewObject) WX.events.emit("weather:loaded", weather);
    } finally {
      restoring = false;
    }
    render();
  }

  function onLoaded(weather) {
    if (restoring) return; // our own replay — don't re-save or announce
    clearSlow();
    fallbackReason = null;
    WX.storage.saveWeather(weather);
    if (recovering) {
      recovering = false;
      flash("Back online \u2014 weather updated.");
    }
  }

  function onFailed(err) {
    if (err && err.code === "ABORT") return;
    clearSlow();

    var city = WX.state.city;

    if (canFallBack(err)) {
      var cached = findCached(city);
      if (cached) {
        restore(cached, reasonFor(err));
        return;
      }
    }

    // No usable cache: surface a clear error (current.js already set a generic one).
    var name = cityName();
    var message = offlineNow() || (err && err.code === "NETWORK")
      ? "You\u2019re offline and there is no saved weather" + (name ? " for " + name : "") + ". Reconnect and try again."
      : (WX.state.error && WX.state.error.message) || "Something went wrong while loading the weather.";

    fallbackReason = null;
    recovering = true;
    WX.set({ status: "error", error: { code: err && err.code, message: message } });
    render();
  }

  function onCityChanged() {
    armSlow();
  }

  // Re-fetch the current city, bypassing api.js's in-memory cache.
  function retry() {
    var city = WX.state.city;
    if (!city) return null;
    WX.api.clearCache(city);
    var load = WX.loadWeather || (WX.city && WX.city.load);
    return load ? load(city) : null;
  }

  function onBrowserOffline() {
    if (WX.state.status === "ready" && WX.state.weather) {
      // What's on screen is now, effectively, cached data.
      fallbackReason = "offline";
      recovering = true;
      WX.set({ status: "offline", source: "cache" });
    }
    render();
  }

  function onBrowserOnline() {
    var status = WX.state.status;
    if (WX.state.city && (status === "offline" || status === "error")) {
      retry();
    } else {
      render();
    }
  }

  // ----------------------------------------------------------------- render

  // Returns what the banner should say, or null to hide it.
  function describe() {
    var s = WX.state;
    var name = cityName();

    if (s.status === "loading") {
      return {
        kind: "loading",
        title: (s.weather ? "Refreshing" : "Loading") + " weather" + (name ? " for " + name : "") + "\u2026",
        detail: slow ? "This is taking longer than usual. Check your connection." : ""
      };
    }

    if (s.status === "offline") {
      var unavailable = fallbackReason === "unavailable";
      var parts = [];
      if (s.weather && s.weather.fetchedAt) parts.push("Last updated " + ago(s.weather.fetchedAt));
      parts.push(offlineNow() ? "We\u2019ll refresh automatically when you\u2019re back online." : "Try again in a moment.");
      return {
        kind: "offline",
        title: unavailable
          ? "Weather service not responding (showing cached data)"
          : "Offline Mode (showing cached data)",
        detail: parts.join(" \u00B7 "),
        retry: !!s.city
      };
    }

    if (s.status === "error") {
      return {
        kind: "error",
        title: "Couldn\u2019t load weather",
        detail: (s.error && s.error.message) || "Something went wrong. Please try again.",
        retry: !!s.city
      };
    }

    if (notice) return { kind: "success", title: notice, detail: "" };

    if (s.status === "idle" && offlineNow()) {
      return { kind: "info", title: "You\u2019re offline", detail: "Connect to the internet to search for a city." };
    }

    return null;
  }

  var ICONS = { offline: "!", error: "!", success: "\u2713", info: "i" };

  function render() {
    var mount = WX.$("#status-banner");
    if (!mount) return;

    var model = describe();

    if (!model) {
      mount.hidden = true;
      mount.innerHTML = "";
      mount.className = "wx-region wx-region--status";
      mount.removeAttribute("data-sig");
      mount.setAttribute("role", "status");
      mount.setAttribute("aria-live", "polite");
      return;
    }

    // Skip the rebuild when nothing changed (keeps the Retry button focused).
    var sig = [model.kind, model.title, model.detail, model.retry ? "r" : ""].join("|");
    if (mount.getAttribute("data-sig") === sig && mount.firstChild) return;
    mount.setAttribute("data-sig", sig);

    mount.hidden = false;
    mount.className = "wx-region wx-region--status is-" + model.kind;
    mount.setAttribute("role", model.kind === "error" ? "alert" : "status");
    mount.setAttribute("aria-live", model.kind === "error" ? "assertive" : "polite");
    mount.innerHTML = "";

    var box = WX.el("div", "wx-status wx-status--" + model.kind);

    if (model.kind === "loading") {
      var spinner = WX.el("span", "wx-status__spinner");
      spinner.setAttribute("aria-hidden", "true");
      box.appendChild(spinner);
    } else {
      var icon = WX.el("span", "wx-status__icon", ICONS[model.kind] || "");
      icon.setAttribute("aria-hidden", "true");
      box.appendChild(icon);
    }

    var text = WX.el("div", "wx-status__text");
    text.appendChild(WX.el("strong", "wx-status__title", model.title));
    if (model.detail) text.appendChild(WX.el("span", "wx-status__detail", model.detail));
    box.appendChild(text);

    if (model.retry) {
      var btn = WX.el("button", "wx-status__action", "Retry");
      btn.type = "button";
      btn.setAttribute("data-status-action", "retry");
      box.appendChild(btn);
    }

    mount.appendChild(box);
  }

  // ------------------------------------------------------------------- init

  WX.status = {
    init: function () {
      if (bound) {
        render();
        return;
      }
      bound = true;

      WX.events.on("city:changed", onCityChanged);
      WX.events.on("weather:loaded", onLoaded);
      WX.events.on("weather:failed", onFailed);
      // Repaints for these events come from script.js renderAll() (-> status.render).
      // This module only calls render() itself for things no event covers:
      // the slow-load timer, the "back online" notice and browser online/offline.

      window.addEventListener("offline", onBrowserOffline);
      window.addEventListener("online", onBrowserOnline);

      document.addEventListener("click", function (event) {
        var target = event.target;
        if (target && target.closest && target.closest("[data-status-action='retry']")) retry();
      });

      // Opened while offline with nothing on screen: show the last saved forecast.
      if (offlineNow() && !WX.state.weather) {
        var last = WX.storage.readLastWeather();
        if (last) restore(last, "offline");
      }

      render();
    },

    render: render,

    // Exposed for the leader's script.js / debugging.
    retry: retry
  };
})(window.WX = window.WX || {});