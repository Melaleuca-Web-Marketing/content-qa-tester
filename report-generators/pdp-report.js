// pdp-report.js - Generate HTML report for PDP test results

export function generatePdpReport(results, duration, theme = 'dark') {
  const timestamp = new Date().toISOString();
  const isDark = theme === 'dark';
  const runs = normalizePdpRuns(results);
  const runSummaries = runs.map((run) => buildRunSummary(run));
  const totalSkus = runSummaries.reduce((sum, run) => sum + run.results.length, 0);
  const totalPassed = runSummaries.reduce((sum, run) => sum + run.passedCount, 0);
  const totalFailed = runSummaries.reduce((sum, run) => sum + run.failedCount, 0);
  const totalScreenshots = runSummaries.reduce((sum, run) => sum + run.screenshotCount, 0);
  const environment = results?.environment || runSummaries[0]?.environment || 'N/A';
  const region = results?.region || runSummaries[0]?.region || 'N/A';
  const cultureList = runSummaries.map((run) => run.cultureLabel).filter(Boolean);
  const cultureLabel = cultureList.length === 0
    ? 'N/A'
    : (cultureList.length === 1 ? cultureList[0] : `Multiple (${cultureList.join(', ')})`);
  const showCultureLabel = runSummaries.length > 1;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PDP Test Report - ${new Date(timestamp).toLocaleString()}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg-primary:${isDark ? '#0f172a' : '#f0f2f5'};--bg-card:${isDark ? '#1e293b' : 'white'};--bg-card-header:${isDark ? '#334155' : '#f8fafc'};--bg-screenshot:${isDark ? '#334155' : '#f8fafc'};--text-primary:${isDark ? '#f1f5f9' : '#1a1a2e'};--text-secondary:${isDark ? '#94a3b8' : '#64748b'};--text-heading:${isDark ? '#f8fafc' : '#1e293b'};--border-color:${isDark ? '#475569' : '#e2e8f0'};--border-light:${isDark ? '#334155' : '#f1f5f9'}}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;padding:20px}.container{max-width:1400px;margin:0 auto}.header{background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);color:#fff;padding:30px 40px;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 20px rgba(139,92,246,.3)}.header h1{font-size:28px;font-weight:700;margin-bottom:12px}.header-meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;opacity:.95}.header-meta span{display:flex;align-items:center;gap:6px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.summary-card{background:var(--bg-card);padding:12px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'});text-align:center}.summary-card h3{font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}.summary-card .value{font-size:16px;font-weight:700}.summary-card .value.passed{color:#10b981}.summary-card .value.failed{color:#ef4444}.summary-card .value.count{color:#3b82f6}.section{background:var(--bg-card);border-radius:16px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}.section-header{padding:20px 24px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color)}.section-header h2{font-size:20px;font-weight:600;color:var(--text-heading)}.section-body{padding:24px}.sku-card{border:1px solid var(--border-color);border-radius:12px;margin-bottom:20px;overflow:hidden}.sku-header{padding:16px 20px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}.sku-header h3{font-size:16px;font-weight:600;color:var(--text-heading)}.sku-meta{display:flex;gap:12px;align-items:center}.sku-body{padding:16px 20px}.content-type-badge{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.content-type-badge.pdp{background:#d1fae5;color:#059669}.content-type-badge.longDescription{background:#dbeafe;color:#1d4ed8}.content-type-badge.nothing{background:${isDark ? '#475569' : '#e2e8f0'};color:${isDark ? '#94a3b8' : '#64748b'}}.status-pill{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.status-pill.passed{background:#d1fae5;color:#059669}.status-pill.failed{background:#fee2e2;color:#dc2626}.culture-badge{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;background:#fef3c7;color:#92400e}.screenshot-stack{display:flex;flex-direction:column;gap:16px}.screenshot-item{border:1px solid var(--border-color);border-radius:12px;background:var(--bg-card);overflow:hidden}.screenshot-item.size-mobile{width:33.333%}.screenshot-item.size-tablet{width:66.666%}.screenshot-item.size-desktop{width:100%}.screenshot-item summary{padding:12px 16px;font-size:14px;font-weight:600;cursor:pointer;background:var(--bg-card-header);color:var(--text-heading)}.screenshot-item[open] summary{border-bottom:1px solid var(--border-color)}.screenshot-content{padding:16px;display:flex;justify-content:center}.screenshot-content img{width:100%;border-radius:8px;border:1px solid var(--border-color)}@media(max-width:900px){.screenshot-item.size-mobile,.screenshot-item.size-tablet{width:100%}}.section-card{border:1px solid var(--border-color);border-radius:12px;margin-bottom:16px;overflow:hidden}.section-card-header{padding:12px 16px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;cursor:pointer}.section-card-header h4{font-size:14px;font-weight:600;color:var(--text-heading)}.section-card-body{padding:16px}.section-type-badge{padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;text-transform:uppercase;background:${isDark ? '#475569' : '#e2e8f0'};color:${isDark ? '#e2e8f0' : '#475569'}}.data-table{width:100%;border-collapse:collapse;font-size:13px}.data-table th,.data-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border-light);vertical-align:top}.data-table th{width:120px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.4px}.image-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}.image-card{border:1px solid var(--border-color);border-radius:8px;padding:12px;background:var(--bg-card-header)}.image-card img{width:100%;border-radius:6px;margin-bottom:8px}.image-card .image-type{font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-secondary);margin-bottom:4px}.image-card .image-url{font-size:11px;color:#3b82f6;word-break:break-all}.image-card .image-alt{font-size:11px;color:var(--text-secondary);margin-top:4px}.link-list{display:flex;flex-direction:column;gap:8px}.link-item{padding:8px 12px;background:var(--bg-card-header);border-radius:8px;border:1px solid var(--border-color)}.link-url{color:#3b82f6;text-decoration:none;word-break:break-all;font-size:13px}.link-url:hover{text-decoration:underline}.link-meta{font-size:11px;color:var(--text-secondary);margin-top:4px}.long-description-content{background:var(--bg-card-header);border-radius:8px;padding:16px;font-size:14px;line-height:1.8;white-space:pre-wrap;max-height:400px;overflow-y:auto}.back-to-top{position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;border:none;padding:10px 16px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(15,23,42,.3);opacity:0;pointer-events:none;transition:opacity .2s ease}.back-to-top.show{opacity:1;pointer-events:auto}.empty-state{color:var(--text-secondary);font-size:13px}.footer{text-align:center;padding:24px;color:var(--text-secondary);font-size:13px}</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>PDP Test Report</h1>
