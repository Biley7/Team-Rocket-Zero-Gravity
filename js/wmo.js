// WeatherHack — WMO weather-code mapping and icons.
// OWNER: Core (frontend architect).
// Rule: this is the ONLY place a weather code is turned into text, an icon or a
// theme. Pawan's alerts and Dighal's favourites must call WX.wmo.describe()
// instead of writing their own table (ARCHITECTURE.md conflict C8).
(function (WX) {
  "use strict";

  var ICON_WRAPPER_OPEN = '<svg class="wx-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">';
  var CLOUD = '<path d="M46 46H22a11 11 0 0 1-1.9-21.8A15 15 0 0 1 48.3 21 9.8 9.8 0 0 1 46 46z" fill="currentColor"/>';
  var CLOUD_HIGH = '<path d="M46 38H22a11 11 0 0 1-1.9-21.8A15 15 0 0 1 48.3 13 9.8 9.8 0 0 1 46 38z" fill="currentColor"/>';

  var ICONS = {
    clear:
      '<circle cx="32" cy="32" r="13" fill="currentColor"/>' +
      '<g stroke="currentColor" stroke-width="5" stroke-linecap="round">' +
      '<path d="M32 6v8M32 50v8M6 32h8M50 32h8M14 14l6 6M44 44l6 6M50 14l-6 6M20 44l-6 6"/></g>',

    night: '<path d="M42 6a26 26 0 1 0 16 44A28 28 0 0 1 42 6z" fill="currentColor"/>',

    partly:
      '<circle cx="21" cy="19" r="9" fill="currentColor"/>' +
      '<path d="M48 50H28a10 10 0 0 1-1.7-19.9 13.5 13.5 0 0 1 25.6-2.6A8.8 8.8 0 0 1 48 50z" fill="currentColor"/>',

    cloud: CLOUD,

    fog:
      '<g stroke="currentColor" stroke-width="5" stroke-linecap="round">' +
      '<path d="M14 24h36M10 34h44M16 44h32M12 54h40"/></g>',

    drizzle:
      CLOUD_HIGH +
      '<g stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M26 46v8M38 46v8"/></g>',

    rain:
      CLOUD_HIGH +
      '<g stroke="currentColor" stroke-width="4" stroke-linecap="round">' +
      '<path d="M22 46v10M32 46v12M42 46v10"/></g>',

    thunder:
      CLOUD_HIGH +
      '<path d="M34 40l-10 14h8l-3 12 13-17h-8l3-9z" fill="currentColor"/>',

    snow:
      CLOUD_HIGH +
      '<g fill="currentColor"><circle cx="24" cy="50" r="3.4"/><circle cx="34" cy="57" r="3.4"/>' +
      '<circle cx="44" cy="50" r="3.4"/></g>'
  };

  // code -> [label, icon, theme]
  var CODES = {
    0:  ["Clear sky", "clear", "clear"],
    1:  ["Mainly clear", "partly", "clear"],
    2:  ["Partly cloudy", "partly", "clouds"],
    3:  ["Overcast", "cloud", "clouds"],
    45: ["Fog", "fog", "fog"],
    48: ["Depositing rime fog", "fog", "fog"],
    51: ["Light drizzle", "drizzle", "rain"],
    53: ["Moderate drizzle", "drizzle", "rain"],
    55: ["Dense drizzle", "drizzle", "rain"],
    56: ["Light freezing drizzle", "drizzle", "rain"],
    57: ["Dense freezing drizzle", "drizzle", "rain"],
    61: ["Light rain", "rain", "rain"],
    63: ["Moderate rain", "rain", "rain"],
    65: ["Heavy rain", "rain", "rain"],
    66: ["Light freezing rain", "rain", "rain"],
    67: ["Heavy freezing rain", "rain", "rain"],
    71: ["Light snow", "snow", "snow"],
    73: ["Moderate snow", "snow", "snow"],
    75: ["Heavy snow", "snow", "snow"],
    77: ["Snow grains", "snow", "snow"],
    80: ["Light rain showers", "rain", "rain"],
    81: ["Moderate rain showers", "rain", "rain"],
    82: ["Violent rain showers", "rain", "rain"],
    85: ["Light snow showers", "snow", "snow"],
    86: ["Heavy snow showers", "snow", "snow"],
    95: ["Thunderstorm", "thunder", "thunder"],
    96: ["Thunderstorm with hail", "thunder", "thunder"],
    99: ["Severe thunderstorm with hail", "thunder", "thunder"]
  };

  var UNKNOWN = ["Unknown conditions", "cloud", "clouds"];

  WX.wmo = {
    // Always returns a complete, render-safe descriptor.
    describe: function (code) {
      var entry = CODES[code] || UNKNOWN;
      return {
        code: typeof code === "number" ? code : null,
        label: entry[0],
        icon: entry[1],
        theme: entry[2]
      };
    },

    iconSvg: function (iconKey) {
      var shape = ICONS[iconKey] || ICONS.cloud;
      return ICON_WRAPPER_OPEN + shape + "</svg>";
    },

    // Used by current.js to pick the moon instead of the sun after dark.
    iconFor: function (code, isDay) {
      var info = WX.wmo.describe(code);
      if (info.icon === "clear" && isDay === false) return "night";
      if (info.icon === "partly" && isDay === false) return "night";
      return info.icon;
    },

    codes: Object.keys(CODES).map(Number)
  };
})(window.WX = window.WX || {});
