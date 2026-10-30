// WeatherHack — localStorage facade.
// OWNER: Dighal.
// Rule: no other module may touch window.localStorage directly.
//
// Generic layer : get / set / remove / available
// Favourites    : readFavourites / writeFavourites / toCityRef
// Weather cache : saveWeather / readWeather / readLastWeather / clearWeatherCache
(function (WX) {
  "use strict";

  // Namespaced keys so three owners never overwrite each other (ARCHITECTURE.md 3.4).
  var KEYS = {
    FAVOURITES: "wx.favourites",  // [Dighal]
    UNITS: "wx.units",            // [Dighal]
    CACHE: "wx.cache"             // [Dighal]
  };

  var CACHE_VERSION = 1;
  var MAX_CACHED_CITIES = 5; // keeps the cache well under the ~5 MB localStorage quota

  // Session fallback so the app still works when storage is blocked
  // (Safari private mode, cookies disabled, quota exceeded).
  var memory = Object.create(null);
  var usable = null;

  function canUseStorage() {
    if (usable !== null) return usable;
    try {
      var probe = "wx.probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      usable = true;
    } catch (err) {
      usable = false;
    }
    return usable;
  }

  // ------------------------------------------------------------- city helpers

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  // Same identity rule as WX.api.coordKey (3-decimal lat,lon). Falls back to a
  // local copy so this file never depends on script load order.
  function keyOf(source) {
    if (WX.api && typeof WX.api.coordKey === "function") return WX.api.coordKey(source);
    if (!source || !isNum(Number(source.latitude)) || !isNum(Number(source.longitude))) return "";
    return Number(source.latitude).toFixed(3) + "," + Number(source.longitude).toFixed(3);
  }

  // Reduces anything city-shaped to the cityRef contract:
  // { id, name, country, countryCode, region, district, latitude, longitude, timezone }
  // Returns null when it can't be a usable location.
  function toCityRef(source) {
    if (!source || typeof source !== "object") return null;
    if (!source.name || !isNum(source.latitude) || !isNum(source.longitude)) return null;
    return {
      id: source.id != null ? source.id : null,
      name: String(source.name),
      country: source.country || "",
      countryCode: source.countryCode || "",
      region: source.region || "",
      district: source.district || "",
      latitude: source.latitude,
      longitude: source.longitude,
      timezone: source.timezone || "UTC"
    };
  }

  function looksLikeWeather(weather) {
    return !!(
      weather &&
      weather.city &&
      weather.current &&
      weather.hourly &&
      Array.isArray(weather.daily) &&
      isNum(weather.fetchedAt)
    );
  }

  // ------------------------------------------------------------- cache store

  // Shape: { v: 1, last: "<coordKey>", entries: { "<coordKey>": { savedAt, weather } } }
  function emptyStore() {
    return { v: CACHE_VERSION, last: null, entries: {} };
  }

  function readStore() {
    var store = storage.get(KEYS.CACHE, null);
    if (!store || store.v !== CACHE_VERSION || !store.entries || typeof store.entries !== "object") {
      return emptyStore();
    }
    return store;
  }

  function prune(store) {
    var keys = Object.keys(store.entries).sort(function (a, b) {
      return store.entries[b].savedAt - store.entries[a].savedAt; // newest first
    });
    keys.slice(MAX_CACHED_CITIES).forEach(function (key) {
      delete store.entries[key];
    });
    if (store.last && !store.entries[store.last]) store.last = keys[0] || null;
  }

  // ------------------------------------------------------------------ public

  var storage = {
    KEYS: KEYS,
    toCityRef: toCityRef,

    available: function () {
      return canUseStorage();
    },

    get: function (key, fallback) {
      if (canUseStorage()) {
        try {
          var raw = window.localStorage.getItem(key);
          if (raw !== null) return JSON.parse(raw);
        } catch (err) {
          // Corrupt JSON or a blocked read — fall through to the session copy.
        }
      }
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
    },

    set: function (key, value) {
      memory[key] = value;
      if (!canUseStorage()) return false;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        return false; // quota exceeded — session copy still holds the value
      }
    },

    remove: function (key) {
      delete memory[key];
      if (!canUseStorage()) return;
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        /* nothing useful to do */
      }
    },

    // ---- favourites (cityRef[] only — never whole weather objects) ----------

    readFavourites: function () {
      var raw = storage.get(KEYS.FAVOURITES, []);
      if (!Array.isArray(raw)) return [];
      var seen = Object.create(null);
      var out = [];
      raw.forEach(function (item) {
        var ref = toCityRef(item);
        var key = ref ? keyOf(ref) : "";
        if (!ref || !key || seen[key]) return;
        seen[key] = true;
        out.push(ref);
      });
      return out;
    },

    writeFavourites: function (list) {
      var clean = (Array.isArray(list) ? list : []).map(toCityRef).filter(Boolean);
      return storage.set(KEYS.FAVOURITES, clean);
    },

    // ---- weather cache -----------------------------------------------------

    // Call after every successful network fetch.
    saveWeather: function (weather) {
      if (!looksLikeWeather(weather)) return false;
      var key = keyOf(weather.city);
      if (!key) return false;

      var store = readStore();
      store.entries[key] = { savedAt: Date.now(), weather: weather };
      store.last = key;
      prune(store);

      if (!storage.set(KEYS.CACHE, store)) {
        // Quota hit: keep only the newest entry and try once more.
        var slim = emptyStore();
        slim.entries[key] = store.entries[key];
        slim.last = key;
        return storage.set(KEYS.CACHE, slim);
      }
      return true;
    },

    // Last good result for this exact city, or null.
    readWeather: function (city) {
      var key = keyOf(city);
      if (!key) return null;
      var entry = readStore().entries[key];
      return entry && looksLikeWeather(entry.weather) ? entry.weather : null;
    },

    // Most recent good result for any city, or null.
    readLastWeather: function () {
      var store = readStore();
      var entry = store.last ? store.entries[store.last] : null;
      return entry && looksLikeWeather(entry.weather) ? entry.weather : null;
    },

    clearWeatherCache: function () {
      storage.remove(KEYS.CACHE);
    }
  };

  WX.storage = storage;
})(window.WX = window.WX || {});