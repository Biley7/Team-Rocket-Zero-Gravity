# WeatherHack — Frontend Architecture Plan

**Repo:** `team-rocket` (Team-Rocket-Zero-Gravity) · **Stack:** HTML + vanJS + CSS + Open-Meteo · **No build step**
**Author:** Senior Frontend Architect · **Status:** Plan only — no implementation in this document

---

## 0. Ground truth used for this plan

| Item | Verified value |
|---|---|
| Files in repo | `index.html`, `script.js`, `package.json`, `README.md`, `.gitignore`, `.freebuff/project-id` |
| Git | Repo lives in `Team-Rocket-Zero-Gravity/` (workspace root is **not** a git repo). Branch `main`, 1 commit `817063f`, remote `github.com/Biley7/Team-Rocket-Zero-Gravity.git` |
| Serve | `npm start` → `npx --yes serve .` (needs network on first run) |
| CSS | **No `.css` file exists** — all CSS is an inline `<style>` block in `index.html` |
| Existing DOM | `#app`, `#status`, `.start`, `.tag` only |
| Existing JS | `KEY`, `$()`, `state = { items: [] }`, `save()`, `load()`, `render()` (empty) + 5 empty TODO stubs |

Verified live Open-Meteo contract (Haldia, `forecast_days=7`):

```
geocoding → results[]: { id, name, latitude, longitude, country, country_code,
                         admin1, admin2, admin3, timezone, population }
forecast  → { latitude, longitude, utc_offset_seconds, timezone,
              timezone_abbreviation, elevation, current_units, current,
              hourly_units, hourly, daily_units, daily }
current   → { time, interval, temperature_2m, relative_humidity_2m,
              apparent_temperature, is_day, precipitation, weather_code,
              wind_speed_10m, wind_direction_10m }
hourly    → { time[168], temperature_2m[168], precipitation[168] }
daily     → { time[7], weather_code[7], temperature_2m_max[7],
              temperature_2m_min[7], precipitation_sum[7], wind_speed_10m_max[7] }
```

Notes that shape the design:
- `hourly` returns **168 entries (7 days)**, `daily` returns **7** — no extra calls needed for either.
- `is_day` exists **only on `current`**. To get day/night for future days, add `is_day` to `hourly` and `sunrise,sunset` to `daily`.
- All `time` strings are **local ISO without offset**; the real offset is in `utc_offset_seconds`.

---

## 1. Existing repository structure

```
WeatherHack/
└── Team-Rocket-Zero-Gravity/     ← git repo root
    ├── .freebuff/project-id       ← tooling artifact, untracked
    ├── .gitignore                 ← node_modules/, .env
    ├── README.md
    ├── index.html                 ← base page + inline <style>
    ├── package.json               ← only `start` script
    └── script.js                  ← state, save/load, render, 5 TODO stubs
```

### Current runtime flow

[index.html](index.html) loads [script.js](script.js) with `defer`, then:

```js
document.addEventListener("DOMContentLoaded", () => {
  load();
  $("#status").textContent = "script.js loaded.";
  render();                          // currently empty — page shows placeholder
});
```

So today the app is a **placeholder shell**. There is no state machine, no data layer, no rendering, no CSS file, and no DOM contract. That is expected — this starter is a blank canvas, which is exactly why the interfaces must be fixed *before* three people start writing code.

### Reusable assets (keep, don't rewrite)

| Asset | Verdict |
|---|---|
| `$()` query helper | **Keep**, promote to shared helper |
| `save()` / `load()` try-catch pattern | **Keep the pattern** (storage can throw in private mode), but move behind a storage facade |
| Single `KEY` constant | **Replace** with namespaced keys (see §4.4) — one key for three owners guarantees collisions |
| `state = { items: [] }` | **Replace** with `WX.state` (§4) |
| TODO stubs `searchCity`, `fetchWeather`, `computeAlerts`, `renderChart`, `renderAlerts` | **Keep the names**, assign owners, and re-house them into modules |
| `.start` card style | Reusable as the base of `.wx-card` |
| Inline `<style>` | **Move out** to `styles/base.css` |

---

## 2. Recommended file structure

No build step, so everything is loaded by `<script>` tags in a fixed order. CSS is split by owner so three people never touch one file.

