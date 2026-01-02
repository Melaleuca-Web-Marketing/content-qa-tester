// mixinad-report.js - Generate HTML report for Mix-In Ad test results

import { config } from '../config.js';

export function generateMixInAdReport(results, captureDuration, theme = 'dark') {
  if (!results || !results.length) {
    throw new Error('No results found.');
  }

  const timestamp = new Date().toISOString();
  const successCount = results.filter(r => !r.error && !r.noAdsFound).length;
  const errorCount = results.filter(r => r.error).length;
  const noAdsCount = results.filter(r => r.noAdsFound).length;
  const environment = results[0]?.environment || 'Unknown';
  const durationText = captureDuration ? (captureDuration / 1000).toFixed(1) + 's' : 'N/A';
  const isDark = theme === 'dark';

  // Sort results
  const cultureOrder = {
    enus: 0, esus: 1, enca: 2, frca: 3, esmx: 4,
    ie: 5, uk: 6, de: 7, pl: 8, nl: 9, lt: 10,
  };
  const widthRank = Object.fromEntries(config.mixinad.widths.map((w, i) => [w, i]));

  const sorted = [...results].sort((a, b) => {
    const ca = cultureOrder[a.culture] ?? 99;
    const cb = cultureOrder[b.culture] ?? 99;
    if (ca !== cb) return ca - cb;
    const oa = Number(a.order ?? 999);
    const ob = Number(b.order ?? 999);
    if (oa !== ob) return oa - ob;
    // Sort by adIndex within same culture/category
    const ia = Number(a.adIndex ?? -1);
    const ib = Number(b.adIndex ?? -1);
    if (ia !== ib) return ia - ib;
    const wa = widthRank[a.width] ?? 99;
    const wb = widthRank[b.width] ?? 99;
    return wa - wb;
  });

  // Group by culture + category + adIndex
  const groupedItems = {};
  sorted.forEach((item) => {
    const groupKey = `${item.culture}|${item.category}|${item.mainCategory || ''}|${item.adIndex ?? 'none'}`;
    if (!groupedItems[groupKey]) {
      groupedItems[groupKey] = {
        culture: item.culture,
        category: item.category,
        mainCategory: item.mainCategory || '',
        adIndex: item.adIndex ?? null,
        domPosition: item.domPosition,
        items: [],
        href: item.href,
        target: item.target,
        imageLocale: item.imageLocale,
        imageAlt: item.imageAlt,
        url: item.url,
        hasError: false,
        noAdsFound: item.noAdsFound || false
      };
    }
    groupedItems[groupKey].items.push(item);
    if (item.error) groupedItems[groupKey].hasError = true;
    if (!item.error && !item.noAdsFound) {
      if (item.href) groupedItems[groupKey].href = item.href;
      if (item.imageLocale) groupedItems[groupKey].imageLocale = item.imageLocale;
      if (item.imageAlt) groupedItems[groupKey].imageAlt = item.imageAlt;
    }
  });

  const groups = Object.values(groupedItems);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mix-In Ad Test Report - ${new Date(timestamp).toLocaleString()}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg-primary:${isDark ? '#0f172a' : '#f0f2f5'};--bg-card:${isDark ? '#1e293b' : 'white'};--bg-card-header:${isDark ? '#334155' : '#f8fafc'};--bg-screenshot:${isDark ? '#334155' : '#f8fafc'};--text-primary:${isDark ? '#f1f5f9' : '#1a1a2e'};--text-secondary:${isDark ? '#94a3b8' : '#64748b'};--text-heading:${isDark ? '#f8fafc' : '#1e293b'};--border-color:${isDark ? '#475569' : '#e2e8f0'};--border-light:${isDark ? '#334155' : '#f1f5f9'};--mono-bg:${isDark ? '#475569' : '#f1f5f9'}}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;padding:20px}.container{max-width:1600px;margin:0 auto}.header{background:linear-gradient(135deg,#ec4899 0%,#db2777 100%);color:#fff;padding:30px 40px;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 20px rgba(236,72,153,.3)}.header h1{font-size:28px;font-weight:700;margin-bottom:12px}.header-meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;opacity:.95}.header-meta span{display:flex;align-items:center;gap:6px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.summary-card{background:var(--bg-card);padding:24px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'});text-align:center}.summary-card h3{font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}.summary-card .value{font-size:36px;font-weight:700}.summary-card .value.total{color:#ec4899}.summary-card .value.success{color:#10b981}.summary-card .value.error{color:#ef4444}.summary-card .value.none{color:#f59e0b}.summary-card .value.time{color:#8b5cf6;font-size:24px}.ad-card{background:var(--bg-card);border-radius:16px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}.ad-header{padding:20px 24px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}.ad-header h2{font-size:20px;font-weight:600;color:var(--text-heading)}.ad-header .culture-badge{background:#fbcfe8;color:#9f1239;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600}.status-badge{padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.status-badge.success{background:#d1fae5;color:#059669}.status-badge.error{background:#fee2e2;color:#dc2626}.status-badge.none-found{background:#fef3c7;color:#d97706}.status-badge.partial{background:#fef3c7;color:#d97706}.ad-body{padding:24px}.info-message{background:${isDark ? '#3b2817' : '#fefce8'};border:1px solid ${isDark ? '#78350f' : '#fef08a'};color:${isDark ? '#fbbf24' : '#a16207'};padding:16px 20px;border-radius:10px;margin-bottom:20px;font-weight:500}.error-message{background:${isDark ? '#3b1f1f' : '#fef2f2'};border:1px solid ${isDark ? '#7f1d1d' : '#fecaca'};color:${isDark ? '#f87171' : '#dc2626'};padding:16px 20px;border-radius:10px;margin-bottom:20px;font-weight:500}.ad-info{margin-bottom:24px}.ad-info table{width:100%;border-collapse:collapse}.ad-info th,.ad-info td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--border-light)}.ad-info th{width:130px;color:var(--text-secondary);font-weight:500;font-size:13px;text-transform:uppercase;letter-spacing:.3px}.ad-info td{color:var(--text-heading)}.ad-info td a{color:#ec4899;text-decoration:none;word-break:break-all}.ad-info td a:hover{text-decoration:underline}.ad-info .mono{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;background:var(--mono-bg);padding:2px 6px;border-radius:4px}.btn-copy{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#ec4899 0%,#db2777 100%);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;box-shadow:0 2px 8px rgba(236,72,153,.3)}.btn-copy:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(236,72,153,.4)}.btn-copy:active{transform:translateY(0)}.btn-copy.copied{background:linear-gradient(135deg,#10b981 0%,#059669 100%)}.screenshots-section{border-top:1px solid var(--border-color);padding-top:24px}.screenshots-section h3{font-size:14px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}.screenshots-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}.screenshot-item{background:var(--bg-screenshot);border:1px solid var(--border-color);border-radius:12px;overflow:hidden}.screenshot-item.error{border-color:${isDark ? '#7f1d1d' : '#fecaca'};background:${isDark ? '#3b1f1f' : '#fef2f2'}}.screenshot-header{padding:10px 12px;background:var(--bg-card);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-direction:column;gap:8px}.screenshot-item.error .screenshot-header{background:${isDark ? '#3b1f1f' : '#fef2f2'};border-bottom-color:${isDark ? '#7f1d1d' : '#fecaca'}}.screenshot-width{font-size:13px;font-weight:600;color:var(--text-heading)}.screenshot-error{padding:20px 12px;color:${isDark ? '#f87171' : '#dc2626'};font-size:12px;text-align:center}.screenshot-image{padding:8px}.screenshot-image img{width:100%;border-radius:8px;display:block}.footer{text-align:center;padding:24px;color:var(--text-secondary);font-size:13px}@media(max-width:992px){.screenshots-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:600px){.header{padding:24px}.header h1{font-size:24px}.header-meta{gap:12px}.ad-header{flex-direction:column;align-items:flex-start}.screenshots-grid{grid-template-columns:1fr}}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Mix-In Ad Test Report</h1>
      <div class="header-meta">
        <span><strong>Environment:</strong> ${environment === 'production' ? 'Production' : environment === 'uat' ? 'UAT' : 'Stage (Preview)'}</span>
        <span><strong>Total Captures:</strong> ${results.length}</span>
        <span><strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</span>
      </div>
    </div>

    <div class="summary">
      <div class="summary-card">
        <h3>Total Captures</h3>
        <div class="value total">${results.length}</div>
      </div>
      <div class="summary-card">
        <h3>Successful</h3>
        <div class="value success">${successCount}</div>
      </div>
      <div class="summary-card">
        <h3>Failed</h3>
        <div class="value error">${errorCount}</div>
      </div>
      <div class="summary-card">
        <h3>No Ads Found</h3>
        <div class="value none">${noAdsCount}</div>
      </div>
      <div class="summary-card">
        <h3>Duration</h3>
        <div class="value time">${durationText}</div>
      </div>
    </div>

    ${groups.map((group, groupIdx) => {
    const allErrors = group.items.every(i => i.error);
    const hasErrors = group.items.some(i => i.error);
    const isNoAds = group.noAdsFound;
    const statusClass = allErrors ? 'error' : isNoAds ? 'none-found' : hasErrors ? 'partial' : 'success';
    const statusText = allErrors ? 'Failed' : isNoAds ? 'No Ads' : hasErrors ? 'Partial' : 'Success';
    const targetText = group.target && group.target.toLowerCase() === '_blank' ? 'New Tab' : 'Same Tab';
    const adLabel = group.adIndex !== null ? ` - Mix-In Ad #${group.adIndex + 1}` : '';

    return `
    <div class="ad-card">
      <div class="ad-header">
        <div>
          <h2>${escapeHtml(group.category)} ${group.mainCategory ? `<span style="color: var(--text-secondary); font-weight: 400;">(${escapeHtml(group.mainCategory)})</span>` : ''}</h2>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="culture-badge">${escapeHtml(group.culture.toUpperCase())}</span>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="ad-body">
        ${isNoAds ? `
        <div class="info-message">
          No mix-in ads found on this category page.
        </div>
        ` : allErrors ? `
        <div class="error-message">
          All captures failed: ${escapeHtml(group.items[0]?.message || 'Mix-in ad not found or request failed')}
        </div>
        ` : `
        <div class="ad-info">
          <table>
            <tr>
              <th>Link</th>
              <td>
                <span class="mono">${escapeHtml(group.href || 'N/A')}</span>
                ${group.href ? `<button class="btn-copy" onclick="copyText('${encodeURIComponent(group.href)}', this)" style="margin-left: 12px;">Copy Link</button>` : ''}
              </td>
            </tr>
            <tr>
              <th>Target</th>
              <td>${targetText}</td>
            </tr>
            ${group.domPosition ? `
            <tr>
              <th>Position</th>
              <td>#${group.domPosition} in product grid</td>
            </tr>
            ` : ''}
            ${group.imageLocale ? `
            <tr>
              <th>Image Locale</th>
              <td>${escapeHtml(group.imageLocale)}</td>
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
          <div class="screenshots-grid">
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
                <img src="${item.image}" alt="Mix-In Ad at ${item.width}px">
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

    <div class="footer">
      Generated by Melaleuca Unified Tester
    </div>
  </div>

  <script>async function copyText(t,b){try{await navigator.clipboard.writeText(decodeURIComponent(t));showCopied(b)}catch(e){showError(b)}}async function copyImage(d,b){try{const dataUrl=decodeURIComponent(d);const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=dataUrl});const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);canvas.toBlob(async(blob)=>{try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);showCopied(b)}catch(e){console.error('Clipboard write failed:',e);showError(b)}},'image/png')}catch(e){console.error('Copy failed:',e);showError(b)}}function showCopied(b){const o=b.textContent;b.textContent='Copied!';b.classList.add('copied');setTimeout(()=>{b.textContent=o;b.classList.remove('copied')},1500)}function showError(b){const o=b.textContent;b.textContent='Failed';setTimeout(()=>{b.textContent=o},1500)}</script>
</body>
</html>`;

  return { html, successCount };
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
