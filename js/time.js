// WeatherHack — time helpers.
// OWNER: Core (frontend architect). Shared because both the dashboard (current.js)
// and the hourly chart (chart.js, Pawan) need labels that respect the CITY's
// timezone, not the viewer's.
//
// Open-Meteo returns timestamps as local wall-clock strings for the requested
// city (e.g. "2026-10-30T14:00") together with utc_offset_seconds. Passing those
// strings to `new Date()` would re-interpret them in the viewer's timezone and
// shift every label, so we parse the components directly instead.
(function (WX) {
  "use strict";

  var LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function parseLocal(iso) {
    if (typeof iso !== "string") return null;
    var m = LOCAL_RE.exec(iso);
    if (!m) return null;
    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: m[4] ? Number(m[4]) : 0,
      minute: m[5] ? Number(m[5]) : 0
    };
  }

  // A Date pinned to UTC from the wall-clock components. Used only for calendar
  // maths (weekday names), never for arithmetic on "now".
  function utcFromLocal(iso) {
    var p = parseLocal(iso);
    if (!p) return null;
    return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute));
  }

  WX.time = {
    parseLocal: parseLocal,

    // "2026-10-30T14:00" -> "14:00", or "2 PM" when hour12 is true.
    formatHour: function (iso, hour12) {
      var p = parseLocal(iso);
      if (!p) return "—";
      if (!hour12) return pad(p.hour) + ":00";
      var h = p.hour % 12;
      if (h === 0) h = 12;
      return h + (p.hour < 12 ? " AM" : " PM");
    },

    // "2026-10-30" -> "Thu" / "30 Oct" / "Thu 30 Oct"
    formatDay: function (iso, options) {
      var date = utcFromLocal(iso);
      if (!date) return "—";
      var opts = options || { weekday: "short" };
      try {
        return new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "UTC" }, opts)).format(date);
      } catch (err) {
        return iso;
      }
    },

    formatDate: function (iso) {
      return WX.time.formatDay(iso, { day: "numeric", month: "short" });
    },

    // Live clock for a city, derived from its UTC offset.
    offsetClock: function (offsetSeconds) {
      var now = new Date(Date.now() + (Number(offsetSeconds) || 0) * 1000);
      return pad(now.getUTCHours()) + ":" + pad(now.getUTCMinutes());
    },

    // Timestamp in the viewer's own timezone (used for "last updated").
    formatViewerTime: function (epochMs) {
      if (!epochMs) return "—";
      try {
        return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(epochMs));
      } catch (err) {
        return "—";
      }
    },

    // How stale the cached reading is, e.g. "just now", "12 min ago".
    relative: function (epochMs) {
      if (!epochMs) return "";
      var seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
      if (seconds < 45) return "just now";
      var minutes = Math.round(seconds / 60);
      if (minutes < 60) return minutes + " min ago";
      var hours = Math.round(minutes / 60);
      if (hours < 24) return hours + " h ago";
      return Math.round(hours / 24) + " d ago";
    }
  };
})(window.WX = window.WX || {});
