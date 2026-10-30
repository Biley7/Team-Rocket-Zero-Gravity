// WeatherHack — normalize + validate the Open-Meteo payload.
// OWNER: Core (frontend architect).
// Turns the raw API response into the shared contract in ARCHITECTURE.md 4.1.
// Nothing downstream should ever see the raw payload.
(function (WX) {
  "use strict";

  var SHAPE = "SHAPE";

  // WX.api.error is defined in api.js. These functions only run after every
  // script has loaded, so the reference is safe despite the file order.
  function shapeError(message) {
    return WX.api.error(SHAPE, message);
  }

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  // Returns a number-or-null series. A missing array is a hard error (the API
  // contract changed); a missing inside value is tolerated as null.
  function numberSeries(source, key, expectedLength, label) {
    var arr = source ? source[key] : null;
    if (!Array.isArray(arr)) throw shapeError("Missing forecast series: " + label);
    if (arr.length !== expectedLength) {
      throw shapeError("Unexpected length for " + label + " (" + arr.length + " != " + expectedLength + ")");
    }
    return arr.map(function (value) {
      return isNum(value) ? value : null;
    });
  }

  function dayFlags(source, key, expectedLength) {
    var arr = source ? source[key] : null;
    if (!Array.isArray(arr)) return new Array(expectedLength).fill(null);
    return arr.map(function (value) {
      return value === 1 || value === true;
    });
  }

  // Throws when the payload cannot produce a usable dashboard.
  WX.validateForecast = function (raw) {
    if (!raw || typeof raw !== "object") throw shapeError("The weather service returned an empty response.");

    if (!raw.current || typeof raw.current !== "object") {
      throw shapeError("The response is missing its 'current' block.");
    }
    if (!isNum(raw.current.temperature_2m)) {
      throw shapeError("The response is missing the current temperature.");
    }
    if (!raw.hourly || !Array.isArray(raw.hourly.time) || raw.hourly.time.length === 0) {
      throw shapeError("The response is missing hourly data.");
    }
    if (!raw.daily || !Array.isArray(raw.daily.time) || raw.daily.time.length === 0) {
      throw shapeError("The response is missing daily data.");
    }
    if (!isNum(raw.latitude) || !isNum(raw.longitude)) {
      throw shapeError("The response is missing coordinates.");
    }
    return true;
  };

  WX.normalize = function (raw, city) {
    WX.validateForecast(raw);

    var cur = raw.current;
    var hourlyRaw = raw.hourly;
    var dailyRaw = raw.daily;
    var hourCount = hourlyRaw.time.length;
    var dayCount = dailyRaw.time.length;
    var currentInfo = WX.wmo.describe(cur.weather_code);

    var hourly = {
      time: hourlyRaw.time.slice(),
      temperature: numberSeries(hourlyRaw, "temperature_2m", hourCount, "hourly.temperature_2m"),
      precipitationProbability: numberSeries(hourlyRaw, "precipitation_probability", hourCount, "hourly.precipitation_probability"),
      precipitation: numberSeries(hourlyRaw, "precipitation", hourCount, "hourly.precipitation"),
      weatherCode: numberSeries(hourlyRaw, "weather_code", hourCount, "hourly.weather_code"),
      windSpeed: numberSeries(hourlyRaw, "wind_speed_10m", hourCount, "hourly.wind_speed_10m"),
      isDay: dayFlags(hourlyRaw, "is_day", hourCount)
    };

    var daily = dailyRaw.time.map(function (date, index) {
      var code = isNum(dailyRaw.weather_code[index]) ? dailyRaw.weather_code[index] : null;
      var info = WX.wmo.describe(code);
      return {
        date: date,
        weatherCode: code,
        description: info.label,
        icon: info.icon,
        theme: info.theme,
        tempMax: isNum(dailyRaw.temperature_2m_max[index]) ? dailyRaw.temperature_2m_max[index] : null,
        tempMin: isNum(dailyRaw.temperature_2m_min[index]) ? dailyRaw.temperature_2m_min[index] : null,
        precipitationSum: isNum(dailyRaw.precipitation_sum[index]) ? dailyRaw.precipitation_sum[index] : null,
        precipitationProbabilityMax: isNum(dailyRaw.precipitation_probability_max[index])
          ? dailyRaw.precipitation_probability_max[index]
          : null,
        windSpeedMax: isNum(dailyRaw.wind_speed_10m_max[index]) ? dailyRaw.wind_speed_10m_max[index] : null,
        sunrise: dailyRaw.sunrise ? dailyRaw.sunrise[index] : null,
        sunset: dailyRaw.sunset ? dailyRaw.sunset[index] : null,
        uvIndexMax: dailyRaw.uv_index_max && isNum(dailyRaw.uv_index_max[index]) ? dailyRaw.uv_index_max[index] : null
      };
    });

    if (daily.length === 0) throw shapeError("The response contained no forecast days.");

    // Timezone facts come from the forecast response (timezone=auto), so the
    // city object is authoritative even if the geocoder was vague.
    // Coordinates keep the REQUESTED values when available: Open-Meteo echoes
    // them rounded (51.50853 -> 51.5), which would break cache/dedupe identity
    // for the same city.
    var cityOut = {
      id: (city && city.id != null) ? city.id : null,
      name: (city && city.name) || "Selected location",
      country: (city && city.country) || "",
      countryCode: (city && city.countryCode) || "",
      region: (city && city.region) || "",
      district: (city && city.district) || "",
      latitude: city && isNum(city.latitude) ? city.latitude : raw.latitude,
      longitude: city && isNum(city.longitude) ? city.longitude : raw.longitude,
      timezone: raw.timezone || (city && city.timezone) || "UTC",
      utcOffsetSeconds: isNum(raw.utc_offset_seconds) ? raw.utc_offset_seconds : 0
    };

    return {
      city: cityOut,
      fetchedAt: Date.now(),
      current: {
        time: cur.time,
        temperature: cur.temperature_2m,
        feelsLike: isNum(cur.apparent_temperature) ? cur.apparent_temperature : null,
        humidity: isNum(cur.relative_humidity_2m) ? cur.relative_humidity_2m : null,
        weatherCode: isNum(cur.weather_code) ? cur.weather_code : null,
        description: currentInfo.label,
        icon: WX.wmo.iconFor(cur.weather_code, cur.is_day !== 0),
        theme: currentInfo.theme,
        isDay: cur.is_day !== 0,
        precipitation: isNum(cur.precipitation) ? cur.precipitation : null,
        windSpeed: isNum(cur.wind_speed_10m) ? cur.wind_speed_10m : null,
        windDirection: isNum(cur.wind_direction_10m) ? cur.wind_direction_10m : null
      },
      hourly: hourly,
      daily: daily
    };
  };
})(window.WX = window.WX || {});
