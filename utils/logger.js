// logger.js - Shared logging utilities with redaction

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const SENSITIVE_KEY_PATTERN = /pass(word)?|pwd|token|authorization|cookie|session|secret|apikey|api_key|clientsecret|client_secret/i;

function shouldLog(level) {
  const currentRaw = process.env.TESTER_LOG_LEVEL || process.env.LOG_LEVEL || 'info';
  const current = String(currentRaw).toLowerCase();
  const normalized = String(level || 'info').toLowerCase();
  const currentLevel = LOG_LEVELS[current] ?? LOG_LEVELS.info;
  const messageLevel = LOG_LEVELS[normalized] ?? LOG_LEVELS.info;
  return messageLevel <= currentLevel;
}

function isSensitiveKey(key) {
  if (!key) return false;
  return SENSITIVE_KEY_PATTERN.test(String(key));
}

function truncateString(value, maxLength) {
  if (typeof value !== 'string') return value;
  if (!maxLength || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...(truncated)`;
}

export function redact(value, options = {}) {
  const maxStringLength = options.maxStringLength ?? 500;
  const seen = new WeakSet();

  const walk = (val) => {
    if (val === null || val === undefined) return val;
    const valType = typeof val;
    if (valType === 'string') {
      return truncateString(val, maxStringLength);
    }
    if (valType !== 'object') {
      return val;
    }

    if (val instanceof Error) {
      return {
        name: val.name,
        message: truncateString(val.message, maxStringLength),
        stack: truncateString(val.stack, maxStringLength)
      };
    }

    if (seen.has(val)) return '[Circular]';
    seen.add(val);

    if (Array.isArray(val)) {
      return val.map(walk);
    }

    const output = {};
    Object.entries(val).forEach(([key, entryValue]) => {
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = walk(entryValue);
      }
    });
    return output;
  };

  return walk(value);
}

export function log(level, message, data = null) {
  if (!shouldLog(level)) return;
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${String(level || 'info').toUpperCase()}]`;
  const safeData = data ? redact(data) : null;
  if (safeData) {
    console.log(`${prefix} ${message}`, JSON.stringify(safeData, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
}
