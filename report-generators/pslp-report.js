// pslp-report.js - Generate HTML report for PSLP test results

import { detectImageLocale } from '../utils/image-utils.js';

export function generatePslpReport(results, duration, theme = 'dark', excelValidation = null) {
  const timestamp = new Date().toISOString();
  const { options = {}, screenshots = [], componentReports = [] } = results;
  const isDark = theme === 'dark';
  const monthlySpecialsValidation = buildMonthlySpecialsValidation(componentReports, excelValidation);
  const heroCarouselValidation = buildCarouselValidation(componentReports, excelValidation, options, 'heroCarousel', 'hero-carousel');
  const variableWindowsValidation = buildCarouselValidation(componentReports, excelValidation, options, 'variableWindows', 'variable-windows');
  const fullWidthBannerValidation = buildCarouselValidation(componentReports, excelValidation, options, 'fullWidthBanner', 'full-width-banner');
  const seasonalCarouselValidation = buildSeasonalCarouselValidation(componentReports, excelValidation, options);
  const brandCTAWindowsValidation = buildCarouselValidation(componentReports, excelValidation, options, 'brandCTAWindows', 'brand-cta-windows');
  const validationContext = {
    monthlySpecials: monthlySpecialsValidation,
    heroCarousel: heroCarouselValidation,
    variableWindows: variableWindowsValidation,
    fullWidthBanner: fullWidthBannerValidation,
    seasonalCarousel: seasonalCarouselValidation,
    brandCTAWindows: brandCTAWindowsValidation
  };

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
<style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg-primary:${isDark ? '#0f172a' : '#f0f2f5'};--bg-card:${isDark ? '#1e293b' : 'white'};--bg-card-header:${isDark ? '#334155' : '#f8fafc'};--bg-screenshot:${isDark ? '#334155' : '#f8fafc'};--text-primary:${isDark ? '#f1f5f9' : '#1a1a2e'};--text-secondary:${isDark ? '#94a3b8' : '#64748b'};--text-heading:${isDark ? '#f8fafc' : '#1e293b'};--border-color:${isDark ? '#475569' : '#e2e8f0'};--border-light:${isDark ? '#334155' : '#f1f5f9'}}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;padding:20px}.container{max-width:1400px;margin:0 auto}.header{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#fff;padding:30px 40px;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 20px rgba(16,185,129,.3)}.header h1{font-size:28px;font-weight:700;margin-bottom:12px}.header-meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;opacity:.95}.header-meta span{display:flex;align-items:center;gap:6px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.summary-card{background:var(--bg-card);padding:12px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'});text-align:center}.summary-card h3{font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}.summary-card .value{font-size:16px;font-weight:700}.summary-card .value.passed{color:#10b981}.summary-card .value.failed{color:#ef4444}.summary-card .value.count{color:#3b82f6}.section{background:var(--bg-card);border-radius:16px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}.section-header{padding:20px 24px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color)}.section-header h2{font-size:20px;font-weight:600;color:var(--text-heading)}.section-body{padding:24px}.screenshot-stack{display:flex;flex-direction:column;gap:16px}.screenshot-item{border:1px solid var(--border-color);border-radius:12px;background:var(--bg-card);overflow:hidden}.screenshot-item.size-mobile{width:33.333%}.screenshot-item.size-tablet{width:66.666%}.screenshot-item.size-desktop{width:100%}.screenshot-item summary{padding:12px 16px;font-size:14px;font-weight:600;cursor:pointer;background:var(--bg-card-header);color:var(--text-heading)}.screenshot-item[open] summary{border-bottom:1px solid var(--border-color)}.screenshot-content{padding:16px;display:flex;justify-content:center}.screenshot-content img{width:100%;border-radius:8px;border:1px solid var(--border-color)}@media(max-width:900px){.screenshot-item.size-mobile,.screenshot-item.size-tablet{width:100%}}.component-card{border:1px solid var(--border-color);border-radius:12px;margin-bottom:20px;overflow:hidden}.component-header{padding:16px 20px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center}.component-header h3{font-size:16px;font-weight:600;color:var(--text-heading)}.component-body{padding:16px 20px}.status-pill{padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.status-pill.passed{background:#d1fae5;color:#059669}.status-pill.failed{background:#fee2e2;color:#dc2626}.data-table{width:100%;border-collapse:collapse;font-size:13px}.data-table th,.data-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border-light);vertical-align:top}.data-table th{width:160px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.4px}.validation-row td{background:var(--bg-card-header)}.validation-cell{display:flex;flex-direction:column;gap:6px;font-size:12px}.validation-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}.validation-badge.pass{background:#d1fae5;color:#059669}.validation-badge.fail{background:#fee2e2;color:#dc2626}.validation-badge.missing{background:#fef3c7;color:#b45309}.validation-badge.extra{background:#ede9fe;color:#7c3aed}.validation-detail{color:var(--text-secondary)}.validation-inline{margin-top:6px}.cell-stack{display:flex;flex-direction:column;gap:6px}.cell-stack img{max-width:180px;border-radius:8px;border:1px solid var(--border-color)}.url-link{color:#3b82f6;text-decoration:none;word-break:break-all}.url-link:hover{text-decoration:underline}.badge-list{display:flex;flex-wrap:wrap;gap:6px}.badge{background:${isDark ? '#475569' : '#e2e8f0'};color:${isDark ? '#e2e8f0' : '#475569'};padding:4px 10px;border-radius:999px;font-size:12px}.alt-text{color:var(--text-secondary);font-size:12px}.monthly-group{margin-bottom:16px}.monthly-group:last-child{margin-bottom:0}.monthly-group-header{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:8px}.monthly-group-title{font-size:13px;font-weight:600;color:var(--text-heading)}.monthly-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.monthly-card{border:1px solid var(--border-color);border-radius:12px;padding:12px;background:var(--bg-card-header)}.monthly-card img{width:64px;height:auto;border-radius:6px;border:1px solid var(--border-color);margin-bottom:8px}.monthly-sku{font-size:13px;font-weight:700;color:var(--text-heading);margin-bottom:6px}.monthly-name{font-size:12px;color:var(--text-secondary);margin-bottom:6px}.monthly-alt{font-size:11px;color:var(--text-secondary);margin-bottom:8px}@media(max-width:1100px){.monthly-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.monthly-grid{grid-template-columns:repeat(1,minmax(0,1fr))}}.featured-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.featured-card{border:1px solid var(--border-color);border-radius:12px;padding:12px;background:var(--bg-card-header);text-align:center}.featured-card img{width:50%;max-width:120px;height:auto;border-radius:8px;border:1px solid var(--border-color);margin:0 auto 8px;display:block}.featured-alt{font-size:11px;color:var(--text-secondary);margin-bottom:8px}.featured-card a{display:block;color:#3b82f6;font-size:12px;font-weight:600;text-decoration:none;word-break:break-word}.featured-card a:hover{text-decoration:underline}@media(max-width:1100px){.featured-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:720px){.featured-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.back-to-top{position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;border:none;padding:10px 16px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(15,23,42,.3);opacity:0;pointer-events:none;transition:opacity .2s ease}.back-to-top.show{opacity:1;pointer-events:auto}.empty-state{color:var(--text-secondary);font-size:13px}.footer{text-align:center;padding:24px;color:var(--text-secondary);font-size:13px}</style>
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
  : componentReports.map((report) => renderComponentSection(report, isDark, validationContext)).join('')}
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

