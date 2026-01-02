// pslp-report.js - Generate HTML report for PSLP test results

export function generatePslpReport(results, duration, theme = 'dark') {
  const timestamp = new Date().toISOString();
  const { options = {}, screenshots = [], componentReports = [] } = results;
  const isDark = theme === 'dark';

  const componentSummaries = componentReports.map((report) => {
    const itemCount = getItemCount(report.data);
    return {
      name: report.name,
      itemCount,
      passed: itemCount > 0
    };
  });
  const passedCount = componentSummaries.filter((r) => r.passed).length;
  const failedCount = componentSummaries.length - passedCount;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PSLP Test Report - ${new Date(timestamp).toLocaleString()}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg-primary:${isDark ? '#0f172a' : '#f0f2f5'};--bg-card:${isDark ? '#1e293b' : 'white'};--bg-card-header:${isDark ? '#334155' : '#f8fafc'};--bg-screenshot:${isDark ? '#334155' : '#f8fafc'};--text-primary:${isDark ? '#f1f5f9' : '#1a1a2e'};--text-secondary:${isDark ? '#94a3b8' : '#64748b'};--text-heading:${isDark ? '#f8fafc' : '#1e293b'};--border-color:${isDark ? '#475569' : '#e2e8f0'};--border-light:${isDark ? '#334155' : '#f1f5f9'}}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;padding:20px}.container{max-width:1400px;margin:0 auto}.header{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#fff;padding:30px 40px;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 20px rgba(16,185,129,.3)}.header h1{font-size:28px;font-weight:700;margin-bottom:12px}.header-meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;opacity:.95}.header-meta span{display:flex;align-items:center;gap:6px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.summary-card{background:var(--bg-card);padding:24px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'});text-align:center}.summary-card h3{font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}.summary-card .value{font-size:28px;font-weight:700}.summary-card .value.passed{color:#10b981}.summary-card .value.failed{color:#ef4444}.summary-card .value.count{color:#3b82f6}.section{background:var(--bg-card);border-radius:16px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}.section-header{padding:20px 24px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color)}.section-header h2{font-size:20px;font-weight:600;color:var(--text-heading)}.section-body{padding:24px}.screenshot-stack{display:flex;flex-direction:column;gap:16px}.screenshot-item{border:1px solid var(--border-color);border-radius:12px;background:var(--bg-card);overflow:hidden}.screenshot-item.size-mobile{width:33.333%}.screenshot-item.size-tablet{width:66.666%}.screenshot-item.size-desktop{width:100%}.screenshot-item summary{padding:12px 16px;font-size:14px;font-weight:600;cursor:pointer;background:var(--bg-card-header);color:var(--text-heading)}.screenshot-item[open] summary{border-bottom:1px solid var(--border-color)}.screenshot-content{padding:16px;display:flex;justify-content:center}.screenshot-content img{width:100%;border-radius:8px;border:1px solid var(--border-color)}@media(max-width:900px){.screenshot-item.size-mobile,.screenshot-item.size-tablet{width:100%}}.component-card{border:1px solid var(--border-color);border-radius:12px;margin-bottom:20px;overflow:hidden}.component-header{padding:16px 20px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center}.component-header h3{font-size:16px;font-weight:600;color:var(--text-heading)}.component-body{padding:16px 20px}.status-pill{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.status-pill.passed{background:#d1fae5;color:#059669}.status-pill.failed{background:#fee2e2;color:#dc2626}.data-table{width:100%;border-collapse:collapse;font-size:13px}.data-table th,.data-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border-light);vertical-align:top}.data-table th{width:160px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.4px}.cell-stack{display:flex;flex-direction:column;gap:6px}.cell-stack img{max-width:180px;border-radius:8px;border:1px solid var(--border-color)}.url-link{color:#3b82f6;text-decoration:none;word-break:break-all}.url-link:hover{text-decoration:underline}.badge-list{display:flex;flex-wrap:wrap;gap:6px}.badge{background:${isDark ? '#475569' : '#e2e8f0'};color:${isDark ? '#e2e8f0' : '#475569'};padding:4px 10px;border-radius:999px;font-size:12px}.alt-text{color:var(--text-secondary);font-size:12px}.monthly-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.monthly-card{border:1px solid var(--border-color);border-radius:12px;padding:12px;background:var(--bg-card-header)}.monthly-card img{width:64px;height:auto;border-radius:6px;border:1px solid var(--border-color);margin-bottom:8px}.monthly-sku{font-size:13px;font-weight:700;color:var(--text-heading);margin-bottom:6px}.monthly-name{font-size:12px;color:var(--text-secondary);margin-bottom:6px}.monthly-alt{font-size:11px;color:var(--text-secondary);margin-bottom:8px}@media(max-width:1100px){.monthly-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.monthly-grid{grid-template-columns:repeat(1,minmax(0,1fr))}}.featured-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.featured-card{border:1px solid var(--border-color);border-radius:12px;padding:12px;background:var(--bg-card-header);text-align:center}.featured-card img{width:50%;max-width:120px;height:auto;border-radius:8px;border:1px solid var(--border-color);margin:0 auto 8px;display:block}.featured-alt{font-size:11px;color:var(--text-secondary);margin-bottom:8px}.featured-card a{display:block;color:#3b82f6;font-size:12px;font-weight:600;text-decoration:none;word-break:break-word}.featured-card a:hover{text-decoration:underline}@media(max-width:1100px){.featured-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:720px){.featured-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.back-to-top{position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;border:none;padding:10px 16px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(15,23,42,.3);opacity:0;pointer-events:none;transition:opacity .2s ease}.back-to-top.show{opacity:1;pointer-events:auto}.empty-state{color:var(--text-secondary);font-size:13px}.footer{text-align:center;padding:24px;color:var(--text-secondary);font-size:13px}</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>PSLP Test Report</h1>
<div class="header-meta">
<span><strong>Environment:</strong> ${escapeHtml(options.environment || 'N/A')}</span>
<span><strong>Region:</strong> ${escapeHtml((options.region || '').toUpperCase())}</span>
<span><strong>Culture:</strong> ${escapeHtml(options.culture || 'N/A')}</span>
<span><strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</span>
<span><strong>Duration:</strong> ${duration ? (duration / 1000).toFixed(1) + 's' : 'N/A'}</span>
</div>
</div>

<div class="summary">
<div class="summary-card">
<h3>Components Tested</h3>
<div class="value count">${componentSummaries.length}</div>
</div>
<div class="summary-card">
<h3>Passed</h3>
<div class="value passed">${passedCount}</div>
</div>
<div class="summary-card">
<h3>Failed</h3>
<div class="value failed">${failedCount}</div>
</div>
<div class="summary-card">
<h3>Screenshots</h3>
<div class="value count">${screenshots.length}</div>
</div>
</div>

<div class="section">
<div class="section-header"><h2>Screenshots</h2></div>
<div class="section-body">
${screenshots.length === 0
  ? '<div class="empty-state">No screenshots captured.</div>'
  : `<div class="screenshot-stack">
${screenshots.map((s) => {
  const sizeClass = s.width <= 576 ? 'size-mobile' : s.width < 1000 ? 'size-tablet' : 'size-desktop';
  return `<details class="screenshot-item ${sizeClass}">
<summary>${s.width}px - ${getScreenshotLabel(s.width)} Screenshot</summary>
<div class="screenshot-content">
<img src="data:image/jpeg;base64,${s.data}" alt="Screenshot at ${s.width}px">
</div>
</details>`;
}).join('')}
</div>`}
</div>
</div>

<div class="section">
<div class="section-header"><h2>Component Data</h2></div>
<div class="section-body">
${componentReports.length === 0
  ? '<div class="empty-state">No components were selected for testing.</div>'
  : componentReports.map((report) => renderComponentSection(report, isDark)).join('')}
</div>
</div>

<div class="footer">Generated by Melaleuca Unified Tester</div>
</div>
<button class="back-to-top" id="back-to-top" type="button">Top</button>
<script>const b=document.getElementById('back-to-top');window.addEventListener('scroll',()=>{b.classList.toggle('show',window.scrollY>400)});b.addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'})})</script>
</body>
</html>`;

  return { html, name: `pslp-report-${timestamp.replace(/:/g, '-')}.html` };
}

function getScreenshotLabel(width) {
  if (width <= 576) return 'Mobile';
  if (width <= 992) return 'Tablet';
  return 'Desktop';
}

function getItemCount(data) {
  if (!data) return 0;
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data.skus)) return data.skus.length;
  return 1;
}

function renderComponentSection(report, isDark) {
  const name = report?.name || 'Unknown Component';
  const data = report?.data;
  const itemCount = getItemCount(data);
  const statusClass = itemCount > 0 ? 'passed' : 'failed';
  const statusLabel = itemCount > 0 ? 'Passed' : 'Failed';

  return `
<div class="component-card">
<div class="component-header">
<h3>${escapeHtml(formatComponentName(name))}</h3>
<span class="status-pill ${statusClass}">${statusLabel}</span>
</div>
<div class="component-body">
${renderComponentDetails(name, data)}
</div>
</div>`;
}

function renderComponentDetails(name, data) {
  switch (name) {
    case 'heroCarousel': return renderHeroCarousel(data);
    case 'variableWindows': return renderVariableWindows(data);
    case 'fullWidthBanner': return renderFullWidthBanner(data);
    case 'monthlySpecials': return renderMonthlySpecials(data);
    case 'featuredCategories': return renderFeaturedCategories(data);
    case 'seasonalCarousel': return renderSeasonalCarousel(data);
    case 'brandCTAWindows': return renderBrandCTAWindows(data);
    case 'productCarousel': return renderProductCarousel(data);
    default: return `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }
}

