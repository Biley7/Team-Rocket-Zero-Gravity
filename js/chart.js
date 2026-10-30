// Core Task 3: Canvas chart for hourly temperature and rainfall.
(function () {
  const WX = window.WX = window.WX || {};
  WX.hourly = WX.hourly || {};

  WX.hourly.render = function (hourly) {
    const canvas = document.getElementById("hourlyChart");
    if (!canvas || !hourly) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const times = hourly.time || [];
    const temperatures = hourly.temperature_2m || [];
    const rain = hourly.precipitation || [];
    const count = Math.min(24, times.length, temperatures.length);

    const width = Math.max(300, canvas.clientWidth || 600);
    const height = Math.max(200, canvas.clientHeight || 260);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!count) {
      ctx.fillStyle = "#52606d";
      ctx.font = "14px system-ui";
      ctx.fillText("Hourly forecast data is not available.", 12, 28);
      return;
    }

    const temps = temperatures.slice(0, count).map(Number);
    const rainfall = Array.from({ length: count }, (_, i) => Number(rain[i] || 0));
    const validTemps = temps.filter(Number.isFinite);
    if (!validTemps.length) return;

    const minTemp = Math.floor(Math.min(...validTemps) - 2);
    const maxTemp = Math.max(minTemp + 1, Math.ceil(Math.max(...validTemps) + 2));
    const maxRain = Math.max(1, ...rainfall.filter(Number.isFinite));
    const pad = { top: 32, right: 16, bottom: 38, left: 42 };
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const x = i => pad.left + (count === 1 ? chartWidth / 2 : i / (count - 1) * chartWidth);
    const yTemp = value => pad.top + (maxTemp - value) / (maxTemp - minTemp) * chartHeight;

    ctx.font = "11px system-ui";
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e5e7eb";
    ctx.fillStyle = "#52606d";
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartHeight * i / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      const value = maxTemp - (maxTemp - minTemp) * i / 4;
      ctx.fillText(`${Math.round(value)}°`, 4, y + 4);
    }

    rainfall.forEach((value, i) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const barWidth = Math.max(2, chartWidth / count * 0.5);
      const barHeight = chartHeight * 0.42 * value / maxRain;
      ctx.fillStyle = "#93c5fd";
      ctx.fillRect(x(i) - barWidth / 2, pad.top + chartHeight - barHeight, barWidth, barHeight);
    });

    ctx.beginPath();
    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 2.5;
    let started = false;
    temps.forEach((value, i) => {
      if (!Number.isFinite(value)) { started = false; return; }
      if (!started) { ctx.moveTo(x(i), yTemp(value)); started = true; }
      else ctx.lineTo(x(i), yTemp(value));
    });
    ctx.stroke();

    temps.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      ctx.beginPath();
      ctx.fillStyle = "#ea580c";
      ctx.arc(x(i), yTemp(value), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    for (let i = 0; i < count; i += 4) {
      const label = String(times[i]).slice(11, 16) || String(times[i]);
      ctx.fillStyle = "#52606d";
      ctx.fillText(label, Math.min(width - 38, Math.max(pad.left, x(i) - 14)), height - 12);
    }

    ctx.font = "12px system-ui";
    ctx.fillStyle = "#ea580c";
    ctx.fillText("● Temperature (°C)", pad.left, 16);
    ctx.fillStyle = "#2563eb";
    ctx.fillText("■ Rain (mm)", pad.left + 145, 16);

    const summary = document.getElementById("chart-summary");
    if (summary) {
      summary.textContent = `Next 24 hours: ${Math.min(...validTemps).toFixed(1)}–${Math.max(...validTemps).toFixed(1)}°C; maximum hourly rainfall ${Math.max(0, ...rainfall.filter(Number.isFinite)).toFixed(1)} mm.`;
    }
  };

  window.addEventListener("resize", () => {
    const dashboard = window.WeatherDashboard;
    const current = dashboard && dashboard.getState();
    if (current?.forecast) WX.hourly.render(current.forecast.hourly);
  });
})();