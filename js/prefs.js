// WeatherHack — favourite cities and the C/F toggle UI.
// OWNER: Dighal.
// Regions owned: #favourites, #units-toggle.
//
// Favourites are stored as cityRef only (never the whole weather object):
//   { id, name, country, countryCode, region, district, latitude, longitude, timezone }
// Persistence goes through WX.storage (wx.favourites); units through WX.units (wx.units).
(function (WX) {
  "use strict";

  var MAX_FAVOURITES = 10;
  var NOTE_MS = 3500;

  var noteTimer = null;
  var bound = false;

  // ---------------------------------------------------------------- helpers

  function keyOf(city) {
    return WX.api && WX.api.coordKey ? WX.api.coordKey(city) : "";
  }

  function list() {
    return Array.isArray(WX.state.favourites) ? WX.state.favourites : [];
  }

  function indexOfCity(city) {
    var key = keyOf(city);
    if (!key) return -1;
    var items = list();
    for (var i = 0; i < items.length; i++) {
      if (keyOf(items[i]) === key) return i;
    }
    return -1;
  }

  function findByKey(key) {
    var items = list();
    for (var i = 0; i < items.length; i++) {
      if (keyOf(items[i]) === key) return items[i];
    }
    return null;
  }

  function persist(next) {
    WX.storage.writeFavourites(next);
    WX.set({ favourites: next }); // always a new array so WX.set sees a change
    WX.events.emit("favourites:changed", next);
  }

  function note(text) {
    var node = WX.$("#fav-note");
    if (!node) return;
    node.textContent = text || "";
    clearTimeout(noteTimer);
    if (text) {
      noteTimer = setTimeout(function () { node.textContent = ""; }, NOTE_MS);
    }
  }

  function selectCity(city) {
    var fn = WX.city && WX.city.select ? WX.city.select : WX.loadWeather;
    if (fn) fn(city);
  }

  // ------------------------------------------------------- favourites: logic

  function has(city) {
    return indexOfCity(city) > -1;
  }

  function add(city) {
    var ref = WX.storage.toCityRef(city);
    if (!ref || !keyOf(ref)) return false;
    if (has(ref)) return false;
    if (list().length >= MAX_FAVOURITES) {
      note("You can save up to " + MAX_FAVOURITES + " cities. Remove one first.");
      return false;
    }
    persist(list().concat([ref]));
    note(ref.name + " added to favourites.");
    return true;
  }

  function remove(city) {
    var key = keyOf(city);
    if (!key) return false;
    var items = list();
    var next = items.filter(function (item) { return keyOf(item) !== key; });
    if (next.length === items.length) return false;
    persist(next);
    note((city.name || "City") + " removed from favourites.");
    return true;
  }

  function toggle(city) {
    return has(city) ? remove(city) : add(city);
  }

  // ------------------------------------------------------ favourites: render

  function buildFavourites(mount) {
    mount.innerHTML =
      '<section class="wx-card wx-favs" aria-labelledby="favs-title">' +
        '<header class="wx-favs__head">' +
          '<h2 id="favs-title" class="wx-favs__title">Favourite cities</h2>' +
          '<button id="fav-toggle" class="wx-fav-toggle" type="button" aria-pressed="false"></button>' +
        '</header>' +
        '<p id="fav-note" class="wx-favs__note" role="status" aria-live="polite"></p>' +
        '<ul id="fav-list" class="wx-favs__list"></ul>' +
        '<p id="fav-empty" class="wx-empty">No favourites yet. Search for a city, then save it here.</p>' +
      '</section>';
  }

  function renderFavourites() {
    var mount = WX.$("#favourites");
    if (!mount) return;
    if (!mount.querySelector(".wx-favs")) buildFavourites(mount);

    var toggleBtn = WX.$("#fav-toggle", mount);
    var listEl = WX.$("#fav-list", mount);
    var emptyEl = WX.$("#fav-empty", mount);
    var city = WX.state.city;
    var items = list();

    // "Save / remove current city" button
    if (!city) {
      toggleBtn.disabled = true;
      toggleBtn.setAttribute("aria-pressed", "false");
      toggleBtn.removeAttribute("aria-label");
      toggleBtn.textContent = "\u2606 Save city";
      toggleBtn.title = "Search for a city first";
    } else if (has(city)) {
      toggleBtn.disabled = false;
      toggleBtn.setAttribute("aria-pressed", "true");
      toggleBtn.setAttribute("aria-label", "Remove " + city.name + " from favourites");
      toggleBtn.textContent = "\u2605 Saved";
      toggleBtn.title = "Remove " + city.name + " from favourites";
    } else {
      toggleBtn.disabled = false;
      toggleBtn.setAttribute("aria-pressed", "false");
      toggleBtn.setAttribute("aria-label", "Add " + city.name + " to favourites");
      toggleBtn.textContent = "\u2606 Save " + city.name;
      toggleBtn.title = "Add " + city.name + " to favourites";
    }

    // Chips
    var activeKey = keyOf(city);
    listEl.innerHTML = "";
    items.forEach(function (fav) {
      var key = keyOf(fav);
      var active = key === activeKey;

      var li = WX.el("li", "wx-fav" + (active ? " is-active" : ""));

      var pick = WX.el("button", "wx-fav__pick");
      pick.type = "button";
      pick.setAttribute("data-fav-select", key);
      var meta = [fav.region, fav.countryCode || fav.country].filter(Boolean).join(", ");
      pick.setAttribute("aria-label", "Show weather for " + fav.name + (meta ? ", " + meta : ""));
      if (active) pick.setAttribute("aria-current", "true");
      pick.appendChild(WX.el("span", "wx-fav__name", fav.name));
      if (meta) pick.appendChild(WX.el("span", "wx-fav__meta", meta));
      li.appendChild(pick);

      var rm = WX.el("button", "wx-fav__remove", "\u00D7");
      rm.type = "button";
      rm.setAttribute("data-fav-remove", key);
      rm.setAttribute("aria-label", "Remove " + fav.name + " from favourites");
      li.appendChild(rm);

      listEl.appendChild(li);
    });

    emptyEl.classList.toggle("is-hidden", items.length > 0);
    emptyEl.hidden = items.length > 0;
  }

  // ----------------------------------------------------- units toggle: render

  function renderUnitsToggle() {
    var mount = WX.$("#units-toggle");
    if (!mount) return;

    var btn = mount.querySelector(".wx-switch");
    if (!btn) {
      mount.innerHTML =
        '<button id="units-switch" class="wx-switch" type="button" role="switch" ' +
          'aria-label="Show temperatures in Fahrenheit">' +
          '<span class="wx-switch__label wx-switch__label--c" aria-hidden="true">\u00B0C</span>' +
          '<span class="wx-switch__track" aria-hidden="true"><span class="wx-switch__thumb"></span></span>' +
          '<span class="wx-switch__label wx-switch__label--f" aria-hidden="true">\u00B0F</span>' +
        '</button>';
      btn = mount.querySelector(".wx-switch");
    }

    var isF = WX.units.current === "F";
    btn.setAttribute("aria-checked", isF ? "true" : "false"); // "on" = Fahrenheit
    btn.setAttribute("data-unit", isF ? "f" : "c");
  }

  // ------------------------------------------------------------------ events

  // One delegated listener on document: survives re-renders and works even if
  // a mount point is rebuilt by someone else.
  function onClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var pick = target.closest("[data-fav-select]");
    if (pick) {
      var chosen = findByKey(pick.getAttribute("data-fav-select"));
      if (chosen) selectCity(chosen);
      return;
    }

    var rm = target.closest("[data-fav-remove]");
    if (rm) {
      var doomed = findByKey(rm.getAttribute("data-fav-remove"));
      if (doomed) remove(doomed);
      var toggleBtn = WX.$("#fav-toggle"); // the chip is gone, so move focus somewhere sensible
      if (toggleBtn && !toggleBtn.disabled) toggleBtn.focus();
      return;
    }

    if (target.closest("#fav-toggle")) {
      if (WX.state.city) toggle(WX.state.city);
      return;
    }

    if (target.closest("#units-toggle .wx-switch")) {
      WX.units.toggle();
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener("click", onClick);

    // No self-rendering here: script.js renderAll() repaints this region on
    // "favourites:changed", "city:changed" and "units:changed".

    // Keep several open tabs in sync.
    window.addEventListener("storage", function (event) {
      if (!event.key) return;
      if (event.key === WX.storage.KEYS.FAVOURITES) {
        var fresh = WX.storage.readFavourites();
        WX.set({ favourites: fresh });
        WX.events.emit("favourites:changed", fresh); // triggers renderAll
      } else if (event.key === WX.storage.KEYS.UNITS) {
        WX.units.set(WX.storage.get(WX.storage.KEYS.UNITS, "C"));
      }
    });
  }

  // -------------------------------------------------------------------- init

  WX.prefs = {
    init: function () {
      // units.init() is called by script.js just before this. The first paint
      // comes from the renderAll() at the end of WX.boot().
      WX.set({ favourites: WX.storage.readFavourites() });        // restores saved favourites
      bind();
    },

    renderFavourites: renderFavourites,
    renderUnitsToggle: renderUnitsToggle,

    // Programmatic API (handy for tests or a future "star" button elsewhere).
    add: add,
    remove: remove,
    toggle: toggle,
    has: has,
    list: function () { return list().slice(); }
  };
})(window.WX = window.WX || {});