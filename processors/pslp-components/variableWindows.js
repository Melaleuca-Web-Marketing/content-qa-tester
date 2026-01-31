// variableWindows.js - Extract Variable Windows data from PSLP


const shouldLogPslp = (() => {
  const raw = process.env.PSLP_DIAGNOSTICS || process.env.TESTER_LOG_LEVEL || process.env.LOG_LEVEL || '';
  return String(raw).toLowerCase() === 'debug'
    || ['1', 'true', 'yes', 'on', 'verbose'].includes(String(process.env.PSLP_DIAGNOSTICS || '').toLowerCase());
})();

const logPslp = (...args) => {
  if (shouldLogPslp) console.log(...args);
};

export async function extractVariableWindowsData(page, selectors) {
  logPslp('Extracting Variable Windows data...');
  const windowsData = [];
  const sel = selectors.variableWindows;
  const baseUrl = new URL(page.url()).origin;

  const windowElements = await page.$$(sel.window);

  for (const windowElement of windowElements) {
    const linkElement = await windowElement.$(sel.anchor);
    if (!linkElement) {
      console.warn('Could not find link element for a variable window.');
      continue;
    }

    const linkDirection = await linkElement.getAttribute('href');
    const newTab = (await linkElement.getAttribute('target')) === '_blank';

    const mobileImageStyle = await windowElement.$eval(sel.mobileImage, (div) => div.style.backgroundImage).catch(() => null);
    const mobileImage = mobileImageStyle ? normalizeUrl(mobileImageStyle.replace(/url\(['"]?(.*?)['"]?\)/, '$1'), baseUrl) : null;

    const desktopImageStyle = await windowElement.$eval(sel.desktopImage, (div) => div.style.backgroundImage).catch(() => null);
    const desktopImage = desktopImageStyle ? normalizeUrl(desktopImageStyle.replace(/url\(['"]?(.*?)['"]?\)/, '$1'), baseUrl) : null;

    const altText = (await linkElement.getAttribute('aria-label'))
      || (await linkElement.getAttribute('title'))
      || await windowElement.$eval('img', (img) => img.getAttribute('alt')).catch(() => null);

    windowsData.push({
      mobileImage: mobileImage,
      desktopImage: desktopImage,
      altText: altText ? altText.trim() : null,
      linkDirection: linkDirection,
      newTab: newTab
    });
  }

  return windowsData;
}

function normalizeUrl(url, baseUrl) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    return trimmed;
  }
}