function renderComponentSection(report, isDark, validation) {
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
${renderComponentDetails(name, data, validation, isDark)}
</div>
</div>`;
}

function renderComponentDetails(name, data, validation, isDark) {
  switch (name) {
    case 'heroCarousel': return renderHeroCarousel(data, validation?.heroCarousel, isDark);
    case 'variableWindows': return renderVariableWindows(data, validation?.variableWindows, isDark);
    case 'fullWidthBanner': return renderFullWidthBanner(data, validation?.fullWidthBanner, isDark);
    case 'monthlySpecials': return renderMonthlySpecials(data, validation?.monthlySpecials, isDark);
    case 'featuredCategories': return renderFeaturedCategories(data);
    case 'seasonalCarousel': return renderSeasonalCarousel(data, validation?.seasonalCarousel, isDark);
    case 'brandCTAWindows': return renderBrandCTAWindows(data, validation?.brandCTAWindows, isDark);
    case 'productCarousel': return renderProductCarousel(data);
    default: return `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }
}

function renderHeroCarousel(data, validation, isDark) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No hero carousel slides detected.</div>';
  }
  const includeValidation = validation && validation.total > 0;
  const rows = data.map((slide, i) => {
    const validationEntry = includeValidation ? getValidationEntry(validation, i + 1) : null;
    const validationRow = includeValidation
      ? `
<tr class="validation-row">
<td colspan="7">${renderValidationCell(validationEntry)}</td>
</tr>`
      : '';
    return `
${validationRow}
<tr>
<td>Slide ${i + 1}</td>
<td>${renderImageCell(slide.mobileImage, slide.altText)}</td>
<td>${renderImageCell(slide.tabletImage, slide.altText)}</td>
<td>${renderImageCell(slide.desktopImage, slide.altText)}</td>
<td>${renderAltText(slide.altText)}</td>
<td>${renderLinkCell(slide.linkDirection)}</td>
<td>${slide.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`;
  }).join('');
  return `<table class="data-table"><thead><tr><th>Slide</th><th>Mobile</th><th>Tablet</th><th>Desktop</th><th>Alt Text</th><th>Link</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderVariableWindows(data, validation, isDark) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No variable windows detected.</div>';
  }
  const includeValidation = validation && validation.total > 0;
  const rows = data.map((w, i) => {
    const validationEntry = includeValidation ? getValidationEntry(validation, i + 1) : null;
    const validationRow = includeValidation
      ? `
