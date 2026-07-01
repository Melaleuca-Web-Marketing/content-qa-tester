# Desktop App

This folder contains the Electron wrapper for the Melaleuca Content QA Tester.
It is intentionally additive: the existing server app still starts with
`npm start`, and the desktop app starts the same `server.js` locally with
desktop-only environment variables.

## Runtime Isolation

The desktop wrapper sets these values before launching the local server:

- `TESTER_NO_AUTO_OPEN=1`
- `TESTER_PORT=0`
- `TESTER_DATA_DIR=<user-local-app-data>\Melaleuca Content QA Tester`
- `CATEGORIES_PATH=<user-local-app-data>\Melaleuca Content QA Tester\categories.json`
- `TESTER_TOOL_CONCURRENCY=<local CPU bounded default>`

That keeps reports, history, job state, session lanes, and category edits on the
user's computer instead of inside the installed app folder or the shared server.

## Commands

```powershell
npm run desktop:dev
npm run desktop:pack
npm run desktop:dist
```

`desktop:pack` creates an unpacked Windows app under `dist/`.
`desktop:dist` creates the NSIS Windows installer.

Both packaging commands run `desktop:install-browsers` first, which installs the
Playwright Chromium build under `node_modules/playwright-core/.local-browsers`
so it can be packaged with the app.