```
Team-Rocket-Zero-Gravity/
├── index.html                  ← SHELL: markup skeleton + region containers only   [You]
├── script.js                   ← BOOTSTRAP: load(), orchestration, init            [You]
├── styles/
│   ├── base.css                ← reset, design tokens, app grid, cards, utilities  [You]
│   ├── scene.css               ← shared atmosphere: .wx-scene layers + keyframes   [You]
│   ├── current.css             ← search, current conditions, 7-day                  [You]
│   ├── chart.css               ← hourly chart canvas + legend                      [Pawan]
│   ├── alerts.css              ← alert cards + severity colours                    [Pawan]
│   └── prefs.css               ← favourites, unit toggle, status banner            [Dighal]
└── js/
    ├── events.js               ← WX.events pub/sub (shared, frozen)                [You]
    ├── state.js                ← WX.state + WX.set()/WX.get()                      [You]
    ├── wmo.js                  ← WMO code → { description, icon, themeKey }        [You]
    ├── normalize.js            ← raw API payload → normalized contract             [You]
    ├── units.js                ← WX.units.formatTemp()/formatWind()/toggle()       [Dighal]
    ├── storage.js              ← WX.storage.* facade over localStorage             [Dighal]
    ├── api.js                  ← WX.api.searchCities() / fetchForecast()           [You]
    ├── current.js              ← search UI, current card, 7-day forecast           [You]
    ├── scene.js                ← WX.scene.map()/init() + WX.theme.apply()          [You]
    ├── chart.js                ← WX.hourly.render()                                [Pawan]
    ├── alerts.js               ← WX.alerts.compute() / render()                    [Pawan]
    ├── prefs.js                ← favourites + unit toggle UI                       [Dighal]
    └── status.js               ← WX.status.* loading/offline/error + cache read    [Dighal]
```

### Why classic scripts + a namespace, not ES modules

`README.md` says *"or simply open `index.html` in your browser"*. ES modules (`import`/`export`) **break over `file://`** because of CORS, and a hackathon demo is exactly where you'll double-click the file. Classic scripts with a single `WX` namespace:

- work on `file://` **and** over `npm start`;
- need zero build step;
- give a deterministic load order;
- avoid global pollution by touching exactly one global.

**Decision to confirm with the team:** if you are happy to always be on `http://` (via `npm start`), ES modules are cleaner and allow one entry `/js/main.js`. If you want the `file://` safety net, use the namespace plan below. **This plan assumes the namespace approach.**

### Load order (strict — append-only zone in `index.html`)

```html
<script src="js/events.js"   defer></script>
<script src="js/state.js"    defer></script>
<script src="js/wmo.js"      defer></script>
<script src="js/normalize.js" defer></script>
<script src="js/storage.js"  defer></script>
<script src="js/units.js"    defer></script>
<script src="js/api.js"      defer></script>
<script src="js/current.js"  defer></script>
<script src="js/scene.js"    defer></script>   <!-- after current.js: owns WX.theme -->
<script src="js/chart.js"    defer></script>   <!-- Pawan -->
<script src="js/alerts.js"   defer></script>   <!-- Pawan -->
<script src="js/prefs.js"    defer></script>   <!-- Dighal -->
<script src="js/status.js"   defer></script>   <!-- Dighal -->
<script src="script.js"      defer></script>   <!-- bootstrap, must stay last -->
```

Rule: **each developer appends their own two `<script>` lines and never reorders or edits another's.** Every file is an IIFE that only writes to `WX.*`.

```js
// every module looks like this — the only allowed global is WX
(function (WX) {
  "use strict";
  WX.hourly = { render: function (mount, weather, units) { /* ... */ } };
})(window.WX = window.WX || {});
```

---

## 3. Conflict analysis (the most important section)

These are the real collision points in the current code. Each one is solved by a rule in §4–§6.