<tr class="validation-row">
<td colspan="6">${renderValidationCell(validationEntry)}</td>
</tr>`
      : '';
    return `
${validationRow}
<tr>
<td>Window ${i + 1}</td>
<td>${renderImageCell(w.mobileImage, w.altText)}</td>
<td>${renderImageCell(w.desktopImage, w.altText)}</td>
<td>${renderAltText(w.altText)}</td>
<td>${renderLinkCell(w.linkDirection)}</td>
<td>${w.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`;
  }).join('');
  return `<table class="data-table"><thead><tr><th>Window</th><th>Mobile</th><th>Desktop</th><th>Alt Text</th><th>Link</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderFullWidthBanner(data, validation, isDark) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No full width banner detected.</div>';
  }
  const includeValidation = validation && validation.total > 0;
  const rows = data.map((b, i) => {
    const validationEntry = includeValidation ? getValidationEntry(validation, i + 1) : null;
    const validationRow = includeValidation
      ? `
<tr class="validation-row">
<td colspan="7">${renderValidationCell(validationEntry)}</td>
</tr>`
      : '';
    return `
${validationRow}
<tr>
<td>Banner ${i + 1}</td>
<td>${renderImageCell(b.mobileImage, b.altText)}</td>
<td>${renderImageCell(b.tabletImage, b.altText)}</td>
<td>${renderImageCell(b.desktopImage, b.altText)}</td>
<td>${renderAltText(b.altText)}</td>
<td>${renderLinkCell(b.linkDirection)}</td>
<td>${b.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`;
  }).join('');
  return `<table class="data-table"><thead><tr><th>Banner</th><th>Mobile</th><th>Tablet</th><th>Desktop</th><th>Alt Text</th><th>Link</th><th>Target</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMonthlySpecials(data, validation, isDark) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No monthly specials detected.</div>';
  }

  const includeValidation = validation && validation.total > 0;
  const missingSlides = includeValidation
    ? validation.slides.filter((slide) => slide.status === 'missing').map((slide) => slide.slide).sort((a, b) => a - b)
    : [];
  const extraSlides = includeValidation && validation.extraSlides && validation.extraSlides.length > 0
    ? validation.extraSlides.slice().sort((a, b) => a - b)
    : [];

  const validationNote = includeValidation && (missingSlides.length > 0 || extraSlides.length > 0)
    ? `<div style="margin-bottom: 12px; font-size: 12px; color: var(--text-secondary);">
      ${missingSlides.length > 0 ? `Missing slides in page: ${escapeHtml(missingSlides.join(', '))}. ` : ''}
      ${extraSlides.length > 0 ? `Extra slides detected (not in Excel): ${escapeHtml(extraSlides.join(', '))}.` : ''}
    </div>`
    : '';

  const grouped = new Map();
  data.forEach((item) => {
    const slideIndex = item?.slideIndex ? Number(item.slideIndex) : null;
    const key = Number.isFinite(slideIndex) && slideIndex > 0 ? slideIndex : 'unassigned';
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  });

  const numericKeys = Array.from(grouped.keys())
    .filter((key) => typeof key === 'number')
    .sort((a, b) => a - b);
  const hasUnassigned = grouped.has('unassigned');
  const orderedKeys = hasUnassigned ? [...numericKeys, 'unassigned'] : numericKeys;

  const groupsHtml = orderedKeys.map((key) => {
    const items = grouped.get(key) || [];
    const isUnassigned = key === 'unassigned';
    const slideLabel = isUnassigned ? 'Unassigned Items' : `Slide ${key}`;
    const validationEntry = includeValidation && !isUnassigned ? getValidationEntry(validation, key) : null;
    const validationDetails = validationEntry ? renderValidationDetails(validationEntry) : '';
    const headerParts = `
