// memory-monitor.js - Memory usage monitoring utilities

/**
 * Get current memory usage in MB
 * @returns {Object} - Memory usage in MB (rss, heapUsed, heapTotal, external)
 */
export function getMemoryUsageMB() {
  const usage = process.memoryUsage();
  return {
    rss: (usage.rss / 1024 / 1024).toFixed(2),
    heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(2),
    heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(2),
    external: (usage.external / 1024 / 1024).toFixed(2)
  };
}

/**
 * Log memory usage with label
 * @param {string} label - Optional label for the log message
 */
export function logMemoryUsage(label = '') {
  const mem = getMemoryUsageMB();
  console.log(`[Memory${label ? ' - ' + label : ''}] RSS: ${mem.rss}MB, Heap: ${mem.heapUsed}/${mem.heapTotal}MB`);
}

/**
 * Check if memory usage exceeds threshold
 * @param {number} thresholdMB - Threshold in MB (default: 1024)
 * @returns {boolean} - True if heap usage exceeds threshold
 */
export function checkMemoryThreshold(thresholdMB = 1024) {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  return heapUsedMB > thresholdMB;
}
