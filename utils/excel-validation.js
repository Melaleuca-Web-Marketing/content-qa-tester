// excel-validation.js - Backend Excel Validation Utility for Reports

import { config } from '../config.js';
import { redact } from './logger.js';

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function shouldLogExcel(level) {
  const currentRaw = process.env.EXCEL_VALIDATION_LOG_LEVEL
    || process.env.TESTER_LOG_LEVEL
    || process.env.LOG_LEVEL
    || 'info';
  const current = String(currentRaw).toLowerCase();
  const normalized = String(level || 'info').toLowerCase();
  const currentLevel = LOG_LEVELS[current] ?? LOG_LEVELS.info;
  const messageLevel = LOG_LEVELS[normalized] ?? LOG_LEVELS.info;
  return messageLevel <= currentLevel;
}

function logExcel(level, message, data = null) {
  if (!shouldLogExcel(level)) return;
  if (data) {
    console.log(`${message}`, JSON.stringify(redact(data), null, 2));
  } else {
    console.log(message);
  }
}

const validationCache = new WeakMap();

function getValidationCache(excelData) {
  if (!excelData || !Array.isArray(excelData)) return null;
  let cache = validationCache.get(excelData);
  if (!cache) {
    cache = { byType: new Map(), match: new Map() };
    validationCache.set(excelData, cache);
  }
  return cache;
}

/**
 * Normalize text fields (category names, etc.)
 */
function normalizeText(value) {
  if (!value) return '';
  return value.toString()
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '-')  // Normalize spaces and hyphens to single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

const EU_CULTURE_LINK_COLUMNS = {
  uk: 'UKIE Link',
  ie: 'UKIE Link',
  de: 'DE Link',
  nl: 'NL Link',
  pl: 'PL Link',
  lt: 'LT Link'
};

const HOST_MAP = config.banner?.hostMap || {};
const CULTURE_LABEL_TO_CODE = Object.entries(config.banner?.cultureLangMap || {}).reduce((acc, [code, label]) => {
  acc[String(label).toLowerCase()] = code;
  return acc;
}, {});

function normalizeCultureKey(culture) {
  if (!culture) return null;
  const raw = String(culture).trim().toLowerCase();
  const productionMap = HOST_MAP.production || {};

  if (productionMap[raw]) return raw;

  const normalizedLabel = raw.replace(/_/g, '-');
  if (CULTURE_LABEL_TO_CODE[normalizedLabel]) {
    return CULTURE_LABEL_TO_CODE[normalizedLabel];
  }

  const compact = raw.replace(/[^a-z]/g, '');
  if (productionMap[compact]) return compact;

  return raw;
}

function resolveExpectedDomain(culture, environment) {
  const envKey = HOST_MAP[environment] ? environment : 'production';
  const cultureKey = normalizeCultureKey(culture);
  if (!cultureKey) return null;
  return HOST_MAP[envKey]?.[cultureKey] || null;
}

function getEuLinkColumnForCulture(culture) {
  const cultureKey = normalizeCultureKey(culture);
  if (!cultureKey) return null;
  return EU_CULTURE_LINK_COLUMNS[cultureKey] || null;
}

function resolveExpectedLink(match, culture) {
  if (!match) return { value: '', missing: true, cultureKey: null, columnName: null };
  const cultureKey = normalizeCultureKey(culture);

  if (match.linkByCulture && cultureKey) {
    const hasColumn = Object.prototype.hasOwnProperty.call(match.linkByCulture, cultureKey);
    const value = hasColumn ? match.linkByCulture[cultureKey] : '';
    return {
      value: value || '',
      missing: !hasColumn || !value,
      cultureKey,
      columnName: getEuLinkColumnForCulture(cultureKey)
    };
  }

  return {
    value: match.bannerLink || '',
    missing: false,
    cultureKey,
    columnName: null
  };
}

/**
 * Parse URL into domain and path components
 */
