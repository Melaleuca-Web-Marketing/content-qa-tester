// featuredCategories.js - Extract Featured Categories data from PSLP

export async function extractFeaturedCategoriesData(page, selectors) {
  console.log('Extracting Featured Categories data...');
  const featuredCategoriesData = [];
  const sel = selectors.featuredCategories;
  const baseUrl = new URL(page.url()).origin;

  const categoryListItems = await page.$$(sel.item);

  for (const itemElement of categoryListItems) {
    const linkElement = await itemElement.$(sel.card);
    if (!linkElement) {
      console.warn('Could not find link element for a featured category.');
      continue;
    }

    const linkDirection = (await linkElement.getAttribute('href'))
      || (await linkElement.getAttribute('data-correct-href'))
      || (await linkElement.getAttribute('data-href'));

    const imageInfo = await linkElement.$eval(sel.image, (img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
      return {
        src,
        srcset,
        alt: img.getAttribute('alt') || ''
      };
    }).catch(() => null);

    const imageSource = normalizeUrl(imageInfo?.src || pickSrcsetUrl(imageInfo?.srcset), baseUrl);
    const altText = imageInfo?.alt?.trim() || null;

    featuredCategoriesData.push({
      image: imageSource,
      altText,
      linkDirection: linkDirection
    });
  }

  return featuredCategoriesData;
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
