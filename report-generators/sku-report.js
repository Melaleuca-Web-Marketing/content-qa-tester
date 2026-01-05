// sku-report.js - Generate HTML report for SKU test results

export function generateSkuReport(results, duration, theme = 'dark') {
  const timestamp = new Date().toISOString();
  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;

  const environment = results[0]?.environment || 'Unknown';
  const region = results[0]?.region || 'Unknown';
  const cultureList = [...new Set(results.map(r => r.culture).filter(Boolean))];
  const culture = cultureList.length === 0
    ? 'Unknown'
    : (cultureList.length === 1 ? cultureList[0] : `Multiple (${cultureList.join(', ')})`);
  const isDark = theme === 'dark';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SKU Test Report - ${new Date(timestamp).toLocaleString()}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}:root{--bg-primary:${isDark ? '#0f172a' : '#f0f2f5'};--bg-card:${isDark ? '#1e293b' : 'white'};--bg-card-header:${isDark ? '#334155' : '#f8fafc'};--bg-image:${isDark ? '#334155' : '#f8fafc'};--text-primary:${isDark ? '#f1f5f9' : '#1a1a2e'};--text-secondary:${isDark ? '#94a3b8' : '#64748b'};--text-heading:${isDark ? '#f8fafc' : '#1e293b'};--border-color:${isDark ? '#475569' : '#e2e8f0'};--border-light:${isDark ? '#334155' : '#f1f5f9'}}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;padding:20px}.container{max-width:1400px;margin:0 auto}.header{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#fff;padding:30px 40px;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 20px rgba(16,185,129,.3)}.header h1{font-size:28px;font-weight:700;margin-bottom:12px}.header-meta{display:flex;flex-wrap:wrap;gap:24px;font-size:14px;opacity:.95}.header-meta span{display:flex;align-items:center;gap:6px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.summary-card{background:var(--bg-card);padding:12px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'});text-align:center}.summary-card h3{font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}.summary-card .value{font-size:18px;font-weight:700}.summary-card .value.total{color:#3b82f6}.summary-card .value.success{color:#10b981}.summary-card .value.error{color:#ef4444}.summary-card .value.time{color:#8b5cf6;font-size:14px}.sku-card{background:var(--bg-card);border-radius:16px;margin-bottom:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${isDark ? '.3' : '.08'})}.sku-header{padding:20px 24px;background:var(--bg-card-header);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;gap:12px}.sku-header h2{font-size:20px;font-weight:600;color:var(--text-heading)}.sku-header .sku-number{color:var(--text-secondary);font-weight:400}.sku-header-meta{display:flex;align-items:center;gap:10px}.culture-badge{padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:#dbeafe;color:#1d4ed8;text-transform:uppercase}.status-badge{padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}.status-badge.success{background:#d1fae5;color:#059669}.status-badge.error{background:#fee2e2;color:#dc2626}.sku-body{padding:24px}.error-message{background:${isDark ? '#3b1f1f' : '#fef2f2'};border:1px solid ${isDark ? '#7f1d1d' : '#fecaca'};color:${isDark ? '#f87171' : '#dc2626'};padding:16px 20px;border-radius:10px;margin-bottom:20px;font-weight:500}.product-grid{display:grid;grid-template-columns:220px 1fr;gap:24px}@media(max-width:768px){.product-grid{grid-template-columns:1fr}.sku-header{flex-direction:column;align-items:flex-start}}.product-image{background:var(--bg-image);border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:center}.product-image img{max-width:100%;max-height:200px;object-fit:contain;border-radius:8px}.product-image .no-image{color:var(--text-secondary);font-size:14px}.product-info table{width:100%;border-collapse:collapse}.product-info th,.product-info td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--border-light)}.product-info th{width:130px;color:var(--text-secondary);font-weight:500;font-size:13px;text-transform:uppercase;letter-spacing:.3px}.product-info td{color:var(--text-heading)}.product-info td a{color:#3b82f6;text-decoration:none;word-break:break-all}.product-info td a:hover{text-decoration:underline}.cart-result{margin-top:20px;padding:16px 20px;border-radius:10px;display:flex;align-items:center;gap:12px}.cart-result.success{background:#d1fae5;color:#059669}.cart-result.error{background:#fee2e2;color:#dc2626}.cart-result strong{font-weight:600}.screenshot-section{margin-top:24px;border-top:1px solid var(--border-color);padding-top:24px}.screenshot-section h3{font-size:14px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}.screenshot-container{background:var(--bg-image);border:1px solid var(--border-color);border-radius:12px;padding:12px;max-height:600px;overflow:auto}.screenshot-container img{width:100%;border-radius:8px;display:block}.footer{text-align:center;padding:24px;color:var(--text-secondary);font-size:13px}.screenshot-toggle{background:var(--border-light);border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:var(--text-secondary);margin-bottom:12px;transition:background .2s}.screenshot-toggle:hover{background:var(--border-color)}.screenshot-content{display:none}.screenshot-content.expanded{display:block}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SKU Test Report</h1>
      <div class="header-meta">
        <span><strong>Environment:</strong> ${environment}</span>
        <span><strong>Region:</strong> ${region.toUpperCase()}</span>
        <span><strong>Culture:</strong> ${culture}</span>
        <span><strong>Generated:</strong> ${new Date(timestamp).toLocaleString()}</span>
      </div>
    </div>

    <div class="summary">
      <div class="summary-card">
        <h3>Total SKUs</h3>
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
        <h3>Duration</h3>
        <div class="value time">${duration ? (duration / 1000).toFixed(1) + 's' : 'N/A'}</div>
      </div>
    </div>

    ${results.map((r, idx) => `
    <div class="sku-card">
      <div class="sku-header">
        <h2>${escapeHtml(r.data?.name || 'Unknown Product')} <span class="sku-number">(SKU: ${r.sku})</span></h2>
        <div class="sku-header-meta">
          <span class="culture-badge">${escapeHtml((r.culture || 'N/A').toUpperCase())}</span>
          <span class="status-badge ${r.success ? 'success' : 'error'}">
            ${r.success ? 'Success' : 'Failed'}
          </span>
        </div>
      </div>
      <div class="sku-body">
        ${r.error ? `<div class="error-message">${escapeHtml(r.error)}</div>` : ''}

        ${r.data ? `
        <div class="product-grid">
          <div class="product-image">
            ${r.data.image
        ? `<img src="${escapeHtml(r.data.image)}" alt="Product Image">`
        : '<div class="no-image">No image available</div>'}
          </div>
          <div class="product-info">
            <table>
              <tr>
                <th>Name</th>
                <td>${escapeHtml(r.data.name || 'N/A')}</td>
              </tr>
              <tr>
                <th>Item #</th>
                <td>${escapeHtml(r.data.itemNumber || r.sku)}</td>
              </tr>
              <tr>
                <th>Price</th>
                <td>${escapeHtml(r.data.price || 'N/A')}</td>
              </tr>
              <tr>
                <th>Description</th>
                <td>${escapeHtml(r.data.description || 'N/A')}</td>
              </tr>
              <tr>
                <th>Savings</th>
                <td>${escapeHtml(r.data.savings || 'N/A')}</td>
              </tr>
              <tr>
                <th>Images</th>
                <td>${formatImages(r.data.images)}</td>
              </tr>
              <tr>
                <th>URL</th>
                <td><a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(r.url)}</a></td>
              </tr>
              <tr>
                <th>Timestamp</th>
                <td>${escapeHtml(r.timestamp)}</td>
              </tr>
            </table>

            ${r.addToCartResult ? `
            <div class="cart-result ${r.addToCartResult.success ? 'success' : 'error'}">
              <strong>Add to Cart:</strong>
              <span>${r.addToCartResult.success
          ? escapeHtml(r.addToCartResult.message || 'Success')
          : escapeHtml(r.addToCartResult.error || 'Failed')}</span>
            </div>
            ` : ''}
            ${renderContentChecks(r.data)}
          </div>
        </div>
        ` : ''}

        ${r.screenshot ? `
        <div class="screenshot-section">
          <h3>${r.screenshotType === 'top' ? 'PDP Top Section Screenshot' : 'Full PDP Screenshot'}</h3>
          <button class="screenshot-toggle" onclick="toggleScreenshot(${idx})">
            Show/Hide Screenshot
          </button>
          <div class="screenshot-content" id="screenshot-${idx}">
            <div class="screenshot-container">
              <img src="${r.screenshot}" alt="PDP Screenshot">
            </div>
          </div>
        </div>
        ` : ''}
      </div>
    </div>
    `).join('')}

    <div class="footer">
      Generated by Melaleuca Unified Tester
    </div>
  </div>

  <script>function toggleScreenshot(i){document.getElementById('screenshot-'+i).classList.toggle('expanded')}document.addEventListener('DOMContentLoaded',function(){const f=document.getElementById('screenshot-0');if(f)f.classList.add('expanded')})</script>
