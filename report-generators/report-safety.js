// report-safety.js - URL and image guards for generated HTML reports

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function safeHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

export function safeImageSrc(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (options.allowData === true) {
    const dataMatch = raw.match(/^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i);
    if (dataMatch) {
      return `data:image/${dataMatch[1].toLowerCase()};base64,${dataMatch[2].replace(/\s+/g, '')}`;
    }
  }

  return safeHttpUrl(raw);
}

export function renderExternalLink(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return options.empty ?? 'N/A';

  const label = options.label ?? raw;
  const safeUrl = safeHttpUrl(raw);
  const classAttr = options.className ? ` class="${escapeHtml(options.className)}"` : '';
  if (!safeUrl) {
    return `<span${classAttr}>${escapeHtml(label)}</span>`;
  }

  return `<a${classAttr} href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function renderExternalImage(value, altText = '', options = {}) {
  const safeSrc = safeImageSrc(value, options);
  if (!safeSrc) return options.empty ?? '';

  const classAttr = options.className ? ` class="${escapeHtml(options.className)}"` : '';
  const extraAttrs = options.attrs ? ` ${options.attrs}` : '';
  return `<img${classAttr} src="${escapeHtml(safeSrc)}" alt="${escapeHtml(altText)}"${extraAttrs}>`;
}
