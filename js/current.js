// WeatherHack — city search, current conditions and the 7-day forecast.
// OWNER: Core (frontend architect).
// Regions owned: #city-search, #current-weather, #forecast-7day.
// Never write into #alerts, #hourly-chart, #favourites, #units-toggle or
// #status-banner — those belong to Pawan and Dighal.
(function (WX) {
  "use strict";

  var $ = WX.$;
  var DEBOUNCE_MS = 280;
  var MIN_QUERY = 2;
  var SUGGESTION_LIMIT = 6;

  var els = {};
  var suggestions = [];
  var activeIndex = -1;
  var debounceId = null;
  var searchController = null;
  var forecastController = null;
  var searchSequence = 0;   // guards against out-of-order search responses
  var forecastKey = null;   // coordinates of the request currently in flight

  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  var ICON_SEARCH =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  var ICON_CLEAR =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ---------------------------------------------------------------- helpers

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  function flagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "";
    var points = countryCode.toUpperCase().split("").map(function (ch) {
      return 127397 + ch.charCodeAt(0);
    });
    return String.fromCodePoint.apply(String, points);
  }

  function compassPoint(degrees) {
    if (!isNum(degrees)) return "";
    return COMPASS[Math.round(degrees / 22.5) % 16];
  }

  function placeLabel(city) {
    if (!city) return "";
    return [city.region, city.country].filter(Boolean).join(", ");
  }

  // Turns an API error code into something worth showing a human.
  function friendlyMessage(err) {
    switch (err && err.code) {
      case "NETWORK": return "You appear to be offline. Check your connection and try again.";
      case "TIMEOUT": return "The weather service is taking too long. Please try again.";
      case "HTTP":
        return err.meta && err.meta.status === 429
          ? "Too many requests right now. Wait a moment and try again."
          : "The weather service rejected the request.";
      case "PARSE": return "The weather service sent a response we could not read.";
      case "SHAPE": return "The weather data was incomplete. Try another city.";
      case "INPUT": return "That location could not be resolved.";
      default: return "Something went wrong while loading the weather.";
    }
  }

  // ------------------------------------------------------- region: search

  function buildSearch(mount) {
    mount.innerHTML =
      '<form id="search-form" class="wx-search" role="search" novalidate>' +
        '<div class="wx-search__field">' +
          '<span class="wx-search__icon">' + ICON_SEARCH + '</span>' +
          '<input id="search-input" class="wx-search__input" type="text" autocomplete="off" ' +
            'placeholder="Search for a city" aria-label="Search for a city" ' +
            'role="combobox" aria-expanded="false" aria-controls="search-results" ' +
            'aria-autocomplete="list" aria-describedby="search-hint">' +
          '<span id="search-spinner" class="wx-search__spinner is-hidden" aria-hidden="true"></span>' +
          '<button id="search-clear" class="wx-search__clear is-hidden" type="button" aria-label="Clear search">' +
            ICON_CLEAR +
          '</button>' +
        '</div>' +
        '<ul id="search-results" class="wx-search__results" role="listbox" aria-label="City suggestions"></ul>' +
        '<p id="search-error" class="wx-search__error is-hidden" role="alert"></p>' +
        '<p id="search-hint" class="wx-search__hint">Start typing a city name.</p>' +
      '</form>';

    els.form = $("#search-form");
    els.input = $("#search-input");
    els.clear = $("#search-clear");
    els.spinner = $("#search-spinner");
    els.results = $("#search-results");
    els.searchError = $("#search-error");
    els.hint = $("#search-hint");

    els.form.addEventListener("submit", onSubmit);
    els.input.addEventListener("input", onInput);
    els.input.addEventListener("keydown", onKeydown);
    els.input.addEventListener("focus", function () {
      if (suggestions.length) openDropdown();
    });
    els.clear.addEventListener("click", function () {
      els.input.value = "";
      els.clear.classList.add("is-hidden");
      resetSuggestions();
      els.hint.textContent = "Start typing a city name.";
      els.input.focus();
    });
    document.addEventListener("click", function (event) {
      if (!mount.contains(event.target)) closeDropdown();
    });
  }

  function onInput() {
    var query = els.input.value.trim();
    els.clear.classList.toggle("is-hidden", query.length === 0);
    clearTimeout(debounceId);

    if (query.length < MIN_QUERY) {
      cancelSearch();
      resetSuggestions();
      els.hint.textContent = query.length === 0 ? "Start typing a city name." : "Keep typing to search.";
      return;
    }

    els.hint.textContent = "Searching…";
    els.spinner.classList.remove("is-hidden");
    debounceId = setTimeout(function () { runSearch(query); }, DEBOUNCE_MS);
  }

  function onSubmit(event) {
    event.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      choose(suggestions[activeIndex]);
      return;
    }
    if (suggestions.length === 1) {
      choose(suggestions[0]);
      return;
    }
    clearTimeout(debounceId);
    var query = els.input.value.trim();
    if (query.length >= MIN_QUERY) runSearch(query);
  }

  function onKeydown(event) {
    var open = isOpen();
    switch (event.key) {
      case "ArrowDown":
        if (!suggestions.length) return;
        event.preventDefault();
        if (!open) openDropdown();
        setActive(activeIndex + 1);
        break;
      case "ArrowUp":
        if (!open || !suggestions.length) return;
        event.preventDefault();
        setActive(activeIndex - 1);
        break;
      case "Home":
        if (!open || !suggestions.length) return;
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        if (!open || !suggestions.length) return;
        event.preventDefault();
        setActive(suggestions.length - 1);
        break;
      case "Enter":
        if (open && activeIndex >= 0 && suggestions[activeIndex]) {
          event.preventDefault();
          choose(suggestions[activeIndex]);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          closeDropdown();
        } else if (els.input.value) {
          event.preventDefault();
          els.input.value = "";
          els.clear.classList.add("is-hidden");
          resetSuggestions();
          els.hint.textContent = "Start typing a city name.";
        }
        break;
      default:
        break;
    }
  }

  function runSearch(query) {
    var sequence = ++searchSequence;
    cancelSearch();
    searchController = new AbortController();
    clearSearchError();

    return WX.api
      .searchCities(query, { signal: searchController.signal, limit: SUGGESTION_LIMIT })
      .then(function (cities) {
        if (sequence !== searchSequence) return; // a newer query already won
        suggestions = cities;
        activeIndex = -1;
        renderSuggestions(query);
      })
      .catch(function (err) {
        if (err.code === "ABORT" || sequence !== searchSequence) return;
        suggestions = [];
        activeIndex = -1;
        renderEmptySuggestions(query);
        showSearchError(friendlyMessage(err));
      })
      .then(function () {
        if (sequence === searchSequence) els.spinner.classList.add("is-hidden");
      });
  }

  function cancelSearch() {
    if (searchController) {
      searchController.abort();
      searchController = null;
    }
  }

  function resetSuggestions() {
    suggestions = [];
    activeIndex = -1;
    els.results.innerHTML = "";
    closeDropdown();
  }

  function renderSuggestions(query) {
    els.results.innerHTML = "";
    if (!suggestions.length) {
      renderEmptySuggestions(query);
      return;
    }
    suggestions.forEach(function (city, index) {
      els.results.appendChild(buildOption(city, index));
    });
    els.hint.textContent = suggestions.length + (suggestions.length === 1 ? " match" : " matches") + " for “" + query + "”. Use arrow keys to choose.";
    openDropdown();
  }

  function renderEmptySuggestions(query) {
    els.results.innerHTML = "";
    var item = WX.el("li", "wx-search__empty", "No cities match “" + query + "”. Check the spelling or try a larger nearby town.");
    item.setAttribute("role", "presentation");
    els.results.appendChild(item);
    els.hint.textContent = "No matches found.";
    openDropdown();
  }

  function buildOption(city, index) {
    var item = WX.el("li", "wx-search__option");
    item.id = "search-option-" + index;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");

    var flag = flagEmoji(city.countryCode);
    if (flag) item.appendChild(WX.el("span", "wx-search__flag", flag));

    var body = WX.el("span", "wx-search__body");
    body.appendChild(WX.el("span", "wx-search__name", city.name));
    // Identical city names stay distinguishable via region + country.
    body.appendChild(WX.el("span", "wx-search__meta", placeLabel(city) || "Unknown region"));
    item.appendChild(body);

    if (isNum(city.latitude) && isNum(city.longitude)) {
      item.appendChild(WX.el("span", "wx-search__coords", city.latitude.toFixed(2) + ", " + city.longitude.toFixed(2)));
    }

    var label = city.name + (placeLabel(city) ? ", " + placeLabel(city) : "");
    item.setAttribute("aria-label", label);

    item.addEventListener("mouseenter", function () { setActive(index); });
    item.addEventListener("mousedown", function (event) { event.preventDefault(); });
    item.addEventListener("click", function () { choose(city); });
    return item;
  }

  function setActive(index) {
    var options = els.results.querySelectorAll(".wx-search__option");
    if (!options.length) return;
    if (index < 0) index = options.length - 1;
    if (index >= options.length) index = 0;
    activeIndex = index;

    options.forEach(function (node, i) {
      var active = i === index;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
    els.input.setAttribute("aria-activedescendant", options[index].id);
    options[index].scrollIntoView({ block: "nearest" });
  }

  function openDropdown() {
    els.results.classList.add("is-open");
    els.input.setAttribute("aria-expanded", "true");
  }

  function closeDropdown() {
    els.results.classList.remove("is-open");
    els.input.setAttribute("aria-expanded", "false");
    els.input.removeAttribute("aria-activedescendant");
  }

  function isOpen() {
    return els.results.classList.contains("is-open");
  }

  function showSearchError(message) {
    els.searchError.textContent = message;
    els.searchError.classList.remove("is-hidden");
  }

  function clearSearchError() {
    els.searchError.textContent = "";
    els.searchError.classList.add("is-hidden");
  }

  function choose(city) {
    els.input.value = city.name;
    els.clear.classList.remove("is-hidden");
    resetSuggestions();
    els.hint.textContent = "Showing " + city.name + (placeLabel(city) ? " · " + placeLabel(city) : "") + ".";
    select(city);
  }

  // ------------------------------------------------- region: current weather

  function buildCurrent(mount) {
    mount.innerHTML =
      '<article class="wx-card wx-current">' +
        '<header class="wx-current__head">' +
          '<div class="wx-current__place">' +
            '<h2 id="current-city" class="wx-current__city">No city selected</h2>' +
            '<p id="current-region" class="wx-current__region">Search above to load a forecast.</p>' +
          '</div>' +
          '<p id="current-updated" class="wx-current__updated"></p>' +
        '</header>' +
        '<div id="current-body" class="wx-current__body">' +
          '<div id="current-icon" class="wx-current__icon" aria-hidden="true"></div>' +
          '<div class="wx-current__temp-block">' +
            '<p id="current-temp" class="wx-current__temp">—</p>' +
            '<p id="current-desc" class="wx-current__desc">—</p>' +
            '<p id="current-feels" class="wx-current__feels">—</p>' +
          '</div>' +
        '</div>' +
        '<dl class="wx-current__meta">' +
          '<div class="wx-current__meta-item"><dt>Humidity</dt><dd id="current-humidity">—</dd></div>' +
          '<div class="wx-current__meta-item"><dt>Wind</dt><dd id="current-wind">—</dd></div>' +
          '<div class="wx-current__meta-item"><dt>Rain now</dt><dd id="current-precip">—</dd></div>' +
          '<div class="wx-current__meta-item"><dt>Local time</dt><dd id="current-localtime">—</dd></div>' +
        '</dl>' +
        '<p id="current-message" class="wx-current__message is-hidden"></p>' +
      '</article>';

    els.current = $(".wx-current");
    els.city = $("#current-city");
    els.region = $("#current-region");
    els.updated = $("#current-updated");
    els.icon = $("#current-icon");
    els.temp = $("#current-temp");
    els.desc = $("#current-desc");
    els.feels = $("#current-feels");
    els.humidity = $("#current-humidity");
    els.wind = $("#current-wind");
    els.precip = $("#current-precip");
    els.localTime = $("#current-localtime");
    els.message = $("#current-message");
  }

  function render() {
    if (!els.city) return;

    var weather = WX.state.weather;
    var loading = WX.state.status === "loading";
    els.current.classList.toggle("is-loading", loading);

    if (!weather) {
      els.city.textContent = WX.state.city ? WX.state.city.name : "No city selected";
      els.region.textContent = WX.state.city
        ? placeLabel(WX.state.city) || "Loading forecast…"
        : "Search above to load a forecast.";
      els.updated.textContent = "";
      els.icon.innerHTML = WX.wmo.iconSvg("cloud");
      els.temp.textContent = "—";
      els.desc.textContent = loading ? "Loading…" : "—";
      els.feels.textContent = "";
      els.humidity.textContent = "—";
      els.wind.textContent = "—";
      els.precip.textContent = "—";
      els.localTime.textContent = "—";
      setMessage(WX.state.error ? WX.state.error.message : "", "error");
      return;
    }

    var city = weather.city;
    var current = weather.current;

    els.city.textContent = city.name;
    var flag = flagEmoji(city.countryCode);
    if (flag) els.city.textContent = city.name + " " + flag;
    els.region.textContent = placeLabel(city) || city.timezone;
    els.updated.textContent = "Updated " + WX.time.relative(weather.fetchedAt);
    els.updated.title = "Local time when this reading was fetched: " + WX.time.formatViewerTime(weather.fetchedAt);

    els.icon.innerHTML = WX.wmo.iconSvg(current.icon);
    els.temp.textContent = WX.units.formatTemp(current.temperature, { unit: true });
    els.desc.textContent = current.description;
    els.feels.textContent = "Feels like " + WX.units.formatTemp(current.feelsLike);
    els.humidity.textContent = WX.units.formatPercent(current.humidity);

    var direction = compassPoint(current.windDirection);
    els.wind.textContent = WX.units.formatWind(current.windSpeed) + (direction ? " " + direction : "");
    els.precip.textContent = WX.units.formatPrecip(current.precipitation);
    els.localTime.textContent = WX.time.offsetClock(city.utcOffsetSeconds);

    setMessage(loading ? "Refreshing…" : "", "info");
  }

  function setMessage(text, tone) {
    if (!els.message) return;
    if (!text) {
      els.message.textContent = "";
      els.message.className = "wx-current__message is-hidden";
      return;
    }
    els.message.textContent = text;
    els.message.className = "wx-current__message wx-current__message--" + tone;
  }

  // ------------------------------------------------------ region: 7-day view

  function buildForecast(mount) {
    mount.innerHTML =
      '<article class="wx-card wx-forecast">' +
        '<header class="wx-forecast__head">' +
          '<h2 class="wx-forecast__title">7-day forecast</h2>' +
          '<p id="forecast-summary" class="wx-forecast__summary"></p>' +
        '</header>' +
        '<ul id="forecast-list" class="wx-forecast__list"></ul>' +
        '<p id="forecast-empty" class="wx-empty">Pick a city to see the week ahead.</p>' +
      '</article>';

    els.forecastList = $("#forecast-list");
    els.forecastEmpty = $("#forecast-empty");
    els.forecastSummary = $("#forecast-summary");
  }

  function renderForecast() {
    if (!els.forecastList) return;
    var weather = WX.state.weather;

    if (!weather || !weather.daily.length) {
      els.forecastList.innerHTML = "";
      els.forecastEmpty.classList.remove("is-hidden");
      els.forecastSummary.textContent = "";
      return;
    }

    els.forecastEmpty.classList.add("is-hidden");
    els.forecastList.innerHTML = "";

    // Shared scale across the week so the range bars are comparable.
    var lows = weather.daily.map(function (day) { return day.tempMin; }).filter(isNum);
    var highs = weather.daily.map(function (day) { return day.tempMax; }).filter(isNum);
    var weekLow = lows.length ? Math.min.apply(null, lows) : 0;
    var weekHigh = highs.length ? Math.max.apply(null, highs) : 1;
    var span = Math.max(1, weekHigh - weekLow);

    var weekRain = weather.daily.reduce(function (sum, day) {
      return sum + (isNum(day.precipitationSum) ? day.precipitationSum : 0);
    }, 0);
    els.forecastSummary.textContent = weekRain > 0
      ? Math.round(weekRain) + " mm of rain expected this week"
      : "No significant rain expected this week";

    weather.daily.forEach(function (day, index) {
      var card = WX.el("li", "wx-forecast-card");
      card.setAttribute("data-theme", day.theme || "clouds");

      var header = WX.el("div", "wx-forecast-card__head");
      header.appendChild(WX.el("p", "wx-forecast-card__day", index === 0 ? "Today" : WX.time.formatDay(day.date)));
      header.appendChild(WX.el("p", "wx-forecast-card__date", WX.time.formatDate(day.date)));
      card.appendChild(header);

      var icon = WX.el("div", "wx-forecast-card__icon");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = WX.wmo.iconSvg(day.icon);
      card.appendChild(icon);

      card.appendChild(WX.el("p", "wx-forecast-card__desc", day.description));

      var temps = WX.el("p", "wx-forecast-card__temps");
      temps.appendChild(WX.el("span", "wx-forecast-card__max", WX.units.formatTemp(day.tempMax)));
      temps.appendChild(WX.el("span", "wx-forecast-card__min", WX.units.formatTemp(day.tempMin)));
      card.appendChild(temps);

      var bar = WX.el("div", "wx-forecast-card__bar");
      var fill = WX.el("span", "wx-forecast-card__fill");
      if (isNum(day.tempMin) && isNum(day.tempMax)) {
        fill.style.left = ((day.tempMin - weekLow) / span) * 100 + "%";
        fill.style.width = Math.max(6, ((day.tempMax - day.tempMin) / span) * 100) + "%";
      }
      bar.appendChild(fill);
      bar.setAttribute("aria-hidden", "true");
      card.appendChild(bar);

      var meta = WX.el("p", "wx-forecast-card__meta");
      if (isNum(day.precipitationProbabilityMax)) {
        meta.appendChild(WX.el("span", "wx-forecast-card__rain", WX.units.formatPercent(day.precipitationProbabilityMax) + " rain"));
      }
      if (isNum(day.uvIndexMax)) {
        meta.appendChild(WX.el("span", "wx-forecast-card__uv", "UV " + Math.round(day.uvIndexMax)));
      }
      card.appendChild(meta);

      card.setAttribute("aria-label",
        WX.time.formatDay(day.date, { weekday: "long", day: "numeric", month: "long" }) + ": " +
        day.description + ", high " + WX.units.formatTemp(day.tempMax, { unit: true }) +
        ", low " + WX.units.formatTemp(day.tempMin, { unit: true }));

      els.forecastList.appendChild(card);
    });
  }

  // ------------------------------------------------------------- selection

  // Programmatic entry point — favourites (Dighal) call this too.
  function select(city) {
    return loadWeather(city);
  }

  // Fetches (or reuses) the normalized weather for a cityRef and publishes it.
  function loadWeather(city) {
    city = city || WX.state.city;
    if (!city) return Promise.resolve(null);

    var key = WX.api.coordKey(city);
    var showing = WX.state.weather ? WX.api.coordKey(WX.state.weather.city) : null;

    // Only cancel the in-flight request when moving to a different location,
    // otherwise we would abort the very request we are about to reuse.
    if (forecastController && key !== forecastKey) forecastController.abort();
    forecastController = new AbortController();
    forecastKey = key;

    // Switching city: drop the previous city's numbers instead of showing them
    // underneath the new city's name. Keeping the same city (a refresh) retains them.
    WX.set({
      city: city,
      status: "loading",
      error: null,
      weather: showing === key ? WX.state.weather : null
    });
    WX.events.emit("city:changed", city);

    return WX.api
      .fetchForecast(city, { signal: forecastController.signal })
      .then(function (weather) {
        if (WX.api.coordKey(WX.state.city) !== key) return null; // superseded by a newer choice
        WX.set({ weather: weather, city: weather.city, status: "ready", error: null, source: "network" });
        WX.events.emit("weather:loaded", weather);
        return weather;
      })
      .catch(function (err) {
        if (err.code === "ABORT") return null;
        WX.set({ status: "error", error: { code: err.code, message: friendlyMessage(err) } });
        WX.events.emit("weather:failed", err);
        return null;
      });
  }

  function applyTheme(weather) {
    if (!document.body) return;
    if (!weather || !weather.current) {
      document.body.removeAttribute("data-weather");
      document.body.removeAttribute("data-time");
      return;
    }
    document.body.setAttribute("data-weather", weather.current.theme || "clouds");
    document.body.setAttribute("data-time", weather.current.isDay ? "day" : "night");
  }

  // ------------------------------------------------------------------ init

  function init() {
    var searchMount = $("#city-search");
    var currentMount = $("#current-weather");
    var forecastMount = $("#forecast-7day");

    if (searchMount) buildSearch(searchMount);
    if (currentMount) buildCurrent(currentMount);
    if (forecastMount) buildForecast(forecastMount);

    els.spinner = els.spinner || null;

    // A unit change alters every temperature on screen, so repaint the region.
    WX.events.on("units:changed", function () {
      render();
      renderForecast();
    });

    render();
    renderForecast();
  }

  WX.current = { init: init, render: render };
  WX.forecast = { init: function () {}, render: renderForecast };
  WX.theme = { apply: applyTheme };

  WX.city = {
    select: select,
    load: loadWeather,
    // Exposed for tests/debugging and for Dighal's favourites flow.
    results: function () { return suggestions.slice(); }
  };

  WX.loadWeather = loadWeather;
})(window.WX = window.WX || {});
