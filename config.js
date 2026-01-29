// config.js - Unified Configuration for SKU and Banner Tester

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CATEGORIES_PATH = join(__dirname, 'categories.json');
const TEMPLATE_CATEGORIES_PATH = join(__dirname, 'categories.template.json');

export function getCategoriesPath() {
  const envPath = process.env.CATEGORIES_PATH;
  if (!envPath) return DEFAULT_CATEGORIES_PATH;
  return isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath);
}

export function getCategoriesTemplatePath() {
  return TEMPLATE_CATEGORIES_PATH;
}

// Load categories from external JSON file
function loadCategories() {
  try {
    const categoriesPath = getCategoriesPath();
    const categoriesData = JSON.parse(readFileSync(categoriesPath, 'utf8'));
    const source = categoriesData && categoriesData.data ? categoriesData.data : categoriesData;

    // Transform JSON format to config format
    const transformed = {};
    for (const [region, categories] of Object.entries(source || {})) {
      transformed[region] = Object.entries(categories).map(([name, items]) => ({
        name,
        items
      }));
    }
    return transformed;
  } catch (err) {
    try {
      const categoriesData = JSON.parse(readFileSync(TEMPLATE_CATEGORIES_PATH, 'utf8'));
      const source = categoriesData && categoriesData.data ? categoriesData.data : categoriesData;
      const transformed = {};
      for (const [region, categories] of Object.entries(source || {})) {
        transformed[region] = Object.entries(categories).map(([name, items]) => ({
          name,
          items
        }));
      }
      return transformed;
    } catch (templateErr) {
      console.warn('Could not load categories file, using defaults:', err.message);
    }
    // Return default categories if file doesn't exist
    return getDefaultCategories();
  }
}

function getDefaultCategories() {
  return {
    'US & Canada': [
      {
        name: 'Supplements',
        items: [
          { label: 'Show All', path: '/productstore/supplements' }
        ]
      }
    ]
  };
}

// Load categories at module load time
const loadedCategories = loadCategories();

