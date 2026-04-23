// report-cleanup.js - Report file cleanup utilities

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Delete reports older than specified days
 * @param {string} reportsDir - Reports directory path
 * @param {number} daysToKeep - Number of days to keep reports (default: 30)
 * @returns {Object} - { deleted: number, kept: number, errors: number }
 */
export function cleanupOldReports(reportsDir, daysToKeep = 30) {
  const now = Date.now();
  const maxAge = daysToKeep * 24 * 60 * 60 * 1000; // Convert days to ms

  let deleted = 0;
  let kept = 0;
  let errors = 0;

  try {
    const files = fs.readdirSync(reportsDir);

    for (const file of files) {
      if (!file.endsWith('.html')) continue;

      const filePath = join(reportsDir, file);

      try {
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
          fs.unlinkSync(filePath);
          deleted++;
          log('debug', '[Cleanup] Deleted old report', { file });
        } else {
          kept++;
        }
      } catch (err) {
        log('error', `[Cleanup] Error processing ${file}`, { error: err.message });
        errors++;
      }
    }
  } catch (err) {
    log('error', '[Cleanup] Error reading reports directory', { error: err.message });
    return { deleted: 0, kept: 0, errors: 1 };
  }

  log('info', '[Cleanup] Summary', { deleted, kept, errors });
  return { deleted, kept, errors };
}

/**
 * Get report file statistics
 * @param {string} reportsDir - Reports directory path
 * @returns {Object|null} - Statistics object or null on error
 */
export function getReportStats(reportsDir) {
  try {
    const files = fs.readdirSync(reportsDir);
    const htmlFiles = files.filter(f => f.endsWith('.html'));

    let totalSize = 0;
    let oldestDate = Date.now();
    let newestDate = 0;

    for (const file of htmlFiles) {
      const filePath = join(reportsDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
      if (stats.mtimeMs < oldestDate) oldestDate = stats.mtimeMs;
      if (stats.mtimeMs > newestDate) newestDate = stats.mtimeMs;
    }

    return {
      count: htmlFiles.length,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      oldestDate: htmlFiles.length > 0 ? new Date(oldestDate).toISOString() : null,
      newestDate: htmlFiles.length > 0 ? new Date(newestDate).toISOString() : null
    };
  } catch (err) {
    log('error', '[Cleanup] Error getting report stats', { error: err.message });
    return null;
  }
}
