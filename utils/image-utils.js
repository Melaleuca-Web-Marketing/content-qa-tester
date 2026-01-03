// utils/image-utils.js - Shared image processing utilities

/**
 * Detect the regional locale from an image URL
 * @param {string} imageSrc - The image source URL
 * @returns {string|null} - The detected region code (US, CA, MX, UK, etc.) or null
 */
export function detectImageLocale(imageSrc) {
  if (!imageSrc) return null;

  // Locale code to region mapping
  const localeMap = {
    'enus': 'US', 'en-us': 'US', 'esus': 'US', 'es-us': 'US',
    'enca': 'CA', 'en-ca': 'CA', 'frca': 'CA', 'fr-ca': 'CA',
    'esmx': 'MX', 'es-mx': 'MX',
    'engb': 'UK', 'en-gb': 'UK', 'enie': 'IE', 'en-ie': 'IE',
    'dede': 'DE', 'de-de': 'DE', 'plpl': 'PL', 'pl-pl': 'PL',
    'nlnl': 'NL', 'nl-nl': 'NL', 'ltlt': 'LT', 'lt-lt': 'LT',
    'uk': 'UK', 'ie': 'IE', 'de': 'DE', 'pl': 'PL', 'nl': 'NL', 'lt': 'LT'
  };

  const lowerSrc = imageSrc.toLowerCase();

  // Check each locale code against common URL patterns
  for (const [code, region] of Object.entries(localeMap)) {
    const patterns = [
      `-${code}-`, `_${code}_`, `/${code}/`,
      `-${code}.`, `_${code}.`, `--${code}.`, `--${code}-`
    ];

    if (patterns.some(pattern => lowerSrc.includes(pattern))) {
      return region;
    }
  }

  return null;
}
