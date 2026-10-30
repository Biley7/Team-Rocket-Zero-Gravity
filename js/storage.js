// WeatherHack — localStorage facade.
// OWNER: Dighal. This file deliberately contains only the generic read/write
// layer. Add favourites/cache helpers here as your features land.
// Rule: no other module may touch window.localStorage directly.
(function (WX) {
  "use strict";

  // Namespaced keys so three owners never overwrite each other (ARCHITECTURE.md 3.4).
  var KEYS = {
    FAVOURITES: "wx.favourites",  // [Dighal]
    UNITS: "wx.units",            // [Dighal]
    CACHE: "wx.cache"             // [Dighal]
  };

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

  WX.storage = {
    KEYS: KEYS,

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
    }
  };
})(window.WX = window.WX || {});
