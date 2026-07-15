# Page Tester

Generic any-page **content** testing tool inside the Melaleuca Content QA Tester.
Unlike the other tools (SKU, Banner, PSLP, Mix-In Ad, Sort Order, PDP) which
target specific page types, the Page Tester runs a fixed set of content checks
against **any** page on melaleuca.com, signed out and/or signed in, across
production / stage / UAT and all cultures — and can optionally send the collected
results to Claude for an AI review that adds context to the report.

## What it tests

Every run tests content — there is nothing to configure per check:

| Check | What it collects |
|---|---|
| Image Health | Broken images (`naturalWidth === 0`), missing `alt` attributes, totals |
| Content / Metadata | Title, meta description, `html lang` vs requested culture, H1 count/text, H2 heading outline, visible text length, `#environment-variables` culture |
| Component Inventory | Counts of known Melaleuca components (hero carousel, full-width banner, variable windows, monthly specials, product cards, mix-in ads, product grid, PDP details, etc.) |
| Screenshots | Full-page JPEG screenshots at the selected viewport widths |

Every result also records HTTP status, redirect chain, and load time.

## Report format

The HTML report mirrors the **PDP tester report** (same visual language and the
same section-by-section content breakdown), generalized to any page:

- **Executive summary** — page-test totals (each page × culture × auth is one
  test), passed / failed counts, total content sections, and total screenshots.
- **AI review** — overall panel when enabled.
- **Per test card** (one per page / culture / auth): culture + auth badges and a
  Passed / Failed status pill, issue chips, per-card AI findings, a **Page
  Summary** table (URL, HTTP status, load time, title, meta description, H1,
  lang, text length, section headings, component inventory), then:
  - **Full Page Screenshots** — collapsible, responsive (Mobile / Tablet /
    Desktop) at every captured width.
  - **Content Sections (N)** — the page's main content broken into numbered
    sections, each with a **section type badge** (Banner / Content / Image /
    Navigation / Text), its own **section screenshot** (with dimensions), an
    **image alt-text audit** (`N images, M missing`, missing ones flagged), and
    a **links list** (URL, link text, opens-in-same/new-tab behavior).

Section extraction is ported from the PDP tester but rooted at the page's main
content region (`main` / `[role=main]` / `#vApp` / `body`), skipping site chrome
(header / nav / footer). Capped at 40 sections per page.

A page is marked **Failed** if it errored, returned HTTP >= 400, or had broken
images; otherwise **Passed**. Softer content issues (missing meta description,
missing alt text, lang mismatch) surface as issue chips without failing the test.

## Specifying pages

Enter one page per line in the UI:

- Site-relative paths: `/`, `/productstore/supplements`, `/Product/1216`
- Full URLs: `https://productstore2-uatus.melaleuca.com/productstore/cleaning`

Relative paths are resolved against the selected environment + region host.
`sc_lang` is appended automatically from the selected culture unless the URL
already sets it. Max 100 pages per run.

## Auth modes

- **Signed Out** — no site login. On stage/UAT the Microsoft gateway auth still
  runs (automatic with credentials, or manual sign-in with Resume, same as the
  other tools).
- **Signed In** — logs in to melaleuca.com with the provided credentials before
  testing (same login flow as the SKU/PDP testers). Selecting both modes tests
  every page both ways so the report can be compared side by side.

Each culture × auth-mode combination runs in a fresh browser context, so
signed-in state never leaks into signed-out results.

## AI review

When enabled (checkbox in the UI), the run's results — minus screenshots — are
sent once, after all pages finish, to the Anthropic API. The review returns:

- An **overall summary** and pass/warning/fail status for the whole run
- A **per-page verdict, summary, and findings** (severity, explanation,
  recommendation), rendered in the HTML report

The reviewer is instructed to add context for the **content team** (not
developers): judging missing components by page type, spotting incomplete or
thin content, comparing signed-in vs signed-out and cross-culture results, and
phrasing recommendations as what to fix in Sitecore.

### Setup

Add to `.env.local` in the app root (loaded by `server.js` at startup):

```
ANTHROPIC_API_KEY=sk-ant-...
# optional, defaults to claude-opus-4-8
TESTER_AI_MODEL=claude-opus-4-8
```

If the key is not configured, the AI Review checkbox is disabled in the UI (with
an explanatory message) and runs proceed without review. AI failures (rate
limits, auth errors) never fail the test run — the report simply notes that the
review was not completed.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Enables AI review | unset (AI review disabled) |
| `TESTER_AI_MODEL` | Claude model for the review | `claude-opus-4-8` |
| `TESTER_PAGE_CONCURRENCY` | Global concurrent page jobs | `TESTER_TOOL_CONCURRENCY` (12) |
| `TESTER_PAGE_LANE_CONCURRENCY` | Per-user concurrent page jobs | 1 |

## Files

- `processors/page-processor.js` — Playwright engine (extends `BaseProcessor`)
- `report-generators/page-report.js` — HTML report
- `utils/ai-reviewer.js` — Anthropic API integration (structured JSON output)
- `public/page-tester.html` / `public/page-app.js` — UI
- `config.js` — `config.page` section, `buildPageTestUrl`, `validatePageConfig`
- `server.js` — `/api/page/*` routes (status/start/stop/resume/update-credentials/results)

## API

Same route shape as the other tools:

```
GET  /api/page/status
POST /api/page/start      { pages[], environment, region, cultures[], authModes[],
                            widths[], aiReview, username, password, testName }
POST /api/page/stop
POST /api/page/resume
POST /api/page/update-credentials
GET  /api/page/results
```

Reports are auto-generated on completion and appear in Job History like every
other tool (mode: `page`, teal accent).
