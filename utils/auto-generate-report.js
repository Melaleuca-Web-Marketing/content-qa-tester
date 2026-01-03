// auto-generate-report.js

import { join } from 'path';
import fs from 'fs';
import { formatTimestamp } from './format-timestamp.js';
import { saveToHistory } from './history.js';
import { broadcast } from './broadcast.js';

const REPORTS_DIR = join(process.cwd(), 'reports');

export function autoGenerateReport(processor, reportGenerator, mode) {
  processor.on('status', (data) => {
    if (data.type === 'completed') {
      const results = processor.getResults();
      if (!results || (Array.isArray(results) && results.length === 0)) {
        return;
      }
      
      const duration = data.duration || null;
      const theme = 'dark';
      const { html, name } = reportGenerator(results, duration, theme);

      const now = new Date();
      const timestamp = formatTimestamp(now);
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

      const filename = `${mode}-test-${env}-${culture}-${timestamp}.html`;
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
        entry.region = results.region;
        entry.componentsCount = results.componentReports?.length || 0;
        entry.screenshotsCount = results.screenshots?.length || 0;
      }

      saveToHistory(entry);
    }
    broadcast({ type: `${mode}-status`, data });
  });
}