function parseLink(value) {
  if (!value) return { domain: null, path: '' };

  let link = value.toString().trim().toLowerCase();

  // Check if it has a domain (starts with http:// or https://)
  const domainMatch = link.match(/^https?:\/\/([^/]+)(.*)/i);

  if (domainMatch) {
    const domain = domainMatch[1]; // e.g., "www.melaleuca.com" or "www.melaleuca.ca"
    let path = domainMatch[2] || '/';

    // Remove trailing slash
    path = path.replace(/\/$/, '');
    // Remove query parameters and fragments
    path = path.replace(/[?#].*$/, '');

    return { domain, path };
  } else {
    // No domain, just a path
    let path = link;
    // Remove trailing slash
    path = path.replace(/\/$/, '');
    // Remove query parameters and fragments
    path = path.replace(/[?#].*$/, '');

    return { domain: null, path };
  }
}

/**
 * Normalize link/URL fields (backwards compatibility)
 */
function normalizeLink(value) {
  if (!value) return '';
  let link = value.toString().trim().toLowerCase();

  // Remove protocol and domain if present
  link = link.replace(/^https?:\/\/[^/]+/i, '');

  // Remove trailing slash
  link = link.replace(/\/$/, '');

  // Remove query parameters and fragments for comparison
  link = link.replace(/[?#].*$/, '');

  return link;
}

/**
 * Normalize target field
 */
function normalizeTarget(value) {
  if (!value) return '';
  const normalized = value.toString().trim().toLowerCase();

  // Map variations to standard values
  if (normalized.includes('same') || normalized === '_self') return 'same tab';
  if (normalized.includes('new') || normalized === '_blank') return 'new tab';

  return normalized;
}

function normalizeSkuValue(value) {
  if (value === null || value === undefined) return '';
  return value.toString().trim();
}

function normalizeSkuList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeSkuValue(entry))
      .filter(Boolean);
  }
  return normalizeSkuValue(value)
    .split(/[,\n;]/)
    .map((entry) => normalizeSkuValue(entry))
    .filter(Boolean);
}

function compareSkus(actual, expected) {
  const normalizedActual = normalizeSkuValue(actual);
  const normalizedExpected = normalizeSkuList(expected);
  const match = normalizedActual !== '' && normalizedExpected.includes(normalizedActual);

  return {
    actual: normalizedActual,
    expected: normalizedExpected.join(', '),
    match
  };
}

/**
 * Find matching Excel row for a captured result
 */
function findMatchingRow(result, excelData, type = 'category-banner') {
  const resultMainCat = normalizeText(result.mainCategory || '');
  const resultSubcat = normalizeText(result.category || result.subcategory || '');
  const cache = getValidationCache(excelData);
  const positionKey = type === 'mix-in-ad' ? String(result.position ?? '') : '';
  const matchKey = `${type}|${resultMainCat}|${resultSubcat}|${positionKey}`;

  if (cache && cache.match.has(matchKey)) {
    return cache.match.get(matchKey) || null;
  }

  logExcel('debug', `[Excel Validation] Looking for match: Main="${resultMainCat}", Sub="${resultSubcat}"`);

  // Filter by type first (cached)
  let candidateRows = cache ? cache.byType.get(type) : null;
  if (!candidateRows) {
    candidateRows = excelData.filter(row => row.type === type);
    if (cache) {
      cache.byType.set(type, candidateRows);
    }
  }
  logExcel('debug', `[Excel Validation] Found ${candidateRows.length} candidate rows of type "${type}"`);

  // For mix-in ads, also match by position
  if (type === 'mix-in-ad' && result.position !== undefined) {
    const match = candidateRows.find(row =>
      row.mainCategory === resultMainCat &&
      row.subcategory === resultSubcat &&
      row.position === result.position
    );
    if (cache) cache.match.set(matchKey, match || null);
    return match;
  }

  // For category banners, just match by category
  const match = candidateRows.find(row =>
    row.mainCategory === resultMainCat &&
    row.subcategory === resultSubcat
  );
  if (cache) cache.match.set(matchKey, match || null);
  return match;
}

/**
 * Compare link fields
 * Also checks if domain matches the expected host for the culture/environment
 */
function compareLinks(actual, expected, culture = '', environment = 'production') {
  const parsedActual = parseLink(actual || '');
  const parsedExpected = parseLink(expected || '');

  const normalizedActual = normalizeLink(actual || '');
  const normalizedExpected = normalizeLink(expected || '');

  // Check if paths match
  const pathsMatch = parsedActual.path === parsedExpected.path;

  // Check domain if present in actual captured result
  let domainMatch = true;
  let domainError = null;
  let expectedDomain = parsedExpected.domain;

  if (parsedActual.domain) {
    const actualDomain = parsedActual.domain;
    const expectedHost = resolveExpectedDomain(culture, environment);

    if (expectedHost) {
      if (actualDomain !== expectedHost) {
        domainMatch = false;
        domainError = `Expected ${expectedHost} for ${culture || 'unknown culture'} (${environment || 'production'}), but found ${actualDomain}`;
      }
      expectedDomain = expectedHost;
    } else if (parsedExpected.domain) {
      if (actualDomain !== parsedExpected.domain) {
        domainMatch = false;
        domainError = `Expected ${parsedExpected.domain}, but found ${actualDomain}`;
      }
      expectedDomain = parsedExpected.domain;
    }
  }

  const match = pathsMatch && domainMatch;

  return {
    actual: normalizedActual,
    expected: normalizedExpected,
    match,
    domainError,
    actualDomain: parsedActual.domain,
    expectedDomain
  };
}

/**
 * Compare target fields
 */
function compareTargets(actual, expected) {
  const normalizedActual = normalizeTarget(actual || '');
  const normalizedExpected = normalizeTarget(expected || '');

  return {
    actual: normalizedActual,
    expected: normalizedExpected,
    match: normalizedActual === normalizedExpected
  };
}

/**
 * Validate captured results against Excel data
 * @param {Array} capturedResults - Results from banner/mix-in ad capture
 * @param {Array} excelData - Normalized Excel data from frontend
 * @param {string} type - Type of content: 'category-banner' or 'mix-in-ad'
 * @returns {Array} Results with validation information
 */
export function validateResults(capturedResults, excelData, type = 'category-banner') {
  if (!excelData || excelData.length === 0) {
    return capturedResults;
  }

  logExcel('info', `[Excel Validation] Validating ${capturedResults.length} results against ${excelData.length} Excel rows (type: ${type})`);
  const validatedResults = [];
  const notFoundCounts = new Map();

  for (const result of capturedResults) {
    const culture = result.culture || '';

    // Find matching Excel row
    const match = findMatchingRow(result, excelData, type);

    if (!match) {
      const resultMainCat = normalizeText(result.mainCategory || '');
      const resultSubcat = normalizeText(result.category || result.subcategory || '');
      const key = `${resultMainCat}|${resultSubcat}|${culture}`;
      const existing = notFoundCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        notFoundCounts.set(key, {
          mainCategory: resultMainCat,
          subcategory: resultSubcat,
          culture,
          count: 1
        });
      }

      validatedResults.push({
        ...result,
        validation: {
          status: 'not-found',
          message: 'No matching row found in Excel'
        }
      });
      continue;
    }

    const linkInfo = resolveExpectedLink(match, culture);
    const linkComparison = linkInfo.missing
      ? {
        actual: normalizeLink(result.href || ''),
        expected: '',
        match: false,
        missing: true,
        message: linkInfo.columnName ? `Missing ${linkInfo.columnName}` : 'Missing link for culture'
      }
      : compareLinks(result.href, linkInfo.value, culture, result.environment);

    // Compare fields
    const comparisons = {
      link: linkComparison,
      target: compareTargets(result.target, match.target)
    };

    // For mix-in ads, also compare position
    if (type === 'mix-in-ad' && result.position !== undefined) {
      comparisons.position = {
        actual: result.position,
        expected: match.position,
        match: result.position === match.position
      };
    }

    const expectedSkus = normalizeSkuList(match.skus);
    if (type === 'mix-in-ad' && expectedSkus.length > 0) {
      comparisons.sku = compareSkus(result.addToCartResult?.sku, expectedSkus);
    }

    // Determine overall status
    const allMatch = Object.values(comparisons).every(c => c.match);
    const status = allMatch ? 'PASS' : 'FAIL';

    // Log comparison results
    logExcel('debug', `[Excel Validation] ${status === 'PASS' ? '✅' : '❌'} ${status} - ${result.category} (${result.mainCategory})`);
    if (!allMatch) {
      Object.entries(comparisons).forEach(([field, comp]) => {
        if (!comp.match) {
          if (comp.domainError) {
            logExcel('debug', `  ❌ ${field}: ${comp.domainError}`);
            logExcel('debug', `     Actual: "${comp.actual}" (domain: ${comp.actualDomain})`);
            logExcel('debug', `     Expected: "${comp.expected}"`);
          } else {
            logExcel('debug', `  ❌ ${field}: "${comp.actual}" !== "${comp.expected}"`);
          }
        }
      });
    }

    return {
      ...result,
      validation: {
        status: allMatch ? 'pass' : 'fail',
        expected: {
          link: linkInfo.value,
          target: match.target,
          position: match.position,
          sku: expectedSkus.join(', ')
        },
        comparisons
      }
    };
    validatedResults.push({
      ...result,
      validation: {
        status: allMatch ? 'pass' : 'fail',
        expected: {
          link: linkInfo.value,
          target: match.target,
          position: match.position,
          sku: expectedSkus.join(', ')
        },
        comparisons
      }
    });
  }

  if (notFoundCounts.size > 0) {
    const groups = Array.from(notFoundCounts.values())
      .sort((a, b) => b.count - a.count || a.culture.localeCompare(b.culture))
      .slice(0, 20);
    const totalNotFound = Array.from(notFoundCounts.values()).reduce((sum, item) => sum + item.count, 0);
    logExcel(
      'warn',
      `[Excel Validation] ${totalNotFound} results did not match Excel rows across ${notFoundCounts.size} unique category/culture combinations`,
      {
        groups,
        truncated: notFoundCounts.size > groups.length
      }
    );
  }

  return validatedResults;
}

/**
 * Generate validation summary
 */
export function generateValidationSummary(validatedResults) {
  const total = validatedResults.length;
  const passed = validatedResults.filter(r => r.validation?.status === 'pass').length;
  const failed = validatedResults.filter(r => r.validation?.status === 'fail').length;
  const notFound = validatedResults.filter(r => r.validation?.status === 'not-found').length;

  return {
    total,
    passed,
    failed,
    notFound,
    passRate: total > 0 ? ((passed / total) * 100).toFixed(1) : 0
  };
}

/**
 * Validate a single capture result against Excel data (for real-time activity feed)
 * @param {Object} result - Single capture result with href, target, culture, category, mainCategory
 * @param {Array} excelData - Normalized Excel data array
 * @param {string} type - Type: 'category-banner' or 'mix-in-ad'
 * @returns {Object} Validation result: { status, failures, expected }
 */
export function validateSingleResult(result, excelData, type = 'category-banner') {
  if (!excelData || excelData.length === 0) {
    return { status: 'skipped', message: 'No Excel data provided' };
  }

  const culture = result.culture || '';

  // Find matching Excel row
  const match = findMatchingRow(result, excelData, type);

  if (!match) {
    return {
      status: 'not-found',
      message: 'No matching row in Excel'
    };
  }

  const linkInfo = resolveExpectedLink(match, culture);
  const linkResult = linkInfo.missing
    ? {
      actual: normalizeLink(result.href || ''),
      expected: '',
      match: false,
      missing: true,
      message: linkInfo.columnName ? `Missing ${linkInfo.columnName}` : 'Missing link for culture'
    }
    : compareLinks(result.href, linkInfo.value, culture, result.environment);
  const targetResult = compareTargets(result.target, match.target);
  const positionResult = type === 'mix-in-ad' && result.position !== undefined
    ? {
      actual: result.position,
      expected: match.position,
      match: result.position === match.position
    }
    : null;
  const expectedSkus = normalizeSkuList(match.skus);
  const skuResult = type === 'mix-in-ad' && expectedSkus.length > 0 && result.addToCartResult?.sku
    ? compareSkus(result.addToCartResult.sku, expectedSkus)
    : null;

  // Collect failures
  const failures = [];
  if (!linkResult.match) failures.push('link');
  if (!targetResult.match) failures.push('target');
  if (positionResult && !positionResult.match) failures.push('position');
  if (skuResult && !skuResult.match) failures.push('sku');

  const expected = {
    link: linkInfo.value,
    target: match.target
  };
  const actual = {
    link: result.href,
    target: result.target
  };

  if (positionResult) {
    expected.position = match.position;
    actual.position = result.position;
  }
  if (skuResult) {
    expected.sku = skuResult.expected;
    actual.sku = skuResult.actual;
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    expected,
    actual
  };
}
