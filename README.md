# Melaleuca Content QA Tester

Unified testing tool for Melaleuca SKUs and Banners using Playwright.

## Local setup

1) Install dependencies

```
npm install
```

2) Install Playwright browser (one time)

```
npm run install-browsers
```

3) Configure environment variables

Copy `.env.example` to `.env` and update values as needed.

Key settings:
- `TESTER_BASE_PATH`: Use `/` locally. In production, set this to your subdirectory (for example `/qa-tester`).
- `TESTER_PORT`: Port to bind (default `3000`).
- `TESTER_DATA_DIR`: Optional directory for reports and history.
- `TESTER_NO_AUTO_OPEN`: Set to `1` to disable opening a browser on startup.
- `TESTER_BROWSER`: Optional browser override (for example `chrome`, `edge`, `firefox`).

4) Start the server

```
npm start
```

## Keeping local and production in sync

Use the same code and the same `npm start` command in all environments. Only environment variables should differ. This keeps routing and asset paths consistent while allowing production to run under a subdirectory via `TESTER_BASE_PATH`.
