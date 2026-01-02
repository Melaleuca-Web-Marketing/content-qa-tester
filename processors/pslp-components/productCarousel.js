// productCarousel.js - Extract Product Carousel data from PSLP

export async function extractProductCarouselData(page, selectors) {
  console.log('Extracting Product Carousel data...');
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