function renderHeroCarousel(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No hero carousel slides detected.</div>';
  }
  const rows = data.map((slide, i) => `
<tr>
<td>Slide ${i + 1}</td>
<td>${renderImageCell(slide.mobileImage, slide.altText)}</td>
<td>${renderImageCell(slide.tabletImage, slide.altText)}</td>
<td>${renderImageCell(slide.desktopImage, slide.altText)}</td>
<td>${renderAltText(slide.altText)}</td>
<td>${renderLinkCell(slide.linkDirection)}</td>
<td>${slide.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`).join('');
  return `<table class="data-table"><thead><tr><th>Slide</th><th>Mobile</th><th>Tablet</th><th>Desktop</th><th>Alt Text</th><th>Link</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderVariableWindows(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No variable windows detected.</div>';
  }
  const rows = data.map((w, i) => `
<tr>
<td>Window ${i + 1}</td>
<td>${renderImageCell(w.mobileImage, w.altText)}</td>
<td>${renderImageCell(w.desktopImage, w.altText)}</td>
<td>${renderAltText(w.altText)}</td>
<td>${renderLinkCell(w.linkDirection)}</td>
<td>${w.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`).join('');
  return `<table class="data-table"><thead><tr><th>Window</th><th>Mobile</th><th>Desktop</th><th>Alt Text</th><th>Link</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderFullWidthBanner(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No full width banner detected.</div>';
  }
  const rows = data.map((b, i) => `
<tr>
<td>Banner ${i + 1}</td>
<td>${renderImageCell(b.mobileImage, b.altText)}</td>
<td>${renderImageCell(b.tabletImage, b.altText)}</td>
<td>${renderImageCell(b.desktopImage, b.altText)}</td>
<td>${renderAltText(b.altText)}</td>
<td>${renderLinkCell(b.linkDirection)}</td>
<td>${b.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`).join('');
  return `<table class="data-table"><thead><tr><th>Banner</th><th>Mobile</th><th>Tablet</th><th>Desktop</th><th>Alt Text</th><th>Link</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMonthlySpecials(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No monthly specials detected.</div>';
  }
  return `<div class="monthly-grid">${data.map((item) => {
    const sku = item?.sku ? `SKU ${escapeHtml(item.sku)}` : 'SKU N/A';
    const name = item?.name ? escapeHtml(item.name) : 'Name unavailable';
    const altText = item?.altText ? escapeHtml(item.altText) : null;
    const slideLabel = item?.slideIndex ? `Slide ${escapeHtml(item.slideIndex)}` : null;
    const link = item?.linkDirection ? escapeHtml(item.linkDirection) : null;
    const imageUrl = item?.imageUrl ? escapeHtml(item.imageUrl) : null;
    return `<div class="monthly-card">
${imageUrl ? `<img src="${imageUrl}" alt="${altText || 'Monthly special'}" loading="lazy">` : ''}
<div class="monthly-sku">${sku}</div>
<div class="monthly-name">${name}</div>
${slideLabel ? `<div class="monthly-alt">${slideLabel}</div>` : ''}
${altText ? `<div class="monthly-alt">Alt: ${altText}</div>` : ''}
${link ? `<a class="url-link" href="${link}" target="_blank">${link}</a>` : '<div class="empty-state">No link</div>'}
</div>`;
  }).join('')}</div>`;
}

function renderFeaturedCategories(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No featured categories detected.</div>';
  }
  return `<div class="featured-grid">${data.map((item) => `
<div class="featured-card">
${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.altText || 'Featured category')}">` : '<div class="empty-state">No image</div>'}
${item.altText ? `<div class="featured-alt">Alt: ${escapeHtml(item.altText)}</div>` : ''}
${item.linkDirection ? `<a href="${escapeHtml(item.linkDirection)}" target="_blank">${escapeHtml(item.linkDirection)}</a>` : '<div class="empty-state">No link</div>'}
</div>`).join('')}</div>`;
}

function renderSeasonalCarousel(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No seasonal carousel slides detected.</div>';
  }
  const rows = data.map((slide, i) => `
<tr>
<td>Slide ${i + 1}</td>
<td>${renderImageCell(slide.mobileImage, slide.altText)}</td>
<td>${renderImageCell(slide.desktopImage, slide.altText)}</td>
<td>${renderAltText(slide.altText)}</td>
<td>${renderSkuBadges(slide.skus)}</td>
</tr>`).join('');
  return `<table class="data-table"><thead><tr><th>Slide</th><th>Mobile</th><th>Desktop</th><th>Alt Text</th><th>SKUs</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderBrandCTAWindows(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No brand CTA windows detected.</div>';
  }
  const rows = data.map((item, i) => `
<tr>
<td>Window ${i + 1}</td>
<td>${renderImageCell(item.mobileImage, item.altText)}</td>
<td>${renderImageCell(item.desktopImage, item.altText)}</td>
<td>${renderAltText(item.altText)}</td>
<td>${renderLinkCell(item.linkDirection)}</td>
<td>${item.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`).join('');
  return `<table class="data-table"><thead><tr><th>Window</th><th>Mobile</th><th>Desktop</th><th>Alt Text</th><th>Link</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderProductCarousel(data) {
  const skus = data?.skus || [];
  if (!Array.isArray(skus) || skus.length === 0) {
    return '<div class="empty-state">No SKUs detected in product carousel.</div>';
  }
  return `<div class="badge-list">${skus.map((sku) => `<span class="badge">${escapeHtml(sku)}</span>`).join('')}</div>`;
}

function renderImageCell(url, altText) {
  if (!url) return 'N/A';
  const safeUrl = escapeHtml(url);
  const safeAlt = altText ? escapeHtml(altText) : 'Image';
  return `<div class="cell-stack"><a class="url-link" href="${safeUrl}" target="_blank">${safeUrl}</a><img src="${safeUrl}" alt="${safeAlt}" loading="lazy"></div>`;
}

function renderLinkCell(url) {
  if (!url) return 'N/A';
  const safeUrl = escapeHtml(url);
  return `<a class="url-link" href="${safeUrl}" target="_blank">${safeUrl}</a>`;
}

function renderAltText(altText) {
  if (!altText) return 'N/A';
  return `<span class="alt-text">${escapeHtml(altText)}</span>`;
}

function renderSkuBadges(skus) {
  if (!Array.isArray(skus) || skus.length === 0) return 'N/A';
  return `<div class="badge-list">${skus.map((sku) => `<span class="badge">${escapeHtml(sku)}</span>`).join('')}</div>`;
}

function formatComponentName(name) {
  return String(name).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
