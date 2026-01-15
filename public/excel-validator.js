// excel-validator.js - Shared Excel Validation Utility

/**
 * Required Excel columns
 */
const REQUIRED_COLUMNS = [
  'Type',
  'Main Category',
  'Subcategory',
  'Banner Link',
  'Target',
  'Position',
  'SKUs'
];

const CULTURE_LANG_MAP = {
  enus: 'en-US',
  esus: 'es-US',
  enca: 'en-CA',
  frca: 'fr-CA',
  esmx: 'es-MX',
  ie: 'en-IE',
  uk: 'en-GB',
  de: 'de-DE',
  pl: 'pl-PL',
  nl: 'nl-NL',
  lt: 'lt-LT'
};

const HOST_MAP = {
  stage: {
    enus: 'productstore2-us-preview.melaleuca.com',
    esus: 'productstore2-us-preview.melaleuca.com',
    enca: 'productstore2-ca-preview.melaleuca.com',
    frca: 'productstore2-ca-preview.melaleuca.com',
    esmx: 'productstore2-mx-preview.melaleuca.com',
    ie: 'productstore2-ie-preview.melaleuca.com',
    uk: 'productstore2-uk-preview.melaleuca.com',
    de: 'productstore2-de-preview.melaleuca.com',
    pl: 'productstore2-pl-preview.melaleuca.com',
    nl: 'productstore2-nl-preview.melaleuca.com',
    lt: 'productstore2-lt-preview.melaleuca.com'
  },
  uat: {
    enus: 'productstore2-uatus.melaleuca.com',
    esus: 'productstore2-uatus.melaleuca.com',
    enca: 'productstore2-uatca.melaleuca.com',
    frca: 'productstore2-uatca.melaleuca.com',
    esmx: 'productstore2-uatmx.melaleuca.com',
    ie: 'productstore2-uatie.melaleuca.com',
    uk: 'productstore2-uatuk.melaleuca.com',
    de: 'productstore2-uatde.melaleuca.com',
    pl: 'productstore2-uatpl.melaleuca.com',
    nl: 'productstore2-uatl.melaleuca.com',
    lt: 'productstore2-uatlt.melaleuca.com'
  },
  production: {
    enus: 'www.melaleuca.com',
    esus: 'www.melaleuca.com',
    enca: 'ca.melaleuca.com',
    frca: 'ca.melaleuca.com',
    esmx: 'mx.melaleuca.com',
    ie: 'ie.melaleuca.com',
    uk: 'uk.melaleuca.com',
    de: 'de.melaleuca.com',
    pl: 'pl.melaleuca.com',
    nl: 'nl.melaleuca.com',
    lt: 'lt.melaleuca.com'
  }
};