<div class="header-meta">
<span><strong>Environment:</strong> ${escapeHtml(environment)}</span>
<span><strong>Region:</strong> ${escapeHtml(String(region || '').toUpperCase())}</span>
<span><strong>Culture:</strong> ${escapeHtml(cultureLabel)}</span>
<span><strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</span>
<span><strong>Duration:</strong> ${duration ? (duration / 1000).toFixed(1) + 's' : 'N/A'}</span>
</div>
</div>

<div class="summary">
<div class="summary-card">
<h3>SKUs Tested</h3>
<div class="value count">${totalSkus}</div>
</div>
<div class="summary-card">
<h3>Passed</h3>
<div class="value passed">${totalPassed}</div>
</div>
<div class="summary-card">
<h3>Failed</h3>
<div class="value failed">${totalFailed}</div>
</div>
<div class="summary-card">
<h3>Screenshots</h3>
<div class="value count">${totalScreenshots}</div>
</div>
</div>

${runSummaries.map((summary) => `
${summary.results.map((result) => renderSkuResult(result, isDark, showCultureLabel ? summary.cultureLabel : null)).join('')}
`).join('')}

<div class="footer">Generated by Melaleuca Unified Tester</div>
</div>
<button class="back-to-top" id="back-to-top" type="button">Top</button>
<script>const b=document.getElementById('back-to-top');window.addEventListener('scroll',()=>{b.classList.toggle('show',window.scrollY>400)});b.addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'})})</script>
</body>
</html>`;

  return { html, name: `pdp-report-${timestamp.replace(/:/g, '-')}.html` };
}

function normalizePdpRuns(results) {
  if (!results) return [];
  if (Array.isArray(results.runs) && results.runs.length > 0) {
    return results.runs.map((run) => ({
      ...run,
      culture: run.culture || results.culture || '',
      results: Array.isArray(run.results) ? run.results : []
    }));
  }

  // Single run format
  return [{
    culture: results.culture || results.options?.culture || '',
    results: Array.isArray(results.results) ? results.results : (Array.isArray(results) ? results : []),
    environment: results.environment || results.options?.environment,
    region: results.region || results.options?.region
  }];
}

function buildRunSummary(run) {
  const cultureLabel = run.culture || 'N/A';
  const results = Array.isArray(run.results) ? run.results : [];
  const passedCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;
  const screenshotCount = results.reduce((sum, r) => sum + (r.screenshots?.length || 0), 0);

  return {
    ...run,
    cultureLabel,
    results,
    passedCount,
    failedCount,
    screenshotCount
  };
}

function renderSkuResult(result, isDark, cultureLabel) {
  const isPassed = result.success;
  const statusClass = isPassed ? 'passed' : 'failed';
  const statusLabel = isPassed ? 'Passed' : 'Failed';
  const contentType = result.contentType || 'nothing';
  const contentTypeLabel = getContentTypeLabel(contentType);
  const culture = cultureLabel || result.culture || '';
  const cultureBadge = culture ? `<span class="culture-badge">${escapeHtml(culture)}</span>` : '';

  return `