| # | Conflict | Who collides | Why it breaks | Resolution |
|---|---|---|---|---|
| **C1** | `#app` is one container and `render()` is one function | All three | First dev's `innerHTML =` wipes the other two's DOM. Guaranteed merge conflict + runtime blanking | Split into **named region containers**; replace `render()` with orchestrator that calls each region renderer (§5) |
| **C2** | `let state = { items: [] }` | All three | Three people mutate one object literal; Dighal's storage and Pawan's alerts disagree on shape | Single `WX.state` with a **frozen documented shape**; writes only via `WX.set()` (§4) |
| **C3** | `save()`/`load()` write one `KEY` blob | You + Dighal | Favourites, unit pref and weather cache overwrite each other in one JSON | **Namespaced keys** + storage facade; nobody calls `localStorage` directly (§3.4) |
| **C4** | Inline `<style>` in `index.html` | All three | Everyone adds rules to the same block → constant conflicts in `<head>` | Move to 5 owner-scoped CSS files; `index.html` keeps only `<link>` tags |
| **C5** | C/F toggle affects *every* rendered temperature | All three | Each dev re-implements `(c*9/5)+32`; chart axis and alert thresholds drift out of sync | **Canonical data always in °C.** One formatter `WX.units.formatTemp()` (§3.3) |
| **C6** | `fetchWeather()` could be called by both you and Dighal | You + Dighal | Double API calls; "don't duplicate API calls" violated | `WX.api.fetchForecast()` is the **only** network path; Dighal reads cache, never fetches |
| **C7** | `computeAlerts` / `renderChart` stubs sit in your file | You + Pawan | Pawan would have to edit `script.js`, which you also own | Stubs are **deleted from `script.js`** and re-homed into Pawan's `chart.js`/`alerts.js` |
| **C8** | Weather-code → description/icon mapping | You + Pawan | Two divergent tables (e.g. 61 = "Rain" vs "Light rain") | One table `WX.wmo.describe()` in `wmo.js`; everyone imports it |
| **C9** | `.freebuff/` is untracked | — | `git status` noise; someone may commit it | Add `.freebuff/` to `.gitignore` (owner: you) |
| **C10** | `$()` and `KEY` are module-private once split | All three | Each dev defines their own `$` | Keep `$` on `WX.$` (§3.2) |

### 3.1 The `#app` problem, concretely

Today there is nowhere for three features to live. This is the root cause of C1 and it must be fixed **before** any branch starts. The shell becomes:

```html
<main id="app" class="wx-app">
  <div id="status-banner"  class="wx-status" aria-live="polite"></div>   <!-- Dighal -->
  <section id="city-search"   class="wx-region wx-region--search"></section>   <!-- You -->
  <section id="current-weather" class="wx-region wx-region--current"></section> <!-- You -->
  <section id="hourly-chart"  class="wx-region wx-region--chart"></section>    <!-- Pawan -->
  <section id="alerts"        class="wx-region wx-region--alerts"></section>   <!-- Pawan -->
  <section id="forecast-7day" class="wx-region wx-region--forecast"></section> <!-- You -->
  <section id="favourites"    class="wx-region wx-region--favourites"></section><!-- Dighal -->
  <div id="units-toggle"      class="wx-units"></div>                          <!-- Dighal -->
</main>
```

Each `renderX()` writes **only into its own `#region`**. Nobody touches another region's subtree. This single change removes ~80% of the merge risk.

### 3.2 Shared helpers

```js
WX.$  = (sel, root) => (root || document).querySelector(sel);
WX.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
WX.el = (tag, className, text) => { /* createElement + class + textContent */ };
```

### 3.3 Unit conversion — one implementation only

```js
WX.units = {
  current: "C",                        // "C" | "F"
  formatTemp(celsius, opts),           // → "30°" / "86°"  (null-safe → "—")
  formatWind(kmh, opts),               // m/s if user later wants it
  toggle(),                            // flips current, emits "units:changed"
  subscribe(fn)                        // convenience wrapper on WX.events.on
};
```

Hard rule: **the normalized contract and all alert thresholds are in metric.** Fahrenheit is a *display* concern only. Pawan computes alert thresholds against °C, then renders via `WX.units.formatTemp()`.

### 3.4 Storage namespacing

```
wx.favourites   → [ cityRef, ... ]                       [Dighal]
wx.units        → "C" | "F"                              [Dighal]
wx.cache        → { city, weather, fetchedAt }           [Dighal]
```

Legacy `hackday-haldia-team-rocket` key: leave it, do not write to it. It only ever held `{ items: [] }`.

---

## 4. Shared data contract

This is the **single normalized object** every feature consumes. It is the boundary between the API layer and all UI layers. Owner: **you**. Consumers: everyone. It is produced **once per city selection** by exactly one API call.

### 4.1 The normalized weather object (`WX.state.weather`)

