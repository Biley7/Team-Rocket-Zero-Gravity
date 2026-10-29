# Weather and Alerts Dashboard

> Turn forecast data into clear warnings.

Hack Day Haldia x GRID community - 6-hour build challenge

**Repo:** `team-rocket` | **Stack:** HTML + vanilla JavaScript | **Difficulty:** Medium-Hard | **Time:** 6 hours

## Brief
Weather apps show numbers; people need warnings. Build a dashboard that turns forecast data into clear, colour-coded alerts.

## Core tasks (must-do)
- [ ] City search and selection (use a free, no-key weather API such as Open-Meteo)
- [ ] Current conditions and a 7-day forecast
- [ ] Hourly temperature and rain chart (canvas or SVG)
- [ ] Rule-based alerts for heat, heavy rain and strong wind, with severity colours
- [ ] Favourite cities and a C/F toggle saved in localStorage
- [ ] Loading, offline and error states (cache the last result)
- [ ] Responsive layout that works at phone width

## Bonus tasks (only after the core works)
- [ ] Compare two cities side by side
- [ ] 'What should I wear?' suggestions
- [ ] Air quality / UV panel if the API offers it
- [ ] Shareable link for a city

## What is already here
- `index.html` - base page
- `script.js` - state, `save()` / `load()` (localStorage), `render()` and TODO function stubs
- `package.json` - `npm start` serves this folder

## Run locally
```bash
npm start   # or simply open index.html in your browser
```

## Deploy
Any static host works (for example GitHub Pages, Netlify or Vercel). There is no build step.

## Suggested pacing
- Hour 1: read this README, agree on a plan and split the work
- Hours 2-4: build the core tasks
- Hour 5: integrate, polish, then bonus tasks if time allows
- Hour 6: deploy, open the Pull Request, submit on the MLH platform (OrganizerHQ)

## Submission checklist
- [ ] All core tasks work end to end
- [ ] Project is deployed and the live link opens
- [ ] Pull Request created on the Voyage GitHub repository assigned to your team
- [ ] Project submitted on the MLH platform (OrganizerHQ) - instructions are shared at the start of the event

## Rules
- Build new features on top of this starter project and integrate them.
- Teams of 3-4; every member must be present.
- AI tools and open-source / open-weight models are fully allowed.