<div class="section">
<div class="sku-card">
<div class="sku-header">
<h3>SKU ${escapeHtml(result.sku)}</h3>
<div class="sku-meta">
${cultureBadge}
<span class="content-type-badge ${contentType}">${contentTypeLabel}</span>
<span class="status-pill ${statusClass}">${statusLabel}</span>
</div>
</div>
<div class="sku-body">
${result.error ? `<div class="empty-state" style="color: #ef4444; margin-bottom: 16px;">Error: ${escapeHtml(result.error)}</div>` : ''}

${renderScreenshots(result.screenshots)}

${contentType === 'pdp' ? renderPdpSections(result.sections, isDark) : ''}
${contentType === 'longDescription' ? renderLongDescription(result.longDescription) : ''}
${contentType === 'nothing' ? '<div class="empty-state">No content found in the "About This Product" section.</div>' : ''}
</div>
</div>
</div>`;
}

function getContentTypeLabel(contentType) {
  switch (contentType) {
    case 'pdp': return 'PDP Content';
    case 'longDescription': return 'Long Description';
    case 'nothing': return 'No Content';
    default: return 'Unknown';
  }
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
    return '<div class="empty-state">No screenshots captured.</div>';
  }

  return `
<div style="margin-bottom: 20px;">
<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 12px;">Full Page Screenshots (${screenshots.length})</div>
<div class="screenshot-stack">
${screenshots.map((s) => {
  const sizeClass = s.width <= 576 ? 'size-mobile' : s.width < 1000 ? 'size-tablet' : 'size-desktop';
  const label = getScreenshotLabel(s.width);
  // Handle both full base64 data and just base64 string
  const imgSrc = s.data.startsWith('data:') ? s.data : `data:image/jpeg;base64,${s.data}`;
  return `
<details class="screenshot-item ${sizeClass}">
<summary>${s.width}px - ${label}</summary>
<div class="screenshot-content">
<img src="${imgSrc}" alt="Screenshot at ${s.width}px" loading="lazy">
</div>
</details>`;
}).join('')}
</div>
</div>`;
}

function renderPdpSections(sections, isDark) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return '<div class="empty-state">No sections detected in the PDP content.</div>';
  }

  return `
<div style="margin-top: 16px;">
<h4 style="font-size: 14px; font-weight: 600; color: var(--text-heading); margin-bottom: 12px;">Content Sections (${sections.length})</h4>
${sections.map((section) => renderSection(section, isDark)).join('')}
</div>`;
}

function renderSection(section, isDark) {
  const sectionType = section.contentType || 'unknown';
  const sectionTypeLabel = getSectionTypeLabel(sectionType);

  return `