export const config = {
  // Category version for tracking hot-reload
  _categoryVersion: 0,

  // ============ SHARED CONFIGURATION ============
  environments: {
    production: {
      us: "https://www.melaleuca.com",
      ca: "https://ca.melaleuca.com",
      mx: "https://mx.melaleuca.com",
      uk: "https://uk.melaleuca.com",
      ie: "https://ie.melaleuca.com",
      de: "https://de.melaleuca.com",
      lt: "https://lt.melaleuca.com",
      nl: "https://nl.melaleuca.com",
      pl: "https://pl.melaleuca.com"
    },
    stage: {
      us: "https://productstore2-us-preview.melaleuca.com",
      ca: "https://productstore2-ca-preview.melaleuca.com",
      mx: "https://productstore2-mx-preview.melaleuca.com",
      uk: "https://productstore2-uk-preview.melaleuca.com",
      ie: "https://productstore2-ie-preview.melaleuca.com",
      de: "https://productstore2-de-preview.melaleuca.com",
      lt: "https://productstore2-lt-preview.melaleuca.com",
      nl: "https://productstore2-nl-preview.melaleuca.com",
      pl: "https://productstore2-pl-preview.melaleuca.com"
    },
    uat: {
      us: "https://productstore2-uatus.melaleuca.com",
      ca: "https://productstore2-uatca.melaleuca.com",
      mx: "https://productstore2-uatmx.melaleuca.com",
      uk: "https://productstore2-uatuk.melaleuca.com",
      ie: "https://productstore2-uatie.melaleuca.com",
      de: "https://productstore2-uatde.melaleuca.com",
      lt: "https://productstore2-uatlt.melaleuca.com",
      nl: "https://productstore2-uatl.melaleuca.com",
      pl: "https://productstore2-uatpl.melaleuca.com"
    }
  },

  regions: {
    us: {
      name: "United States",
      cultures: ["en-US", "es-US"]
    },
    ca: {
      name: "Canada",
      cultures: ["en-CA", "fr-CA"]
    },
    mx: {
      name: "Mexico",
      cultures: ["es-MX"]
    },
    uk: {
      name: "United Kingdom",
      cultures: ["en-GB"]
    },
    ie: {
      name: "Ireland",
      cultures: ["en-IE"]
    },
    de: {
      name: "Germany",
      cultures: ["de-DE"]
    },
    lt: {
      name: "Lithuania",
      cultures: ["lt-LT"]
    },
    nl: {
      name: "Netherlands",
      cultures: ["nl-NL"]
    },
    pl: {
      name: "Poland",
      cultures: ["pl-PL"]
    }
  },

  cultureNames: {
    "en-US": "English (US)",
    "es-US": "Spanish (US)",
    "en-CA": "English (CA)",
    "fr-CA": "French (CA)",
    "es-MX": "Spanish (MX)",
    "en-GB": "English (UK)",
    "en-IE": "English (IE)",
    "de-DE": "German",
    "lt-LT": "Lithuanian",
    "nl-NL": "Dutch",
    "pl-PL": "Polish"
  },

  // ============ SKU TESTER CONFIGURATION ============
  sku: {
    timeouts: {
      pageLoad: 30000,
      addToCart: 5000,
      shelfAppear: 10000,
      imageLoad: 15000,
      screenshotDelay: 2000,
      betweenSkus: 1000,
      loginWait: 10000
    },

    selectors: {
      // Product page selectors
      productName: ".o-productDetails__heading",
      productPrice: ".m-productDetailPrice__primaryPrice",
      productImage: ".m-prodMedia__image",
      productImages: ".o-productDetails img",
      productDescription: ".o-productDetails__desc",
      itemNumber: ".o-productDetails__details",
      productSavings: ".o-productDetails .text-red, .o-productDetails .text-red strong",
      pdpTopSection: "#section-pdp-top, .o-productDetails",
      aboutSection: "#section-pdp-about",
      ingredientsSection: "#section-pdp-ingredients",
      addToCartButton: ".m-cartAddConfig__btn button.a-button",
      cartShelf: ".o-cartShelf, .o-shelf.-isVisible",
      addedToCartMessage: ".o-cartShelf__header, .m-shelfConfirm__heading span[role='text']",
      errorMessage: ".m-cartAddConfig__error",
      closeShelfButton: ".o-cartShelf__close, .o-shelf__close button, [data-testid='button-closeX']",
      configuratorList: ".o-configuratorAcc__list",
      configuratorOptionButton: ".m-refinerImage, .m-refinerSwatch, .a-pill",
      configuratorSelectedOption: ".o-configuratorAcc__item.-selected, .o-configuratorAcc__item.-active, .m-refinerImage.-selected, .m-refinerImage.-active, .m-refinerImage[aria-pressed='true'], .m-refinerImage[aria-selected='true'], .m-refinerSwatch.-selected, .m-refinerSwatch.-active, .m-refinerSwatch[aria-pressed='true'], .m-refinerSwatch[aria-selected='true'], .a-pill.-selected, .a-pill.-active, .a-pill[aria-pressed='true'], .a-pill[aria-selected='true']",
      configuratorAccordionToggle: ".o-configuratorAcc .o-accordion__toggler[aria-expanded]",
      // Login selectors (home page)
      homePageSignInButton: "a.a-authorBtn",
      // Login selectors (sign in form page)
      loginUsernameField: "[data-testid='username-input']",
      loginPasswordField: "[data-testid='password-input']",
      loginSubmitButton: "[data-testid='signIn-button']",
      loginErrorMessage: "[data-testid='invalidCredential-container']:not(.hidden)",
      loggedInIndicator: ".m-headerAccount__name"
    },

    loginPath: "/Account/Login",

    defaults: {
      environment: "production",
      region: "us",
      culture: "en-US",
      fullScreenshot: true,
      topScreenshot: false,
      addToCart: false
    }
  },

  // ============ BANNER TESTER CONFIGURATION ============
  banner: {
    widths: [320, 415, 576, 768, 992, 1210],

    selector: '[data-testid="link-fullWidthBanner"], .m-fwBanner',

    timeouts: {
      singleCapture: 90000,
      totalCapture: 1800000,
      pageLoad: 3000,
      bannerWait: 500,
      betweenCaptures: 500
    },

    browser: {
      captureHeight: 1800
    },

    // Mobile emulation defaults (used for small widths to match DevTools)
    mobileEmulation: {
      enabled: true,
      widths: [320, 415],
      deviceScaleFactor: 2,
      userAgent: ''
    },

    // Culture code mapping for URL lang parameter
    cultureLangMap: {
      "enus": "en-US",
      "esus": "es-US",
      "enca": "en-CA",
      "frca": "fr-CA",
      "esmx": "es-MX",
      "ie": "en-IE",
      "uk": "en-GB",
      "de": "de-DE",
      "pl": "pl-PL",
      "nl": "nl-NL",
      "lt": "lt-LT"
    },

    // Host mapping by environment and culture
    hostMap: {
      stage: {
        enus: "productstore2-us-preview.melaleuca.com",
        esus: "productstore2-us-preview.melaleuca.com",
        enca: "productstore2-ca-preview.melaleuca.com",
        frca: "productstore2-ca-preview.melaleuca.com",
        esmx: "productstore2-mx-preview.melaleuca.com",
        ie: "productstore2-ie-preview.melaleuca.com",
        uk: "productstore2-uk-preview.melaleuca.com",
        de: "productstore2-de-preview.melaleuca.com",
        pl: "productstore2-pl-preview.melaleuca.com",
        nl: "productstore2-nl-preview.melaleuca.com",
        lt: "productstore2-lt-preview.melaleuca.com"
      },
      uat: {
        enus: "productstore2-uatus.melaleuca.com",
        esus: "productstore2-uatus.melaleuca.com",
        enca: "productstore2-uatca.melaleuca.com",
        frca: "productstore2-uatca.melaleuca.com",
        esmx: "productstore2-uatmx.melaleuca.com",
        ie: "productstore2-uatie.melaleuca.com",
        uk: "productstore2-uatuk.melaleuca.com",
        de: "productstore2-uatde.melaleuca.com",
        pl: "productstore2-uatpl.melaleuca.com",
        nl: "productstore2-uatnl.melaleuca.com",
        lt: "productstore2-uatlt.melaleuca.com"
      },
      production: {
        enus: "www.melaleuca.com",
        esus: "www.melaleuca.com",
        enca: "ca.melaleuca.com",
        frca: "ca.melaleuca.com",
        esmx: "mx.melaleuca.com",
        ie: "ie.melaleuca.com",
        uk: "uk.melaleuca.com",
        de: "de.melaleuca.com",
        pl: "pl.melaleuca.com",
        nl: "nl.melaleuca.com",
        lt: "lt.melaleuca.com"
      }
    },

    // Banner regions with cultures and categories
    regions: {
      usca: {
        name: "US & Canada",
        cultures: [
          { code: "enus", label: "en-US" },
          { code: "esus", label: "es-US" },
          { code: "enca", label: "en-CA" },
          { code: "frca", label: "fr-CA" }
        ],
        categories: loadedCategories['US & Canada'] || []
      },
      mx: {
        name: "Mexico",
        cultures: [{ code: "esmx", label: "es-MX" }],
        categories: loadedCategories['Mexico'] || []
      },
      ukeu: {
        name: "UK & Europe",
        cultures: [
          { code: "ie", label: "Ireland" },
          { code: "uk", label: "UK" },
          { code: "de", label: "Germany" },
          { code: "pl", label: "Poland" },
          { code: "nl", label: "Netherlands" },
          { code: "lt", label: "Lithuania" }
        ],
        categories: loadedCategories['Europe'] || []
      }
    },

    // Default values
    defaults: {
      environment: 'stage',
      region: 'usca',
      widths: [320, 768, 1210]
    }
  },

  // ============ PSLP TESTER CONFIGURATION ============
  pslp: {
    screenWidths: [320, 415, 576, 768, 992, 1210],

    components: [
      'heroCarousel',
      'variableWindows',
      'fullWidthBanner',
      'monthlySpecials',
      'featuredCategories',
      'seasonalCarousel',
      'brandCTAWindows',
      'productCarousel'
    ],

    componentNames: {
      heroCarousel: 'Hero Carousel',
      variableWindows: 'Variable Windows',
      fullWidthBanner: 'Full Width Banner',
      monthlySpecials: 'Monthly Specials',
      featuredCategories: 'Featured Categories',
      seasonalCarousel: 'Seasonal Carousel',
      brandCTAWindows: 'Brand CTA Windows',
      productCarousel: 'Product Carousel'
    },

    selectors: {
      login: {
        homePageSignInButton: "a.a-authorBtn",
        username: "[data-testid='username-input']",
        password: "[data-testid='password-input']",
        loginButton: "[data-testid='signIn-button']",
        errorMessage: "[data-testid='invalidCredential-container']:not(.hidden)"
      },
      modal: {
        dialog: "[role='dialog']",
        closeButton: "[aria-label='Close'], button.close"
      },
      heroCarousel: {
        slide: '.o-heroCarousel .slick-slide:not(.slick-cloned)',
        link: '.m-fwBanner',
        desktopImage: 'source[media*="1024px"]',
        tabletImage: 'source[media*="768px"]',
        mobileImage: 'source[media*="575px"]'
      },
      variableWindows: {
        window: '.m-varWindow',
        anchor: '.m-varWindow__anchor',
        mobileImage: '.m-varWindow__image.-mobile',
        desktopImage: '.m-varWindow__image.-desktop'
      },
      fullWidthBanner: {
        link: '[data-testid="link-fullWidthBanner"], .m-fwBanner',
        desktopImage: 'source[media*="1024px"]',
        tabletImage: 'source[media*="768px"]',
        mobileImage: 'source[media*="575px"]'
      },
      monthlySpecials: {
        slide: '.o-monthlySpecial__slide',
        card: '.m-mscProductCard',
        dot: 'button[data-testid="button-monthlySpecialDot"], .o-monthlySpecial__dot',
        image: 'img'
      },
      featuredCategories: { item: '.o-categorySection__listItem', card: '.m-categoryCard', image: 'img' },
      seasonalCarousel: { slide: '.o-seasonalCarousel__slide', productCard: '.m-seasonalProdCard', mobileImage: '.o-seasonalSlide__image.-mobile', desktopImage: '.o-seasonalSlide__image.-desktop' },
      brandCTAWindows: {
        link: '.m-ctaBlock__link',
        mobileImage: '.m-ctaBlock__bg.-mobile',
        desktopImage: '.m-ctaBlock__bg.-desktop'
      },
      productCarousel: { card: '.m-prodCard' }
    },

    defaults: {
    },

    timeouts: {
      pageLoad: 30000,
      loginWait: 10000,
      componentLoad: 5000,
      betweenComponents: 1000
    }
  },

  // ============ MIX-IN AD TESTER CONFIGURATION ============
  mixinad: {
    widths: [320, 415, 576, 768, 992, 1210],

    selector: '.m-mixinAd, article.m-mixinAd',

    timeouts: {
      singleCapture: 90000,
      totalCapture: 1800000,
      pageLoad: 3000,
      mixinAdWait: 500,
      betweenCaptures: 500
    },

    browser: {
      captureHeight: 1800
    },

    // Reuse banner's region and culture configuration
    get regions() { return config.banner.regions; },
    get cultureLangMap() { return config.banner.cultureLangMap; },
    get hostMap() { return config.banner.hostMap; },
    defaults: {
      environment: "stage",
      region: "usca",
      widths: [320, 768, 1210]
    }
  },

  // ============ PDP TESTER CONFIGURATION ============
  pdp: {
    screenWidths: [320, 415, 576, 768, 992, 1210],

    selectors: {
      // Main "About This Product" section
      aboutSection: '#section-pdp-about',
      aboutHeader: '#section-pdp-about > header',
      aboutContent: '#section-pdp-about > div',

      // Generic image selectors (find any image pattern)
      images: {
        picture: 'picture',
        img: 'img',
        lazyImg: 'img[data-src]',
        bgImage: '[style*="background-image"]'
      },

      // Picture source media queries (for responsive image detection)
      sources: {
        desktop: 'source[media*="1024px"], source[media*="min-width: 1024"]',
        tablet: 'source[media*="768px"], source[media*="min-width: 768"]',
        mobile: 'source[media*="575px"], source[media*="max-width: 575"]'
      },

      // Responsive visibility classes (Tailwind patterns)
      visibility: {
        desktopOnly: '[class*="hidden"][class*="md:block"]',
        mobileOnly: '[class*="md:hidden"]'
      },

      // Background image classes (when present)
      backgrounds: {
        desktop: '[class*="-desktop"], [class*="desktop"]',
        mobile: '[class*="-mobile"], [class*="mobile"]'
      },

      // Links
      link: 'a[href]',

      // Login selectors (same as SKU tester)
      login: {
        homePageSignInButton: "a.a-authorBtn",
        username: "[data-testid='username-input']",
        password: "[data-testid='password-input']",
        loginButton: "[data-testid='signIn-button']",
        errorMessage: "[data-testid='invalidCredential-container']:not(.hidden)"
      }
    },

    timeouts: {
      pageLoad: 30000,
      loginWait: 10000,
      screenshotDelay: 2000,
      betweenSkus: 1000,
      imageLoad: 15000
    },

    defaults: {
      environment: "production",
      region: "us",
      culture: "en-US"
    }
  }
};