</body>
</html>`;

  return { html, name: 'sku-report' };
}

function formatImages(images) {
  if (!images || images.length === 0) return 'N/A';
  const typeOrder = { Hero: 1, Glamour: 2, Label: 3, Other: 4 };
  const sorted = [...images].sort((a, b) => {
    const orderA = typeOrder[a.type] || 99;
    const orderB = typeOrder[b.type] || 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.filename.localeCompare(b.filename);
  });

  return sorted
    .map((img) => `${escapeHtml(img.type)}: ${escapeHtml(img.filename)}`)
    .join('<br>');
}

function renderContentChecks(data) {
  if (!data) return '';

  const checks = [];
  if (typeof data.aboutHasContent === 'boolean') {
    checks.push({
      label: 'About Content',
      ok: data.aboutHasContent,
      message: data.aboutHasContent ? 'Long Description or PDP found.' : 'Missing content'
    });
  }

  if (typeof data.ingredientsHasContent === 'boolean') {
    let detail = 'Missing ingredient label or smart ingredients';
    if (data.ingredientsHasContent) {
      if (data.ingredientsHasLabel && data.ingredientsHasSmartIngredients) {
        detail = 'Ingredient label + smart ingredients';
      } else if (data.ingredientsHasLabel) {
        detail = 'Ingredient label';
      } else if (data.ingredientsHasSmartIngredients) {
        detail = 'Smart ingredients';
      } else {
        detail = 'Ingredients present';
      }
    }

    checks.push({
      label: 'Ingredients',
      ok: data.ingredientsHasContent,
      message: detail
    });
  }

  if (checks.length === 0) return '';

  return checks.map((check) => `
            <div class="cart-result ${check.ok ? 'success' : 'error'}">
              <strong>${escapeHtml(check.label)}:</strong>
              <span>${escapeHtml(check.message)}</span>
            </div>
  `).join('');
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