<div class="monthly-group-header">
  <div class="monthly-group-title">${escapeHtml(slideLabel)}</div>
  ${validationEntry ? renderValidationBadge(validationEntry, validationDetails) : ''}
</div>`;

    const cards = items.map((item) => {
      const sku = item?.sku ? `SKU ${escapeHtml(item.sku)}` : 'SKU N/A';
      const name = item?.name ? escapeHtml(item.name) : 'Name unavailable';
      const altText = item?.altText ? escapeHtml(item.altText) : null;
      const link = item?.linkDirection ? escapeHtml(item.linkDirection) : null;
      const imageUrl = item?.imageUrl ? escapeHtml(item.imageUrl) : null;
      return `<div class="monthly-card">
${imageUrl ? `<img src="${imageUrl}" alt="${altText || 'Monthly special'}" loading="lazy">` : ''}
<div class="monthly-sku">${sku}</div>
<div class="monthly-name">${name}</div>
${altText ? `<div class="monthly-alt">Alt: ${altText}</div>` : ''}
${link ? `<a class="url-link" href="${link}" target="_blank">${link}</a>` : '<div class="empty-state">No link</div>'}
</div>`;
    }).join('');

    return `<div class="monthly-group">
${headerParts}
<div class="monthly-grid">${cards}</div>
</div>`;
  }).join('');

  return `${validationNote}${groupsHtml}`;
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

function renderSeasonalCarousel(data, validation, isDark) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No seasonal carousel slides detected.</div>';
  }
  const includeValidation = validation && validation.total > 0;
  const rows = data.map((slide, i) => {
    const validationEntry = includeValidation ? getValidationEntry(validation, i + 1) : null;
    const validationRow = includeValidation
      ? `
<tr class="validation-row">
<td colspan="5">${renderValidationCell(validationEntry)}</td>
</tr>`
      : '';
    return `
