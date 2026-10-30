// WeatherHack — rule-based heat, heavy-rain and strong-wind alerts.
// OWNER: Pawan. Region owned: #alerts (ids: #alerts-list, #alerts-empty,
// class .wx-alert — ARCHITECTURE.md 6.1).
//
// Contract: init() builds this region's DOM once. compute(weather) is a pure
// function over the shared normalized object (weather.hourly.*) returning
// [{ id, severity, title, detail, icon }]; render(mount, alerts) paints them.
// script.js calls both together on every repaint, so this module never
// self-renders on an event.
(function (WX) {
  "use strict";

  WX.alerts = WX.alerts || {};

  // Illustrative dashboard thresholds, not official meteorological warnings.
  // Always compared in Celsius and km/h: the normalized contract is metric, so
  // the C/F toggle never changes which alert fires.
  var RULES = { heatHigh: 35, heatSevere: 40, rainHigh: 15, rainSevere: 30, windHigh: 40, windSevere: 60 };

  var WINDOW_HOURS = 24;

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  // Numbers inside the next 24 hours for one normalized hourly series.
  function window24(hourly, key) {
    var arr = hourly && hourly[key];
    return Array.isArray(arr) ? arr.slice(0, WINDOW_HOURS).filter(isNum) : [];
  }

  function maxOf(values) {
    return values.reduce(function (top, value) { return value > top ? value : top; }, -Infinity);
  }

  // ------------------------------------------------------------------ compute

  function compute(weather) {
    var hourly = weather ? weather.hourly : null;
    var temps = window24(hourly, "temperature");
    var rain = window24(hourly, "precipitation");
    var wind = window24(hourly, "windSpeed");

    var alerts = [];
    var maxTemp = temps.length ? maxOf(temps) : -Infinity;
    var maxRain = rain.length ? maxOf(rain) : 0;
    var maxWind = wind.length ? maxOf(wind) : 0;

    if (maxTemp >= RULES.heatSevere) {
      alerts.push({
        id: "heat",
        severity: "severe",
        icon: "HEAT",
        title: "Extreme heat",
        detail: "Temperature may reach " + WX.units.formatTemp(maxTemp, { unit: true }) +
          " in the next 24 hours. Drink water, seek shade and limit strenuous outdoor activity."
      });
    } else if (maxTemp >= RULES.heatHigh) {
      alerts.push({
        id: "heat",
        severity: "high",
        icon: "HEAT",
        title: "High temperature",
        detail: "Temperature may reach " + WX.units.formatTemp(maxTemp, { unit: true }) +
          ". Stay hydrated and take breaks in the shade."
      });
    }

    if (maxRain >= RULES.rainSevere) {
      alerts.push({
        id: "rain",
        severity: "severe",
        icon: "RAIN",
        title: "Very heavy rain",
        detail: "Hourly rainfall may reach " + WX.units.formatPrecip(maxRain) +
          ". Watch for waterlogging and avoid flooded roads."
      });
    } else if (maxRain >= RULES.rainHigh) {
      alerts.push({
        id: "rain",
        severity: "high",
        icon: "RAIN",
        title: "Heavy rain",
        detail: "Hourly rainfall may reach " + WX.units.formatPrecip(maxRain) +
          ". Allow extra travel time and watch for waterlogging."
      });
    }

    if (maxWind >= RULES.windSevere) {
      alerts.push({
        id: "wind",
        severity: "severe",
        icon: "WIND",
        title: "Very strong wind",
        detail: "Wind speed may reach " + WX.units.formatWind(maxWind) +
          ". Secure loose objects and avoid exposed areas."
      });
    } else if (maxWind >= RULES.windHigh) {
      alerts.push({
        id: "wind",
        severity: "high",
        icon: "WIND",
        title: "Strong wind",
        detail: "Wind speed may reach " + WX.units.formatWind(maxWind) +
          ". Use caution near trees and loose outdoor objects."
      });
    }

    // No series at all means we cannot judge the forecast — report "nothing to
    // show" ([] => #alerts-empty) rather than a reassuring all-clear.
    if (!alerts.length && (temps.length || rain.length || wind.length)) {
      alerts.push({
        id: "none",
        severity: "low",
        icon: "OK",
        title: "No high-risk conditions detected",
        detail: "The next 24-hour forecast stays inside this dashboard's demo thresholds. Continue checking official local weather guidance."
      });
    }

    return alerts;
  }

  // ------------------------------------------------------------------- build

  function buildCard(mount) {
    var card = WX.el("section", "wx-card wx-alerts");
    card.setAttribute("aria-labelledby", "alerts-title");

    var head = WX.el("header", "wx-alerts__head");
    var title = WX.el("h2", "wx-alerts__title", "Weather alerts");
    title.id = "alerts-title";
    head.appendChild(title);
    head.appendChild(WX.el("p", "wx-alerts__sub", ""));
    card.appendChild(head);

    var list = WX.el("ul", "wx-alerts__list");
    list.id = "alerts-list";
    card.appendChild(list);

    var empty = WX.el("p", "wx-empty wx-alerts__empty", "Alerts are unavailable because forecast data could not be loaded.");
    empty.id = "alerts-empty";
    card.appendChild(empty);

    mount.appendChild(card);
  }

  function severityLabel(severity) {
    return severity.charAt(0).toUpperCase() + severity.slice(1);
  }

  function alertNode(alert) {
    var severity = alert.severity || "moderate";
    var item = WX.el("li", "wx-alert wx-alert--" + severity);
    item.setAttribute("data-severity", severity);

    var head = WX.el("div", "wx-alert__head");
    var badge = WX.el("span", "wx-alert__badge", alert.icon || "");
    badge.setAttribute("aria-hidden", "true");
    head.appendChild(badge);
    // Severity is never colour-only (ARCHITECTURE.md 6.4) — spell it out.
    head.appendChild(WX.el("span", "wx-alert__sev", severityLabel(severity)));
    item.appendChild(head);

    item.appendChild(WX.el("h3", "wx-alert__title", alert.title || "Alert"));
    item.appendChild(WX.el("p", "wx-alert__detail", alert.detail || ""));
    return item;
  }

  // ------------------------------------------------------------------ render

  function render(mount, alerts) {
    mount = mount || WX.$("#alerts");
    if (!mount) return;
    if (!mount.querySelector(".wx-alerts")) buildCard(mount);

    var list = WX.$("#alerts-list", mount);
    var empty = WX.$("#alerts-empty", mount);
    var sub = WX.$(".wx-alerts__sub", mount);
    var items = Array.isArray(alerts) ? alerts.filter(Boolean) : [];

    var city = WX.state.city;
    sub.textContent = city && city.name ? "For " + city.name : "";

    list.replaceChildren();
    items.forEach(function (alert) { list.appendChild(alertNode(alert)); });

    var showEmpty = items.length === 0;
    empty.hidden = !showEmpty;
    empty.classList.toggle("is-hidden", !showEmpty);
  }

  // -------------------------------------------------------------------- init

  WX.alerts.init = function () {
    var mount = WX.$("#alerts");
    if (mount && !mount.querySelector(".wx-alerts")) buildCard(mount);
  };

  WX.alerts.compute = compute;
  WX.alerts.render = render;

  // Read-only view of the thresholds, for tests and future settings UI.
  WX.alerts.rules = {
    heatHigh: RULES.heatHigh, heatSevere: RULES.heatSevere,
    rainHigh: RULES.rainHigh, rainSevere: RULES.rainSevere,
    windHigh: RULES.windHigh, windSevere: RULES.windSevere
  };
})(window.WX = window.WX || {});
