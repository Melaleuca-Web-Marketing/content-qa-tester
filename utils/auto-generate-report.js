// auto-generate-report.js

import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { formatTimestamp } from './format-timestamp.js';
import { saveToHistory } from './history.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.TESTER_DATA_DIR || resolve(__dirname, '..');
const REPORTS_DIR = join(DATA_DIR, 'reports');

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

      console.log('[Auto-Generate-Report] Excel Validation:', excelValidation ? `Enabled (${excelValidation.data?.length || 0} rows)` : 'Disabled');

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
