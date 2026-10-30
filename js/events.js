// WeatherHack — shared event bus.
// OWNER: Core (frontend architect). Interface is frozen; coordinate before changing.
// Purpose: lets each module react to state changes without calling into another
// module's render pipeline. See ARCHITECTURE.md section 4.5.
(function (WX) {
  "use strict";

  var listeners = Object.create(null);

  WX.events = {
    // Returns an unsubscribe function.
    on: function (name, handler) {
      if (typeof handler !== "function") return function () {};
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(handler);
      return function off() {
        var arr = listeners[name];
        if (!arr) return;
        var i = arr.indexOf(handler);
        if (i > -1) arr.splice(i, 1);
      };
    },

    emit: function (name, payload) {
      var arr = listeners[name];
      if (!arr) return;
      // Copy first: a handler may unsubscribe while we iterate.
      arr.slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (err) {
          console.error("[WX.events] handler failed for '" + name + "'", err);
        }
      });
    },

    clear: function (name) {
      if (name) delete listeners[name];
      else listeners = Object.create(null);
    }
  };
})(window.WX = window.WX || {});