// ============ HELPER FUNCTIONS ============

// Get base URL for a region and environment
export function getBaseUrl(environment, region) {
  return config.environments[environment]?.[region] || null;
}

// Build PDP URL for SKU testing
export function buildPdpUrl(environment, region, culture, sku) {
  const baseUrl = getBaseUrl(environment, region);
  if (!baseUrl) return null;
  return `${baseUrl}/Product/${sku}?sc_lang=${culture}`;
}

// Build login URL
export function buildLoginUrl(environment, region) {
  const baseUrl = getBaseUrl(environment, region);
  if (!baseUrl) return null;
  return `${baseUrl}${config.sku.loginPath}`;
}

// Get available cultures for a region (SKU tester)
export function getCulturesForRegion(region) {
  return config.regions[region]?.cultures || [];
}

// Validate SKU configuration
export function validateSkuConfig(options) {
  const errors = [];

  if (!config.environments[options.environment]) {
    errors.push(`Invalid environment: ${options.environment}. Valid: ${Object.keys(config.environments).join(', ')}`);
  }

  if (!config.regions[options.region]) {
    errors.push(`Invalid region: ${options.region}. Valid: ${Object.keys(config.regions).join(', ')}`);
  }

  const validCultures = getCulturesForRegion(options.region);
  const selectedCultures = Array.isArray(options.cultures) && options.cultures.length > 0
    ? options.cultures
    : (options.culture ? [options.culture] : []);

  if (selectedCultures.length === 0) {
    errors.push('At least one culture must be selected');
  } else if (validCultures.length > 0) {
    const invalidCultures = selectedCultures.filter(culture => !validCultures.includes(culture));
    if (invalidCultures.length > 0) {
      errors.push(`Invalid culture(s) for region ${options.region}: ${invalidCultures.join(', ')}. Valid: ${validCultures.join(', ')}`);
    }
  }

  return errors;
}

