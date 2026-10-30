// WeatherHack — Open-Meteo API service.
// OWNER: Core (frontend architect).
// Rule: this is the ONLY module allowed to call fetch() (ARCHITECTURE.md section 8).
// Every failure surfaces as an Error with a stable `.code`:
//   NETWORK | TIMEOUT | HTTP | PARSE | SHAPE | ABORT | INPUT
(function (WX) {
  "use strict";

  var GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
  var FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

  var GEOCODE_TIMEOUT = 8000;
  var FORECAST_TIMEOUT = 12000;
  var CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  var CURRENT_VARS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
    "precipitation",
    "is_day"
  ];

  var HOURLY_VARS = [
    "temperature_2m",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
    "is_day"
  ];

  var DAILY_VARS = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "precipitation_probability_max",
    "wind_speed_10m_max",
    "sunrise",
    "sunset",
    "uv_index_max"
  ];

  // --- request bookkeeping -------------------------------------------------
  // dedupe: identical coordinates share one in-flight request.
  // cache:  a fresh result is reused instead of re-fetching (also what makes
  //         favourites clicking the current city free).
  var inflight = Object.create(null);
  var cache = Object.create(null);

  function error(code, message, meta) {
    var err = new Error(message || "The weather request failed.");
    err.name = "WeatherApiError";
    err.code = code;
    if (meta) err.meta = meta;
    return err;
  }

  function coordKey(source) {
    if (!source) return "";
    var lat = Number(source.latitude);
    var lon = Number(source.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return "";
    return lat.toFixed(3) + "," + lon.toFixed(3);
  }

  // --- transport -----------------------------------------------------------
  function requestJson(url, externalSignal, timeoutMs) {
    var controller = new AbortController();
    var timedOut = false;

    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", function () { controller.abort(); }, { once: true });
    }

    return fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) {
          throw error("HTTP", "The weather service responded with status " + response.status + ".", {
            status: response.status,
            url: url
          });
        }
        return response.text();
      })
      .then(function (text) {
        try {
          return JSON.parse(text);
        } catch (parseErr) {
          throw error("PARSE", "The weather service returned an unreadable response.");
        }
      })
      .catch(function (err) {
        if (err && err.name === "WeatherApiError") throw err;
        if (err && err.name === "AbortError") {
          if (timedOut) throw error("TIMEOUT", "The weather service took too long to respond.");
          throw error("ABORT", "Request cancelled.");
        }
        throw error("NETWORK", "Could not reach the weather service. Check your connection.");
      })
      .then(
        function (value) { clearTimeout(timer); return value; },
        function (err) { clearTimeout(timer); throw err; }
      );
  }

  // --- geocoding -----------------------------------------------------------
  function toCityRef(result) {
    return {
      id: result.id != null ? result.id : null,
      name: result.name,
      country: result.country || "",
      countryCode: result.country_code || "",
      region: result.admin1 || "",
      district: result.admin2 || "",
      latitude: result.latitude,
      longitude: result.longitude,
      timezone: result.timezone || "UTC"
    };
  }

  function searchCities(query, options) {
    options = options || {};
    var term = (query || "").trim();
    // An empty term is a valid client-side state, not an API error.
    if (term.length < 2) return Promise.resolve([]);

    var url = GEOCODE_URL +
      "?name=" + encodeURIComponent(term) +
      "&count=" + (options.limit || 6) +
      "&language=en&format=json";

    return requestJson(url, options.signal, GEOCODE_TIMEOUT).then(function (data) {
      var results = data && Array.isArray(data.results) ? data.results : [];
      return results.map(toCityRef);
    });
  }

  // --- forecast ------------------------------------------------------------
  function buildForecastUrl(city) {
    var params = new URLSearchParams();
    params.set("latitude", String(city.latitude));
    params.set("longitude", String(city.longitude));
    params.set("current", CURRENT_VARS.join(","));
    params.set("hourly", HOURLY_VARS.join(","));
    params.set("daily", DAILY_VARS.join(","));
    params.set("forecast_days", "7");
    params.set("timezone", "auto");
    return FORECAST_URL + "?" + params.toString();
  }

  function fetchForecast(city, options) {
    options = options || {};

    if (!city || !isFinite(Number(city.latitude)) || !isFinite(Number(city.longitude))) {
      return Promise.reject(error("INPUT", "A city with valid coordinates is required."));
    }

    var key = coordKey(city);
    var maxAge = options.maxAge != null ? options.maxAge : CACHE_TTL;
    var cached = cache[key];

    if (cached && !options.force && Date.now() - cached.at < maxAge) {
      return Promise.resolve(cached.weather);
    }
    if (inflight[key]) return inflight[key];

    var pending = requestJson(buildForecastUrl(city), options.signal, FORECAST_TIMEOUT)
      .then(function (raw) {
        // normalize() validates and throws a SHAPE error if the payload is unusable.
        var weather = WX.normalize(raw, city);
        cache[key] = { at: Date.now(), weather: weather };
        return weather;
      })
      .then(
        function (weather) { delete inflight[key]; return weather; },
        function (err) { delete inflight[key]; throw err; }
      );

    inflight[key] = pending;
    return pending;
  }

  WX.api = {
    error: error,
    coordKey: coordKey,
    searchCities: searchCities,
    fetchForecast: fetchForecast,

    // Lets Dighal's status module decide between "fresh" and "cached" reads.
    isCached: function (city, maxAge) {
      var entry = cache[coordKey(city)];
      if (!entry) return false;
      return Date.now() - entry.at < (maxAge != null ? maxAge : CACHE_TTL);
    },

    peekCache: function (city) {
      var entry = cache[coordKey(city)];
      return entry ? entry.weather : null;
    },

    clearCache: function (city) {
      if (city) delete cache[coordKey(city)];
      else cache = Object.create(null);
    }
  };
})(window.WX = window.WX || {});
