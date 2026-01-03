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
      const filename = `${mode}-test-${env}-${timestamp}.html`;
      const filepath = join(REPORTS_DIR, filename);

      fs.writeFileSync(filepath, html);

      const entry = {
        mode,
        filename,
        timestamp: now.getTime(),
        environment: env,
        duration
      };

      if (Array.isArray(results)) {
        entry.region = results[0]?.region;
        entry.culture = results[0]?.culture;
        entry.count = results.length;
        entry.successCount = results.filter(r => r.success).length;
        entry.errorCount = results.filter(r => !r.success).length;
      } else {
        entry.region = results.region;
        entry.culture = results.culture;
        entry.componentsCount = results.componentReports?.length || 0;
        entry.screenshotsCount = results.screenshots?.length || 0;
      }

      saveToHistory(entry);
    }
    broadcast({ type: `${mode}-status`, data });
  });
}
