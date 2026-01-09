// singleton.js - Generic singleton factory for processor instances

/**
 * Map to store singleton instances by key
 * @type {Map<string, any>}
 */
const instances = new Map();

/**
 * Get or create a singleton instance
 * @param {string} key - Unique identifier for the singleton
 * @param {Function} factory - Factory function to create the instance if it doesn't exist
 * @returns {any} The singleton instance
 * @example
 * const processor = getSingleton('SkuProcessor', () => new SkuProcessor());
 */
export function getSingleton(key, factory) {
  if (!instances.has(key)) {
    instances.set(key, factory());
  }
  return instances.get(key);
}

/**
 * Clear a specific singleton instance
 * Useful for testing or resetting state
 * @param {string} key - Unique identifier for the singleton to clear
 * @returns {boolean} True if the instance was found and deleted
 */
export function clearSingleton(key) {
  return instances.delete(key);
}

/**
 * Clear all singleton instances
 * Useful for testing or complete reset
 */
export function clearAllSingletons() {
  instances.clear();
}

/**
 * Check if a singleton instance exists
 * @param {string} key - Unique identifier for the singleton
 * @returns {boolean} True if the instance exists
 */
export function hasSingleton(key) {
  return instances.has(key);
}
