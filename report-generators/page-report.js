// page-report.js - Generate HTML report for Page Tester (content QA) results.
//
// Mirrors the PDP tester report: an executive summary, then one card per page /
// culture / auth combination. Each card shows the full-page screenshots at every
// captured width and a numbered "Content Sections" breakdown — each section with
// its own screenshot, an image alt-text audit, and a link inventory. The AI
// review (when enabled) is rendered as an overall panel and per-card findings.

import { escapeHtml, renderExternalLink, safeImageSrc } from './report-safety.js';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_COLORS = {
  critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', info: '#64748b'
};

export function generatePageReport(results, duration, theme = 'dark') {
  const timestamp = new Date().toISOString();
  const isDark = theme === 'dark';

  const environment = results[0]?.environment || 'N/A';
  const region = results[0]?.region || 'N/A';
  const cultureList = [...new Set(results.map(r => r.culture).filter(Boolean))];
  const cultureLabel = cultureList.length === 0
    ? 'N/A'
    : (cultureList.length === 1 ? cultureList[0] : `Multiple (${cultureList.join(', ')})`);
  const authModeList = [...new Set(results.map(r => r.authMode).filter(Boolean))];

  const passedCount = results.filter(r => r.success && isPassed(r)).length;
  const failedCount = results.length - passedCount;
  const totalSections = results.reduce((sum, r) => sum + (r.sections?.length || 0), 0);
  const totalScreenshots = results.reduce((sum, r) => sum + (r.screenshots?.length || 0), 0);

  const aiOverall = results[0]?.aiOverall || null;

  // Group by page entry so cultures/auth modes for the same page sit together
  const groups = new Map();
  for (const result of results) {
    const key = result.page || result.url || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Page Content Test Report - ${escapeHtml(new Date(timestamp).toLocaleString())}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg-primary:${isDark ? '#0f172a' : '#f0f2f5'};--bg-card:${isDark ? '#1e293b' : 'white'};--bg-card-header:${isDark ? '#334155' : '#f8fafc'};--bg-screenshot:${isDark ? '#334155' : '#f8fafc'};--text-primary:${isDark ? '#f1f5f9' : '#1a1a2e'};--text-secondary:${isDark ? '#94a3b8' : '#64748b'};--text-heading:${isDark ? '#f8fafc' : '#1e293b'};--border-color:${isDark ? '#475569' : '#e2e8f0'};--border-light:${isDark ? '#334155' : '#f1f5f9'}}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;padding:20px}
