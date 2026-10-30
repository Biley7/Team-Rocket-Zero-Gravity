// Core Task 4: rule-based heat, heavy-rain and strong-wind alerts.
(function () {
  const WX = window.WX = window.WX || {};
  WX.alerts = WX.alerts || {};

  // Illustrative dashboard thresholds, not official meteorological warnings.
  // Open-Meteo wind_speed_10m defaults to km/h.
  const RULES = { heatHigh: 35, heatSevere: 40, rainHigh: 15, rainSevere: 30, windHigh: 40, windSevere: 60 };

  function compute(hourly) {
    if (!hourly) return [];
    const temperatures = (hourly.temperature_2m || []).slice(0, 24).map(Number).filter(Number.isFinite);
    const rainfall = (hourly.precipitation || []).slice(0, 24).map(Number).filter(Number.isFinite);
    const wind = (hourly.wind_speed_10m || []).slice(0, 24).map(Number).filter(Number.isFinite);
    if (!temperatures.length && !rainfall.length && !wind.length) return [];

    const maxTemp = temperatures.length ? Math.max(...temperatures) : -Infinity;
    const maxRain = rainfall.length ? Math.max(...rainfall) : 0;
    const maxWind = wind.length ? Math.max(...wind) : 0;
    const alerts = [];

    if (maxTemp >= RULES.heatSevere) {
      alerts.push({ severity: "severe", title: "Extreme heat", message: `Temperature may reach ${maxTemp.toFixed(1)}°C in the next 24 hours. Drink water, seek shade and limit strenuous outdoor activity.` });
    } else if (maxTemp >= RULES.heatHigh) {
      alerts.push({ severity: "high", title: "High temperature", message: `Temperature may reach ${maxTemp.toFixed(1)}°C. Stay hydrated and take breaks in the shade.` });
    }

    if (maxRain >= RULES.rainSevere) {
      alerts.push({ severity: "severe", title: "Very heavy rain", message: `Hourly rainfall may reach ${maxRain.toFixed(1)} mm. Watch for waterlogging and avoid flooded roads.` });
    } else if (maxRain >= RULES.rainHigh) {
      alerts.push({ severity: "high", title: "Heavy rain", message: `Hourly rainfall may reach ${maxRain.toFixed(1)} mm. Allow extra travel time and watch for waterlogging.` });
    }

    if (maxWind >= RULES.windSevere) {
      alerts.push({ severity: "severe", title: "Very strong wind", message: `Wind speed may reach ${maxWind.toFixed(1)} km/h. Secure loose objects and avoid exposed areas.` });
    } else if (maxWind >= RULES.windHigh) {
      alerts.push({ severity: "high", title: "Strong wind", message: `Wind speed may reach ${maxWind.toFixed(1)} km/h. Use caution near trees and loose outdoor objects.` });
    }

    if (!alerts.length) {
      alerts.push({ severity: "moderate", title: "No high-risk conditions detected", message: "The next 24-hour forecast does not cross this dashboard's demo thresholds. Continue checking official local weather guidance." });
    }
    return alerts;
  }

  function render(hourly, city = "Selected location") {
    const container = document.getElementById("alerts-container");
    if (!container) return;
    const alerts = compute(hourly);
    container.replaceChildren();

    if (!alerts.length) {
      container.textContent = "Forecast data is unavailable, so alerts cannot be calculated.";
      return;
    }

    alerts.forEach(alert => {
      const card = document.createElement("article");
      card.className = `alert-card ${alert.severity}`;
      const heading = document.createElement("h3");
      heading.textContent = `${alert.title} — ${alert.severity.toUpperCase()}`;
      const message = document.createElement("p");
      message.textContent = `${city}: ${alert.message}`;
      card.append(heading, message);
      container.appendChild(card);
    });
  }

  WX.alerts.compute = compute;
  WX.alerts.render = render;
  WX.alerts.rules = { ...RULES };
})();