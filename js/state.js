// WeatherHack — shared application state.
// OWNER: Core (frontend architect). Shape is the contract in ARCHITECTURE.md section 4.2.
// Everything the UI needs lives here so no module has to reach into another module.
(function (WX) {
  "use strict";

  WX.state = {
    city: null,        // cityRef of the selected city (section 4.3)
    weather: null,     // normalized weather object (section 4.1) or null
    units: "C",        // "C" | "F"                          [Dighal]
    favourites: [],    // array of cityRef                    [Dighal]
    status: "idle",    // idle | loading | ready | error | offline  [Dighal]
    error: null,       // { code, message } | null            [Dighal]
    source: "network"  // network | cache                     [Dighal]
  };

  // Shallow merge + change notification. Always write through this, never by
  // assigning to WX.state directly, so persistence and rendering stay in sync.
  WX.set = function (patch) {
    if (!patch) return WX.state;
    var changed = [];
    Object.keys(patch).forEach(function (key) {
      if (WX.state[key] !== patch[key]) {
        WX.state[key] = patch[key];
        changed.push(key);
      }
    });
    if (changed.length) {
      WX.events.emit("state:changed", { keys: changed, state: WX.state });
    }
    return WX.state;
  };

  WX.get = function () {
    return WX.state;
  };

  // Shared DOM helpers — every module uses these instead of defining its own.
  WX.$ = function (selector, root) {
    return (root || document).querySelector(selector);
  };
  WX.$$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };
  WX.el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
})(window.WX = window.WX || {});
