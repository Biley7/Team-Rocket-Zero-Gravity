// Weather and Alerts Dashboard - Hack Day Haldia x GRID community starter. Build the core tasks from README.md.
const KEY = "hackday-haldia-team-rocket";
const $ = (sel) => document.querySelector(sel);

// App state - reshape it to fit your project.
let state = { items: [] };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
}

function load() {
  try { state = JSON.parse(localStorage.getItem(KEY)) || state; } catch (e) { /* ignore */ }
}

function render() {
  // TODO: draw your UI into #app
}

// ---- TODO(core): fill these in -------------------------------------------
// TODO(core): city name -> coordinates
function searchCity() {
}

// TODO(core): coordinates -> forecast data
function fetchWeather() {
}

// TODO(core): forecast -> list of alerts with severity
function computeAlerts() {
}

// TODO(core): draw the hourly chart
function renderChart() {
}

// TODO(core): show alert cards
function renderAlerts() {
}


document.addEventListener("DOMContentLoaded", () => {
  load();
  $("#status").textContent = "script.js loaded.";
  render();
});
