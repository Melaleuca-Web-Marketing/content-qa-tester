// brandCTAWindows.js - Extract Brand CTA Windows data from PSLP

export async function extractBrandCTAWindowsData(page, selectors) {
  console.log('Extracting Brand CTA Windows data...');
  const brandCTAWindowsData = [];
  const sel = selectors.brandCTAWindows;
  const baseUrl = new URL(page.url()).origin;

  const ctaLinkElements = await page.$$(sel.link);

  for (const linkElement of ctaLinkElements) {
    const linkDirection = await linkElement.getAttribute('href');
    const newTab = (await linkElement.getAttribute('target')) === '_blank';

    const mobileImageStyle = await linkElement.$eval(sel.mobileImage, (div) => div.style.backgroundImage).catch(() => null);
    const mobileImage = mobileImageStyle ? normalizeUrl(mobileImageStyle.replace(/url\(['"]?(.*?)['"]?\)/, '$1'), baseUrl) : null;

    const desktopImageStyle = await linkElement.$eval(sel.desktopImage, (div) => div.style.backgroundImage).catch(() => null);
    const desktopImage = desktopImageStyle ? normalizeUrl(desktopImageStyle.replace(/url\(['"]?(.*?)['"]?\)/, '$1'), baseUrl) : null;

    const altText = (await linkElement.getAttribute('aria-label'))
      || (await linkElement.getAttribute('title'))
      || await linkElement.$eval('img', (img) => img.getAttribute('alt')).catch(() => null);

    brandCTAWindowsData.push({
      mobileImage: mobileImage,
      desktopImage: desktopImage,
      altText: altText ? altText.trim() : null,
      linkDirection: linkDirection,
      newTab: newTab
    });
  }

  return brandCTAWindowsData;
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
