npm # Multi-User Scope Changes (High Level)

This document summarizes the multi-user isolation changes so another agent can validate behavior.

## Goal

- Each browser/user sees only their own running jobs, status updates, and history.
- Users can run the same tool concurrently without colliding.

## How Identity Is Assigned

- A per-browser user ID is generated and stored in localStorage.
- The user ID is sent on every API request (header `X-User-Id`) and on WebSocket connections (query param `userId`).

Files:

- `public/user-session.js`
- `public/index.html`
- `public/sku-app.js`
- `public/banner-app.js`
- `public/mixinad-app.js`
- `public/pslp-app.js`
- `public/sku-tester.html`
- `public/banner-tester.html`
- `public/mixinad-tester.html`
- `public/pslp-tester.html`

## Server Side Isolation

- Processors are created per user and stored in a per-user registry.
- Status/progress/error broadcasts are scoped to the originating user only.

Files:

- `server.js`
- `utils/broadcast.js`

## History and Reports

- History is stored per user.
- History endpoints filter by user ID.
- Report downloads only succeed if the report belongs to the requesting user.
- Reports are named with a user tag and milliseconds to avoid collisions.

Files:

- `utils/history.js`
- `utils/auto-generate-report.js`
- `server.js`
- `public/index.html`

## What to Test

- Two different browsers/users can run the same tool at the same time.
- Each user only sees their own running jobs on the dashboard.
- Each user only sees their own history entries.
- Download/open links work only for the user who ran the job.
- Excel validation still works as before (no cross-user leakage).

## Known Behavior

- Old history entries (before this change) do not appear because they have no user ID.
- There is no login; user identity is browser-local (localStorage).
