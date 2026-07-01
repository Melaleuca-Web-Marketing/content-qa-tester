// auto-generate-report.js

import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { formatTimestamp } from './format-timestamp.js';
import { saveToHistory } from './history.js';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.TESTER_DATA_DIR || resolve(__dirname, '..');
const REPORTS_DIR = join(DATA_DIR, 'reports');
const MAX_FAILURE_MESSAGES = 5;
const MAX_FAILURE_SCAN_NODES = 12000;
const SKIPPED_FAILURE_SCAN_KEYS = new Set([
  'screenshot',
  'screenshots',
  'image',
  'imageData',
  'dataUrl',
  'base64',
  'src',
  'html',
  'outerHTML',
  'innerHTML'
]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pushFailureMessage(summary, value) {
  const message = String(value || '').replace(/\s+/g, ' ').trim();
  if (!message || summary.failureMessages.length >= MAX_FAILURE_MESSAGES) return;
  if (summary.failureMessages.includes(message)) return;
  summary.failureMessages.push(message.slice(0, 180));
}

function countValidationFailures(validation) {
  if (!validation || typeof validation !== 'object') return 0;

  const candidates = [];
  const failed = finiteNumber(validation.failed);
  const missing = finiteNumber(validation.missing);
  const notFound = finiteNumber(validation.notFound);
  const failures = Array.isArray(validation.failures) ? validation.failures.length : null;
  const extraPositions = Array.isArray(validation.extraPositions) ? validation.extraPositions.length : 0;
  const extraSlides = Array.isArray(validation.extraSlides) ? validation.extraSlides.length : 0;

  if (failed && failed > 0) candidates.push(failed);
  if (failures && failures > 0) candidates.push(failures);
  if (validation.status === 'fail' || validation.status === 'failed' || validation.status === 'not-found') candidates.push(1);
  if (validation.pass === false) candidates.push(1);

  const baseFailures = candidates.length > 0 ? Math.max(...candidates) : 0;
  return baseFailures
    + (missing && missing > 0 ? missing : 0)
    + (notFound && notFound > 0 ? notFound : 0)
    + extraPositions
    + extraSlides;
}

function buildResultFailureSummary(results, activityResults = []) {
  const summary = {
    inspectedCount: 0,
    captureFailureCount: 0,
    validationFailureCount: 0,
    addToCartFailureCount: 0,
    failureMessages: []
  };
  const seen = new WeakSet();
  let scannedNodes = 0;

  const visit = (value, key = '') => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value) || scannedNodes >= MAX_FAILURE_SCAN_NODES) return;
    seen.add(value);
    scannedNodes += 1;

    const hasResultShape = Object.prototype.hasOwnProperty.call(value, 'success')
      || Object.prototype.hasOwnProperty.call(value, 'error')
      || Object.prototype.hasOwnProperty.call(value, 'validation')
      || Object.prototype.hasOwnProperty.call(value, 'addToCartResult');

    if (hasResultShape) {
      summary.inspectedCount += 1;
    }

    if (value.error || value.success === false || value.failed === true) {
      summary.captureFailureCount += 1;
      pushFailureMessage(summary, value.message || value.error || 'Capture failed');
    }

    const validationFailures = countValidationFailures(value.validation);
    if (validationFailures > 0) {
      summary.validationFailureCount += validationFailures;
      pushFailureMessage(summary, value.validation?.message || `Validation failed (${validationFailures})`);
    }

    const addToCartResult = value.addToCartResult;
    if (addToCartResult && typeof addToCartResult === 'object' && addToCartResult.attempted && addToCartResult.success === false) {
      summary.addToCartFailureCount += 1;
      pushFailureMessage(summary, addToCartResult.reason || 'Add to cart failed');
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      if (SKIPPED_FAILURE_SCAN_KEYS.has(childKey)) continue;
      if (childKey === 'validation') continue;
      if (typeof childValue === 'object' && childValue !== null) {
        visit(childValue, childKey);
      }
    }
  };

  visit(results);
  visit(activityResults);

  summary.resultFailureCount = summary.captureFailureCount
    + summary.validationFailureCount
    + summary.addToCartFailureCount;
  return summary;
}

