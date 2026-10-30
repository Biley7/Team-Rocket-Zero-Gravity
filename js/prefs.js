// WeatherHack — favourite cities and the C/F toggle UI.
// OWNER: Dighal. Replace the placeholders below.
//
// Wired for you already:
//   WX.units.toggle()                  flips C/F, persists to wx.units,
//                                      sets <body data-units> and emits units:changed
//   WX.storage.get/set/remove          only place allowed to touch localStorage
//   WX.storage.KEYS.FAVOURITES         "wx.favourites"
//   WX.loadWeather(cityRef)            loads a city (deduped, cached)
//   WX.city.select(cityRef)            loads a city and updates the selected city
//
// A favourite must be stored as a cityRef only:
//   { id, name, country, countryCode, region, district, latitude, longitude, timezone }
// Never store the whole normalized weather object in the favourites list.
(function (WX) {
  "use strict";

  WX.prefs = {
    init: function () {},

    renderFavourites: function () {
      var mount = WX.$("#favourites");
      if (!mount) return;
      mount.innerHTML = '<p class="wx-empty">Favourites region ready — owned by Dighal (js/prefs.js).</p>';
    },

    renderUnitsToggle: function () {
      var mount = WX.$("#units-toggle");
      if (!mount) return;
      mount.innerHTML = "";
    }
  };
})(window.WX = window.WX || {});
