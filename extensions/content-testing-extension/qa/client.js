// QA Tester API client. Requests go with the browser's cookies (credentials: "include"), so the extension
// uses the same tester_sid session as the QA Tester web app: tests started here show up in that user's
// queue, job history and reports. The server has no CORS; the extension's host permission covers it.

export function makeClient(server) {
  const base = String(server || "").replace(/\/+$/, "");

  async function req(path, init = {}) {
    const r = await fetch(base + path, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : {},
    });
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const err = new Error((data && (data.message || data.error)) || `HTTP ${r.status}`);
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    base,
    session: () => req("/api/session"),
    config: () => req("/api/config"),
    start: (tool, body) => req(`/api/${tool}/start`, { method: "POST", body: JSON.stringify(body) }),
    jobs: (limit = 8) => req(`/api/jobs/me?limit=${limit}`),
    history: () => req("/api/history"),
    reportUrl: (filename) => `${base}/api/reports/${encodeURIComponent(filename)}`,
    appUrl: (page = "index.html") => `${base}/${page}`,
  };
}

/** The finished job's report in /api/history: same tool and test name, written around when the job finished. */
export function findReport(history, job, testName) {
  const entries = (history && history.history) || [];
  const done = Date.parse(job.finishedAt || job.startedAt || job.createdAt || 0) || 0;
  const candidates = entries.filter((h) => h.mode === job.tool && (!testName || h.testName === testName));
  candidates.sort((a, b) => Math.abs(a.timestamp - done) - Math.abs(b.timestamp - done));
  const best = candidates[0];
  return best && (!done || Math.abs(best.timestamp - done) < 10 * 60 * 1000) ? best : null;
}
