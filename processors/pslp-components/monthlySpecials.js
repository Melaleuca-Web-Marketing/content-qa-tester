// monthlySpecials.js - Extract Monthly Specials data from PSLP

export async function extractMonthlySpecialsData(page, selectors) {
  console.log('========================================');
  console.log('Extracting Monthly Specials data...');
  const monthlySpecialsData = [];

  if (!selectors || !selectors.monthlySpecials) {
    console.error('ERROR: Missing monthlySpecials selectors in config', selectors);
    return [];
  }

  const sel = selectors.monthlySpecials;
  console.log('Using Monthly Specials selectors:', JSON.stringify(sel, null, 2));

  const baseUrl = new URL(page.url()).origin;
  const seenKeys = new Set();

  // Check if monthly specials component exists
  const componentExists = await page.$('.o-monthlySpecial, .preComponentLoader.-monthlySpecial');
  if (!componentExists) {
    console.log('Monthly Specials component not found on page');
    return monthlySpecialsData;
  }
  console.log('Monthly Specials component found on page');

  const componentRoot = await page.$('.o-monthlySpecial') || componentExists;
  try {
    await componentRoot.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
  } catch {
    // Ignore scroll issues
  }

  const slideSelector = sel.slide || '.o-monthlySpecial__slide';
  const dotSelector = sel.dot || '.o-monthlySpecial__dot';
  const cardSelector = sel.card;
  const imageSelector = sel.image;

  console.log('Monthly Specials selectors resolved:', {
    slideSelector,
    dotSelector,
    cardSelector,
    imageSelector
  });

  if (cardSelector) {
    const cardFound = await page.waitForSelector(cardSelector, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    console.log(`Card selector "${cardSelector}" present: ${cardFound} `);
  } else {
    console.log('Card selector is empty or undefined.');
  }

  const debugSnapshot = await page.evaluate((data) => {
    const {
      slideSelector,
      dotSelector,
      cardSelector,
      imageSelector,
      altCardSelectors
    } = data;

    const component = document.querySelector('.o-monthlySpecial');
    const slides = Array.from(document.querySelectorAll(slideSelector));
    const dots = Array.from(document.querySelectorAll(dotSelector));
    const list = document.querySelector('.o-monthlySpecial__list');

    const altCounts = {};
    altCardSelectors.forEach((selector) => {
      altCounts[selector] = selector ? document.querySelectorAll(selector).length : 0;
    });

    const slideSummaries = slides.map((slide, index) => {
      const cards = cardSelector ? slide.querySelectorAll(cardSelector) : [];
      const nestedIndexEl = slide.querySelector('[data-slide-index]');
      const dataSlideIndex = nestedIndexEl?.getAttribute('data-slide-index') || slide.getAttribute('data-slide-index');
      const firstCard = cards[0];

      return {
        index: index + 1,
        ariaHidden: slide.getAttribute('aria-hidden'),
        dataSlideIndex,
        dataTestId: slide.getAttribute('data-testid'),
        childCount: slide.children.length,
        cardCount: cards.length,
        firstCardTag: firstCard?.tagName || null,
        firstCardClasses: firstCard?.className || null,
        firstCardHtml: firstCard?.outerHTML?.slice(0, 300) || null
      };
    });

    const componentCardCount = cardSelector ? document.querySelectorAll(cardSelector).length : 0;

    return {
      componentFound: Boolean(component),
      listFound: Boolean(list),
      listChildCount: list ? list.children.length : 0,
      slideCount: slides.length,
      dotCount: dots.length,
      componentCardCount,
      altCardCounts: altCounts,
      slideSummaries,
      componentHtmlSnippet: component?.outerHTML?.slice(0, 400) || null,
      imageSelectorSampleCount: imageSelector ? document.querySelectorAll(imageSelector).length : 0
    };
  }, {
    slideSelector,
    dotSelector,
    cardSelector,
    imageSelector,
    altCardSelectors: [
      '.m-mscProductCard',
      '.o-monthlySpecial__cards article',
      '.o-monthlySpecial__slide article'
    ]
  });

  console.log('Monthly Specials DOM snapshot', JSON.stringify(debugSnapshot, null, 2));

  const extractCardData = async (cardElement, slideIndex) => {
    let imageElement = null;
    try {
      if (sel.image) {
        imageElement = await cardElement.$(sel.image);
      } else {
        console.warn('sel.image is falsy:', sel.image);
      }
    } catch (e) {
      console.error('Error querying image element:', e);
      console.error('sel.image value:', sel.image);
      throw e;
    }

    const linkElement = await cardElement.$('a');
    const linkDirection = linkElement
      ? (await linkElement.getAttribute('href'))
      || (await linkElement.getAttribute('data-correct-href'))
      || (await linkElement.getAttribute('data-href'))
      : null;

    let sku = null;
    let name = null;
    let imageUrl = null;
    let altText = null;

    if (imageElement) {
      const imageInfo = await imageElement.evaluate((img) => ({
        currentSrc: img.currentSrc || '',
        src: img.getAttribute('src') || '',
        dataSrc: img.getAttribute('data-src') || '',
        srcset: img.getAttribute('srcset') || '',
        dataSrcset: img.getAttribute('data-srcset') || '',
        alt: img.getAttribute('alt') || ''
      }));

      const srcsetUrl = pickSrcsetUrl(imageInfo.dataSrcset || imageInfo.srcset);
      const rawUrl = imageInfo.currentSrc || imageInfo.src || imageInfo.dataSrc || srcsetUrl;
      imageUrl = normalizeUrl(rawUrl, baseUrl);
      altText = imageInfo.alt?.trim() || null;
      name = altText;

      const match = imageUrl ? imageUrl.match(/global\/products\/(\d+)h-0*1/i) : null;
      if (match && match[1]) {
        sku = match[1];
      }
    } else {
      console.log(`  No image element found for card on slide ${slideIndex} `);
    }

    const key = `${slideIndex || ''}| ${sku || ''}| ${imageUrl || ''}| ${linkDirection || ''} `;
    if (key === '|||' || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    monthlySpecialsData.push({ sku, name, linkDirection, imageUrl, altText, slideIndex });
  };

  const collectCards = async (rootElement, fallbackIndex) => {
    if (!rootElement) {
      console.log('  No root element provided to collectCards');
      return;
    }
    const productCards = cardSelector ? await rootElement.$$(cardSelector) : [];
    console.log(`  Found ${productCards.length} product cards in slide ${fallbackIndex} `);
    if (productCards.length === 0) {
      const slideDebug = await rootElement.evaluate((el) => ({
        className: el.className || '',
        dataSlideIndex: el.getAttribute('data-slide-index'),
        dataTestId: el.getAttribute('data-testid'),
        articleCount: el.querySelectorAll('article').length,
        cardCount: el.querySelectorAll('.m-mscProductCard').length,
        imgCount: el.querySelectorAll('img').length,
        htmlSnippet: el.outerHTML ? el.outerHTML.slice(0, 300) : null
      })).catch(() => null);
      if (slideDebug) {
        console.log('  Slide debug', JSON.stringify(slideDebug, null, 2));
      }
      return;
    }

    const slideIndex = await rootElement.$eval('[data-slide-index]', (el) => el.getAttribute('data-slide-index'))
      .catch(() => null)
      || (fallbackIndex ? String(fallbackIndex) : null);
    console.log(`  Slide index: ${slideIndex} `);

    for (const cardElement of productCards) {
      await extractCardData(cardElement, slideIndex);
    }
  };

  console.log(`Looking for slides with selector: ${slideSelector} `);
  const slides = await page.$$(slideSelector);
  console.log(`Found ${slides.length} total slides`);

  // Log slide visibility
  for (let i = 0; i < slides.length; i++) {
    const isVisible = await slides[i].isVisible().catch(() => false);
    const ariaHidden = await slides[i].getAttribute('aria-hidden');
    console.log(`  Slide ${i + 1}: aria - hidden="${ariaHidden}", isVisible = ${isVisible} `);
  }

  // Check if stacking CSS is applied (all slides visible)
  const isStacked = await page.evaluate(() => {
    const stackingStyle = document.getElementById('pslp-carousel-stack');
    return stackingStyle !== null;
  });
  console.log(`Stacking CSS applied: ${isStacked} `);

  const dots = await page.$$(dotSelector);
  console.log(`Found ${dots.length} dots using selector: ${dotSelector}`);

  if (dots.length > 0) {
    console.log(`Processing ${dots.length} dots to render each slide`);
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const dotMeta = await dot.evaluate((el) => ({
        ariaLabel: el.getAttribute('aria-label'),
        dataIndex: el.getAttribute('data-index'),
        dataPage: el.getAttribute('data-page'),
        dataActive: el.getAttribute('data-active'),
        className: el.className || ''
      })).catch(() => ({}));
      console.log(`Clicking dot ${i + 1}/${dots.length}`, JSON.stringify(dotMeta));

      await dot.evaluate((el) => el.click()).catch(() => { });
      await page.waitForTimeout(700);

      const activeSlide = await page.$(`${slideSelector}[aria-hidden="false"]`);
      if (!activeSlide) {
        console.log(`  No active slide found after clicking dot ${i + 1}`);
        continue;
      }

      const activeMeta = await activeSlide.evaluate((el) => ({
        className: el.className || '',
        ariaHidden: el.getAttribute('aria-hidden'),
        dataSlideIndex: el.getAttribute('data-slide-index'),
        dataTestId: el.getAttribute('data-testid'),
        htmlSnippet: el.outerHTML ? el.outerHTML.slice(0, 200) : null
      })).catch(() => ({}));
      console.log(`  Active slide after click`, JSON.stringify(activeMeta));

      const fallbackIndex = dotMeta.dataIndex ? String(Number(dotMeta.dataIndex) + 1) : String(i + 1);
      await collectCards(activeSlide, fallbackIndex);
    }
  } else if (slides.length > 0) {
    console.log('No dots found; processing slides directly');
    for (let i = 0; i < slides.length; i++) {
      await collectCards(slides[i], i + 1);
    }
  }

  console.log(`Extracted ${monthlySpecialsData.length} monthly specials products total`);
  console.log('========================================');
  return monthlySpecialsData;
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
