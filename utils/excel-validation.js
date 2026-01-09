// excel-validation.js - Backend Excel Validation Utility for Reports

import { config } from '../config.js';

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

/**
 * Find matching Excel row for a captured result
 */
function findMatchingRow(result, excelData, type = 'category-banner') {
  const resultMainCat = normalizeText(result.mainCategory || '');
  const resultSubcat = normalizeText(result.category || result.subcategory || '');

  console.log(`[Excel Validation] Looking for match: Main="${resultMainCat}", Sub="${resultSubcat}"`);

  // Filter by type first
  const candidateRows = excelData.filter(row => row.type === type);
  console.log(`[Excel Validation] Found ${candidateRows.length} candidate rows of type "${type}"`);

  // For mix-in ads, also match by position
  if (type === 'mix-in-ad' && result.position !== undefined) {
    return candidateRows.find(row =>
      row.mainCategory === resultMainCat &&
      row.subcategory === resultSubcat &&
      row.position === result.position
    );
  }

  // For category banners, just match by category
  return candidateRows.find(row =>
    row.mainCategory === resultMainCat &&
    row.subcategory === resultSubcat
  );
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
 * Compare image locale fields
 */
function compareImageLocale(actual, expected) {
  const normalizedActual = normalizeText(actual || '');
  const normalizedExpected = normalizeText(expected || '');

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

  console.log(`[Excel Validation] Validating ${capturedResults.length} results against ${excelData.length} Excel rows (type: ${type})`);

  return capturedResults.map(result => {
    // Determine which locale column to use based on culture
    const culture = result.culture || '';
    const isCanada = culture.toLowerCase().includes('ca');
    const localeField = isCanada ? 'imageLocaleCA' : 'imageLocaleUS';

    // Find matching Excel row
    const match = findMatchingRow(result, excelData, type);

    if (!match) {
      const resultMainCat = normalizeText(result.mainCategory || '');
      const resultSubcat = normalizeText(result.category || result.subcategory || '');
      console.log(`[Excel Validation] ❌ NOT FOUND - Main: "${resultMainCat}", Sub: "${resultSubcat}", Culture: ${culture}`);
      return {
        ...result,
        validation: {
          status: 'not-found',
          message: 'No matching row found in Excel'
        }
      };
    }

    // Compare fields
    const comparisons = {
      link: compareLinks(result.href, match.bannerLink, culture, result.environment),
      target: compareTargets(result.target, match.target),
      imageLocale: compareImageLocale(result.imageLocale, match[localeField])
    };

    // For mix-in ads, also compare position
    if (type === 'mix-in-ad' && result.position !== undefined) {
      comparisons.position = {
        actual: result.position,
        expected: match.position,
        match: result.position === match.position
      };
    }

    // Determine overall status
    const allMatch = Object.values(comparisons).every(c => c.match);
    const status = allMatch ? 'PASS' : 'FAIL';

    // Log comparison results
    console.log(`[Excel Validation] ${status === 'PASS' ? '✅' : '❌'} ${status} - ${result.category} (${result.mainCategory})`);
    if (!allMatch) {
      Object.entries(comparisons).forEach(([field, comp]) => {
        if (!comp.match) {
          if (comp.domainError) {
            console.log(`  ❌ ${field}: ${comp.domainError}`);
            console.log(`     Actual: "${comp.actual}" (domain: ${comp.actualDomain})`);
            console.log(`     Expected: "${comp.expected}"`);
          } else {
            console.log(`  ❌ ${field}: "${comp.actual}" !== "${comp.expected}"`);
          }
        }
      });
    }

    return {
      ...result,
      validation: {
        status: allMatch ? 'pass' : 'fail',
        expected: {
          link: match.bannerLink,
          target: match.target,
          imageLocale: match[localeField],
          position: match.position
        },
        comparisons
      }
    };
  });
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
 * @param {Object} result - Single capture result with href, target, imageLocale, culture, category, mainCategory
 * @param {Array} excelData - Normalized Excel data array
 * @param {string} type - Type: 'category-banner' or 'mix-in-ad'
 * @returns {Object} Validation result: { status, failures, expected }
 */
export function validateSingleResult(result, excelData, type = 'category-banner') {
  if (!excelData || excelData.length === 0) {
    return { status: 'skipped', message: 'No Excel data provided' };
  }

  const culture = result.culture || '';
  const isCanada = culture.toLowerCase().includes('ca');
  const localeField = isCanada ? 'imageLocaleCA' : 'imageLocaleUS';

  // Find matching Excel row
  const match = findMatchingRow(result, excelData, type);

  if (!match) {
    return {
      status: 'not-found',
      message: 'No matching row in Excel'
    };
  }

  // Compare fields
  const linkResult = compareLinks(result.href, match.bannerLink, culture, result.environment);
  const targetResult = compareTargets(result.target, match.target);
  const localeResult = compareImageLocale(result.imageLocale, match[localeField]);
  const positionResult = type === 'mix-in-ad' && result.position !== undefined
    ? {
      actual: result.position,
      expected: match.position,
      match: result.position === match.position
    }
    : null;

  // Collect failures
  const failures = [];
  if (!linkResult.match) failures.push('link');
  if (!targetResult.match) failures.push('target');
  if (!localeResult.match) failures.push('imageLocale');
  if (positionResult && !positionResult.match) failures.push('position');

  const expected = {
    link: match.bannerLink,
    target: match.target,
    imageLocale: match[localeField]
  };
  const actual = {
    link: result.href,
    target: result.target,
    imageLocale: result.imageLocale
  };

  if (positionResult) {
    expected.position = match.position;
    actual.position = result.position;
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    expected,
    actual
  };
}