<details class="section-card" open>
<summary class="section-card-header">
<h4>Section ${section.index} - ${escapeHtml(section.tagName)}</h4>
<span class="section-type-badge">${sectionTypeLabel}</span>
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
      return `<div class="empty-state" style="margin-bottom: 16px; color: #f59e0b;">Screenshot error: ${escapeHtml(section.screenshotError)}</div>`;
    }
    return '<div class="empty-state" style="margin-bottom: 16px;">No screenshot available for this section.</div>';
  }

  return `
<div style="margin-bottom: 16px;">
<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 8px;">Section Screenshot (Desktop)</div>
<div class="section-screenshot-container" style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: var(--bg-card-header);">
<img src="${section.screenshot}" alt="Section ${section.index} screenshot" style="width: 100%; display: block;" loading="lazy">
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

function renderSectionAltTexts(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return '';
  }

  // Filter images that have alt text or flag those missing it
  const imageAltData = images.map((img, idx) => {
    const altText = img.alt || img.sources?.desktop?.alt || '';
    return {
      index: idx + 1,
      alt: altText,
      hasAlt: altText.length > 0
    };
  });

  const missingCount = imageAltData.filter(i => !i.hasAlt).length;

  return `
<div style="margin-bottom: 16px;">
<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 8px;">Image Alt Text (${images.length} images${missingCount > 0 ? `, <span style="color: #f59e0b;">${missingCount} missing</span>` : ''})</div>
<div class="link-list">
${imageAltData.map((img) => `
<div class="link-item" style="${!img.hasAlt ? 'border-color: #f59e0b;' : ''}">
<div style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Image ${img.index}</div>
<div style="font-size: 13px; color: ${img.hasAlt ? 'var(--text-primary)' : '#f59e0b'};">${img.hasAlt ? escapeHtml(img.alt) : 'No alt text'}</div>
</div>
`).join('')}
</div>
</div>`;
}

function renderSectionImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return '';
  }

  return `
<div style="margin-bottom: 16px;">
<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 8px;">Images (${images.length})</div>
<div class="image-grid">
${images.map((img) => {
  const imgUrl = img.url || img.sources?.desktop?.url || img.sources?.mobile?.url || '';
  const altText = img.alt || img.sources?.desktop?.alt || '';
  const typeLabel = img.type === 'picture' ? 'Responsive Picture' : img.type === 'background' ? 'Background Image' : 'Standard Image';
  const visibilityLabel = img.visibility === 'desktop-only' ? ' (Desktop Only)' : img.visibility === 'mobile-only' ? ' (Mobile Only)' : '';

  let responsiveSources = '';
  if (img.type === 'picture' && img.sources) {
    const sourceLines = [];
    if (img.sources.desktop?.url) sourceLines.push(`Desktop: ${escapeHtml(img.sources.desktop.url)}`);
    if (img.sources.tablet?.url) sourceLines.push(`Tablet: ${escapeHtml(img.sources.tablet.url)}`);
    if (img.sources.mobile?.url) sourceLines.push(`Mobile: ${escapeHtml(img.sources.mobile.url)}`);
    if (sourceLines.length > 0) {
      responsiveSources = `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">${sourceLines.join('<br>')}</div>`;
    }
  }

  return `
<div class="image-card">
${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(altText)}" loading="lazy">` : '<div class="empty-state">No image URL</div>'}
<div class="image-type">${typeLabel}${visibilityLabel}</div>
${imgUrl ? `<div class="image-url">${escapeHtml(imgUrl)}</div>` : ''}
${altText ? `<div class="image-alt">Alt: ${escapeHtml(altText)}</div>` : '<div class="image-alt" style="color: #f59e0b;">No alt text</div>'}
${responsiveSources}
</div>`;
}).join('')}
</div>
</div>`;
}

function renderSectionLinks(links) {
  if (!Array.isArray(links) || links.length === 0) {
    return '';
  }

  return `
<div style="margin-bottom: 16px;">
<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 8px;">Links (${links.length})</div>
<div class="link-list">
${links.map((link) => `
<div class="link-item">
<a class="link-url" href="${escapeHtml(link.url)}" target="_blank">${escapeHtml(link.url)}</a>
<div class="link-meta">
<span>Behavior: ${link.target === 'new tab' ? 'Opens in New Tab' : 'Opens in Same Tab'}</span>
</div>
</div>
`).join('')}
</div>
</div>`;
}

function renderLongDescription(longDescription) {
  if (!longDescription || !longDescription.text) {
    return '<div class="empty-state">No long description content found.</div>';
  }

  return `
<div style="margin-top: 16px;">
<h4 style="font-size: 14px; font-weight: 600; color: var(--text-heading); margin-bottom: 12px;">Long Description</h4>
<div class="long-description-content">${escapeHtml(longDescription.text)}</div>
</div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