// Build banner URL for a culture and path
export function buildBannerUrl(environment, culture, path) {
  const host = config.banner.hostMap[environment]?.[culture];
  if (!host) return null;
  const langCode = config.banner.cultureLangMap[culture] || culture;
  return `https://${host}${path}?sc_lang=${langCode}`;
}

// Get banner region config
export function getBannerRegion(regionCode) {
  return config.banner.regions[regionCode] || null;
}

// Validate banner configuration
export function validateBannerConfig(options) {
  const errors = [];

  if (!['stage', 'uat', 'production'].includes(options.environment)) {
    errors.push(`Invalid environment: ${options.environment}. Valid: stage, uat, production`);
  }

  if (!config.banner.regions[options.region]) {
    errors.push(`Invalid region: ${options.region}. Valid: ${Object.keys(config.banner.regions).join(', ')}`);
  }

  if (!options.widths || options.widths.length === 0) {
    errors.push('At least one viewport width must be selected');
  }

  if (options.loginEnabled && (!options.username || !options.password)) {
    errors.push('Username and password are required when login is enabled');
  }

  return errors;
}

// ============ PSLP HELPER FUNCTIONS ============

// Build PSLP URL for a region and culture
export function buildPslpUrl(environment, region, culture) {
  const baseUrl = getBaseUrl(environment, region);
  if (!baseUrl) return null;
  return `${baseUrl}/?sc_lang=${culture}`;
}

