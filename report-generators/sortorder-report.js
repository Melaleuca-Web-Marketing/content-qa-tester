// sortorder-report.js - Generate HTML report for default category order capture results

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeRows(results) {
  return Array.isArray(results) ? results : [];
}

function buildGroupKey(result) {
  return [
    result.culture || '',
    result.mainCategory || '',
    result.category || '',
    result.width || ''
  ].join('|');
}

function buildGroupAnchorId(group, index) {
  const raw = [
    group?.culture || '',
    group?.mainCategory || '',
    group?.category || '',
    group?.width || ''
  ].join('-');
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `category-${index + 1}-${slug || 'section'}`;
}

function formatPrice(product) {
  if (product?.memberPriceText) return String(product.memberPriceText).trim();
  if (Number.isFinite(product?.memberPrice)) return `$${product.memberPrice}`;
  return '';
}

function formatPoints(product) {
  if (product?.pointsText) return String(product.pointsText).trim();
  if (Number.isFinite(product?.points)) return `${product.points}`;
  return '';
}

function sanitizeCssValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  // Allow common computed-style formats only.
  if (!/^[#(),.%/\w\s-]+$/.test(text)) return '';
  return text;
}

function buildStampInlineStyle(stampStyle) {
  if (!stampStyle || typeof stampStyle !== 'object') return '';
  const stylePairs = [
    ['background-color', sanitizeCssValue(stampStyle.backgroundColor)],
    ['color', sanitizeCssValue(stampStyle.color)],
    ['border-color', sanitizeCssValue(stampStyle.borderColor)],
    ['border-width', sanitizeCssValue(stampStyle.borderWidth)],
    ['border-style', sanitizeCssValue(stampStyle.borderStyle)],
    ['border-radius', sanitizeCssValue(stampStyle.borderRadius)],
    ['font-size', sanitizeCssValue(stampStyle.fontSize)],
    ['font-weight', sanitizeCssValue(stampStyle.fontWeight)],
    ['text-transform', sanitizeCssValue(stampStyle.textTransform)],
    ['letter-spacing', sanitizeCssValue(stampStyle.letterSpacing)],
    ['padding-top', sanitizeCssValue(stampStyle.paddingTop)],
    ['padding-right', sanitizeCssValue(stampStyle.paddingRight)],
    ['padding-bottom', sanitizeCssValue(stampStyle.paddingBottom)],
    ['padding-left', sanitizeCssValue(stampStyle.paddingLeft)]
  ].filter(([, value]) => Boolean(value));

  return stylePairs.map(([key, value]) => `${key}:${value}`).join(';');
}

function renderStampBadge(product) {
  const stampText = String(product?.stamp || '').trim();
  if (!stampText) return '';
  const inlineStyle = buildStampInlineStyle(product?.stampStyle);
  const styleAttr = inlineStyle ? ` style="${escapeHtml(inlineStyle)}"` : '';
  return `<span class="stamp-chip"${styleAttr}>${escapeHtml(stampText)}</span>`;
}

function renderValidationBlock(validation, isDark) {
  if (!validation || validation.pass === null || validation.pass === undefined) return '';

  const status = validation.pass ? 'pass' : 'fail';
  const statusText = validation.pass ? 'VALIDATION PASSED' : 'VALIDATION FAILED';
  const normalizedMessage = String(validation.message || '').trim().toLowerCase();
  const showMessage = Boolean(normalizedMessage) && ![
    'business rules passed',
    'business rules failed',
    'validation passed',
    'validation failed'
  ].includes(normalizedMessage);
  const rules = Array.isArray(validation.rules) ? validation.rules : [];
  // In a failed validation block, show only failed rules to avoid mixing pass messaging in an error context.
  const visibleRules = status === 'fail'
    ? rules.filter((rule) => rule && rule.pass === false)
    : rules;

  return `
    <div class="validation-box ${status}">
      <div class="validation-head">
        <span class="validation-pill ${status}">${statusText}</span>
        ${showMessage ? `<span class="validation-msg">${escapeHtml(validation.message)}</span>` : ''}
      </div>
      ${visibleRules.length > 0 ? `
        <div class="validation-rules">
          ${visibleRules.map((rule) => {
    const violations = Array.isArray(rule?.details?.violations) ? rule.details.violations : [];
    return `
              <div class="validation-rule ${rule?.pass ? 'pass' : 'fail'}">
                <div class="validation-rule-title">
                  ${escapeHtml(rule?.title || rule?.id || 'Rule')}
                </div>
                <div class="validation-rule-msg">
                  ${escapeHtml(rule?.message || '')}
                </div>
                ${!rule?.pass && violations.length > 0 ? `
                  <div class="validation-rule-violations">
                    ${violations.slice(0, 6).map((v) => `
                      <div class="validation-rule-violation">
                        #${escapeHtml(v.position ?? '')}
                        ${v.familyId ? ` | Family ${escapeHtml(v.familyId)}` : ''}
                        ${v.name ? ` | ${escapeHtml(v.name)}` : ''}
                        ${v.expectedGroup ? ` | Expected: ${escapeHtml(v.expectedGroup)}` : ''}
                        ${v.actualGroup ? ` | Found: ${escapeHtml(v.actualGroup)}` : ''}
                        ${v.higherPriorityPosition ? ` | Should be before #${escapeHtml(v.higherPriorityPosition)}` : ''}
                      </div>
                    `).join('')}
                    ${violations.length > 6 ? `<div class="validation-rule-more">+${violations.length - 6} more</div>` : ''}
                  </div>
                ` : ''}
              </div>
            `;
  }).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

export function generateSortOrderReport(results, captureDuration, theme = 'dark') {
  const rows = normalizeRows(results);
  if (rows.length === 0) {
    throw new Error('No results found.');
  }

  const isDark = theme === 'dark';
  const timestamp = new Date().toISOString();
  const environment = rows[0]?.environment || 'Unknown';
  const durationText = captureDuration ? `${(captureDuration / 1000).toFixed(1)}s` : 'N/A';

  const sorted = [...rows].sort((a, b) => {
    const cultureA = String(a.culture || '');
    const cultureB = String(b.culture || '');
    if (cultureA !== cultureB) return cultureA.localeCompare(cultureB);
    const orderA = Number.isFinite(a.order) ? a.order : 9999;
    const orderB = Number.isFinite(b.order) ? b.order : 9999;
    if (orderA !== orderB) return orderA - orderB;
    const widthA = Number.isFinite(a.width) ? a.width : 9999;
    const widthB = Number.isFinite(b.width) ? b.width : 9999;
    return widthA - widthB;
  });

  const groupsMap = new Map();
  sorted.forEach((result) => {
    const key = buildGroupKey(result);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        culture: result.culture || '',
        mainCategory: result.mainCategory || '',
        category: result.category || '',
        width: result.width || '',
        url: result.url || '',
        captures: []
      });
    }
    groupsMap.get(key).captures.push(result);
  });
  const groups = Array.from(groupsMap.values());

  const totalCaptures = sorted.length;
  const successfulCaptures = sorted.filter((r) => !r.error).length;
  const failedCaptures = sorted.filter((r) => r.error).length;
  const passedValidations = sorted.filter((r) => !r.error && r.validation?.pass === true).length;
  const failedValidations = sorted.filter((r) => !r.error && r.validation?.pass === false).length;
  const groupsWithAnchors = groups.map((group, index) => {
    const captures = Array.isArray(group.captures) ? group.captures : [];
    const captureRuleFailCount = captures.filter((capture) => !capture?.error && capture?.validation?.pass === false).length;
    const ruleViolationCount = captures.reduce((sum, capture) => {
      if (capture?.error || capture?.validation?.pass !== false) return sum;
      const rules = Array.isArray(capture?.validation?.rules) ? capture.validation.rules : [];
      return sum + rules.filter((rule) => rule?.pass === false).length;
    }, 0);
    const categoryPath = group.mainCategory
      ? `${group.mainCategory} > ${group.category}`
      : (group.category || 'Category');
    return {
      ...group,
      categoryPath,
      cultureText: String(group.culture || '').toUpperCase(),
      anchorId: buildGroupAnchorId(group, index),
      hasRuleFailure: captureRuleFailCount > 0,
      captureRuleFailCount,
      ruleViolationCount
    };
  });
  const categoriesWithRuleFailures = groupsWithAnchors.filter((group) => group.hasRuleFailure).length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Category Default Order Report - ${new Date(timestamp).toLocaleString()}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-primary: ${isDark ? '#0f172a' : '#f0f2f5'};
      --bg-card: ${isDark ? '#1e293b' : '#ffffff'};
      --bg-card-header: ${isDark ? '#334155' : '#f8fafc'};
      --text-primary: ${isDark ? '#f1f5f9' : '#1a1a2e'};
      --text-secondary: ${isDark ? '#94a3b8' : '#64748b'};
      --text-heading: ${isDark ? '#f8fafc' : '#1e293b'};
      --border: ${isDark ? '#475569' : '#e2e8f0'};
      --accent: #0ea5e9;
      --ok: #10b981;
      --error: #ef4444;
      --link: ${isDark ? '#7dd3fc' : '#0f4c81'};
      --link-hover: ${isDark ? '#bae6fd' : '#0b3a61'};
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
      padding: 20px;
    }
    .container { max-width: 1600px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
      color: white;
      padding: 28px 34px;
      border-radius: 14px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(14, 165, 233, 0.25);
    }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 14px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .summary-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      text-align: center;
    }
    .summary-card h3 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .summary-card .value { font-size: 24px; font-weight: 700; }
    .value.ok { color: var(--ok); }
    .value.error { color: var(--error); }
    .value.accent { color: var(--accent); }
    .report-layout {
      display: grid;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .report-content {
      min-width: 0;
    }
    .category-nav {
      position: sticky;
      top: 14px;
      align-self: start;
      max-height: calc(100vh - 28px);
      overflow: auto;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
    }
    .category-nav-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.35px;
      color: var(--text-secondary);
      margin-bottom: 10px;
    }
    .category-nav-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .category-nav-link {
      display: block;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid transparent;
      text-decoration: none;
      background: ${isDark ? 'rgba(148, 163, 184, 0.08)' : '#f8fafc'};
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .category-nav-link:hover,
    .category-nav-link:focus {
      border-color: ${isDark ? 'rgba(125, 211, 252, 0.65)' : '#7dd3fc'};
      background: ${isDark ? 'rgba(14, 165, 233, 0.15)' : '#e0f2fe'};
      outline: none;
    }
    .category-nav-link.fail {
      border-color: ${isDark ? 'rgba(248, 113, 113, 0.55)' : '#fca5a5'};
      background: ${isDark ? 'rgba(239, 68, 68, 0.18)' : '#fef2f2'};
    }
    .category-nav-link.fail:hover,
    .category-nav-link.fail:focus {
      border-color: ${isDark ? 'rgba(252, 165, 165, 0.9)' : '#ef4444'};
      background: ${isDark ? 'rgba(239, 68, 68, 0.24)' : '#fee2e2'};
    }
    .category-nav-link.active {
      border-color: ${isDark ? 'rgba(125, 211, 252, 0.9)' : '#0284c7'};
      background: ${isDark ? 'rgba(14, 165, 233, 0.2)' : '#dbeafe'};
      box-shadow: inset 0 0 0 1px ${isDark ? 'rgba(125, 211, 252, 0.45)' : 'rgba(2, 132, 199, 0.25)'};
    }
    .category-nav-link.fail.active {
      border-color: ${isDark ? 'rgba(252, 165, 165, 0.95)' : '#dc2626'};
      background: ${isDark ? 'rgba(239, 68, 68, 0.28)' : '#fee2e2'};
      box-shadow: inset 0 0 0 1px ${isDark ? 'rgba(252, 165, 165, 0.45)' : 'rgba(220, 38, 38, 0.2)'};
    }
    .category-nav-label {
      display: block;
      color: var(--text-primary);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
    }
    .category-nav-meta {
      display: block;
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .category-nav-fail {
      display: inline-block;
      margin-top: 5px;
      border-radius: 999px;
      border: 1px solid ${isDark ? 'rgba(248, 113, 113, 0.85)' : '#ef4444'};
      background: ${isDark ? 'rgba(127, 29, 29, 0.45)' : '#fee2e2'};
      color: ${isDark ? '#fecaca' : '#991b1b'};
      padding: 1px 7px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.35px;
      line-height: 1.35;
    }
    .group {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
      scroll-margin-top: 18px;
    }
    .group:target {
      border-color: ${isDark ? 'rgba(14,165,233,0.75)' : '#38bdf8'};
      box-shadow: 0 0 0 2px ${isDark ? 'rgba(14,165,233,0.30)' : 'rgba(56,189,248,0.25)'};
    }
    .group-header {
      background: var(--bg-card-header);
      border-bottom: 1px solid var(--border);
      padding: 14px 16px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
    }
    .group-title { font-size: 19px; color: var(--text-heading); }
    .group-meta { color: var(--text-secondary); font-size: 13px; }
    a, a:visited {
      color: var(--link);
      text-decoration-color: var(--link);
    }
    a:hover, a:focus {
      color: var(--link-hover);
      text-decoration-color: var(--link-hover);
    }
    .group-body { padding: 14px 16px 18px; }
    .capture-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-bottom: 12px;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .error-box {
      border: 1px solid rgba(239, 68, 68, 0.5);
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      font-size: 13px;
    }
    .section-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--text-secondary);
      margin: 10px 0 8px;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }
    th { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; }
    tr.ad-row td {
      background: ${isDark ? 'rgba(14, 165, 233, 0.12)' : 'rgba(14, 165, 233, 0.10)'};
    }
    .type-pill {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .type-pill.product {
      background: ${isDark ? 'rgba(16,185,129,0.2)' : '#d1fae5'};
      color: ${isDark ? '#34d399' : '#047857'};
    }
    .type-pill.ad {
      background: ${isDark ? 'rgba(14,165,233,0.2)' : '#e0f2fe'};
      color: ${isDark ? '#38bdf8' : '#0369a1'};
    }
    .stamp-chip {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid #dc2626;
      background: #fee2e2;
      color: #991b1b;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      padding: 2px 8px;
      line-height: 1.2;
      white-space: nowrap;
    }
    .status-chip {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid #ef4444;
      background: rgba(239, 68, 68, 0.18);
      color: ${isDark ? '#fca5a5' : '#991b1b'};
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      padding: 2px 8px;
      line-height: 1.2;
      white-space: nowrap;
    }
    .validation-box {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 12px;
      background: ${isDark ? 'rgba(148, 163, 184, 0.08)' : '#f8fafc'};
    }
    .validation-box.pass {
      border-color: ${isDark ? 'rgba(16,185,129,0.5)' : '#86efac'};
      background: ${isDark ? 'rgba(16,185,129,0.10)' : '#ecfdf5'};
    }
    .validation-box.fail {
      border-color: ${isDark ? 'rgba(239,68,68,0.55)' : '#fca5a5'};
      background: ${isDark ? 'rgba(239,68,68,0.12)' : '#fef2f2'};
    }
    .validation-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 6px;
    }
    .validation-pill {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.35px;
    }
    .validation-pill.pass {
      background: ${isDark ? 'rgba(16,185,129,0.25)' : '#bbf7d0'};
      color: ${isDark ? '#6ee7b7' : '#166534'};
    }
    .validation-pill.fail {
      background: ${isDark ? 'rgba(239,68,68,0.25)' : '#fecaca'};
      color: ${isDark ? '#fca5a5' : '#991b1b'};
    }
    .validation-msg {
      font-size: 12px;
      color: var(--text-secondary);
    }
    .validation-rules {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .validation-rule {
      border-top: 1px dashed var(--border);
      padding-top: 6px;
    }
    .validation-rule-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-heading);
    }
    .validation-rule-msg {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .validation-rule-violations {
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .validation-rule-violation,
    .validation-rule-more {
      font-size: 11px;
      color: ${isDark ? '#fca5a5' : '#991b1b'};
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      word-break: break-word;
    }
    .thumb {
      width: 56px;
      height: 56px;
      object-fit: contain;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: ${isDark ? '#0f172a' : '#ffffff'};
      display: block;
    }
    .thumb-placeholder {
      width: 56px;
      height: 56px;
      border-radius: 6px;
      border: 1px dashed var(--border);
      color: var(--text-secondary);
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .footer {
      margin-top: 20px;
      text-align: center;
      color: var(--text-secondary);
      font-size: 12px;
    }
    @media (max-width: 1100px) {
      .report-layout {
        grid-template-columns: 1fr;
      }
      .category-nav {
        position: static;
        max-height: none;
      }
      .category-nav-list {
        max-height: 240px;
        overflow: auto;
      }
    }
  </style>
</head>
<body>
  <div class="container" id="report-top">
    <div class="header">
      <h1>Category Default Order Report</h1>
      <div class="meta">
        <span><strong>Environment:</strong> ${escapeHtml(environment)}</span>
        <span><strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</span>
        <span><strong>Duration:</strong> ${escapeHtml(durationText)}</span>
      </div>
    </div>

    <div class="summary">
      <div class="summary-card"><h3>Total Captures</h3><div class="value accent">${totalCaptures}</div></div>
      <div class="summary-card"><h3>Successful</h3><div class="value ok">${successfulCaptures}</div></div>
      <div class="summary-card"><h3>Failed</h3><div class="value error">${failedCaptures}</div></div>
      <div class="summary-card"><h3>Rule Pass</h3><div class="value ok">${passedValidations}</div></div>
      <div class="summary-card"><h3>Validation Fail</h3><div class="value error">${failedValidations}</div></div>
    </div>

    <div class="report-layout">
      <aside class="category-nav" aria-label="Category navigation">
        <div class="category-nav-title">Jump To Category</div>
        ${categoriesWithRuleFailures > 0 ? `<div class="category-nav-meta">${escapeHtml(categoriesWithRuleFailures)} categories with validation failures</div>` : ''}
        <div class="category-nav-list">
          <a class="category-nav-link" href="#report-top">
            <span class="category-nav-label">Top of report</span>
          </a>
          ${groupsWithAnchors.map((group) => {
    const failLabel = group.hasRuleFailure
      ? `<span class="category-nav-fail">Validation Fail${group.ruleViolationCount > 1 ? ` (${group.ruleViolationCount})` : ''}</span>`
      : '';
    return `
            <a class="category-nav-link ${group.hasRuleFailure ? 'fail' : ''}" href="#${escapeHtml(group.anchorId)}">
              <span class="category-nav-label">${escapeHtml(group.categoryPath)}</span>
              <span class="category-nav-meta">${escapeHtml(group.cultureText)}</span>
              ${failLabel}
            </a>
          `;
  }).join('')}
        </div>
      </aside>

      <div class="report-content">
    ${groupsWithAnchors.map((group) => {
    const safeUrl = escapeHtml(group.url || '');

    return `
      <div class="group" id="${escapeHtml(group.anchorId)}">
        <div class="group-header">
          <div>
            <div class="group-title">${escapeHtml(group.categoryPath)}</div>
            <div class="group-meta">${escapeHtml(group.cultureText)}</div>
          </div>
          <div class="group-meta">${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open category page</a>` : ''}</div>
        </div>
        <div class="group-body">
          ${group.captures.map((capture, idx) => {
      const showAll = capture.showAll?.initial || {};
      const products = Array.isArray(capture.products) ? capture.products : [];
      const mixinAds = Array.isArray(capture.mixinAds) ? capture.mixinAds : [];
      const showAllText = `${showAll.beforeCount ?? 0} -> ${showAll.afterCount ?? 0} (clicks: ${showAll.clicks ?? 0})`;
      const orderedItems = [
        ...products.map((product) => ({
          type: 'product',
          position: Number(product.position) || 0,
          product
        })),
        ...mixinAds.map((ad) => ({
          type: 'ad',
          position: Number(ad.position) || 0,
          ad
        }))
      ].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        if (a.type === b.type) return 0;
        return a.type === 'product' ? -1 : 1;
      });

      if (capture.error) {
        return `
            <div class="capture-meta">Capture ${idx + 1}</div>
            <div class="error-box">${escapeHtml(capture.message || 'Capture failed')}</div>
          `;
      }

      return `
            <div class="capture-meta">
              <span><strong>Capture:</strong> ${idx + 1}</span>
              <span><strong>Products:</strong> ${escapeHtml(capture.productCount ?? 0)}</span>
              <span><strong>Mix-In Ads:</strong> ${escapeHtml(capture.mixinAdCount ?? 0)}</span>
            </div>
            ${renderValidationBlock(capture.validation, isDark)}

            <div class="section-title">Sort Order (Products + Mix-In Ads)</div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Image</th>
                  <th>Name</th>
                  <th>Family ID</th>
                  <th>Stamp</th>
                  <th>Status</th>
                  <th>Price</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                ${orderedItems.length > 0
            ? orderedItems.map((item) => {
              if (item.type === 'ad') {
                const ad = item.ad || {};
                const imageSrc = ad.imageSrc || '';
                const adTitle = escapeHtml(ad.title || '(Untitled mix-in ad)');
                const adName = ad.href
                  ? `<a href="${escapeHtml(ad.href)}" target="_blank" rel="noopener noreferrer">${adTitle}</a>`
                  : adTitle;
                return `
                  <tr class="ad-row">
                    <td>${escapeHtml(ad.position ?? '')}</td>
                    <td><span class="type-pill ad">Mix-In Ad</span></td>
                    <td>
                      ${imageSrc
                    ? `<img class="thumb" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(ad.imageAlt || ad.title || '')}">`
                    : '<div class="thumb-placeholder">No image</div>'}
                    </td>
                    <td>${adName}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                `;
              }

              const product = item.product || {};
              const imageSrc = product.imageSrc || '';
              const imageAlt = product.imageAlt || product.name || product.title || '';
              const productName = escapeHtml(product.name || product.title || '');
              const nameWithLink = product.href
                ? `<a href="${escapeHtml(product.href)}" target="_blank" rel="noopener noreferrer">${productName}</a>`
                : productName;

              return `
                  <tr>
                    <td>${escapeHtml(product.position ?? '')}</td>
                    <td><span class="type-pill product">Product</span></td>
                    <td>
                      ${imageSrc
                    ? `<img class="thumb" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(imageAlt)}">`
                    : '<div class="thumb-placeholder">No image</div>'}
                    </td>
                    <td>${nameWithLink}</td>
                    <td>${escapeHtml(product.familyId || '')}</td>
                    <td>${renderStampBadge(product)}</td>
                    <td>${product.soldOut ? `<span class="status-chip">${escapeHtml(product.soldOutText || 'Sold Out')}</span>` : ''}</td>
                    <td>${escapeHtml(formatPrice(product))}</td>
                    <td>${escapeHtml(formatPoints(product))}</td>
                  </tr>
                `;
            }).join('')
            : `
                  <tr>
                    <td colspan="9">No products captured.</td>
                  </tr>
                `}
              </tbody>
            </table>
          `;
    }).join('')}
        </div>
      </div>
    `;
  }).join('')}
      </div>
    </div>

    <div class="footer">
      Generated by Melaleuca Content QA Tester
    </div>
  </div>
  <script>
    (() => {
      const navLinks = Array.from(document.querySelectorAll('.category-nav-link[href^="#"]'));
      if (navLinks.length === 0) return;

      const groups = Array.from(document.querySelectorAll('.group[id]'));
      const linkByHash = new Map(navLinks.map((link) => [link.getAttribute('href'), link]));

      const setActive = (hash) => {
        navLinks.forEach((link) => link.classList.remove('active'));
        const activeLink = linkByHash.get(hash);
        if (activeLink) activeLink.classList.add('active');
      };

      const updateActiveFromScroll = () => {
        if (window.scrollY < 120) {
          setActive('#report-top');
          return;
        }

        const threshold = window.innerHeight * 0.22;
        let activeGroup = groups[0] || null;
        for (const group of groups) {
          if (group.getBoundingClientRect().top - threshold <= 0) {
            activeGroup = group;
          } else {
            break;
          }
        }

        if (activeGroup && activeGroup.id) {
          setActive('#' + activeGroup.id);
        }
      };

      navLinks.forEach((link) => {
        link.addEventListener('click', () => {
          const hash = link.getAttribute('href');
          if (hash) setActive(hash);
        });
      });

      window.addEventListener('scroll', updateActiveFromScroll, { passive: true });
      window.addEventListener('resize', updateActiveFromScroll);
      updateActiveFromScroll();
    })();
  </script>
</body>
</html>`;

  const firstName = sorted[0]?.mainCategory || sorted[0]?.category || 'sort-order';
  return { html, name: firstName };
}

