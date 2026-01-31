// heroCarousel.js - Extract Hero Carousel data from PSLP


const shouldLogPslp = (() => {
  const raw = process.env.PSLP_DIAGNOSTICS || process.env.TESTER_LOG_LEVEL || process.env.LOG_LEVEL || '';
  return String(raw).toLowerCase() === 'debug'
    || ['1', 'true', 'yes', 'on', 'verbose'].includes(String(process.env.PSLP_DIAGNOSTICS || '').toLowerCase());
})();

const logPslp = (...args) => {
  if (shouldLogPslp) console.log(...args);
};

export async function extractHeroCarouselData(page, selectors) {
  logPslp('Extracting Hero Carousel data...');
  const carouselData = [];
  const sel = selectors.heroCarousel;
  const baseUrl = new URL(page.url()).origin;

  const slides = await page.$$(sel.slide);

  for (const slideElement of slides) {
    const linkElement = await slideElement.$(sel.link);
    const linkDirection = linkElement
      ? (await linkElement.getAttribute('href'))
      || (await linkElement.getAttribute('data-correct-href'))
      || (await linkElement.getAttribute('data-href'))
      : null;
    const newTab = linkElement ? (await linkElement.getAttribute('target')) === '_blank' : false;

    const mobileImageSource = await getSourceValue(slideElement, sel.mobileImage, baseUrl);
    const tabletImageSource = await getSourceValue(slideElement, sel.tabletImage, baseUrl);
    const desktopImageSource = await getSourceValue(slideElement, sel.desktopImage, baseUrl);
    const fallbackImage = await getImageFallback(slideElement, baseUrl);
    const altText = await getImageAlt(slideElement);

    const item = {
      mobileImage: mobileImageSource || fallbackImage,
      tabletImage: tabletImageSource || fallbackImage,
      desktopImage: desktopImageSource || fallbackImage,
      altText,
      linkDirection: linkDirection,
      newTab: newTab
    };

    if (item.linkDirection || item.mobileImage || item.desktopImage) {
      carouselData.push(item);
    }
  }

  return carouselData;
}

async function getSourceValue(root, selector, baseUrl) {
  if (!selector) return null;
  const srcset = await root.$eval(selector, (source) => source.getAttribute('srcset') || source.getAttribute('data-srcset')).catch(() => null);
  const url = pickSrcsetUrl(srcset);
  return normalizeUrl(url, baseUrl);
}

async function getImageFallback(root, baseUrl) {
  const image = await root.$('img');
  if (!image) return null;
  const src = (await image.getAttribute('data-src')) || (await image.getAttribute('src'));
  const srcset = (await image.getAttribute('data-srcset')) || (await image.getAttribute('srcset'));
  return normalizeUrl(src || pickSrcsetUrl(srcset), baseUrl);
}

async function getImageAlt(root) {
  const image = await root.$('img');
  if (!image) return null;
  const alt = await image.getAttribute('alt');
  return alt ? alt.trim() : null;
}

function pickSrcsetUrl(srcset) {
  if (!srcset) return null;
  const parts = srcset.split(',')
    .map((entry) => entry.trim().split(' ')[0])
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
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