```js
{
  city: {
    id: 1344377,                 // geocoding result id (null if unknown)
    name: "Haldia",
    country: "India",
    countryCode: "IN",
    region: "West Bengal",       // from admin1
    district: "East Midnapore",  // from admin2 (optional)
    latitude: 22.06046,
    longitude: 88.10975,
    timezone: "Asia/Kolkata",
    utcOffsetSeconds: 19800
  },

  fetchedAt: 1761822600000,      // Date.now() — used by cache + offline badge

  current: {
    time: "2026-10-30T14:15",    // local ISO as returned
    temperature: 30.1,           // °C
    feelsLike: 33.2,             // °C
    humidity: 74,                // %
    weatherCode: 3,              // WMO code
    description: "Overcast",     // via WX.wmo.describe(code)
    icon: "clouds",              // via WX.wmo.describe(code)
    theme: "clouds",             // visual theme key (see §6.3)
    isDay: true,                 // is_day === 1
    precipitation: 0.0,          // mm (current)
    windSpeed: 12.3,             // km/h
    windDirection: 180           // degrees
  },

  hourly: {
    time:          ["2026-10-30T00:00", ...],  // 168 entries
    temperature:   [24.1, ...],                // °C
    precipitation: [0.0, ...],                 // mm
    isDay:         [0, ...]                    // add is_day to hourly params
  },

  daily: [                                     // exactly 7, index 0 = today
    {
      date: "2026-10-30",
      weatherCode: 3,
      description: "Overcast",
      icon: "clouds",
      tempMax: 32.4,            // °C
      tempMin: 24.1,            // °C
      precipitationSum: 2.4,    // mm
      windSpeedMax: 21.6,       // km/h
      sunrise: "2026-10-30T05:48",
      sunset:  "2026-10-30T17:12"
    }
    // × 7
  ]
}
```

**Unit policy:** every numeric weather value is metric (°C, km/h, mm, %). No Fahrenheit, no m/s, anywhere in this object.

**Immutability:** modules must treat `weather` as read-only. Never mutate `WX.state.weather`.

### 4.2 Global app state (`WX.state`)

```js
WX.state = {
  city:  null,        // cityRef of the selected city
  weather: null,      // normalized object (§4.1) or null
  units: "C",         // Dighal
  favourites: [],     // Dighal — array of cityRef
  status: "idle",     // Dighal — "idle"|"loading"|"ready"|"error"|"offline"
  error: null,        // Dighal — { message, code } | null
  source: "network"   // Dighal — "network" | "cache"
};
```

Write access goes through a tiny setter so Dighal can hook persistence in one place:

```js
WX.set(patch)   // shallow-merge → emits "state:changed" with the patch keys
WX.get()        // returns WX.state (read-only by convention)
```

### 4.3 `cityRef` (what favourites store)

Favourites must survive a reload **without** storing the whole 168-entry weather blob. Store only:

```js
{ id, name, country, countryCode, region, latitude, longitude, timezone }
```

### 4.4 The one API request

```js
WX.api.fetchForecast(cityRefOrCoords) →
  https://api.open-meteo.com/v1/forecast
    ?latitude=..&longitude=..
    &current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,
             precipitation,weather_code,wind_speed_10m,wind_direction_10m
    &hourly=temperature_2m,precipitation,is_day
    &daily=weather_code,temperature_2m_max,temperature_2m_min,
           precipitation_sum,wind_speed_10m_max,sunrise,sunset
    &timezone=auto&forecast_days=7
```

```js
WX.api.searchCities(query) →
  https://geocoding-api.open-meteo.com/v1/search?name=..&count=5&language=en&format=json
```

`is_day` on hourly + `sunrise`/`sunset` on daily are **additions** needed to satisfy the "day/night status" requirement beyond today. Still **one** forecast call.

### 4.5 Event bus — how branches stay decoupled

```js
WX.events.on(name, handler)   // returns an unsubscribe fn
WX.events.emit(name, payload)
```

| Event | Emitted by | Payload | Consumed by |
|---|---|---|---|
| `city:changed` | You | `cityRef` | All |
| `weather:loaded` | You | `weather` | Pawan, Dighal |
| `weather:failed` | You | `error` | Dighal |
| `units:changed` | Dighal | `"C"\|"F"` | You, Pawan |
| `favourites:changed` | Dighal | `cityRef[]` | Dighal |
| `status:changed` | Dighal | `status` | All |

**This is the key decoupling mechanism:** Pawan and Dighal never call into your render pipeline. They subscribe to `weather:loaded` and re-render their own region. You never call theirs.

---

## 5. Function ownership