const CULTURE_LABEL_TO_CODE = Object.entries(CULTURE_LANG_MAP).reduce((acc, [code, label]) => {
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
 * Parse and validate Excel file
 * @param {File} file - The Excel file to parse
 * @returns {Promise<{success: boolean, data?: Array, errors?: Array, preview?: Object}>}
 */
async function parseExcelFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        // Get first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Read rows with header row preserved
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        if (rows.length === 0) {
          resolve({
            success: false,
            errors: ['Excel file is empty']
          });
          return;
        }

        const headers = rows[0].map((header) => String(header || '').trim());
        const missingColumns = REQUIRED_COLUMNS.filter(col => !headers.includes(col));

        if (missingColumns.length > 0) {
          resolve({
            success: false,
            errors: [`Missing required columns: ${missingColumns.join(', ')}`]
          });
          return;
        }

        const jsonData = rows
          .slice(1)
          .filter(row => row.some(cell => String(cell || '').trim() !== ''))
          .map((row) => {
            const rowData = {};
            headers.forEach((header, idx) => {
              if (!header) return;
              rowData[header] = row[idx];
            });
            return rowData;
          });

        if (jsonData.length === 0) {
          resolve({
            success: false,
            errors: ['Excel file has headers but no data rows']
          });
          return;
        }

        // Normalize data
        const normalizedData = jsonData.map((row, index) => {
          const normalized = {
            rowNumber: index + 2, // +2 because row 1 is headers and Excel is 1-indexed
            type: normalizeType(row['Type']),
            mainCategory: normalizeText(row['Main Category']),
            subcategory: normalizeText(row['Subcategory']),
            bannerLink: normalizeLink(row['Banner Link']),
            target: normalizeTarget(row['Target']),
            position: row['Position'] ? parseInt(row['Position']) : null,
            skus: normalizeSkuList(row['SKUs']),
            raw: row
          };

          // Validate type
          if (!normalized.type || !['category-banner', 'mix-in-ad', 'monthly-specials', 'hero-carousel', 'variable-windows', 'full-width-banner', 'seasonal-carousel', 'brand-cta-windows'].includes(normalized.type)) {
            normalized.error = `Invalid Type value: "${row['Type']}" (must be "category-banner", "mix-in-ad", "monthly-specials", "hero-carousel", "variable-windows", "full-width-banner", "seasonal-carousel", or "brand-cta-windows")`;
          }

          // Validate position for mix-in ads
          if (normalized.type === 'mix-in-ad' && !normalized.position) {
            normalized.error = 'Position is required for mix-in-ad rows';
          }

          if (normalized.type === 'monthly-specials') {
            if (!normalized.position) {
              normalized.error = 'Position is required for monthly-specials rows';
            } else if (!normalized.skus || normalized.skus.length === 0) {
              normalized.error = 'SKUs are required for monthly-specials rows';
            }
          }

          if ((normalized.type === 'hero-carousel' || normalized.type === 'variable-windows' || normalized.type === 'full-width-banner' || normalized.type === 'brand-cta-windows') && !normalized.position) {
            normalized.error = `Position is required for ${normalized.type} rows`;
          }

          if (normalized.type === 'seasonal-carousel') {
            if (!normalized.position) {
              normalized.error = 'Position is required for seasonal-carousel rows';
            } else if (!normalized.skus || normalized.skus.length === 0) {
              normalized.error = 'SKUs are required for seasonal-carousel rows';
            }
          }

          return normalized;
        });

        // Check for errors in data
        const dataErrors = normalizedData
          .filter(row => row.error)
          .map(row => `Row ${row.rowNumber}: ${row.error}`);

        // Check for unexpected columns
          const unexpectedColumns = headers.filter(col => !REQUIRED_COLUMNS.includes(col));
        const hasUnexpectedColumns = unexpectedColumns.length > 0;

        // Create preview (first 5 rows)
        const preview = {
          sheetName: firstSheetName,
          totalRows: jsonData.length,
          categoryBanners: normalizedData.filter(r => r.type === 'category-banner').length,
          mixInAds: normalizedData.filter(r => r.type === 'mix-in-ad').length,
          monthlySpecials: normalizedData.filter(r => r.type === 'monthly-specials').length,
          heroCarousel: normalizedData.filter(r => r.type === 'hero-carousel').length,
          variableWindows: normalizedData.filter(r => r.type === 'variable-windows').length,
          fullWidthBanner: normalizedData.filter(r => r.type === 'full-width-banner').length,
          seasonalCarousel: normalizedData.filter(r => r.type === 'seasonal-carousel').length,
          brandCtaWindows: normalizedData.filter(r => r.type === 'brand-cta-windows').length,
          unexpectedColumns: hasUnexpectedColumns ? unexpectedColumns : null,
          sampleRows: normalizedData.slice(0, 5).map(row => ({
            type: row.type,
            mainCategory: row.mainCategory,
            subcategory: row.subcategory,
            position: row.position
          }))
        };

        // Add warning if there are unexpected columns
        if (hasUnexpectedColumns) {
          dataErrors.push(`⚠️ Unexpected columns found: ${unexpectedColumns.join(', ')}`);
        }

        resolve({
          success: dataErrors.length === 0,
          data: normalizedData,
          errors: dataErrors.length > 0 ? dataErrors : undefined,
          preview,
          warnings: hasUnexpectedColumns ? [`Unexpected columns: ${unexpectedColumns.join(', ')}`] : undefined
        });

      } catch (error) {
        resolve({
          success: false,
          errors: [`Failed to parse Excel file: ${error.message}`]
        });
      }
    };

    reader.onerror = function() {
      resolve({
        success: false,
        errors: ['Failed to read file']
      });
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Normalize type field
 */
function normalizeType(value) {
  if (!value) return null;
  const normalized = value.toString().toLowerCase().trim();

  // Accept variations
  if (normalized.includes('brand') && normalized.includes('cta')) return 'brand-cta-windows';
  if (normalized.includes('seasonal')) return 'seasonal-carousel';
  if (normalized.includes('full') && normalized.includes('banner')) return 'full-width-banner';
  if (normalized.includes('hero')) return 'hero-carousel';
  if (normalized.includes('variable')) return 'variable-windows';
  if (normalized.includes('banner')) return 'category-banner';
  if (normalized.includes('monthly')) return 'monthly-specials';
  if (normalized.includes('mix') || normalized.includes('ad')) return 'mix-in-ad';

  return normalized;
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

function normalizeSkuList(value) {
  if (!value) return [];
  return value.toString()
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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
 * Normalize link/URL fields
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
 * Validate captured results against Excel data
 * @param {Array} capturedResults - Results from banner/mix-in ad capture
 * @param {Array} excelData - Normalized Excel data
 * @param {string} culture - Current culture (e.g., 'en-us', 'en-ca')
 * @returns {Array} Results with validation information
 */
function validateResults(capturedResults, excelData, culture) {
  if (!excelData || excelData.length === 0) {
    return capturedResults;
  }

  // Determine which locale column to use
  return capturedResults.map(result => {
    // Find matching Excel row
    const match = findMatchingRow(result, excelData);

    if (!match) {
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
      link: compareLinks(result.link, match.bannerLink, culture, result.environment),
      target: compareTargets(result.target, match.target)
    };

    // For mix-in ads, also compare position
    if (result.type === 'mix-in-ad' && result.position !== undefined) {
      comparisons.position = {
        actual: result.position,
        expected: match.position,
        match: result.position === match.position
      };
    }

    // Determine overall status
    const allMatch = Object.values(comparisons).every(c => c.match);

    return {
      ...result,
      validation: {
        status: allMatch ? 'pass' : 'fail',
        expected: {
          link: match.bannerLink,
          target: match.target,
          position: match.position
        },
        comparisons
      }
    };
  });
}

/**
 * Find matching Excel row for a captured result
 */
function findMatchingRow(result, excelData) {
  const resultType = result.type === 'mix-in-ad' ? 'mix-in-ad' : 'category-banner';
  const resultMainCat = normalizeText(result.mainCategory || '');
  const resultSubcat = normalizeText(result.subcategory || '');

  // Filter by type first
  const candidateRows = excelData.filter(row => row.type === resultType);

  // For mix-in ads, also match by position
  if (resultType === 'mix-in-ad' && result.position !== undefined) {
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
 * Generate validation summary
 */
function generateValidationSummary(validatedResults) {
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

// Export functions (will be available globally when script is loaded)
window.ExcelValidator = {
  parseExcelFile,
  validateResults,
  generateValidationSummary,
  normalizeText,
  normalizeLink,
  normalizeTarget
};