function attachResultFailureSummary(entry, summary) {
  if (!summary || summary.inspectedCount <= 0) return;
  entry.resultInspectedCount = summary.inspectedCount;
  entry.captureFailureCount = summary.captureFailureCount;
  entry.validationFailureCount = summary.validationFailureCount;
  entry.addToCartFailureCount = summary.addToCartFailureCount;
  entry.resultFailureCount = summary.resultFailureCount;
  entry.failureCount = summary.resultFailureCount;
  if (summary.failureMessages.length > 0) {
    entry.failureMessages = summary.failureMessages;
  }
}

export function autoGenerateReport(processor, reportGenerator, mode, userId = null) {
  processor.on('status', (data) => {
    if (data.type === 'completed') {
      const results = processor.getResults();
      if (!results || (Array.isArray(results) && results.length === 0)) {
        return;
      }

      const duration = data.duration || null;
      const theme = 'dark';

      // Get Excel validation options from processor if available
      const options = processor.currentOptions || {};
      const excelValidation = options.excelValidation || null;
      const customTestName = typeof options.testName === 'string' ? options.testName.trim() : '';

      log('debug', '[Auto-Generate-Report] Excel validation settings', {
        enabled: Boolean(excelValidation),
        rowCount: excelValidation?.data?.length || 0
      });

      const { html, name } = reportGenerator(results, duration, theme, excelValidation);

      const now = new Date();
      const timestamp = formatTimestamp(now);
      const msStamp = String(now.getMilliseconds()).padStart(3, '0');
      const env = results.environment || (Array.isArray(results) && results[0]?.environment) || 'unknown';

      // Handle both single and multiple culture tests
      let culture = 'unknown';
      if (results.culture) {
        // Single object with culture property (e.g., PSLP)
        culture = results.culture;
      } else if (Array.isArray(results) && results.length > 0) {
        // Array of results (e.g., SKU, Banner, Mix-in Ad)
        const uniqueCultures = [...new Set(results.map(r => r.culture).filter(Boolean))];
        if (uniqueCultures.length === 1) {
          culture = uniqueCultures[0];
        } else if (uniqueCultures.length > 1) {
          culture = 'multi';
        } else {
          culture = results[0]?.culture || 'unknown';
        }
      }

      const userTag = userId ? String(userId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : 'anon';
      const filename = `${mode}-test-${env}-${culture}-${timestamp}-${msStamp}-${userTag}.html`;
      const filepath = join(REPORTS_DIR, filename);

      fs.writeFileSync(filepath, html);

      const entry = {
        mode,
        filename,
        timestamp: now.getTime(),
        environment: env,
        duration,
        culture
      };

      if (customTestName) {
        entry.testName = customTestName;
      }

      const activityResults = typeof processor.getActivityResults === 'function'
        ? processor.getActivityResults()
        : [];
      attachResultFailureSummary(entry, buildResultFailureSummary(results, activityResults));

      if (Array.isArray(results)) {
        entry.region = results[0]?.region;
        entry.count = results.length;
        entry.successCount = results.filter(r => r.success).length;
        entry.errorCount = results.filter(r => !r.success).length;

        // Store all unique cultures if multiple
        const uniqueCultures = [...new Set(results.map(r => r.culture).filter(Boolean))];
        if (uniqueCultures.length > 1) {
          entry.cultures = uniqueCultures;
        }
      } else {
        const runs = Array.isArray(results.runs) ? results.runs : null;
        if (runs && runs.length > 0) {
          entry.region = results.region || runs[0]?.region;
          entry.componentsCount = runs.reduce((sum, run) => sum + (run.componentReports?.length || 0), 0);
          entry.screenshotsCount = runs.reduce((sum, run) => sum + (run.screenshots?.length || 0), 0);
          const uniqueCultures = [...new Set(runs.map(run => run.culture).filter(Boolean))];
          if (uniqueCultures.length > 1) {
            entry.cultures = uniqueCultures;
          }
        } else {
          entry.region = results.region;
          entry.componentsCount = results.componentReports?.length || 0;
          entry.screenshotsCount = results.screenshots?.length || 0;
        }
      }

      saveToHistory(entry, userId);
    }
  });
}
