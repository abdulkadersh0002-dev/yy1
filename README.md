# SignalsStrategy – Quick Start

A streamlined Node/Express app that serves your AI Trading Dashboard locally. This guide covers sharing the project to another computer (e.g., school PC) and running it reliably on Windows.

## Requirements
- Windows 10/11
- Node.js LTS (install from nodejs.org)
- Git (install from git-scm.com)

Optional:
- MetaTrader 4/5 if you want to connect your EA (not required to view the dashboard)

## Project Layout
- `simple-server.cjs` – Express server and SSE endpoints
- `client/index.html` – Dashboard UI
- `start-app.ps1` – Windows helper to free ports and start/open the app
- `mt-websocket.cjs`, `mt-bridge.cjs`, `signal-engine.cjs` – MT bridge + signals
- `.gitignore` – excludes node_modules, .env, logs

## First-time (Home PC): Push to GitHub
1) Create a new (private) repo on GitHub.
2) In VS Code terminal at the project folder:
```
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

Your `.env` (if any) is ignored and won’t be uploaded. Copy it manually if needed.

## On the School PC: Clone and Run
1) Open terminal and clone:
```
git clone https://github.com/USERNAME/REPO.git
cd REPO
```
2) Install dependencies:
```
npm install
```
3) Start on Windows (frees ports, runs server, opens browser):
```
npm run start:win
```
If you prefer manual start:
```
npm run start
```
Then open http://localhost:4101 in a browser.

## Troubleshooting
- “address already in use” on 4101/8765
  - Close other apps using those ports, or run the helper again:
  - The `start-app.ps1` script kills listeners on 4101/8765 automatically.
- Browser can’t connect or page blank
  - Wait a few seconds after starting.
  - Try http://127.0.0.1:4101 instead of localhost.
  - Allow Windows Firewall when prompted.
- Node isn’t recognized
  - Install Node.js LTS and restart the terminal.
- Git blocked or unavailable at school
  - At home, ZIP the folder (excluding `node_modules`), copy via USB/cloud.
  - On school PC: unzip, then run `npm install` and `npm run start:win`.

## Optional: EA/Real Account Data
- Download/allow EA in MetaTrader and set WebRequest permission to your server URL (http://localhost:4101). This isn’t required to preview the dashboard UI.

## Commands Recap
- Start (Windows):
```
npm run start:win
```
- Start (manual):
```
npm run start
```
- Health check: http://localhost:4101/api/health
- Live stream (SSE): http://localhost:4101/api/stream

---
Maintained by wesam. If you’d like, we can add per-pair watchlists or persist filters automatically (localStorage is already wired for filters).