| Function | File | Owner |
|---|---|---|
| `WX.events.on/emit` | `js/events.js` | **You** |
| `WX.state`, `WX.set()`, `WX.get()` | `js/state.js` | **You** |
| `WX.wmo.describe(code)` | `js/wmo.js` | **You** |
| `WX.normalize(raw, city)` | `js/normalize.js` | **You** |
| `WX.api.searchCities(query)` | `js/api.js` | **You** |
| `WX.api.fetchForecast(city)` | `js/api.js` | **You** |
| `WX.city.search()` (was `searchCity`) | `js/current.js` | **You** |
| `WX.loadWeather()` (was `fetchWeather`) | `js/current.js` | **You** |
| `WX.current.render()` | `js/current.js` | **You** |
| `WX.forecast.render()` | `js/current.js` | **You** |
| `WX.scene.map(code, isDay)` | `js/scene.js` | **You** |
| `WX.scene.init()` | `js/scene.js` | **You** |
| `WX.theme.apply(weather)` | `js/scene.js` | **You** |
| `WX.hourly.render(mount, weather, units)` (was `renderChart`) | `js/chart.js` | **Pawan** |
| `WX.alerts.compute(weather)` (was `computeAlerts`) | `js/alerts.js` | **Pawan** |
| `WX.alerts.render(mount, alerts)` (was `renderAlerts`) | `js/alerts.js` | **Pawan** |
| `WX.units.formatTemp/formatWind/toggle` | `js/units.js` | **Dighal** |
| `WX.storage.get/set/remove` | `js/storage.js` | **Dighal** |
| `WX.storage.saveFavourites/loadFavourites` | `js/storage.js` | **Dighal** |
| `WX.storage.cacheWeather/readCache` | `js/storage.js` | **Dighal** |
| `WX.prefs.renderFavourites()` | `js/prefs.js` | **Dighal** |
| `WX.prefs.renderUnitsToggle()` | `js/prefs.js` | **Dighal** |
| `WX.status.set/clear` | `js/status.js` | **Dighal** |
| `WX.status.render()` | `js/status.js` | **Dighal** |
| `WX.online.watch()` | `js/status.js` | **Dighal** |
| `WX.boot()` + `WX.renderAll()` | `script.js` | **You** |

### 5.1 Boot sequence (`script.js`) — the only place that knows about everyone

```js
WX.boot = function () {
  WX.units.init();        // Dighal: load pref, wire toggle
  WX.storage.init();      // Dighal: load favourites
  WX.prefs.init();
  WX.status.init();       // Dighal: online/offline listeners
  WX.current.init();      // You: search form wiring
  WX.hourly.init();       // Pawan
  WX.alerts.init();       // Pawan
  WX.scene.init();        // You: builds the shared atmosphere once

  WX.status.restore();    // Dighal: paint from cache if present, then refresh
  WX.renderAll();
};

WX.renderAll = function () {
  WX.current.render();
  WX.forecast.render();
  WX.theme.apply(WX.state.weather);
  WX.hourly.render(WX.$("#hourly-chart"), WX.state.weather, WX.units.current);
  WX.alerts.render(WX.$("#alerts"), WX.alerts.compute(WX.state.weather));
  WX.prefs.renderFavourites();
  WX.prefs.renderUnitsToggle();
  WX.status.render();
};
```

Every module exposes `init()` that only wires its own listeners, and `render(...)` that only paints its own region. `renderAll()` is the single full repaint; incremental repaints happen through the event bus.

**Rule:** if you need data from another module, subscribe to an event. **Never** call another module's `render()` directly except from `renderAll()`.

---

## 6. DOM / component ownership

### 6.1 Regions and IDs

| Region | Owner | IDs that owner may create inside |
|---|---|---|
| `.wx-bg` (outside `#app`) | You | `.wx-scene` and `.wx-scene__*` only — built once by `WX.scene.init()` |
| `#status-banner` | Dighal | `#status-banner`, `.wx-status--loading/error/offline`, `#retry-btn` |
| `#city-search` | You | `#search-form`, `#search-input`, `#search-clear`, `#search-spinner`, `#search-results`, `#search-error`, `#search-hint`, `.wx-search__*` |
| `#current-weather` | You | `#current-city`, `#current-flag`, `#current-region`, `#current-icon`, `#current-temp`, `#current-desc`, `#current-range`, `#current-feels`, `#current-humidity`, `#current-wind`, `#current-winddir`, `#current-precip`, `#current-uv`, `#current-sun`, `#current-localtime`, `#current-updated`, `#current-message`, `.wx-current__*` |
| `#hourly-chart` | Pawan | `#hourly-chart`, `#chart-canvas`, `#chart-legend`, `#chart-empty` |
| `#alerts` | Pawan | `#alerts-list`, `#alerts-empty`, `.wx-alert` |
| `#forecast-7day` | You | `#forecast-list`, `#forecast-summary`, `.wx-forecast-row`, `.wx-forecast-row__*`, `#forecast-empty` |
| `#favourites` | Dighal | `#favourites-list`, `#fav-add`, `#fav-empty`, `.wx-fav` |
| `#units-toggle` | Dighal | `#units-toggle`, `#units-label` |