${validationRow}
<tr>
<td>Slide ${i + 1}</td>
<td>${renderImageCell(slide.mobileImage, slide.altText)}</td>
<td>${renderImageCell(slide.desktopImage, slide.altText)}</td>
<td>${renderAltText(slide.altText)}</td>
<td>${renderSkuBadges(slide.skus)}</td>
</tr>`;
  }).join('');
  return `<table class="data-table"><thead><tr><th>Slide</th><th>Mobile</th><th>Desktop</th><th>Alt Text</th><th>SKUs</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderBrandCTAWindows(data, validation, isDark) {
  if (!Array.isArray(data) || data.length === 0) {
    return '<div class="empty-state">No brand CTA windows detected.</div>';
  }
  const includeValidation = validation && validation.total > 0;
  const rows = data.map((item, i) => {
    const validationEntry = includeValidation ? getValidationEntry(validation, i + 1) : null;
    const validationRow = includeValidation
      ? `
<tr class="validation-row">
<td colspan="6">${renderValidationCell(validationEntry)}</td>
</tr>`
      : '';
    return `
${validationRow}
<tr>
<td>Window ${i + 1}</td>
<td>${renderImageCell(item.mobileImage, item.altText)}</td>
<td>${renderImageCell(item.desktopImage, item.altText)}</td>
<td>${renderAltText(item.altText)}</td>
<td>${renderLinkCell(item.linkDirection)}</td>
<td>${item.newTab ? 'New tab' : 'Same tab'}</td>
</tr>`;
  }).join('');
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

function getValidationEntry(validation, position) {
  if (!validation || !Array.isArray(validation.slides)) return null;
  const numericPosition = Number(position);
  if (!Number.isFinite(numericPosition) || numericPosition <= 0) return null;

  const entry = validation.slides.find((slide) => {
    const slidePosition = Number(slide.position ?? slide.slide);
    return slidePosition === numericPosition;
  });

  if (entry) {
    return { ...entry, position: Number(entry.position ?? entry.slide) };
  }

  const extraPositions = validation.extraPositions || validation.extraSlides || [];
  const isExtra = Array.isArray(extraPositions) && extraPositions.includes(numericPosition);

  return {
    position: numericPosition,
    status: 'extra',
    mismatches: [isExtra ? 'Not found in Excel' : 'No matching Excel row']
  };
}

function renderValidationCell(entry) {
  if (!entry) {
    return '<div class="validation-cell"><span class="validation-badge extra">No Excel validation</span></div>';
  }
  const status = entry.status === 'pass' ? 'pass' : entry.status === 'fail' ? 'fail' : entry.status === 'missing' ? 'missing' : 'extra';
  const label = status === 'pass' ? 'Passed' : status === 'fail' ? 'Failed' : status === 'missing' ? 'Missing' : 'Not in Excel';
  const details = renderValidationDetails(entry);
  return `<div class="validation-cell">
<span class="validation-badge ${status}">Validation ${label}</span>
${details}
</div>`;
}

function renderValidationBadge(entry, details = '') {
  if (!entry) return '';
  const status = entry.status === 'pass' ? 'pass' : entry.status === 'fail' ? 'fail' : entry.status === 'missing' ? 'missing' : 'extra';
  const label = status === 'pass' ? 'Passed' : status === 'fail' ? 'Failed' : status === 'missing' ? 'Missing' : 'Not in Excel';
  return `<div class="validation-inline">
<span class="validation-badge ${status}">Validation ${label}</span>
${details}
</div>`;
}

function renderValidationDetails(entry) {
  const detailLines = [];
  if (entry?.mismatches && entry.mismatches.length > 0) {
    detailLines.push(...entry.mismatches);
  } else if (entry?.expectedSkus && entry?.actualSkus && entry.status !== 'pass') {
    const expectedText = entry.expectedSkus.length ? entry.expectedSkus.join(', ') : 'None';
    const actualText = entry.actualSkus.length ? entry.actualSkus.join(', ') : 'None';
    detailLines.push(`SKUs: expected ${expectedText}, actual ${actualText}`);
  }

  if (detailLines.length === 0) {
    return '';
  }

  return detailLines.map((line) => `<div class="validation-detail">${escapeHtml(line)}</div>`).join('');
}

function formatComponentName(name) {
  return String(name).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function normalizeSkuList(value) {
  if (!value) return [];
  return value.toString()
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeLink(value) {
  if (!value) return '';
  let link = value.toString().trim().toLowerCase();
  link = link.replace(/^https?:\/\/[^/]+/i, '');
  link = link.replace(/[?#].*$/, '');
  if (link.length > 1) {
    link = link.replace(/\/$/, '');
  }
  return link;
}

function normalizeTarget(value) {
  if (!value) return '';
  const normalized = value.toString().trim().toLowerCase();
  if (normalized.includes('same') || normalized === '_self') return 'same tab';
  if (normalized.includes('new') || normalized === '_blank') return 'new tab';
  return normalized;
}

function normalizeLocale(value) {
  if (!value) return '';
  return value.toString().trim().toUpperCase();
}

function getExpectedLocale(row, culture) {
  const isCanada = String(culture || '').toLowerCase().includes('ca');
  const locale = isCanada ? row.imageLocaleCA : row.imageLocaleUS;
  return normalizeLocale(locale);
}

function extractImageLocale(item) {
  if (!item) return '';
  const candidates = [item.desktopImage, item.tabletImage, item.mobileImage, item.imageUrl].filter(Boolean);
  for (const candidate of candidates) {
    const locale = detectImageLocale(candidate);
    if (locale) return normalizeLocale(locale);
  }
  return '';
}

function buildCarouselValidation(componentReports, excelValidation, options, componentName, typeKey) {
  if (!excelValidation || !excelValidation.enabled || !Array.isArray(excelValidation.data)) {
    return null;
  }

  const rows = excelValidation.data.filter((row) => row.type === typeKey);
  if (rows.length === 0) {
    return null;
  }

  const component = componentReports.find((report) => report.name === componentName);
  const data = Array.isArray(component?.data) ? component.data : [];

  const expectedByPosition = new Map();
  rows.forEach((row) => {
    const position = Number(row.position);
    if (!Number.isFinite(position) || position <= 0) return;
    expectedByPosition.set(position, row);
  });

  const actualByPosition = new Map();
  data.forEach((item, index) => {
    actualByPosition.set(index + 1, item);
  });

  const slides = [];
  let passed = 0;
  let failed = 0;
  let missing = 0;

  expectedByPosition.forEach((row, position) => {
    const actual = actualByPosition.get(position);
    if (!actual) {
      missing += 1;
      failed += 1;
      slides.push({
        position,
        status: 'missing',
        expected: row,
        actual: null,
        mismatches: ['Missing slide/window']
      });
      return;
    }

    const expectedLink = normalizeLink(row.bannerLink);
    const actualLink = normalizeLink(actual.linkDirection);
    const linkMatch = expectedLink ? expectedLink === actualLink : true;

    const expectedTarget = normalizeTarget(row.target);
    const actualTarget = normalizeTarget(actual.newTab ? 'new tab' : 'same tab');
    const targetMatch = expectedTarget ? expectedTarget === actualTarget : true;

    const expectedLocale = getExpectedLocale(row, options?.culture);
    const actualLocale = extractImageLocale(actual);
    const localeMatch = expectedLocale ? expectedLocale === actualLocale : true;

    const mismatches = [];
    if (!linkMatch) {
      mismatches.push(`Link: expected ${expectedLink || 'N/A'}, actual ${actualLink || 'N/A'}`);
    }
    if (!targetMatch) {
      mismatches.push(`Target: expected ${expectedTarget || 'N/A'}, actual ${actualTarget || 'N/A'}`);
    }
    if (!localeMatch) {
      mismatches.push(`Image Locale: expected ${expectedLocale || 'N/A'}, actual ${actualLocale || 'N/A'}`);
    }

    const status = mismatches.length === 0 ? 'pass' : 'fail';
    if (status === 'pass') {
      passed += 1;
    } else {
      failed += 1;
    }

    slides.push({
      position,
      status,
      expected: row,
      actual,
      mismatches
    });
  });

  const extraPositions = Array.from(actualByPosition.keys())
    .filter((position) => !expectedByPosition.has(position))
    .sort((a, b) => a - b);

  return {
    total: expectedByPosition.size,
    passed,
    failed,
    missing,
    slides,
    extraPositions
  };
}

function renderCarouselValidation(validation, label, isDark) {
  if (!validation || validation.total === 0) {
    return '';
  }

  const isPassing = validation.failed === 0 && validation.missing === 0;
  const summaryBg = isPassing
    ? (isDark ? 'rgba(16, 185, 129, 0.1)' : '#d1fae5')
    : (isDark ? 'rgba(239, 68, 68, 0.1)' : '#fee2e2');
  const summaryBorder = isPassing ? '#10b981' : '#ef4444';
  const summaryColor = isPassing ? '#059669' : '#dc2626';

  const slideRows = validation.slides
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((slide) => {
      const statusLabel = slide.status === 'pass' ? 'Passed' : slide.status === 'missing' ? 'Missing' : 'Failed';
      const mismatchText = slide.mismatches && slide.mismatches.length > 0
        ? `<div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">${slide.mismatches.map((m) => escapeHtml(m)).join('<br>')}</div>`
        : '';
      return `<div style="margin-top: 6px;"><strong>Position ${slide.position}:</strong> ${statusLabel}${mismatchText}</div>`;
    }).join('');

  const extras = validation.extraPositions && validation.extraPositions.length > 0
    ? `<div style="margin-top: 6px; font-size: 12px; color: var(--text-secondary);">Extra positions detected (not in Excel): ${escapeHtml(validation.extraPositions.join(', '))}</div>`
    : '';

  return `
    <div style="padding: 12px 16px; margin-bottom: 16px; background: ${summaryBg}; border-left: 4px solid ${summaryBorder}; border-radius: 6px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <strong style="color: ${summaryColor};">
          ${escapeHtml(label)} Validation ${isPassing ? 'Passed' : 'Failed'}
        </strong>
        <span style="font-size: 12px; color: var(--text-secondary);">(${validation.passed}/${validation.total} positions passed)</span>
      </div>
      ${slideRows}
      ${extras}
    </div>
  `;
}

function compareSkuSets(expectedSkus, actualSkus) {
  const expected = Array.from(new Set((expectedSkus || []).map((sku) => String(sku).trim()))).sort();
  const actual = Array.from(new Set((actualSkus || []).map((sku) => String(sku).trim()))).sort();

  if (expected.length !== actual.length) return false;
  return expected.every((sku, index) => sku === actual[index]);
}

function buildSeasonalCarouselValidation(componentReports, excelValidation, options) {
  if (!excelValidation || !excelValidation.enabled || !Array.isArray(excelValidation.data)) {
    return null;
  }

  const seasonalRows = excelValidation.data.filter((row) => row.type === 'seasonal-carousel');
  if (seasonalRows.length === 0) {
    return null;
  }

  const seasonalReport = componentReports.find((report) => report.name === 'seasonalCarousel');
  const data = Array.isArray(seasonalReport?.data) ? seasonalReport.data : [];

  const expectedByPosition = new Map();
  seasonalRows.forEach((row) => {
    const position = Number(row.position);
    if (!Number.isFinite(position) || position <= 0) return;
    expectedByPosition.set(position, row);
  });

  const actualByPosition = new Map();
  data.forEach((item, index) => {
    actualByPosition.set(index + 1, item);
  });

  const slides = [];
  let passed = 0;
  let failed = 0;
  let missing = 0;

  expectedByPosition.forEach((row, position) => {
    const actual = actualByPosition.get(position);
    if (!actual) {
      missing += 1;
      failed += 1;
      slides.push({
        position,
        status: 'missing',
        expected: row,
        actual: null,
        mismatches: ['Missing slide']
      });
      return;
    }

    const expectedSkus = normalizeSkuList(row.skus || row.raw?.SKUs);
    const actualSkus = Array.isArray(actual?.skus)
      ? actual.skus.map((sku) => String(sku).trim()).filter(Boolean)
      : [];
    const expectedLocale = getExpectedLocale(row, options?.culture);
    const actualLocale = extractImageLocale(actual);

    const normalizedExpectedSkus = Array.from(new Set(expectedSkus.map((sku) => String(sku).trim()))).sort();
    const normalizedActualSkus = Array.from(new Set(actualSkus.map((sku) => String(sku).trim()))).sort();

    const mismatches = [];
    if (expectedSkus.length && !compareSkuSets(expectedSkus, actualSkus)) {
      const expectedText = normalizedExpectedSkus.length ? normalizedExpectedSkus.join(', ') : 'None';
      const actualText = normalizedActualSkus.length ? normalizedActualSkus.join(', ') : 'None';
      mismatches.push(`SKUs: expected ${expectedText}, actual ${actualText}`);
    }
    if (expectedLocale && expectedLocale !== actualLocale) {
      mismatches.push(`Image Locale: expected ${expectedLocale || 'N/A'}, actual ${actualLocale || 'N/A'}`);
    }

    const status = mismatches.length === 0 ? 'pass' : 'fail';
    if (status === 'pass') {
      passed += 1;
    } else {
      failed += 1;
    }

    slides.push({
      position,
      status,
      expected: row,
      actual,
      expectedSkus: normalizedExpectedSkus,
      actualSkus: normalizedActualSkus,
      mismatches
    });
  });

  const extraPositions = Array.from(actualByPosition.keys())
    .filter((position) => !expectedByPosition.has(position))
    .sort((a, b) => a - b);

  return {
    total: expectedByPosition.size,
    passed,
    failed,
    missing,
    slides,
    extraPositions
  };
}

function buildMonthlySpecialsValidation(componentReports, excelValidation) {
  if (!excelValidation || !excelValidation.enabled || !Array.isArray(excelValidation.data)) {
    return null;
  }

  const monthlyRows = excelValidation.data.filter((row) => row.type === 'monthly-specials');
  if (monthlyRows.length === 0) {
    return null;
  }

  const monthlyReport = componentReports.find((report) => report.name === 'monthlySpecials');
  const data = Array.isArray(monthlyReport?.data) ? monthlyReport.data : [];

  const expectedBySlide = new Map();
  monthlyRows.forEach((row) => {
    const slide = Number(row.position);
    if (!Number.isFinite(slide) || slide <= 0) return;
    const skus = normalizeSkuList(row.skus || row.raw?.SKUs);
    expectedBySlide.set(slide, skus);
  });

  const actualBySlide = new Map();
  data.forEach((item) => {
    const slide = Number(item?.slideIndex);
    if (!Number.isFinite(slide) || slide <= 0) return;
    const sku = item?.sku ? String(item.sku).trim() : null;
    if (!sku) return;
    if (!actualBySlide.has(slide)) {
      actualBySlide.set(slide, new Set());
    }
    actualBySlide.get(slide).add(sku);
  });

  const slides = [];
  let passed = 0;
  let failed = 0;
  let missing = 0;

  expectedBySlide.forEach((expectedSkus, slide) => {
    const actualSet = actualBySlide.get(slide);
    const actualSkus = actualSet ? Array.from(actualSet) : [];
    const normalizedExpected = Array.from(new Set((expectedSkus || []).map((sku) => String(sku).trim()))).sort();
    const normalizedActual = Array.from(new Set((actualSkus || []).map((sku) => String(sku).trim()))).sort();
    const mismatches = [];
    let status = 'pass';

    if (normalizedActual.length === 0) {
      status = 'missing';
      mismatches.push('Missing slide');
      missing += 1;
      failed += 1;
    } else if (!compareSkuSets(normalizedExpected, normalizedActual)) {
      status = 'fail';
      const expectedText = normalizedExpected.length ? normalizedExpected.join(', ') : 'None';
      const actualText = normalizedActual.length ? normalizedActual.join(', ') : 'None';
      mismatches.push(`SKUs: expected ${expectedText}, actual ${actualText}`);
      failed += 1;
    } else {
      passed += 1;
    }

    slides.push({
      slide,
      expectedSkus: normalizedExpected,
      actualSkus: normalizedActual,
      status,
      mismatches
    });
  });

  const extraSlides = Array.from(actualBySlide.keys())
    .filter((slide) => !expectedBySlide.has(slide))
    .sort((a, b) => a - b);

  return {
    total: expectedBySlide.size,
    passed,
    failed,
    missing,
    slides,
    extraSlides
  };
}