.container{max-width:1400px;margin:0 auto}
.header{background:linear-gradient(135deg,#14b8a6 0%,#0f766e 100%);color:#fff;padding:30px 40px;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 20px rgba(20,184,166,.3)}
.header h1{font-size:28px;font-weight:700;margin-bottom:12px}
.header-meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;opacity:.95}
.header-meta span{display:flex;align-items:center;gap:6px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px}
.summary-card{background:var(--bg-card);padding:12px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'});text-align:center}
.summary-card h3{font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.summary-card .value{font-size:18px;font-weight:700}
.summary-card .value.passed{color:#10b981}.summary-card .value.failed{color:#ef4444}.summary-card .value.count{color:#3b82f6}.summary-card .value.time{color:#8b5cf6;font-size:15px}
.ai-panel{background:var(--bg-card);border:1px solid var(--border-color);border-left:5px solid #14b8a6;border-radius:12px;padding:20px 24px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}
.ai-panel h2{font-size:16px;margin-bottom:8px;color:var(--text-heading);display:flex;align-items:center;gap:8px}
.ai-panel .ai-model{font-size:11px;color:var(--text-secondary);font-weight:400}
.ai-panel p{font-size:14px;color:var(--text-primary);white-space:pre-wrap}
.ai-error{color:#f59e0b;font-size:13px}
.ai-status{padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;margin-left:8px}
.ai-status.pass{background:#d1fae5;color:#059669}.ai-status.warning{background:#fef3c7;color:#b45309}.ai-status.fail{background:#fee2e2;color:#dc2626}
.page-group{margin-bottom:8px}
.page-group>h2{font-size:16px;color:var(--text-heading);margin:20px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--border-color);word-break:break-all}
.section{background:var(--bg-card);border-radius:16px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}
.sku-card{border:1px solid var(--border-color);border-radius:12px;margin:0;overflow:hidden}
.sku-header{padding:16px 20px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.sku-header h3{font-size:16px;font-weight:600;color:var(--text-heading);word-break:break-all}
.sku-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sku-body{padding:16px 20px}
.status-pill{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.status-pill.passed{background:#d1fae5;color:#059669}.status-pill.failed{background:#fee2e2;color:#dc2626}
.culture-badge{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;background:#fef3c7;color:#92400e}
.auth-badge{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600}
.auth-badge.out{background:${isDark ? '#374151' : '#e2e8f0'};color:${isDark ? '#d1d5db' : '#475569'}}
.auth-badge.in{background:#ede9fe;color:#6d28d9}
.issue-chip{display:inline-block;background:${isDark ? '#422006' : '#fef3c7'};color:${isDark ? '#fbbf24' : '#b45309'};border:1px solid ${isDark ? '#92400e' : '#fcd34d'};padding:3px 10px;border-radius:10px;font-size:12px;margin:0 6px 6px 0}
.block-title{font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-secondary);letter-spacing:.4px;margin-bottom:12px}
.data-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
.data-table th,.data-table td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--border-light);vertical-align:top}
.data-table th{width:150px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.4px}
.data-table td{word-break:break-word}.data-table td a{color:#3b82f6;text-decoration:none}
.screenshot-stack{display:flex;flex-direction:column;gap:16px}
.screenshot-item{border:1px solid var(--border-color);border-radius:12px;background:var(--bg-card);overflow:hidden}
.screenshot-item.size-mobile{width:33.333%}.screenshot-item.size-tablet{width:66.666%}.screenshot-item.size-desktop{width:100%}
.screenshot-item summary{padding:12px 16px;font-size:14px;font-weight:600;cursor:pointer;background:var(--bg-card-header);color:var(--text-heading)}
.screenshot-item[open] summary{border-bottom:1px solid var(--border-color)}
.screenshot-content{padding:16px;display:flex;justify-content:center}
.screenshot-content img{width:100%;border-radius:8px;border:1px solid var(--border-color)}
@media(max-width:900px){.screenshot-item.size-mobile,.screenshot-item.size-tablet{width:100%}}
.section-card{border:1px solid var(--border-color);border-radius:12px;margin-bottom:16px;overflow:hidden}
.section-card-header{padding:12px 16px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;cursor:pointer}
.section-card-header h4{font-size:14px;font-weight:600;color:var(--text-heading)}
.section-card-body{padding:16px}
.section-type-badge{padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;text-transform:uppercase;background:${isDark ? '#475569' : '#e2e8f0'};color:${isDark ? '#e2e8f0' : '#475569'}}
.subhead{font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-secondary);margin-bottom:8px}
.section-screenshot-container{border:1px solid var(--border-color);border-radius:8px;overflow:hidden;background:var(--bg-card-header)}
.section-screenshot-container img{width:100%;display:block}
.link-list{display:flex;flex-direction:column;gap:8px}
.link-item{padding:8px 12px;background:var(--bg-card-header);border-radius:8px;border:1px solid var(--border-color)}
.link-url{color:#3b82f6;text-decoration:none;word-break:break-all;font-size:13px}.link-url:hover{text-decoration:underline}
.link-meta{font-size:11px;color:var(--text-secondary);margin-top:4px}
.finding{border:1px solid var(--border-light);border-radius:10px;padding:10px 14px;margin-bottom:8px;background:var(--bg-card-header)}
.finding .f-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.sev{padding:1px 8px;border-radius:8px;font-size:10px;font-weight:700;text-transform:uppercase;color:#fff}
.finding .f-title{font-weight:600;font-size:13px;color:var(--text-heading)}
.finding p{font-size:13px;color:var(--text-primary);margin-bottom:2px}
.finding .f-rec{font-size:12px;color:var(--text-secondary)}
.ai-case-summary{font-size:13px;margin-bottom:10px;font-style:italic;color:var(--text-primary)}
.ai-block{border:1px solid var(--border-color);border-left:4px solid #14b8a6;border-radius:10px;padding:14px 16px;margin-bottom:20px;background:var(--bg-card-header)}
.back-to-top{position:fixed;bottom:24px;right:24px;background:#0f766e;color:#fff;border:none;padding:10px 16px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(15,23,42,.3);opacity:0;pointer-events:none;transition:opacity .2s ease}
.back-to-top.show{opacity:1;pointer-events:auto}
.empty-state{color:var(--text-secondary);font-size:13px}
.error-message{background:${isDark ? '#3b1f1f' : '#fef2f2'};border:1px solid ${isDark ? '#7f1d1d' : '#fecaca'};color:${isDark ? '#f87171' : '#dc2626'};padding:12px 16px;border-radius:10px;margin-bottom:16px;font-weight:500}
.footer{text-align:center;padding:24px;color:var(--text-secondary);font-size:13px}</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Page Content Test Report</h1>
<div class="header-meta">
<span><strong>Environment:</strong> ${escapeHtml(environment)}</span>
<span><strong>Region:</strong> ${escapeHtml(String(region).toUpperCase())}</span>
<span><strong>Culture:</strong> ${escapeHtml(cultureLabel)}</span>
<span><strong>Auth:</strong> ${escapeHtml(authModeList.map(formatAuthMode).join(', ') || 'N/A')}</span>
<span><strong>Generated:</strong> ${escapeHtml(new Date(timestamp).toLocaleString())}</span>
<span><strong>Duration:</strong> ${duration ? (duration / 1000).toFixed(1) + 's' : 'N/A'}</span>
</div>
</div>

<div class="summary">
<div class="summary-card"><h3>Page Tests</h3><div class="value count">${results.length}</div></div>
<div class="summary-card"><h3>Passed</h3><div class="value passed">${passedCount}</div></div>
<div class="summary-card"><h3>Failed</h3><div class="value failed">${failedCount}</div></div>
<div class="summary-card"><h3>Content Sections</h3><div class="value count">${totalSections}</div></div>
<div class="summary-card"><h3>Screenshots</h3><div class="value count">${totalScreenshots}</div></div>
</div>

${renderAiOverall(aiOverall)}

${[...groups.entries()].map(([pageKey, groupResults]) => `
<div class="page-group">
<h2>${escapeHtml(pageKey)}</h2>
${groupResults.map((result) => renderPageResult(result, isDark)).join('')}
</div>
`).join('')}

<div class="footer">Generated by Melaleuca Content QA Tester &mdash; Page Tester</div>
</div>
<button class="back-to-top" id="back-to-top" type="button">Top</button>
<script>const b=document.getElementById('back-to-top');window.addEventListener('scroll',()=>{b.classList.toggle('show',window.scrollY>400)});b.addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'})})</script>
</body>
</html>`;

  return { html, name: 'page-report' };
}

function isPassed(result) {
  if (!result.success) return false;
  if (result.httpStatus != null && result.httpStatus >= 400) return false;
  if (result.checks?.images?.brokenCount > 0) return false;
  return true;
}

function formatAuthMode(mode) {
  return mode === 'signedIn' ? 'Signed In' : 'Signed Out';
}

function renderAiOverall(aiOverall) {
  if (!aiOverall) return '';
  if (aiOverall.error || !aiOverall.enabled) {
    return `
<div class="ai-panel">
<h2>&#129302; AI Review</h2>
<div class="ai-error">AI review was not completed: ${escapeHtml(aiOverall.error || 'unavailable')}</div>
</div>`;
  }
  const status = ['pass', 'warning', 'fail'].includes(aiOverall.overallStatus) ? aiOverall.overallStatus : null;
  return `
<div class="ai-panel">
<h2>&#129302; AI Review ${status ? `<span class="ai-status ${status}">${escapeHtml(status)}</span>` : ''}
<span class="ai-model">${escapeHtml(aiOverall.model || '')}</span></h2>
<p>${escapeHtml(aiOverall.overallSummary || 'No summary provided.')}</p>
</div>`;
}

function renderPageResult(result, isDark) {
  const passed = isPassed(result);
  const statusClass = passed ? 'passed' : 'failed';
  const statusLabel = passed ? 'Passed' : 'Failed';
  const issues = Array.isArray(result.issues) ? result.issues : [];
  const sections = Array.isArray(result.sections) ? result.sections : [];

  return `
<div class="section">
<div class="sku-card">
<div class="sku-header">
<h3>${escapeHtml(result.culture || 'N/A')} &mdash; ${escapeHtml(formatAuthMode(result.authMode))}</h3>
<div class="sku-meta">
<span class="culture-badge">${escapeHtml((result.culture || 'N/A').toUpperCase())}</span>
<span class="auth-badge ${result.authMode === 'signedIn' ? 'in' : 'out'}">${escapeHtml(formatAuthMode(result.authMode))}</span>
<span class="status-pill ${statusClass}">${statusLabel}</span>
</div>
</div>
<div class="sku-body">
${result.error ? `<div class="error-message">Error: ${escapeHtml(result.error)}</div>` : ''}

${issues.length > 0 ? `<div style="margin-bottom:16px">${issues.map(i => `<span class="issue-chip">${escapeHtml(i)}</span>`).join('')}</div>` : ''}

${renderAiCaseReview(result.aiReview)}

${renderPageSummary(result)}

${renderScreenshots(result.screenshots)}

${result.success ? renderSections(sections) : ''}
</div>
</div>
</div>`;
}

function renderAiCaseReview(aiReview) {
  if (!aiReview) return '';
  const verdict = ['pass', 'warning', 'fail'].includes(aiReview.verdict) ? aiReview.verdict : 'warning';
  const findings = Array.isArray(aiReview.findings)
    ? [...aiReview.findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    : [];
  return `
<div class="ai-block">
<div class="block-title" style="margin-bottom:8px">&#129302; AI Review <span class="ai-status ${verdict}">${escapeHtml(verdict)}</span></div>
${aiReview.summary ? `<div class="ai-case-summary">${escapeHtml(aiReview.summary)}</div>` : ''}
${findings.map(f => `
<div class="finding">
<div class="f-head">
<span class="sev" style="background:${SEVERITY_COLORS[f.severity] || '#64748b'}">${escapeHtml(f.severity || 'info')}</span>
<span class="f-title">${escapeHtml(f.title || '')}</span>
</div>
<p>${escapeHtml(f.explanation || '')}</p>
<div class="f-rec"><strong>Recommendation:</strong> ${escapeHtml(f.recommendation || '')}</div>
</div>`).join('')}
${findings.length === 0 ? '<div class="empty-state" style="color:#10b981">No findings for this page.</div>' : ''}
</div>`;
}

function renderPageSummary(result) {
  const content = result.checks?.content || {};
  const components = result.checks?.components || {};
  const foundComponents = Object.entries(components).filter(([, count]) => count > 0);
  const headings = Array.isArray(content.headings) ? content.headings : [];
  const cell = (value) => (value == null || value === '') ? '<span style="color:#f59e0b">missing</span>' : escapeHtml(String(value));

  return `
<div style="margin-bottom:20px">
<div class="block-title">Page Summary</div>
<table class="data-table">
<tr><th>URL</th><td>${renderExternalLink(result.url, { empty: 'N/A' })}</td></tr>
${result.finalUrl && result.finalUrl !== result.url ? `<tr><th>Final URL</th><td>${renderExternalLink(result.finalUrl, { empty: 'N/A' })}</td></tr>` : ''}
${result.httpStatus != null ? `<tr><th>HTTP Status</th><td>${escapeHtml(String(result.httpStatus))}</td></tr>` : ''}
${result.loadTimeMs != null ? `<tr><th>Load Time</th><td>${escapeHtml((result.loadTimeMs / 1000).toFixed(2))}s</td></tr>` : ''}
<tr><th>Title</th><td>${cell(content.title)}</td></tr>
<tr><th>Meta Description</th><td>${cell(content.metaDescription ? truncateText(content.metaDescription, 160) : null)}</td></tr>
<tr><th>H1 (${escapeHtml(String(content.h1Count ?? 0))})</th><td>${cell(content.firstH1)}</td></tr>
<tr><th>html lang</th><td>${cell(content.htmlLang)}</td></tr>
${content.textLength != null ? `<tr><th>Text length</th><td>${escapeHtml(content.textLength.toLocaleString())} chars</td></tr>` : ''}
${headings.length > 0 ? `<tr><th>Section headings</th><td>${headings.map(h => escapeHtml(h)).join(' &middot; ')}</td></tr>` : ''}
<tr><th>Components</th><td>${foundComponents.length > 0 ? foundComponents.map(([n, c]) => `${escapeHtml(formatComponentName(n))} (${c})`).join(', ') : '<span class="empty-state">None detected</span>'}</td></tr>
</table>
</div>`;
}

function getScreenshotLabel(width) {
  if (width <= 415) return 'Mobile';
  if (width <= 576) return 'Mobile/Tablet';
  if (width <= 768) return 'Tablet';
  if (width <= 992) return 'Desktop (Small)';
  return 'Desktop (Large)';
}

function renderScreenshots(screenshots) {
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    return '<div style="margin-bottom:20px"><div class="block-title">Full Page Screenshots</div><div class="empty-state">No screenshots captured.</div></div>';
  }

  return `
<div style="margin-bottom:20px">
<div class="block-title">Full Page Screenshots (${screenshots.length})</div>
<div class="screenshot-stack">
${screenshots.map((s) => {
  const sizeClass = s.width <= 576 ? 'size-mobile' : s.width < 1000 ? 'size-tablet' : 'size-desktop';
  const label = getScreenshotLabel(s.width);
  const rawData = String(s.data || '');
  const imgSrc = safeImageSrc(rawData.startsWith('data:') ? rawData : `data:image/jpeg;base64,${rawData}`, { allowData: true });
  return `
<details class="screenshot-item ${sizeClass}">
<summary>${escapeHtml(String(s.width))}px - ${label}</summary>
<div class="screenshot-content">
${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="Screenshot at ${escapeHtml(String(s.width))}px" loading="lazy">` : '<div class="empty-state">Invalid screenshot data</div>'}
</div>
</details>`;
}).join('')}
</div>
</div>`;
}

function renderSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return '<div><div class="block-title">Content Sections</div><div class="empty-state">No content sections detected on this page.</div></div>';
  }

  return `
<div>
<h4 style="font-size:14px;font-weight:600;color:var(--text-heading);margin-bottom:12px">Content Sections (${sections.length})</h4>
${sections.map(renderSection).join('')}
</div>`;
}

function renderSection(section) {
  const typeLabel = getSectionTypeLabel(section.contentType);
  return `
<details class="section-card" open>
<summary class="section-card-header">
<h4>Section ${escapeHtml(String(section.index))} - ${escapeHtml(section.tagName)}</h4>
<span class="section-type-badge">${typeLabel}</span>
</summary>
<div class="section-card-body">
${renderSectionScreenshot(section)}
${renderSectionAltTexts(section.images)}
${renderSectionLinks(section.links)}
</div>
</details>`;
}

function renderSectionScreenshot(section) {
  if (!section.screenshot) {
    if (section.screenshotError) {
      return `<div class="empty-state" style="margin-bottom:16px;color:#f59e0b">Screenshot error: ${escapeHtml(section.screenshotError)}</div>`;
    }
    return '<div class="empty-state" style="margin-bottom:16px">No screenshot available for this section.</div>';
  }
  const src = safeImageSrc(section.screenshot, { allowData: true });
  if (!src) return '<div class="empty-state" style="margin-bottom:16px;color:#f59e0b">Invalid screenshot data.</div>';
  const dims = section.dimensions ? ` (${section.dimensions.width}&times;${section.dimensions.height})` : '';
  return `
<div style="margin-bottom:16px">
<div class="subhead">Section Screenshot (Desktop)${dims}</div>
<div class="section-screenshot-container">
<img src="${escapeHtml(src)}" alt="Section ${escapeHtml(String(section.index))} screenshot" loading="lazy">
</div>
</div>`;
}

function renderSectionAltTexts(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  const data = images.map((img, idx) => {
    const alt = img.alt || img.sources?.desktop?.alt || '';
    return { index: idx + 1, alt, hasAlt: alt.length > 0 };
  });
  const missing = data.filter(i => !i.hasAlt).length;
  return `
<div style="margin-bottom:16px">
<div class="subhead">Image Alt Text (${images.length} image${images.length !== 1 ? 's' : ''}${missing > 0 ? `, <span style="color:#f59e0b">${missing} missing</span>` : ''})</div>
<div class="link-list">
${data.map((img) => `
<div class="link-item" style="${!img.hasAlt ? 'border-color:#f59e0b' : ''}">
<div style="font-size:12px;font-weight:600;color:var(--text-secondary)">Image ${img.index}</div>
<div style="font-size:13px;color:${img.hasAlt ? 'var(--text-primary)' : '#f59e0b'}">${img.hasAlt ? escapeHtml(img.alt) : 'No alt text'}</div>
</div>`).join('')}
</div>
</div>`;
}

function renderSectionLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  return `
<div style="margin-bottom:16px">
<div class="subhead">Links (${links.length})</div>
<div class="link-list">
${links.map((link) => `
<div class="link-item">
${renderExternalLink(link.url, { className: 'link-url', empty: '<span class="link-url">N/A</span>' })}
<div class="link-meta">
${link.text ? `<span>Text: ${escapeHtml(link.text)}</span> &middot; ` : ''}<span>Behavior: ${link.target === 'new tab' ? 'Opens in New Tab' : 'Opens in Same Tab'}</span>
</div>
</div>`).join('')}
</div>
</div>`;
}

function getSectionTypeLabel(type) {
  switch (type) {
    case 'banner': return 'Banner';
    case 'content': return 'Content';
    case 'image': return 'Image';
    case 'navigation': return 'Navigation';
    case 'text': return 'Text';
    default: return 'Unknown';
  }
}

function formatComponentName(name) {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

function truncateText(value, max) {
  const str = String(value ?? '');
  return str.length > max ? `${str.slice(0, max)}…` : str;
}