IDs above are **reserved**. To add a new ID, add it to this table first — that is the coordination log. Never reuse another owner's ID.

### 6.2 CSS conventions

- Prefix everything with `wx-`. BLOCK__ELEMENT--MODIFIER.
  `.wx-card`, `.wx-card__title`, `.wx-card--alert`, `.wx-alert--severe`
- **Owner prefixes inside each file:** `wx-search-*`, `wx-current-*`, `wx-forecast-*`, `wx-scene*` (you) · `wx-chart-*`, `wx-alert-*` (Pawan) · `wx-fav-*`, `wx-units-*`, `wx-status-*` (Dighal).
- State classes (global, shared vocabulary): `is-loading`, `is-hidden`, `is-empty`, `is-active`, `is-dimmed`.
- Tokens live only in `styles/base.css` `:root` and are the shared design system. Groups: spacing `--wx-space-1..6`; radii `--wx-radius-sm`, `--wx-radius`, `--wx-radius-lg`, `--wx-radius-pill`; typography `--wx-font`; backgrounds `--wx-bg-base`, `--wx-grad-1..3`, `--wx-blob-1/2`; surfaces/borders `--wx-surface`, `--wx-surface-solid`, `--wx-hover`, `--wx-border`, `--wx-border-strong`; accents `--wx-accent`, `--wx-accent-strong`, `--wx-accent-soft`, `--wx-focus-ring`, `--wx-icon-color`; severity `--wx-sev-low|moderate|high|severe` plus matching `-soft` variants; elevation `--wx-shadow-sm`, `--wx-shadow`, `--wx-shadow-lift`; motion `--wx-anim-fast`, `--wx-anim-base`, `--wx-anim-slow`, `--wx-ease`; icons `--wx-icon-sm|md|lg`; layout `--wx-shell`, `--wx-tap`.
- Consume tokens instead of hard-coding a colour, radius, duration or shadow. Add a new token in `base.css` rather than inventing a local value.
- Focus is global: `:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible` paints a 2px `--wx-accent` outline at zero specificity, so a feature file may still override it.
- **Never** use a bare element selector (`div`, `p`) inside a feature file. Scope to your prefix. This is what keeps five stylesheets from fighting.
- Mobile-first, three tiers in `base.css`: single column below 640px; two equal columns `@media (min-width: 640px)` (tablet); asymmetric `1.15fr / 0.85fr` `@media (min-width: 880px)` (desktop). Every tier uses the same named `grid-template-areas` (`status`, `search`, `current`, `forecast`, `chart`, `alerts`, `favourites`, `units`) and `align-items: start`, so a region's placement never depends on another owner's CSS. `.wx-region` sets `min-width: 0` and empty regions collapse (`:empty { display: none }`) so no tier can overflow horizontally.

### 6.3 Theming via data attributes (you own; others only read)

```html
<body data-weather="clear|clouds|rain|thunder|snow|fog"
      data-scene="clear|partly|clouds|rain|thunder|snow|fog"
      data-intensity="low|med|high|max"
      data-quality="full|reduced"
      data-time="day|night"
      data-units="c|f">
```

| Attribute | Meaning |
|---|---|
| `data-weather` | Palette key. Always the WMO theme from `WX.wmo.describe()`. |
| `data-scene` | Animation key. Same code, but keeps the partly-cloudy/overcast and drizzle/rain distinctions the palette collapses. |
| `data-intensity` | Derived from the code's `level` in `WX.scene.map()`; drives particle density and speed so drizzle never looks like a downpour. |
| `data-quality` | `reduced` on small screens, ≤4 cores, ≤4 GB memory or save-data connections. Thins the particle layers and drops blurs. |
| `data-time` | Local day/night from `current.isDay`. |
| `data-units` | Dighal's C/F preference (display only; state stays metric). |

- `WX.theme.apply(weather)` (in `js/scene.js`) is the **only** writer of `data-weather`, `data-scene`, `data-intensity` and `data-time`. It is called from `WX.renderAll()`, so the atmosphere follows every repaint automatically — nobody needs to wire an extra event.
- `data-quality` is written once by `WX.scene.init()` and re-evaluated on media-query changes.
- Others may **read** these for consistency (Pawan can theme the chart line to match) but must **not** write them.
- `data-units` is written by Dighal's toggle, read by everyone.

