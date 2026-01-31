// seasonalCarousel.js - Extract Seasonal Carousel data from PSLP


const shouldLogPslp = (() => {
  const raw = process.env.PSLP_DIAGNOSTICS || process.env.TESTER_LOG_LEVEL || process.env.LOG_LEVEL || '';
  return String(raw).toLowerCase() === 'debug'
    || ['1', 'true', 'yes', 'on', 'verbose'].includes(String(process.env.PSLP_DIAGNOSTICS || '').toLowerCase());
})();

const logPslp = (...args) => {
  if (shouldLogPslp) console.log(...args);
};

export async function extractSeasonalCarouselData(page, selectors) {
  logPslp('Extracting Seasonal Carousel data...');
  const seasonalCarouselData = [];
  const sel = selectors.seasonalCarousel;
  const baseUrl = new URL(page.url()).origin;

  let slideElements = await page.$$(sel.slide);
  if (slideElements.length === 0) {
    slideElements = await page.$$('.o-seasonalCarousel__slide');
  }

  for (const slideElement of slideElements) {
    const isCloned = await slideElement.evaluate((el) => {
      const parent = el.closest('.slick-slide');
      return parent ? parent.classList.contains('slick-cloned') : false;
    });
    if (isCloned) {
      continue;
    }

    const mobileImageSource = await slideElement.$eval(sel.mobileImage, (img) => img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src')).catch(() => null);
    const desktopImageSource = await slideElement.$eval(sel.desktopImage, (img) => img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src')).catch(() => null);
    const altText = await slideElement.$eval(sel.mobileImage, (img) => img.getAttribute('alt')).catch(() => null)
      || await slideElement.$eval(sel.desktopImage, (img) => img.getAttribute('alt')).catch(() => null);

    const skus = await slideElement.$$eval(sel.productCard, (cards) =>
      cards.map(card => card.getAttribute('data-productid'))
    );

    seasonalCarouselData.push({
      mobileImage: normalizeUrl(mobileImageSource, baseUrl),
      desktopImage: normalizeUrl(desktopImageSource, baseUrl),
      altText: altText ? altText.trim() : null,
      skus: skus
    });
  }

  return seasonalCarouselData;
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
