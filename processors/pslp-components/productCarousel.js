// productCarousel.js - Extract Product Carousel data from PSLP


const shouldLogPslp = (() => {
  const raw = process.env.PSLP_DIAGNOSTICS || process.env.TESTER_LOG_LEVEL || process.env.LOG_LEVEL || '';
  return String(raw).toLowerCase() === 'debug'
    || ['1', 'true', 'yes', 'on', 'verbose'].includes(String(process.env.PSLP_DIAGNOSTICS || '').toLowerCase());
})();

const logPslp = (...args) => {
  if (shouldLogPslp) console.log(...args);
};

export async function extractProductCarouselData(page, selectors) {
  logPslp('Extracting Product Carousel data...');
  const productSkus = [];
  const sel = selectors.productCarousel;

  const container = await page.$('[data-testid="container-productCarousel"], .o-productCarouselVue');
  if (container) {
    await container.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(800);
  }

  if (sel.card) {
    await page.waitForSelector(sel.card, { timeout: 10000 }).catch(() => {});
  }

  const productCards = await page.$$(sel.card);

  for (const cardElement of productCards) {
    const sku = (await cardElement.getAttribute('data-sku'))
      || (await cardElement.getAttribute('data-opt-sku'))
      || (await cardElement.getAttribute('data-productid'));
    if (sku && !productSkus.includes(sku)) {
      productSkus.push(sku);
    }
  }

  return { skus: productSkus };
}