### 6.4 Accessibility contract

- `#status-banner` is `aria-live="polite"` — Dighal owns its text.
- Every region renders an `.is-empty` state rather than collapsing to nothing.
- Charts need a text fallback (`#chart-legend`) — Pawan.
- Severity is never colour-only; include a label — Pawan.

---

## 7. Branch integration strategy

### 7.1 Branch model

```
main  ──●──●────────────────●──────────●──────────●──────►  (always deployable)
        │  │                │          │          │
        │  └─ Phase 0 shell  │          │          │
        │                    │          │          │
        │        feat/core-dashboard ───┘  (You)
        │                    │
        │        feat/hourly-alerts ────────┘  (Pawan)
        │                    │
        │        feat/prefs-states ─────────────┘  (Dighal)
```

- Branches: `feat/core-dashboard` (you), `feat/hourly-alerts` (Pawan), `feat/prefs-states` (Dighal).
- `main` is integration-only. Nobody commits to `main` directly after Phase 0.
- Merge via PR, `main` stays working at all times (README's submission requirement).
- **Owner merges own PR** after a quick review by another member.
- Rebase on `main` before opening a PR; merge conflicts in `index.html` should be near-zero because of the append-only script zone.

### 7.2 Phase 0 — the critical unblocker (you, on `main`, before any branch)

Nothing else can start until this lands, because it *creates* the interfaces:

1. Create `styles/*` and `js/*` skeleton files with the exact signatures in §5 (empty bodies, correct namespace).
2. Rewrite `index.html`: region skeleton (§3.1), CSS `<link>`s, ordered script tags.
3. Keep `js/current.js` search + fetch + current + 7-day **stubbed but wired** so the page still shows something.
4. Move `save()`/`load()` semantics into `js/storage.js`.
5. Add `.freebuff/` to `.gitignore`.
6. Verify: `npm start` → page loads with no console errors, placeholder still visible.

Once Phase 0 is on `main`, all three branches are pure additions to separate files.

### 7.3 Integration checkpoints

| Checkpoint | Owner | Exit criteria |
|---|---|---|
| M0 Shell | You | Page loads, regions present, no console errors |
| M1 Data | You | Search → one forecast call → `#current-weather` + `#forecast-7day` render |
| M2 Chart | Pawan | `#hourly-chart` renders from `weather:loaded`, no fetch of its own |
| M3 Alerts | Pawan | `#alerts` renders from same event |
| M4 Prefs | Dighal | Favourites persist; C/F flips all temps incl. chart axis |
| M5 States | Dighal | Loading/offline/error + cache restore |
| M6 Polish | All | Responsive at 360 px, themes, a11y, then bonus tasks |

---

## 8. Potential merge conflicts (predicted, with owners)

| File | Risk | Cause | Mitigation |
|---|---|---|---|
| `index.html` | **High** | Everyone adds markup/scripts | Only you edit `<head>`; script zone is append-only; regions pre-created in Phase 0 |
| `js/current.js` ↔ `js/chart.js` | Medium | Both need hourly data | Both read `WX.state.weather.hourly`; no shared helper |
| `js/units.js` | **High** | Chart axis + alerts + current all need conversion | `units.js` merged **first** in Phase 0 shell, even if bodies are stubs; interface frozen |
| `js/storage.js` | Medium | Both cache and favourites | Different keys, one facade, Dighal sole owner |
| `styles/base.css` | Medium | Everyone wants tokens | Only you add tokens; others consume |
| `script.js` | Medium | Init order + `renderAll` | You own it; others only expose `init()`/`render()` |
| `js/alerts.js` vs `js/current.js` | Low–Medium | Both use weather codes | Always via `WX.wmo.describe()` |
| `.gitignore` | Low | Dighal may add `.DS_Store` | You own it; PR-comment for additions |

### Hard rules that prevent all of the above

1. One writer per file. If you need a change in someone else's file, comment on their PR.
2. Never call `localStorage` outside `storage.js`.
3. Never convert units outside `units.js`.
4. Never map weather codes outside `wmo.js`.
5. Never call `fetch` outside `api.js`.
6. Never write to another owner's DOM region.
7. Communicate through `WX.events`.
8. Add new DOM IDs to §6.1 before using them.

---

## 9. Missing dependencies & unnecessary complexity

### Missing (needed)

| Need | Recommendation | Note |
|---|---|---|
| **CSS file(s)** | Create `styles/base.css` **first** | None exist today — biggest gap |
| **HTTP-accessible dev server** | `npm start` (`serve`) is fine | `npx --yes serve .` downloads on first run → **hackathon-Wi-Fi risk**. Add fallback `"start:py": "python3 -m http.server 8000"` |
| **`is_day` in hourly, `sunrise`/`sunset` in daily** | Add to the API params | Required for day/night; still one call |
| **`navigator.onLine` + `online`/`offline` listeners** | Dighal | Browser-native, no lib |
| **Timeout/abort on fetch** | `AbortController` with ~10 s timeout | Native, prevents a hung loading state |
| **Date formatting** | `Intl.DateTimeFormat` with `timezone` from the contract | No date library needed |

### Explicitly NOT needed (do not add)

| Temptation | Verdict |
|---|---|
| React/Vue/Svelte/TS | Forbidden by the brief; also unnecessary |
| Chart.js / D3 | README says "canvas or SVG" — Pawan hand-rolls a canvas; ~40 lines for 2 series |
| Bundler (webpack/vite/rollup) | No build step is a feature |
| Day.js / Moment / date-fns | `Intl` + ISO strings suffice |
| Axios | `fetch` is native |
| State library (Redux/Zustand) | `WX.state` + 10-line event bus is enough |
| A big pub/sub library | ~10 lines of `on`/`emit` |
| Class-based OOP layer | Plain objects + IIFEs |
| `localStorage` wrapper library | 20 lines in `storage.js` |
| A weather SDK | Two raw `fetch` calls |

Complexity budget: **~1 shared namespace, ~13 script files, ~5 stylesheets, 10 events.** Anything beyond that is over-engineering for a 6-hour build.

---

## 10. Implementation order

| # | Step | Owner | Branch | Blocks |
|---|---|---|---|---|
| 1 | `styles/base.css` + region skeleton in `index.html` | You | `main` (Phase 0) | everyone |
| 2 | `events.js` + `state.js` | You | `main` | everyone |
| 3 | `wmo.js` | You | `main` | Pawan, you |
| 4 | `storage.js` + `units.js` (**interfaces only**) | Dighal + You | `main` | Pawan, Dighal |
| 5 | `api.js` + `normalize.js` | You | `feat/core-dashboard` | Pawan, Dighal |
| 6 | `current.js` — search, current, 7-day | You | `feat/core-dashboard` | — |
| 7 | `current.css` + themes/animations | You | `feat/core-dashboard` | — |
| 8 | `chart.js` + `chart.css` | Pawan | `feat/hourly-alerts` | M5 |
| 9 | `alerts.js` + `alerts.css` | Pawan | `feat/hourly-alerts` | — |
| 10 | `units.js` bodies | Dighal | `feat/prefs-states` | — |
| 11 | `prefs.js` — favourites + toggle | Dighal | `feat/prefs-states` | — |
| 12 | `status.js` — loading/offline/error/cache | Dighal | `feat/prefs-states` | — |
| 13 | Responsive pass @360 px | You | `main` | — |
| 14 | Bonus (compare, wear, AQI/UV, share link) | All | feature branches | core done |

**Critical path:** steps 1 → 4 must finish before 5–12 start. Steps 8/9 (Pawan) and 10–12 (Dighal) can run fully in parallel once 5 lands.

---

## 11. Decisions to confirm before Phase 0

1. **ES modules vs classic scripts + `WX` namespace?** Plan assumes namespace (keeps `file://` working). Switch to modules only if you accept `http://`-only.
2. **Alert thresholds** (metric defaults to start from): heat `tempMax ≥ 35 / 40 / 45 °C`, rain `precipitationSum ≥ 20 / 50 / 100 mm`, wind `windSpeedMax ≥ 40 / 60 / 90 km/h` → low / high / severe. Pawan owns the final numbers.
3. **Default city** on first load (suggest geolocation-free fallback: Kolkata, else last favourite from cache).
4. **Region order in the layout** — settled: status → search → current → forecast → alerts → chart → favourites → units (the mobile tier's DOM order; the desktop tiers re-flow the last four into `chart | alerts` and `favourites | units`).
5. **Layout breakpoints** — settled: single column below 640px, two equal columns at ≥640px, asymmetric `1.15fr / 0.85fr` at ≥880px. All three tiers share one `grid-template-areas` map in `styles/base.css` (see 6.2).