// Validate PSLP configuration
export function validatePslpConfig(options) {
  const errors = [];

  if (!config.environments[options.environment]) {
    errors.push(`Invalid environment: ${options.environment}. Valid: ${Object.keys(config.environments).join(', ')}`);
  }

  if (!config.regions[options.region]) {
    errors.push(`Invalid region: ${options.region}. Valid: ${Object.keys(config.regions).join(', ')}`);
  }

  const validCultures = getCulturesForRegion(options.region);
  const selectedCultures = Array.isArray(options.cultures) && options.cultures.length > 0
    ? options.cultures
    : (options.culture ? [options.culture] : []);

  if (selectedCultures.length === 0) {
    errors.push('At least one culture must be selected for PSLP testing');
  } else if (validCultures.length > 0) {
    const invalidCultures = selectedCultures.filter(culture => !validCultures.includes(culture));
    if (invalidCultures.length > 0) {
      errors.push(`Invalid culture(s) for region ${options.region}: ${invalidCultures.join(', ')}. Valid: ${validCultures.join(', ')}`);
    }
  }

  if (options.screenWidths && (!Array.isArray(options.screenWidths) || options.screenWidths.length === 0)) {
    errors.push('At least one viewport width must be selected for PSLP testing');
  }

  if (!options.username || !options.password) {
    errors.push('Username and password are required for PSLP testing');
  }

  return errors;
}

