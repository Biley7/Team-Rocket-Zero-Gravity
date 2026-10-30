// WeatherHack — side-by-side city comparison.
// OWNER: Core (frontend architect).
// Region owned: #compare.
//
// The comparison keeps its OWN copy of each city's weather in module-local
// state. It never writes WX.state.city or WX.state.weather, so comparing two
// cities can never disturb the dashboard's selected city, its favourites or
// the Celsius/Fahrenheit preference.
//
// It reuses the shared services rather than re-implementing them:
//   WX.api.searchCities  — the existing Open-Meteo geocoding path
//   WX.api.fetchForecast — cached and de-duplicated by coordinates
//   WX.units             — every temperature/percent/wind label
//   WX.time              — each city's own clock (from its UTC offset)
(function (WX) {
  "use strict";

  var REGION = "#compare";
  var DEBOUNCE_MS = 280;
  var MIN_QUERY = 2;
  var SUGGESTION_LIMIT = 6;
  var CLOCK_TICK_MS = 30000;
  var NOTE_MS = 4000;

  // A difference smaller than this is "the same" — it keeps the summary honest
  // and stops the indicators from flagging noise.
  var TEMP_THRESHOLD = 1;      // °C
  var RAIN_THRESHOLD = 10;     // percentage points
  var WIND_THRESHOLD = 6;      // km/h
  var HUMIDITY_THRESHOLD = 5;  // percentage points
  var UV_THRESHOLD = 1;

  var SLOTS = ["a", "b"];
  var SLOT_LABEL = { a: "City A", b: "City B" };
  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "WNW", "NW", "NNW"];

  var els = {};
  var open = false;
  var note = "";
  var noteTimer = null;
  var bound = false;
  var slots = { a: createSlot("a"), b: createSlot("b") };

  // ---------------------------------------------------------------- helpers

  function createSlot(key) {
    return {
      key: key,
      label: SLOT_LABEL[key],
      city: null,
      weather: null,
      status: "idle",   // idle | loading | ready | error
      error: null,
      suggestions: [],
      active: -1,
      debounceId: null,
      searchSeq: 0,
      loadSeq: 0,
      searchController: null,
      forecastController: null
    };
  }

  function otherKey(key) {
    return key === "a" ? "b" : "a";
  }

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  function keyOf(city) {
    return city && WX.api ? WX.api.coordKey(city) : "";
  }

  function placeLabel(city) {
    if (!city) return "";
    return [city.region, city.country].filter(Boolean).join(", ");
  }

  function cityName(weather) {
    return weather && weather.city ? weather.city.name : "This city";
  }

  function flagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "";
    var points = countryCode.toUpperCase().split("").map(function (ch) {
      return 127397 + ch.charCodeAt(0);
    });
    return String.fromCodePoint.apply(String, points);
  }

  function uvLabel(value) {
    if (!isNum(value)) return "";
    if (value < 3) return "Low";
    if (value < 6) return "Moderate";
    if (value < 8) return "High";
    if (value < 11) return "Very high";
    return "Extreme";
  }

  function compassPoint(degrees) {
    if (!isNum(degrees)) return "";
    return COMPASS[Math.round(degrees / 22.5) % 16];
  }

  function friendly(err) {
    if (WX.errors && typeof WX.errors.friendly === "function") return WX.errors.friendly(err);
    return "Something went wrong while loading the weather.";
  }

  function today(weather) {
    return weather && weather.daily && weather.daily.length ? weather.daily[0] : null;
  }

  // A signed difference, e.g. "+6%" / "−3 km/h". Used only for INDICATORS, so
  // the sign is what carries the meaning.
  function signedText(diff, suffix, decimals) {
    var size = Math.abs(diff);
    var text = decimals ? size.toFixed(decimals) : String(Math.round(size));
    return (diff > 0 ? "+" : "\u2212") + text + suffix;
  }

  function deltaText(kind, diff) {
    switch (kind) {
      case "temp": return WX.units.formatDelta(diff, { sign: true });
      case "percent": return signedText(diff, "%", 0);
      case "wind": return signedText(diff, " km/h", 0);
      default: return signedText(diff, "", uvDecimals(diff));
    }
  }

  function uvDecimals(diff) {
    return Math.abs(diff) % 1 === 0 ? 0 : 1;
  }

  // --------------------------------------------------------- metric contract

  // One list, one order: both cards render these rows in the same sequence so
  // the eye can travel straight across.
  var METRICS = [
    {
      key: "feelsLike",
      label: "Feels like",
      read: function (w) { return w.current.feelsLike; },
      format: function (v) { return WX.units.formatTemp(v, { unit: true }); },
      delta: "temp",
      threshold: TEMP_THRESHOLD
    },
    {
      key: "humidity",
      label: "Humidity",
      read: function (w) { return w.current.humidity; },
      format: function (v) { return WX.units.formatPercent(v); },
      delta: "percent",
      threshold: HUMIDITY_THRESHOLD
    },
    {
      key: "wind",
      label: "Wind speed",
      read: function (w) { return w.current.windSpeed; },
      format: function (v) { return WX.units.formatWind(v); },
      delta: "wind",
      threshold: WIND_THRESHOLD
    },
    {
      key: "windDirection",
      label: "Wind direction",
      read: function (w) { return w.current.windDirection; },
      format: function (v) { return compassPoint(v) || "\u2014"; },
      delta: null,
      threshold: 0
    },
    {
      key: "rain",
      label: "Rain chance",
      read: function (w) { var d = today(w); return d ? d.precipitationProbabilityMax : null; },
      format: function (v) { return WX.units.formatPercent(v); },
      delta: "percent",
      threshold: RAIN_THRESHOLD
    },
    {
      key: "high",
      label: "Today's high",
      read: function (w) { var d = today(w); return d ? d.tempMax : null; },
      format: function (v) { return WX.units.formatTemp(v, { unit: true }); },
      delta: "temp",
      threshold: TEMP_THRESHOLD
    },
    {
      key: "low",
      label: "Today's low",
      read: function (w) { var d = today(w); return d ? d.tempMin : null; },
      format: function (v) { return WX.units.formatTemp(v, { unit: true }); },
      delta: "temp",
      threshold: TEMP_THRESHOLD
    },
    {
      key: "uv",
      label: "UV index",
      read: function (w) { var d = today(w); return d ? d.uvIndexMax : null; },
      format: function (v) { return Math.round(v) + " \u00B7 " + uvLabel(v); },
      delta: "plain",
      threshold: UV_THRESHOLD
    }
  ];

  var TEMP_METRIC = {
    key: "temperature",
    label: "Temperature",
    read: function (w) { return w.current.temperature; },
    format: function (v) { return WX.units.formatTemp(v, { unit: true }); },
    delta: "temp",
    threshold: TEMP_THRESHOLD
  };

  // Only the side that is meaningfully ahead gets an indicator, so a comparison
  // never turns into two competing badges. Values are read from the normalized
  // contract (ARCHITECTURE.md 4.1) — never from raw API field names.
  function metricCells(metric, mine, theirs) {
    var mineValue = metric.read(mine);
    var theirValue = theirs ? metric.read(theirs) : null;
    var cells = {
      value: isNum(mineValue) ? metric.format(mineValue) : "\u2014",
      chip: null
    };

    if (!metric.delta || !isNum(mineValue) || !isNum(theirValue)) return cells;

    var diff = mineValue - theirValue;
    if (Math.abs(diff) < metric.threshold) return cells;

    cells.chip = {
      text: deltaText(metric.delta, Math.abs(diff)),
      dir: "up",
      title: "Higher than " + cityName(theirs) + " by " + deltaText(metric.delta, Math.abs(diff))
    };
    return cells;
  }

  // ----------------------------------------------------- deterministic summary

  function rainChance(weather) {
    var day = today(weather);
    return day ? day.precipitationProbabilityMax : null;
  }

  // Pure function of the two normalized objects: same inputs, same sentences.
  // No AI, no network, no randomness.
  function buildSummary(weatherA, weatherB) {
    var lines = [];
    var nameA = cityName(weatherA);
    var nameB = cityName(weatherB);

    var tempA = weatherA.current.temperature;
    var tempB = weatherB.current.temperature;
    if (isNum(tempA) && isNum(tempB) && Math.abs(tempA - tempB) >= TEMP_THRESHOLD) {
      var warmer = tempA > tempB ? nameA : nameB;
      var cooler = tempA > tempB ? nameB : nameA;
      lines.push(warmer + " is currently " +
        WX.units.formatDelta(Math.abs(tempA - tempB), { unit: true }) +
        " warmer than " + cooler + ".");
    }

    var rainA = rainChance(weatherA);
    var rainB = rainChance(weatherB);
    if (isNum(rainA) && isNum(rainB) && Math.abs(rainA - rainB) >= RAIN_THRESHOLD) {
      lines.push((rainA > rainB ? nameA : nameB) + " has a higher chance of rain today (" +
        Math.round(Math.max(rainA, rainB)) + "% vs " + Math.round(Math.min(rainA, rainB)) + "%).");
    }

    var windA = weatherA.current.windSpeed;
    var windB = weatherB.current.windSpeed;
    if (isNum(windA) && isNum(windB) && Math.abs(windA - windB) >= WIND_THRESHOLD) {
      lines.push((windA > windB ? nameA : nameB) + " has stronger winds (" +
        WX.units.formatWind(Math.max(windA, windB)) + " vs " +
        WX.units.formatWind(Math.min(windA, windB)) + ").");
    }

    var humA = weatherA.current.humidity;
    var humB = weatherB.current.humidity;
    if (isNum(humA) && isNum(humB) && Math.abs(humA - humB) >= HUMIDITY_THRESHOLD) {
      lines.push((humA > humB ? nameA : nameB) + " is more humid (" +
        Math.round(Math.max(humA, humB)) + "% vs " + Math.round(Math.min(humA, humB)) + "%).");
    }

    if (!lines.length) {
      lines.push("Both cities are currently experiencing similar conditions.");
    }
    return lines;
  }

  // ------------------------------------------------------------------ markup

  function pickerMarkup(key) {
    var label = SLOT_LABEL[key];
    return '<div class="wx-cmp__picker">' +
        '<label class="wx-cmp__picker-label" for="cmp-input-' + key + '">' + label + '</label>' +
        '<div class="wx-cmp__field">' +
          '<input id="cmp-input-' + key + '" class="wx-cmp__input" type="text" autocomplete="off" ' +
            'placeholder="Search a city" role="combobox" aria-expanded="false" ' +
            'aria-controls="cmp-results-' + key + '" aria-autocomplete="list" ' +
            'aria-label="' + label + ', search for a city">' +
          '<button id="cmp-clear-' + key + '" class="wx-cmp__clear" type="button" ' +
            'aria-label="Clear ' + label + '" data-cmp-clear="' + key + '" hidden>\u00D7</button>' +
        '</div>' +
        '<ul id="cmp-results-' + key + '" class="wx-cmp__results" role="listbox" ' +
          'aria-label="' + label + ' suggestions"></ul>' +
      '</div>';
  }

  function build() {
    var mount = WX.$(REGION);
    if (!mount) return false;
    if (mount.querySelector(".wx-cmp")) return true; // idempotent

    mount.innerHTML =
      '<article class="wx-card wx-cmp" aria-labelledby="cmp-title">' +
        '<header class="wx-cmp__head">' +
          '<div class="wx-cmp__intro">' +
            '<h2 id="cmp-title" class="wx-cmp__title">Compare cities</h2>' +
            '<p class="wx-cmp__sub">Put two cities side by side. The dashboard above keeps its own city and its own settings.</p>' +
          '</div>' +
          '<div class="wx-cmp__actions">' +
            '<button id="cmp-launch" class="wx-cmp__btn wx-cmp__btn--primary" type="button" ' +
              'aria-expanded="false" aria-controls="cmp-panel">Compare cities</button>' +
            '<button id="cmp-refresh" class="wx-cmp__btn" type="button" hidden>Refresh</button>' +
            '<button id="cmp-swap" class="wx-cmp__btn" type="button" hidden>Swap cities</button>' +
            '<button id="cmp-close" class="wx-cmp__btn" type="button" hidden>Exit comparison</button>' +
          '</div>' +
        '</header>' +
        '<div id="cmp-panel" class="wx-cmp__panel" hidden>' +
          '<div class="wx-cmp__pickers">' + pickerMarkup("a") + pickerMarkup("b") + '</div>' +
          '<p id="cmp-message" class="wx-cmp__message" role="status" aria-live="polite" hidden></p>' +
          '<div id="cmp-cards" class="wx-cmp__cards"></div>' +
          '<div class="wx-cmp__summary">' +
            '<h3 class="wx-cmp__summary-title">How they compare</h3>' +
            '<ul id="cmp-summary-list" class="wx-cmp__summary-list"></ul>' +
            '<p id="cmp-summary-empty" class="wx-cmp__summary-empty">Pick two cities to see how they compare.</p>' +
          '</div>' +
        '</div>' +
      '</article>';

    els.root = WX.$(".wx-cmp", mount);
    els.launch = WX.$("#cmp-launch", mount);
    els.close = WX.$("#cmp-close", mount);
    els.swap = WX.$("#cmp-swap", mount);
    els.refresh = WX.$("#cmp-refresh", mount);
    els.panel = WX.$("#cmp-panel", mount);
    els.message = WX.$("#cmp-message", mount);
    els.cards = WX.$("#cmp-cards", mount);
    els.summaryList = WX.$("#cmp-summary-list", mount);
    els.summaryEmpty = WX.$("#cmp-summary-empty", mount);

    SLOTS.forEach(function (key) {
      var slot = slots[key];
      slot.input = WX.$("#cmp-input-" + key, mount);
      slot.clearBtn = WX.$("#cmp-clear-" + key, mount);
      slot.results = WX.$("#cmp-results-" + key, mount);
      slot.picker = slot.input.closest(".wx-cmp__picker");
    });

    return true;
  }

  // ------------------------------------------------------------- city cards

  function chipNode(chip) {
    var node = WX.el("span", "wx-cmp__delta", chip.text);
    node.setAttribute("data-dir", chip.dir);
    node.setAttribute("title", chip.title);
    return node;
  }

  function retryButton(key) {
    var btn = WX.el("button", "wx-cmp__btn wx-cmp__btn--small", "Try again");
    btn.type = "button";
    btn.setAttribute("data-cmp-retry", key);
    btn.setAttribute("aria-label", "Try loading " + SLOT_LABEL[key] + " again");
    return btn;
  }

  // Each city shows ITS OWN wall clock: the offset comes from that city's
  // forecast response, not from the viewer's timezone.
  function offsetOf(slot) {
    var city = slot.weather ? slot.weather.city : null;
    return city && isNum(city.utcOffsetSeconds) ? city.utcOffsetSeconds : null;
  }

  function clockText(slot) {
    var offset = offsetOf(slot);
    if (offset === null) return "";
    return "Local time " + WX.time.offsetClock(offset);
  }

  function updatedText(slot) {
    return slot.weather ? "Updated " + WX.time.relative(slot.weather.fetchedAt) : "";
  }

  function buildCard(slot, other) {
    var card = WX.el("div", "wx-cmp__card");
    card.setAttribute("data-slot", slot.key);

    if (!slot.city) {
      card.classList.add("wx-cmp__card--empty");
      var placeholder = WX.el("div", "wx-cmp__placeholder");
      placeholder.appendChild(WX.el("p", "wx-cmp__placeholder-title", slot.label));
      placeholder.appendChild(WX.el("p", "wx-cmp__placeholder-text",
        "Search for a city above to start the comparison."));
      card.appendChild(placeholder);
      return card;
    }

    var nameId = "cmp-card-" + slot.key + "-name";
    var head = WX.el("header", "wx-cmp__card-head");
    var flag = flagEmoji(slot.city.countryCode);
    if (flag) head.appendChild(WX.el("p", "wx-cmp__flag", flag));
    var name = WX.el("h3", "wx-cmp__city", slot.city.name);
    name.id = nameId;
    head.appendChild(name);
    head.appendChild(WX.el("p", "wx-cmp__region", placeLabel(slot.city) || slot.city.timezone || ""));
    var clock = WX.el("p", "wx-cmp__clock");
    clock.setAttribute("data-cmp-clock", slot.key);
    clock.textContent = clockText(slot);
    head.appendChild(clock);
    var updated = WX.el("p", "wx-cmp__updated");
    updated.setAttribute("data-cmp-updated", slot.key);
    updated.textContent = updatedText(slot);
    head.appendChild(updated);
    card.appendChild(head);
    card.setAttribute("role", "group");
    card.setAttribute("aria-labelledby", nameId);

    var weather = slot.weather;
    if (!weather) {
      var state = WX.el("div", "wx-cmp__state");
      if (slot.status === "loading") {
        state.classList.add("is-loading");
        state.appendChild(WX.el("p", "wx-cmp__state-text", "Loading the latest conditions\u2026"));
      } else {
        state.appendChild(WX.el("p", "wx-cmp__state-text wx-cmp__state-text--error",
          slot.error || "This city's forecast is unavailable right now."));
        state.appendChild(retryButton(slot.key));
      }
      card.appendChild(state);
      return card;
    }

    var otherWeather = other.weather;

    // Big reading first: temperature plus the condition, so the two cards can
    // be understood at a glance before the row-by-row detail.
    var hero = WX.el("div", "wx-cmp__hero");
    var icon = WX.el("span", "wx-cmp__icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = WX.wmo.iconSvg(weather.current.icon);
    hero.appendChild(icon);

    var reading = WX.el("div", "wx-cmp__reading");
    var cell = metricCells(TEMP_METRIC, weather, otherWeather);
    var temp = WX.el("p", "wx-cmp__temp", cell.value);
    if (cell.chip) temp.appendChild(chipNode(cell.chip));
    reading.appendChild(temp);
    reading.appendChild(WX.el("p", "wx-cmp__desc", weather.current.description));
    hero.appendChild(reading);
    card.appendChild(hero);

    var list = WX.el("dl", "wx-cmp__metrics");
    METRICS.forEach(function (metric) {
      var cells = metricCells(metric, weather, otherWeather);
      var row = WX.el("div", "wx-cmp__metric");
      row.appendChild(WX.el("dt", "wx-cmp__metric-label", metric.label));
      var value = WX.el("dd", "wx-cmp__metric-value");
      value.appendChild(WX.el("span", "wx-cmp__metric-number", cells.value));
      if (cells.chip) value.appendChild(chipNode(cells.chip));
      row.appendChild(value);
      list.appendChild(row);
    });
    card.appendChild(list);

    if (slot.status === "error") {
      card.appendChild(WX.el("p", "wx-cmp__stale",
        "Showing the last reading \u2014 " + (slot.error || "refresh failed") + "."));
    }

    return card;
  }

  function refreshTimes() {
    if (!els.panel) return;
    SLOTS.forEach(function (key) {
      var clock = els.panel.querySelector('[data-cmp-clock="' + key + '"]');
      if (clock) clock.textContent = clockText(slots[key]);
      var updated = els.panel.querySelector('[data-cmp-updated="' + key + '"]');
      if (updated) updated.textContent = updatedText(slots[key]);
    });
  }

  // ------------------------------------------------------------------ render

  function renderSummary() {
    if (!els.summaryList) return;
    els.summaryList.innerHTML = "";

    var weatherA = slots.a.weather;
    var weatherB = slots.b.weather;

    if (weatherA && weatherB) {
      els.summaryEmpty.hidden = true;
      buildSummary(weatherA, weatherB).forEach(function (text) {
        els.summaryList.appendChild(WX.el("li", "wx-cmp__summary-item", text));
      });
      return;
    }

    var text;
    if (!slots.a.city && !slots.b.city) text = "Pick two cities to see how they compare.";
    else if (slots.a.city && slots.b.city) text = "Waiting for both forecasts\u2026";
    else text = "Select the second city to see the comparison.";
    els.summaryEmpty.textContent = text;
    els.summaryEmpty.hidden = false;
  }

  function notify(text) {
    note = text || "";
    clearTimeout(noteTimer);
    if (els.message) {
      els.message.textContent = note;
      els.message.hidden = !note;
    }
    if (!note) return;
    noteTimer = setTimeout(function () {
      note = "";
      if (els.message) {
        els.message.textContent = "";
        els.message.hidden = true;
      }
    }, NOTE_MS);
    if (noteTimer && typeof noteTimer.unref === "function") noteTimer.unref();
  }

  function render() {
    if (!els.root) return;

    var bothCities = !!(slots.a.city && slots.b.city);

    els.launch.hidden = open;
    els.launch.setAttribute("aria-expanded", open ? "true" : "false");
    els.close.hidden = !open;
    els.swap.hidden = !open || !(slots.a.city || slots.b.city);
    els.refresh.hidden = !open || !bothCities;
    els.panel.hidden = !open;

    SLOTS.forEach(function (key) {
      var slot = slots[key];
      var wanted = slot.city ? slot.city.name : "";
      // Never fight the user while they are typing in the field.
      if (document.activeElement !== slot.input && slot.input.value !== wanted) {
        slot.input.value = wanted;
      }
      slot.clearBtn.hidden = !slot.city;
    });

    if (els.message) {
      els.message.textContent = note;
      els.message.hidden = !note;
    }

    els.cards.innerHTML = "";
    els.cards.appendChild(buildCard(slots.a, slots.b));
    els.cards.appendChild(buildCard(slots.b, slots.a));

    renderSummary();
  }

  // ------------------------------------------------------ comparison actions

  function isClash(slot, city) {
    var key = keyOf(city);
    return !!key && key === keyOf(slots[otherKey(slot.key)].city);
  }

  function openPanel() {
    if (open) return;
    open = true;

    // Seed City A from the dashboard's city: a comparison the user almost
    // always wants, and usually free because that forecast is already cached.
    if (!slots.a.city && !slots.b.city && WX.state.city) {
      assign("a", WX.state.city);
    } else {
      render();
    }

    var focusSlot = slots.a.city ? (slots.b.city ? slots.a : slots.b) : slots.a;
    if (focusSlot && focusSlot.input) focusSlot.input.focus();
  }

  function closePanel() {
    if (!open) return;
    open = false;
    SLOTS.forEach(function (key) { closeSuggestions(slots[key]); });
    render();
    if (els.launch) els.launch.focus();
  }

  // Validates the same-city rule, stores the selection and loads it. Used by
  // the search UI and by the programmatic API (WX.compare.pick).
  function assign(key, city) {
    var slot = slots[key];

    if (!city || !keyOf(city)) {
      notify("That location could not be resolved. Try another search.");
      return false;
    }
    if (isClash(slot, city)) {
      notify(SLOT_LABEL[key] + " and " + SLOT_LABEL[otherKey(key)] +
        " must be different cities \u2014 " + slots[otherKey(key)].city.name +
        " is already on the other side.");
      return false;
    }

    slot.city = city;
    slot.weather = WX.api.peekCache(city); // instant repaint when we already have it
    slot.status = "loading";
    slot.error = null;
    render();
    loadSlot(key);
    return true;
  }

  function clearSlot(key) {
    var slot = slots[key];
    abortSearch(slot);
    abortForecast(slot);
    slot.searchSeq++;
    slot.loadSeq++;
    slot.city = null;
    slot.weather = null;
    slot.status = "idle";
    slot.error = null;
    resetSuggestions(slot);
    slot.input.value = "";
    slot.clearBtn.hidden = true;
    render();
  }

  function swap() {
    var a = slots.a;
    var b = slots.b;
    if (!a.city && !b.city) return;

    // Invalidate anything in flight so a late response cannot land in the card
    // it was never meant for, then restart the slots that were still loading.
    var restart = [];
    SLOTS.forEach(function (key) {
      var slot = slots[key];
      if (slot.city && slot.status === "loading") restart.push(key);
      abortSearch(slot);
      abortForecast(slot);
      slot.loadSeq++;
    });

    ["city", "weather", "status", "error"].forEach(function (prop) {
      var carried = a[prop];
      a[prop] = b[prop];
      b[prop] = carried;
    });

    SLOTS.forEach(function (key) {
      var slot = slots[key];
      resetSuggestions(slot);
      slot.input.value = slot.city ? slot.city.name : "";
      slot.clearBtn.hidden = !slot.city;
    });

    render();
    restart.forEach(function (key) { loadSlot(key); });
    notify("Swapped " + SLOT_LABEL.a + " and " + SLOT_LABEL.b + ".");
  }

  // --------------------------------------------------------------- transport

  function abortSearch(slot) {
    if (slot.searchController) {
      slot.searchController.abort();
      slot.searchController = null;
    }
  }

  function abortForecast(slot) {
    if (slot.forecastController) {
      slot.forecastController.abort();
      slot.forecastController = null;
    }
  }

  function loadSlot(key, options) {
    options = options || {};
    var slot = slots[key];
    if (!slot.city) return Promise.resolve(null);

    abortForecast(slot);
    slot.forecastController = new AbortController();
    var seq = ++slot.loadSeq;
    var city = slot.city;
    var cityKey = keyOf(city);

    slot.status = "loading";
    slot.error = null;
    render();

    return WX.api
      .fetchForecast(city, { signal: slot.forecastController.signal, force: !!options.force })
      .then(function (weather) {
        if (seq !== slot.loadSeq) return null;         // superseded by a newer load
        if (keyOf(slot.city) !== cityKey) return null; // the slot moved on
        slot.weather = weather;
        slot.status = "ready";
        slot.error = null;
        render();
        return weather;
      })
      .catch(function (err) {
        if (seq !== slot.loadSeq) return null;
        if (err && err.code === "ABORT") return null;
        // The two cards fail independently: one city erroring leaves the other
        // city's numbers (and the main dashboard) untouched.
        slot.error = friendly(err);
        slot.status = "error";
        render();
        return null;
      });
  }

  // Two independent requests sharing one await point. Each loadSlot() swallows
  // its own failure, so one city failing never rejects the other.
  function loadBoth(force) {
    var jobs = SLOTS
      .filter(function (key) { return !!slots[key].city; })
      .map(function (key) { return loadSlot(key, { force: !!force }); });
    return Promise.all(jobs);
  }

  // --------------------------------------------------------------- search UI

  function resetSuggestions(slot) {
    slot.suggestions = [];
    slot.active = -1;
    if (slot.results) slot.results.innerHTML = "";
    closeSuggestions(slot);
  }

  function openSuggestions(slot) {
    if (!slot.results) return;
    slot.results.classList.add("is-open");
    slot.input.setAttribute("aria-expanded", "true");
  }

  function closeSuggestions(slot) {
    if (!slot.results) return;
    slot.results.classList.remove("is-open");
    slot.input.setAttribute("aria-expanded", "false");
    slot.input.removeAttribute("aria-activedescendant");
  }

  function onInput(key) {
    var slot = slots[key];
    var query = slot.input.value.trim();
    slot.clearBtn.hidden = query.length === 0;
    clearTimeout(slot.debounceId);

    if (query.length < MIN_QUERY) {
      abortSearch(slot);
      slot.searchSeq++;
      resetSuggestions(slot);
      return;
    }
    slot.debounceId = setTimeout(function () { runSearch(slot, query); }, DEBOUNCE_MS);
  }

  function runSearch(slot, query) {
    var seq = ++slot.searchSeq;
    abortSearch(slot);
    slot.searchController = new AbortController();

    return WX.api
      .searchCities(query, { signal: slot.searchController.signal, limit: SUGGESTION_LIMIT })
      .then(function (cities) {
        if (seq !== slot.searchSeq) return; // a newer query already won
        slot.suggestions = cities;
        slot.active = -1;
        renderSuggestions(slot, query);
      })
      .catch(function (err) {
        if (err.code === "ABORT" || seq !== slot.searchSeq) return;
        slot.suggestions = [];
        slot.active = -1;
        renderSuggestions(slot, query, friendly(err));
      });
  }

  function renderSuggestions(slot, query, errorText) {
    slot.results.innerHTML = "";

    var message = errorText || (slot.suggestions.length
      ? null
      : "No cities match \u201C" + query + "\u201D. Check the spelling or try a larger nearby town.");

    if (message) {
      var node = WX.el("li", "wx-cmp__results-empty", message);
      node.setAttribute("role", "presentation");
      slot.results.appendChild(node);
      openSuggestions(slot);
      return;
    }

    slot.suggestions.forEach(function (city, index) {
      slot.results.appendChild(buildOption(slot, city, index));
    });
    openSuggestions(slot);
  }

  function buildOption(slot, city, index) {
    var clash = isClash(slot, city);
    var item = WX.el("li", "wx-cmp__option" + (clash ? " is-disabled" : ""));
    item.id = "cmp-option-" + slot.key + "-" + index;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    if (clash) {
      item.setAttribute("aria-disabled", "true");
      item.setAttribute("aria-label", city.name + " is already " + SLOT_LABEL[otherKey(slot.key)]);
    }

    var flag = flagEmoji(city.countryCode);
    if (flag) item.appendChild(WX.el("span", "wx-cmp__option-flag", flag));

    var body = WX.el("span", "wx-cmp__option-body");
    body.appendChild(WX.el("span", "wx-cmp__option-name", city.name));
    body.appendChild(WX.el("span", "wx-cmp__option-meta", placeLabel(city) || city.timezone || ""));
    item.appendChild(body);

    if (clash) {
      item.appendChild(WX.el("span", "wx-cmp__option-note", "Already " + SLOT_LABEL[otherKey(slot.key)]));
    }

    item.addEventListener("mousedown", function (event) { event.preventDefault(); });
    if (!clash) item.addEventListener("mouseenter", function () { setActive(slot, index); });
    item.addEventListener("click", function () { choose(slot, city); });
    return item;
  }

  // Keyboard navigation steps over the blocked (already-selected) option.
  function enabledIndexes(slot) {
    var out = [];
    slot.suggestions.forEach(function (city, index) {
      if (!isClash(slot, city)) out.push(index);
    });
    return out;
  }

  function stepEnabled(slot, from, delta) {
    var enabled = enabledIndexes(slot);
    if (!enabled.length) return -1;
    if (from < 0) return delta > 0 ? enabled[0] : enabled[enabled.length - 1];
    for (var i = 0; i < enabled.length; i++) {
      if (enabled[i] === from) return enabled[(i + delta + enabled.length) % enabled.length];
    }
    return delta > 0 ? enabled[0] : enabled[enabled.length - 1];
  }

  function setActive(slot, index) {
    var options = WX.$$(".wx-cmp__option", slot.results);
    if (!options.length) return;
    slot.active = index;
    options.forEach(function (node, i) {
      var active = i === index;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (index >= 0 && options[index]) {
      slot.input.setAttribute("aria-activedescendant", options[index].id);
      if (typeof options[index].scrollIntoView === "function") {
        options[index].scrollIntoView({ block: "nearest" });
      }
    }
  }

  function choose(slot, city) {
    if (isClash(slot, city)) {
      closeSuggestions(slot);
      notify(SLOT_LABEL[slot.key] + " and " + SLOT_LABEL[otherKey(slot.key)] +
        " must be different cities.");
      return;
    }
    slot.input.value = city.name;
    slot.clearBtn.hidden = false;
    resetSuggestions(slot);
    assign(slot.key, city);
  }

  function onKeydown(slot, event) {
    var isOpen = slot.results.classList.contains("is-open");

    switch (event.key) {
      case "ArrowDown":
        if (!slot.suggestions.length) return;
        event.preventDefault();
        setActive(slot, stepEnabled(slot, isOpen ? slot.active : -1, 1));
        openSuggestions(slot);
        break;
      case "ArrowUp":
        if (!isOpen || !slot.suggestions.length) return;
        event.preventDefault();
        setActive(slot, stepEnabled(slot, slot.active, -1));
        break;
      case "Home":
        if (!isOpen || !slot.suggestions.length) return;
        event.preventDefault();
        setActive(slot, stepEnabled(slot, -1, 1));
        break;
      case "End":
        if (!isOpen || !slot.suggestions.length) return;
        event.preventDefault();
        setActive(slot, stepEnabled(slot, -1, -1));
        break;
      case "Enter":
        if (isOpen && slot.active >= 0 && slot.suggestions[slot.active]) {
          event.preventDefault();
          choose(slot, slot.suggestions[slot.active]);
        }
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          closeSuggestions(slot);
        } else if (slot.input.value) {
          event.preventDefault();
          slot.input.value = "";
          slot.clearBtn.hidden = true;
          resetSuggestions(slot);
        }
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------- delegation

  function onClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    if (target.closest("#cmp-launch")) { openPanel(); return; }
    if (target.closest("#cmp-close")) { closePanel(); return; }
    if (target.closest("#cmp-swap")) { swap(); return; }
    if (target.closest("#cmp-refresh")) { loadBoth(true); return; }

    var retry = target.closest("[data-cmp-retry]");
    if (retry) {
      var retryKey = retry.getAttribute("data-cmp-retry");
      loadSlot(retryKey);
      slots[retryKey].input.focus();
      return;
    }

    var clear = target.closest("[data-cmp-clear]");
    if (clear) {
      var clearKey = clear.getAttribute("data-cmp-clear");
      clearSlot(clearKey);
      slots[clearKey].input.focus();
      return;
    }

    // A click anywhere outside a picker closes that picker's dropdown.
    SLOTS.forEach(function (key) {
      var slot = slots[key];
      if (slot.picker && !slot.picker.contains(target)) closeSuggestions(slot);
    });
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener("click", onClick);

    SLOTS.forEach(function (key) {
      var slot = slots[key];

      slot.input.addEventListener("input", function () { onInput(key); });
      slot.input.addEventListener("keydown", function (event) { onKeydown(slot, event); });
      slot.input.addEventListener("focus", function () {
        if (slot.suggestions.length) openSuggestions(slot);
      });
      slot.input.addEventListener("blur", function () {
        closeSuggestions(slot);
        // Nothing was chosen, so put the field back to the selected city.
        var wanted = slot.city ? slot.city.name : "";
        if (slot.input.value !== wanted) slot.input.value = wanted;
        slot.clearBtn.hidden = !slot.city;
      });
    });
  }

  // -------------------------------------------------------------------- init

  function init() {
    if (!build()) return;
    bind();

    var ticker = setInterval(refreshTimes, CLOCK_TICK_MS);
    if (ticker && typeof ticker.unref === "function") ticker.unref();

    render();
  }

  WX.compare = {
    init: init,
    render: render,

    // Programmatic surface (used by tests, and handy for a future "compare with
    // this city" action elsewhere).
    open: openPanel,
    close: closePanel,
    pick: assign,
    clear: clearSlot,
    swap: swap,
    refresh: loadBoth,
    summary: function () {
      var a = slots.a.weather;
      var b = slots.b.weather;
      return a && b ? buildSummary(a, b) : [];
    },
    cityKeys: function () {
      return { a: keyOf(slots.a.city), b: keyOf(slots.b.city) };
    }
  };
})(window.WX = window.WX || {});
