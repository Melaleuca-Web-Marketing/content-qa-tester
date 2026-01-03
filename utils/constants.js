// utils/constants.js - Application-wide constants

// Timeouts (in milliseconds)
export const TIMEOUTS = {
  MANUAL_AUTH: 300000,        // 5 minutes - timeout for manual authentication
  PAGE_LOAD: 2000,            // 2 seconds - wait after page load
  COMPONENT_LOAD: 5000,       // 5 seconds - component detection timeout
  SINGLE_CAPTURE: 60000,      // 60 seconds - single screenshot capture timeout
  MONTHLY_SPECIALS_PRIME: 500 // 0.5 seconds - delay between slide clicks
};

// Memory thresholds
export const MEMORY = {
  SCREENSHOT_WARNING_INTERVAL: 50  // Warn every N screenshots about memory usage
};

// Screen dimensions
export const SCREEN = {
  MIN_WIDTH: 1,
  MAX_WIDTH: 4096,
  MIN_HEIGHT: 1,
  MAX_HEIGHT: 4096
};

// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500
};