// ============ MIX-IN AD HELPER FUNCTIONS ============

// Validate Mix-In Ad configuration
export function validateMixInAdConfig(options) {
  const errors = [];

  if (!['stage', 'uat', 'production'].includes(options.environment)) {
    errors.push(`Invalid environment: ${options.environment}. Valid: stage, uat, production`);
  }

  if (!config.mixinad.regions[options.region]) {
    errors.push(`Invalid region: ${options.region}. Valid: ${Object.keys(config.mixinad.regions).join(', ')}`);
  }

  if (!options.widths || options.widths.length === 0) {
    errors.push('At least one viewport width must be selected');
  }

  if (options.loginEnabled && (!options.username || !options.password)) {
    errors.push('Username and password are required when login is enabled');
  }

  return errors;
}

// ============ PDP HELPER FUNCTIONS ============

// Validate PDP configuration
export function validatePdpConfig(options) {
  const errors = [];

  if (!config.environments[options.environment]) {
    errors.push(`Invalid environment: ${options.environment}. Valid: ${Object.keys(config.environments).join(', ')}`);
  }

  if (!config.regions[options.region]) {
    errors.push(`Invalid region: ${options.region}. Valid: ${Object.keys(config.regions).join(', ')}`);
  }

  const validCultures = getCulturesForRegion(options.region);
  const selectedCultures = Array.isArray(options.cultures) && options.cultures.length > 0
    ? options.cultures
    : (options.culture ? [options.culture] : []);

  if (selectedCultures.length === 0) {
    errors.push('At least one culture must be selected for PDP testing');
  } else if (validCultures.length > 0) {
    const invalidCultures = selectedCultures.filter(culture => !validCultures.includes(culture));
    if (invalidCultures.length > 0) {
      errors.push(`Invalid culture(s) for region ${options.region}: ${invalidCultures.join(', ')}. Valid: ${validCultures.join(', ')}`);
    }
  }

  if (!options.username || !options.password) {
    errors.push('Username and password are required for PDP testing');
  }

  return errors;
}
// Reload categories from disk and update config
export function reloadCategories() {
  console.log('Reloading categories from disk...');
  const newCategories = loadCategories();

  // Increment version for tracking
  config._categoryVersion++;

  // Update US & Canada
  if (config.banner.regions.usca) {
    const oldCount = config.banner.regions.usca.categories.length;
    config.banner.regions.usca.categories = newCategories['US & Canada'] || [];
    console.log(`US & Canada categories updated: ${oldCount} -> ${config.banner.regions.usca.categories.length}`);
  }

  // Update Mexico
  if (config.banner.regions.mx) {
    const oldCount = config.banner.regions.mx.categories.length;
    config.banner.regions.mx.categories = newCategories['Mexico'] || [];
    console.log(`Mexico categories updated: ${oldCount} -> ${config.banner.regions.mx.categories.length}`);
  }

  // Update UK & Europe
  if (config.banner.regions.ukeu) {
    const oldCount = config.banner.regions.ukeu.categories.length;
    config.banner.regions.ukeu.categories = newCategories['Europe'] || [];
    console.log(`UK & Europe categories updated: ${oldCount} -> ${config.banner.regions.ukeu.categories.length}`);
  }

  console.log(`Categories reloaded successfully (version ${config._categoryVersion})`);
  return newCategories;
}
