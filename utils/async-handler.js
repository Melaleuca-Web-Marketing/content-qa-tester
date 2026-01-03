// utils/async-handler.js - Express async error handling wrapper

/**
 * Wraps async route handlers to catch errors and pass them to Express error handler
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }))
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Wrapped function that catches errors
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
