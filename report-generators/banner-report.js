// banner-report.js - Generate HTML report for Banner test results

import { config } from '../config.js';
import { validateResults } from '../utils/excel-validation.js';

export function generateBannerReport(results, captureDuration, theme = 'dark', excelValidation = null) {
  if (!results || !results.length) {
    throw new Error('No results found.');
  }

  // Apply Excel validation if provided
  let validatedResults = results;
  let validationSummary = null;
  let excelFilename = null;

  console.log('[Banner Report] Excel Validation received:', excelValidation ? 'YES' : 'NO');
  if (excelValidation) {
    console.log('[Banner Report] Excel Validation enabled:', excelValidation.enabled);
    console.log('[Banner Report] Excel Validation data rows:', excelValidation.data?.length || 0);
  }

  if (excelValidation && excelValidation.enabled && excelValidation.data) {
    console.log('[Banner Report] Running validation...');
    validatedResults = validateResults(results, excelValidation.data, 'category-banner');
    excelFilename = excelValidation.filename || 'Unknown';
  }

  const timestamp = new Date().toISOString();
  const environment = validatedResults[0]?.environment || 'Unknown';
  const durationText = captureDuration ? (captureDuration / 1000).toFixed(1) + 's' : 'N/A';
  const isDark = theme === 'dark';

  // Sort results
  const cultureOrder = {
    enus: 0, esus: 1, enca: 2, frca: 3, esmx: 4,
    ie: 5, uk: 6, de: 7, pl: 8, nl: 9, lt: 10,
  };
  const widthRank = Object.fromEntries(config.banner.widths.map((w, i) => [w, i]));

  const sorted = [...validatedResults].sort((a, b) => {
    const ca = cultureOrder[a.culture] ?? 99;
    const cb = cultureOrder[b.culture] ?? 99;
    if (ca !== cb) return ca - cb;
    const oa = Number(a.order ?? 999);
    const ob = Number(b.order ?? 999);
    if (oa !== ob) return oa - ob;
    const wa = widthRank[a.width] ?? 99;
    const wb = widthRank[b.width] ?? 99;
    return wa - wb;
  });

  // Group by culture + category
  const groupedItems = {};
  sorted.forEach((item) => {
    const groupKey = `${item.culture}|${item.category}|${item.mainCategory || ''}`;
    if (!groupedItems[groupKey]) {
      groupedItems[groupKey] = {
        culture: item.culture,
        category: item.category,
        mainCategory: item.mainCategory || '',
        items: [],
        href: item.href,
        target: item.target,
        imageLocale: item.imageLocale,
        imageAlt: item.imageAlt,
        url: item.url,
        hasError: false,
        validation: item.validation  // Copy validation data from first item
      };
    }
    groupedItems[groupKey].items.push(item);
    if (item.error) groupedItems[groupKey].hasError = true;
    if (!item.error) {
      if (item.href) groupedItems[groupKey].href = item.href;
      if (item.imageLocale) groupedItems[groupKey].imageLocale = item.imageLocale;
      if (item.imageAlt) groupedItems[groupKey].imageAlt = item.imageAlt;
    }
    // Update validation data from non-error items (validation data should be same across all widths for same category)
    if (!item.error && item.validation) {
      groupedItems[groupKey].validation = item.validation;
    }
  });

  const groups = Object.values(groupedItems);
  const failedItems = groups
    .map((group, index) => {
      if (!group.validation || group.validation.status !== 'fail') return null;
      const categoryPath = group.mainCategory ? `${group.mainCategory} > ${group.category}` : group.category;
      return {
        id: `banner-${index + 1}`,
        label: `${String(group.culture || '').toUpperCase()} - ${categoryPath}`
      };
    })
    .filter(Boolean);
  const hasValidationFailures = failedItems.length > 0;
  if (excelValidation && excelValidation.enabled && excelValidation.data) {
    validationSummary = buildGroupValidationSummary(groups);
    console.log('[Banner Report] Validation complete. Summary:', validationSummary);
  }
  const totalBanners = groups.length;
  const failedBanners = groups.filter((group) => {
    const hasErrors = group.items.some((item) => item.error);
    return hasErrors || isValidationFailure(group.validation);
  }).length;
  const successBanners = totalBanners - failedBanners;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Banner Test Report - ${new Date(timestamp).toLocaleString()}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg-primary:${isDark ? '#0f172a' : '#f0f2f5'};--bg-card:${isDark ? '#1e293b' : 'white'};--bg-card-header:${isDark ? '#334155' : '#f8fafc'};--bg-screenshot:${isDark ? '#334155' : '#f8fafc'};--text-primary:${isDark ? '#f1f5f9' : '#1a1a2e'};--text-secondary:${isDark ? '#94a3b8' : '#64748b'};--text-heading:${isDark ? '#f8fafc' : '#1e293b'};--border-color:${isDark ? '#475569' : '#e2e8f0'};--border-light:${isDark ? '#334155' : '#f1f5f9'};--mono-bg:${isDark ? '#475569' : '#f1f5f9'}}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;padding:20px}.container{max-width:1400px;margin:0 auto}.header{background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);color:#fff;padding:30px 40px;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 20px rgba(59,130,246,.3)}.header h1{font-size:28px;font-weight:700;margin-bottom:12px}.header-meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;opacity:.95}.header-meta span{display:flex;align-items:center;gap:6px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.summary-card{background:var(--bg-card);padding:12px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'});text-align:center}.summary-card h3{font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}.summary-card .value{font-size:18px;font-weight:700}.summary-card .value.total{color:#3b82f6}.summary-card .value.success{color:#10b981}.summary-card .value.error{color:#ef4444}.summary-card .value.time{color:#8b5cf6;font-size:14px}.summary-card.summary-action{border:2px solid #ef4444;background:var(--bg-card);cursor:pointer;transition:transform .1s,box-shadow .2s}.summary-card.summary-action:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(239,68,68,.2)}.summary-card.summary-action:focus{outline:2px solid #ef4444;outline-offset:2px}.summary-action-note{font-size:11px;color:var(--text-secondary)}.banner-card{background:var(--bg-card);border-radius:16px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}.banner-header{padding:20px 24px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}.banner-header h2{font-size:20px;font-weight:600;color:var(--text-heading)}.banner-header .culture-badge{background:#dbeafe;color:#1d4ed8;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600}.status-badge{padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.status-badge.success{background:#d1fae5;color:#059669}.status-badge.error{background:#fee2e2;color:#dc2626}.status-badge.partial{background:#fef3c7;color:#d97706}.banner-body{padding:24px}.error-message{background:${isDark ? '#3b1f1f' : '#fef2f2'};border:1px solid ${isDark ? '#7f1d1d' : '#fecaca'};color:${isDark ? '#f87171' : '#dc2626'};padding:16px 20px;border-radius:10px;margin-bottom:20px;font-weight:500}.banner-info{margin-bottom:24px}.banner-info table{width:100%;border-collapse:collapse}.banner-info th,.banner-info td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--border-light)}.banner-info th{width:130px;color:var(--text-secondary);font-weight:500;font-size:13px;text-transform:uppercase;letter-spacing:.3px}.banner-info td{color:var(--text-heading)}.banner-info td a{color:#3b82f6;text-decoration:none;word-break:break-all}.banner-info td a:hover{text-decoration:underline}.banner-info .mono{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;background:var(--mono-bg);padding:2px 6px;border-radius:4px}.btn-copy{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;box-shadow:0 2px 8px rgba(59,130,246,.3)}.btn-copy:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(59,130,246,.4)}.btn-copy:active{transform:translateY(0)}.btn-copy.copied{background:linear-gradient(135deg,#10b981 0%,#059669 100%)}.btn-fix{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;box-shadow:0 2px 8px rgba(245,158,11,.3);margin-left:8px}.btn-fix:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(245,158,11,.4)}.fix-modal{position:fixed;inset:0;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;z-index:2000;opacity:0;visibility:hidden;transition:opacity .2s,visibility .2s}.fix-modal.open{opacity:1;visibility:visible}.fix-modal-panel{background:var(--bg-card);border:1px solid var(--border-color);border-radius:16px;padding:20px 22px;width:560px;max-width:92vw;box-shadow:0 20px 50px -20px rgba(15,23,42,.7);transform:translateY(8px) scale(.98);transition:transform .2s}.fix-modal.open .fix-modal-panel{transform:translateY(0) scale(1)}.fix-modal-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:12px;margin-bottom:14px;border-bottom:1px solid var(--border-color)}.fix-modal-title{font-size:18px;font-weight:700;color:var(--text-primary)}.fix-modal-close{background:transparent;border:none;color:var(--text-secondary);font-size:22px;line-height:1;padding:2px 6px;border-radius:6px;cursor:pointer}.fix-modal-close:hover{color:var(--text-primary);background:var(--bg-card-header)}.fix-modal-body{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--text-secondary)}.fix-modal-location{color:var(--text-primary);font-weight:600}.fix-modal-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.fix-modal-label{text-transform:uppercase;letter-spacing:.4px;font-size:11px;color:var(--text-secondary);margin-bottom:6px}.fix-modal-value{background:var(--mono-bg);border:1px solid var(--border-color);border-radius:10px;padding:8px 10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;color:var(--text-primary);word-break:break-all}.fix-modal-note{color:var(--text-secondary);font-size:12px}.fix-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.fix-modal-actions .btn-copy{margin-left:0}.screenshots-section{border-top:1px solid var(--border-color);padding-top:24px}.screenshots-section h3{font-size:14px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}.screenshots-stack{display:flex;flex-direction:column;gap:20px}.screenshot-item{background:var(--bg-screenshot);border:1px solid var(--border-color);border-radius:12px;overflow:hidden}.screenshot-item.size-mobile{width:33.333%}.screenshot-item.size-tablet{width:66.666%}.screenshot-item.size-desktop{width:100%}.screenshot-item.error{border-color:${isDark ? '#7f1d1d' : '#fecaca'};background:${isDark ? '#3b1f1f' : '#fef2f2'}}.screenshot-header{padding:12px 16px;background:var(--bg-card);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center}.screenshot-item.error .screenshot-header{background:${isDark ? '#3b1f1f' : '#fef2f2'};border-bottom-color:${isDark ? '#7f1d1d' : '#fecaca'}}.screenshot-width{font-size:14px;font-weight:600;color:var(--text-heading)}.screenshot-error{padding:20px 16px;color:${isDark ? '#f87171' : '#dc2626'};font-size:13px;text-align:center}.screenshot-image{padding:12px}.screenshot-image img{width:100%;border-radius:8px;display:block}.validation-panel{position:fixed;top:16px;right:16px;width:300px;max-height:60vh;background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:none;z-index:1000}.validation-panel.show{display:block}.validation-panel-header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary)}.validation-panel-close{background:none;border:none;color:var(--text-secondary);font-size:16px;cursor:pointer}.validation-panel-list{list-style:none;margin:0;padding:8px 12px;max-height:calc(60vh - 44px);overflow:auto;display:flex;flex-direction:column;gap:6px}.validation-panel-list a{color:#3b82f6;text-decoration:none;font-size:12px}.validation-panel-list a:hover{text-decoration:underline}.anchor-target{scroll-margin-top:120px}.back-to-top{position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;border:none;padding:10px 16px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(15,23,42,.3);opacity:0;pointer-events:none;transition:opacity .2s ease}.back-to-top.show{opacity:1;pointer-events:auto}.footer{text-align:center;padding:24px;color:var(--text-secondary);font-size:13px}@media(max-width:768px){.header{padding:24px}.header h1{font-size:24px}.header-meta{gap:12px}.banner-header{flex-direction:column;align-items:flex-start}.screenshot-item.size-mobile,.screenshot-item.size-tablet{width:100%}.validation-panel{left:16px;right:16px;width:auto}.fix-modal-panel{width:92vw}}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Banner Test Report ${validationSummary ? '📊' : ''}</h1>
      <div class="header-meta">
        <span><strong>Environment:</strong> ${environment === 'production' ? 'Production' : 'Stage (Preview)'}</span>
        <span><strong>Total Captures:</strong> ${validatedResults.length}</span>
        <span><strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</span>
        ${validationSummary ? `<span style="background: rgba(16, 185, 129, 0.2); padding: 4px 12px; border-radius: 6px;"><strong>Excel Validation:</strong> ${excelFilename}</span>` : ''}
      </div>
    </div>

    <div class="summary">
      <div class="summary-card">
        <h3>Total Banners</h3>
        <div class="value total">${totalBanners}</div>
      </div>
      <div class="summary-card">
        <h3>Successful</h3>
        <div class="value success">${successBanners}</div>
      </div>
      <div class="summary-card">
        <h3>Failed</h3>
        <div class="value error">${failedBanners}</div>
      </div>
      <div class="summary-card">
        <h3>Duration</h3>
        <div class="value time">${durationText}</div>
      </div>
      ${validationSummary ? `
      <div class="summary-card" style="border: 2px solid #10b981;">
        <h3 style="color: #10b981;">Validation Passed</h3>
        <div class="value success">${validationSummary.passed}</div>
      </div>
      ${validationSummary.failed > 0 ? `
      <button class="summary-card summary-action" id="open-validation-panel" type="button">
        <h3 style="color: #ef4444;">Validation Failed</h3>
        <div class="value error">${validationSummary.failed}</div>
        <div class="summary-action-note">Review failed items</div>
      </button>
      ` : `
      <div class="summary-card" style="border: 2px solid #ef4444;">
        <h3 style="color: #ef4444;">Validation Failed</h3>
        <div class="value error">${validationSummary.failed}</div>
      </div>
      `}
      <div class="summary-card" style="border: 2px solid #f59e0b;">
        <h3 style="color: #f59e0b;">Not Found in Excel</h3>
        <div class="value" style="color: #f59e0b;">${validationSummary.notFound}</div>
      </div>
      <div class="summary-card" style="border: 2px solid #8b5cf6;">
        <h3 style="color: #8b5cf6;">Pass Rate</h3>
        <div class="value" style="color: #8b5cf6; font-size: 28px;">${validationSummary.passRate}%</div>
      </div>
      ` : ''}
    </div>

    ${hasValidationFailures ? `
    <div class="validation-panel" id="validation-panel" aria-hidden="true">
      <div class="validation-panel-header">
        <span>Failed Items (${failedItems.length})</span>
        <button class="validation-panel-close" id="validation-panel-close" type="button" aria-label="Close">X</button>
      </div>
      <ul class="validation-panel-list">
        ${failedItems.map((item) => `<li><a href="#${item.id}">${escapeHtml(item.label)}</a></li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${groups.map((group, groupIdx) => {
    const allErrors = group.items.every(i => i.error);
    const hasErrors = group.items.some(i => i.error) || isValidationFailure(group.validation);
    const statusClass = allErrors ? 'error' : hasErrors ? 'partial' : 'success';
    const statusText = allErrors ? 'Failed' : hasErrors ? 'Partial' : 'Success';
    const targetText = group.target && group.target.toLowerCase() === '_blank' ? 'New Tab' : 'Same Tab';
    const validationActualLink = group.validation?.actual?.link || '';
    const validationExpectedLink = group.validation?.expected?.link || '';
    const linkDisplay = stripDomain(validationActualLink || group.href);
    const anchorId = `banner-${groupIdx + 1}`;

    return `
    <div class="banner-card anchor-target" id="${anchorId}">
      <div class="banner-header">
        <div>
          <h2>${escapeHtml(group.category)} ${group.mainCategory ? `<span style="color: var(--text-secondary); font-weight: 400;">(${escapeHtml(group.mainCategory)})</span>` : ''}</h2>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="culture-badge">${escapeHtml(group.culture.toUpperCase())}</span>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="banner-body">
        ${allErrors ? `
        <div class="error-message">
          All captures failed: ${escapeHtml(group.items[0]?.message || 'Banner not found or request failed')}
        </div>
        ` : `
        <div class="banner-info">
          ${group.validation ? `
          <div style="padding: 12px 16px; margin-bottom: 16px; background: ${group.validation.status === 'pass' ? (isDark ? 'rgba(16, 185, 129, 0.1)' : '#d1fae5') : group.validation.status === 'fail' ? (isDark ? 'rgba(239, 68, 68, 0.1)' : '#fee2e2') : (isDark ? 'rgba(245, 158, 11, 0.1)' : '#fef3c7')}; border-left: 4px solid ${group.validation.status === 'pass' ? '#10b981' : group.validation.status === 'fail' ? '#ef4444' : '#f59e0b'}; border-radius: 6px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: ${group.validation.status !== 'pass' ? '8px' : '0'};">
              <span style="font-size: 18px;">${group.validation.status === 'pass' ? '✅' : group.validation.status === 'fail' ? '❌' : '⚠️'}</span>
              <strong style="color: ${group.validation.status === 'pass' ? '#059669' : group.validation.status === 'fail' ? '#dc2626' : '#d97706'};">
                ${group.validation.status === 'pass' ? 'Validation Passed' : group.validation.status === 'fail' ? 'Validation Failed' : 'Not Found in Excel'}
              </strong>
            </div>
            ${group.validation.message ? `<div style="font-size: 13px; color: var(--text-secondary);">${escapeHtml(group.validation.message)}</div>` : ''}
          </div>
          ` : ''}
          <table>
            <tr>
              <th>Link</th>
              <td>
                <span class="mono">${escapeHtml(linkDisplay || 'N/A')}</span>
                ${linkDisplay ? `<button class="btn-copy" onclick="copyText('${encodeURIComponent(linkDisplay)}', this)" style="margin-left: 12px;">Copy Link</button>` : ''}
                ${group.validation && group.validation.comparisons && ((group.validation.comparisons.link && !group.validation.comparisons.link.match) || (group.validation.comparisons.target && !group.validation.comparisons.target.match)) && group.url ? `
                <button class="btn-fix" type="button" data-fix-url="${escapeHtml(group.url)}" data-fix-culture="${escapeHtml(group.culture || '')}" data-fix-category="${escapeHtml(group.category || '')}" data-fix-main="${escapeHtml(group.mainCategory || '')}" data-fix-actual="${escapeHtml(validationActualLink || group.href || group.validation.comparisons.link?.actual || '')}" data-fix-expected="${escapeHtml(validationExpectedLink || group.validation.comparisons.link?.expected || '')}" data-fix-actual-target="${escapeHtml(group.validation.comparisons.target?.actual || '')}" data-fix-expected-target="${escapeHtml(group.validation.comparisons.target?.expected || '')}">Review</button>
                ` : ''}
                ${group.validation && group.validation.comparisons && group.validation.comparisons.link && !group.validation.comparisons.link.match ? `
                <div style="margin-top: 8px; padding: 8px 12px; background: ${isDark ? '#3b1f1f' : '#fef2f2'}; border-radius: 6px;">
                  ${group.validation.comparisons.link.domainError ? `
                    <div style="font-size: 12px; color: ${isDark ? '#f87171' : '#dc2626'}; font-weight: 600; margin-bottom: 6px;">⚠️ Domain Error:</div>
                    <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(group.validation.comparisons.link.domainError)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">Actual Domain: <span style="font-family: monospace; background: ${isDark ? '#475569' : '#f1f5f9'}; padding: 2px 6px; border-radius: 4px;">${escapeHtml(group.validation.comparisons.link.actualDomain || 'N/A')}</span></div>
                  ` : `
                    <div style="font-size: 12px; color: ${isDark ? '#f87171' : '#dc2626'}; font-weight: 600;">Expected:</div>
                    <div style="font-size: 13px; color: var(--text-secondary); font-family: monospace; margin-top: 4px;">${escapeHtml(validationExpectedLink || group.validation.comparisons.link.expected)}</div>
                  `}
                </div>
                ` : ''}
              </td>
            </tr>
            <tr>
              <th>Target</th>
              <td>
                ${targetText}
                ${group.validation && group.validation.comparisons && group.validation.comparisons.target && !group.validation.comparisons.target.match ? `
                <div style="margin-top: 8px; padding: 8px 12px; background: ${isDark ? '#3b1f1f' : '#fef2f2'}; border-radius: 6px;">
                  <div style="font-size: 12px; color: ${isDark ? '#f87171' : '#dc2626'}; font-weight: 600;">Expected:</div>
                  <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(group.validation.comparisons.target.expected)}</div>
                </div>
                ` : ''}
              </td>
            </tr>
            ${group.imageLocale ? `
            <tr>
              <th>Image Locale</th>
              <td>
                ${escapeHtml(group.imageLocale)}
              </td>
            </tr>
            ` : ''}
            ${group.imageAlt ? `
            <tr>
              <th>Alt Text</th>
              <td>${escapeHtml(group.imageAlt)}</td>
            </tr>
            ` : ''}
            <tr>
              <th>Page URL</th>
              <td><a href="${escapeHtml(group.url || '')}" target="_blank">${escapeHtml(group.url || 'N/A')}</a></td>
            </tr>
          </table>
        </div>

        <div class="screenshots-section">
          <h3>Screenshots by Viewport Width</h3>
          <div class="screenshots-stack">
            ${group.items.map((item, itemIdx) => {
      const sizeClass = item.width <= 576 ? 'size-mobile' : item.width < 1000 ? 'size-tablet' : 'size-desktop';
      if (item.error) {
        return `
            <div class="screenshot-item error ${sizeClass}">
              <div class="screenshot-header">
                <span class="screenshot-width">${item.width}px</span>
                <span class="status-badge error">Error</span>
              </div>
              <div class="screenshot-error">${escapeHtml(item.message || 'Capture failed')}</div>
            </div>`;
      } else {
        return `
            <div class="screenshot-item ${sizeClass}">
              <div class="screenshot-header">
                <span class="screenshot-width">${item.width}px</span>
                <button class="btn-copy" onclick="copyImage('${encodeURIComponent(item.image)}', this)">Copy Image</button>
              </div>
              <div class="screenshot-image">
                <img src="${item.image}" alt="Banner at ${item.width}px">
              </div>
            </div>`;
      }
    }).join('')}

    
          </div>
        </div>
        `}
      </div>
    </div>`;
  }).join('')}

    <div class="fix-modal" id="banner-report-fix-modal" aria-hidden="true">
      <div class="fix-modal-panel" role="dialog" aria-modal="true" aria-labelledby="banner-report-fix-title">
        <div class="fix-modal-header">
          <div class="fix-modal-title" id="banner-report-fix-title">Link Fix</div>
          <button class="fix-modal-close" id="banner-report-fix-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="fix-modal-body">
          <div class="fix-modal-location" id="banner-report-fix-location"></div>
          <div class="fix-modal-message">This banner link does not match the validation sheet.</div>
          <div class="fix-modal-grid">
            <div class="fix-modal-field">
              <div class="fix-modal-label">Current link</div>
              <div class="fix-modal-value" id="banner-report-fix-actual"></div>
            </div>
            <div class="fix-modal-field">
              <div class="fix-modal-label">Expected link</div>
              <div class="fix-modal-value" id="banner-report-fix-expected"></div>
            </div>
            <div class="fix-modal-field">
              <div class="fix-modal-label">Current target</div>
              <div class="fix-modal-value" id="banner-report-fix-target"></div>
            </div>
            <div class="fix-modal-field">
              <div class="fix-modal-label">Expected target</div>
              <div class="fix-modal-value" id="banner-report-fix-target-expected"></div>
            </div>
          </div>
          <div class="fix-modal-note" id="banner-report-fix-note">Auto-fix runs automatically when a link mismatch is found. Use Review to open Content Editor and approve the item.</div>
        </div>
        <div class="fix-modal-actions">
          <button class="btn-copy" id="banner-report-fix-manual" type="button">Review in Content Editor</button>
        </div>
      </div>
    </div>

    <script>
      (function() {
        const FIX_LOG_PREFIX = '[Banner Report Fix]';
        const modal = document.getElementById('banner-report-fix-modal');
        const closeBtn = document.getElementById('banner-report-fix-close');
        const manualBtn = document.getElementById('banner-report-fix-manual');
        const noteEl = document.getElementById('banner-report-fix-note');
        const locationEl = document.getElementById('banner-report-fix-location');
        const actualEl = document.getElementById('banner-report-fix-actual');
        const expectedEl = document.getElementById('banner-report-fix-expected');
        const actualTargetEl = document.getElementById('banner-report-fix-target');
        const expectedTargetEl = document.getElementById('banner-report-fix-target-expected');
        let activeFix = null;

        function logFix(level, message, data) {
          const logger = console[level] || console.log;
          if (data !== undefined) {
            logger(FIX_LOG_PREFIX + ' ' + message, data);
          } else {
            logger(FIX_LOG_PREFIX + ' ' + message);
          }
        }

        function stripDomain(value) {
          if (!value) return '';
          let link = String(value).trim();
          link = link.replace(/^https?:\\/\\/[^/]+/i, '');
          link = link.replace(/#.*$/, '');
          if (link.length > 1) {
            link = link.replace(/\\/$/, '');
          }
          return link;
        }

        function formatTargetLabel(value) {
          if (value === null || value === undefined) return '';
          const raw = String(value).trim();
          if (!raw) return 'Same Tab';
          const lower = raw.toLowerCase();
          if (lower === '_blank' || lower.includes('new')) return 'New Tab';
          if (lower === '_self' || lower.includes('same')) return 'Same Tab';
          return raw;
        }

        function classifyExpectedLink(expectedLink) {
          const value = String(expectedLink || '').trim();
          if (!value) {
            return { linkType: 'internal', requiresItemLookup: true, expectedLinkDomain: '' };
          }
          const match = value.match(/^https?:\/\/([^/?#]+)/i);
          if (!match) {
            return { linkType: 'internal', requiresItemLookup: true, expectedLinkDomain: '' };
          }
          const domain = String(match[1] || '').toLowerCase();
          const isInternal = /(^|\.)melaleuca\.com$/i.test(domain);
          return {
            linkType: isInternal ? 'internal' : 'external',
            requiresItemLookup: isInternal,
            expectedLinkDomain: domain
          };
        }

        function setNote(message) {
          if (noteEl) noteEl.textContent = message || '';
        }

        function closeModal() {
          if (!modal) return;
          modal.classList.remove('open');
          modal.setAttribute('aria-hidden', 'true');
          if (activeFix && activeFix.timeoutId) {
            clearTimeout(activeFix.timeoutId);
          }
          activeFix = null;
          logFix('info', 'Fix modal closed');
        }

        function createRequestId() {
          return 'report-fix-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
        }

        function openModal(button) {
          if (!modal || !button) return;
          const culture = button.dataset.fixCulture || '';
          const category = button.dataset.fixCategory || '';
          const main = button.dataset.fixMain || '';
          const location = main ? culture + ' › ' + main + ' › ' + category : culture + ' › ' + category;
          const actualRaw = button.dataset.fixActual || '';
          const expectedRaw = button.dataset.fixExpected || '';
          const actualTargetRaw = button.dataset.fixActualTarget || '';
          const expectedTargetRaw = button.dataset.fixExpectedTarget || '';
          const actual = stripDomain(actualRaw) || 'Not available';
          const expected = stripDomain(expectedRaw) || 'Not available';
          const url = button.dataset.fixUrl || '';
          let scLang = '';
          try {
            const parsedUrl = new URL(url);
            scLang = parsedUrl.searchParams.get('sc_lang') || '';
          } catch (e) {
            scLang = '';
          }

          if (locationEl) locationEl.textContent = location;
          if (actualEl) actualEl.textContent = actual;
          if (expectedEl) expectedEl.textContent = expected;
          if (actualTargetEl) actualTargetEl.textContent = formatTargetLabel(actualTargetRaw) || 'Not available';
          if (expectedTargetEl) expectedTargetEl.textContent = formatTargetLabel(expectedTargetRaw) || 'Not available';
          setNote('Auto-fix runs automatically when a link mismatch is found. Use Review to open Content Editor and approve the item.');

          activeFix = {
            url,
            culture,
            expectedLink: expectedRaw || expected,
            expectedTarget: expectedTargetRaw || '',
            scLang: scLang,
            requestId: null,
            extensionAcked: false,
            timeoutId: null
          };

          modal.classList.add('open');
          modal.setAttribute('aria-hidden', 'false');
          logFix('info', 'Fix modal opened', { url: url });
        }

        function sendFixRequest() {
          if (!activeFix || !activeFix.url) {
            logFix('warn', 'Manual fix clicked without URL');
            return;
          }

          activeFix.requestId = createRequestId();
          activeFix.extensionAcked = false;
          const linkMeta = classifyExpectedLink(activeFix.expectedLink);

          window.postMessage({
            source: 'banner-tester',
            type: 'CONTENT_QA_FIX_REQUEST',
            payload: {
              requestId: activeFix.requestId,
              url: activeFix.url,
              culture: activeFix.culture,
              expectedLink: activeFix.expectedLink,
              expectedTarget: activeFix.expectedTarget,
              linkType: linkMeta.linkType,
              requiresItemLookup: linkMeta.requiresItemLookup,
              expectedLinkDomain: linkMeta.expectedLinkDomain,
              scLang: activeFix.scLang || '',
              mode: 'manual'
            }
          }, window.location.origin);

          logFix('info', 'Sent fix request', { requestId: activeFix.requestId });
          setNote('Contacting Content QA extension...');

          activeFix.timeoutId = setTimeout(() => {
            if (activeFix && activeFix.extensionAcked) return;
            logFix('warn', 'Extension not detected; opening page');
            setNote('Extension not detected. Opening page so you can use Sitecore Developer Tools.');
            window.open(activeFix.url, '_blank', 'noopener');
            closeModal();
          }, 1500);
        }

        function handleExtensionStatus(message) {
          if (!message || message.source !== 'content-qa-extension') return;
          if (!activeFix || message.requestId !== activeFix.requestId) return;

          if (message.status === 'ack') {
            activeFix.extensionAcked = true;
            if (activeFix.timeoutId) {
              clearTimeout(activeFix.timeoutId);
              activeFix.timeoutId = null;
            }
            setNote('Extension connected. Working...');
            logFix('info', 'Extension acknowledged request');
            return;
          }

          if (message.status === 'progress') {
            if (message.detail) setNote(message.detail);
            logFix('info', 'Extension progress', { detail: message.detail });
            return;
          }

          if (message.status === 'needs-selection') {
            setNote('Multiple banners found. Open the Content QA extension popup to choose the correct component.');
            logFix('warn', 'Extension needs component selection');
            return;
          }

          if (message.status === 'complete') {
            if (message.detail) {
              setNote(message.detail);
              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  new Notification('Fix Applied', { body: message.detail });
                } catch (e) {
                  // ignore notification failures
                }
              }
            } else {
              setNote('Content Editor opened.');
            }
            logFix('info', 'Extension completed', { detail: message.detail });
            closeModal();
            return;
          }

          if (message.status === 'error') {
            setNote(message.error || 'Extension failed to complete the manual fix.');
            logFix('error', 'Extension error', { error: message.error });
          }
        }

        document.addEventListener('click', function(event) {
          const fixButton = event.target.closest('.btn-fix');
          if (fixButton) {
            openModal(fixButton);
            return;
          }

          if (event.target === closeBtn || event.target === modal) {
            closeModal();
          }
        });

        if (manualBtn) manualBtn.addEventListener('click', function() {
          logFix('info', 'Review clicked');
          sendFixRequest();
        });

        document.addEventListener('keydown', function(event) {
          if (event.key === 'Escape' && modal && modal.classList.contains('open')) {
            closeModal();
          }
        });

        window.addEventListener('message', function(event) {
          if (event.source !== window) return;
          handleExtensionStatus(event.data);
        });
      })();
    </script>

    <div class="footer">
      Generated by Melaleuca Unified Tester
    </div>
  </div>
  <button class="back-to-top" id="back-to-top" type="button">Top</button>

  <script>
    function canUseClipboardImage() {
      return window.isSecureContext && navigator.clipboard && typeof ClipboardItem !== 'undefined';
    }

    function showCopied(button) {
      const original = button.textContent;
      button.textContent = 'Copied!';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1500);
    }

    function showError(button) {
      const original = button.textContent;
      button.textContent = 'Failed';
      setTimeout(() => {
        button.textContent = original;
      }, 1500);
    }

    function fallbackCopyText(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      let success = false;
      try {
        success = document.execCommand('copy');
      } catch {
        success = false;
      }
      document.body.removeChild(textarea);
      return success;
    }

    function fallbackCopyImage(dataUrl) {
      return new Promise((resolve) => {
        const wrapper = document.createElement('div');
        wrapper.contentEditable = 'true';
        wrapper.style.position = 'fixed';
        wrapper.style.left = '-9999px';
        wrapper.style.opacity = '0';
        const img = new Image();
        img.onload = () => {
          wrapper.appendChild(img);
          document.body.appendChild(wrapper);
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(wrapper);
          selection.removeAllRanges();
          selection.addRange(range);
          let success = false;
          try {
            success = document.execCommand('copy');
          } catch {
            success = false;
          }
          selection.removeAllRanges();
          document.body.removeChild(wrapper);
          resolve(success);
        };
        img.onerror = () => resolve(false);
        img.src = dataUrl;
      });
    }

    async function copyText(t, button) {
      const text = decodeURIComponent(t);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          showCopied(button);
          return;
        }
      } catch {
        // fall through to execCommand fallback
      }

      const success = fallbackCopyText(text);
      if (success) {
        showCopied(button);
      } else {
        showError(button);
      }
    }

    async function copyImage(data, button) {
      const dataUrl = decodeURIComponent(data);
      if (canUseClipboardImage()) {
        try {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
          });
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(async (blob) => {
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              showCopied(button);
            } catch (err) {
              console.error('Clipboard write failed:', err);
              showError(button);
            }
          }, 'image/png');
          return;
        } catch (err) {
          console.error('Copy failed:', err);
        }
      }

      const success = await fallbackCopyImage(dataUrl);
      if (success) {
        showCopied(button);
      } else {
        showError(button);
      }
    }

    const validationButton = document.getElementById('open-validation-panel');
    const validationPanel = document.getElementById('validation-panel');
    const validationClose = document.getElementById('validation-panel-close');
    if (validationButton && validationPanel && validationClose) {
      validationButton.addEventListener('click', () => {
        validationPanel.classList.add('show');
        validationPanel.setAttribute('aria-hidden', 'false');
      });
      validationClose.addEventListener('click', () => {
        validationPanel.classList.remove('show');
        validationPanel.setAttribute('aria-hidden', 'true');
      });
    }

    const backToTop = document.getElementById('back-to-top');
    if (backToTop) {
      window.addEventListener('scroll', () => {
        backToTop.classList.toggle('show', window.scrollY > 400);
      });
      backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  </script>
</body>
</html>`;

  return { html, successCount: successBanners, name: (sorted[0]?.mainCategory || 'report') };
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

function stripDomain(value) {
  if (!value) return '';
  let link = String(value).trim();
  link = link.replace(/^https?:\/\/[^/]+/i, '');
  link = link.replace(/#.*$/, '');
  if (link.length > 1) {
    link = link.replace(/\/$/, '');
  }
  return link;
}

function isValidationFailure(validation) {
  if (!validation) return false;
  return validation.status === 'fail' || validation.status === 'not-found';
}

function buildGroupValidationSummary(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  let total = 0;
  let passed = 0;
  let failed = 0;
  let notFound = 0;

  groups.forEach((group) => {
    if (!group.validation) return;
    total += 1;
    if (group.validation.status === 'pass') {
      passed += 1;
    } else if (group.validation.status === 'not-found') {
      notFound += 1;
    } else {
      failed += 1;
    }
  });

  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

  return {
    total,
    passed,
    failed,
    notFound,
    passRate
  };
}

