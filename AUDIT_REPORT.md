# Melaleuca Unified Tester - Security & Code Audit Report

**Date**: 2026-01-02
**Version**: 1.0.0
**Auditor**: Claude Code

---

## Executive Summary

The Melaleuca Unified Tester is a functional internal testing tool for SKUs, banners, and product store landing pages using Playwright. The tool demonstrates good architectural patterns with clean separation of concerns across processors. However, it contains several critical security vulnerabilities and code quality issues that should be addressed before production use.

**Risk Level**: HIGH - Multiple critical security issues identified

---

## Critical Security Issues

### 1. Credentials Stored in localStorage (CRITICAL)

**Location**: `server.js:188-220`, `public/sku-app.js:208-223`

**Issue**: User credentials (username, password) and environment credentials (envEmail, envPassword) are stored in browser localStorage without encryption.

**Risk**:
- Credentials accessible by any script running on same domain
- Vulnerable to XSS attacks
- Accessible via local file system access
- Persisted indefinitely in plaintext

**Recommendation**:
- Use secure credential storage (server-side session, encrypted cookies)
- At minimum, encrypt before storing in localStorage
- Clear credentials on browser close
- Consider using credential management APIs

**Code Example**:
```javascript
// Current (INSECURE)
localStorage.setItem('skuTesterPrefs', JSON.stringify(prefs));

// Recommended
// Store credentials server-side with session management
// Or use Web Crypto API for encryption if client-side storage required
```

---

### 2. No HTTPS Enforcement (CRITICAL)

**Location**: `server.js:1-535`

**Issue**: Server runs on HTTP by default with no HTTPS configuration. Credentials transmitted over potentially insecure connections.

**Risk**:
- Credentials transmitted in plaintext over network
- Man-in-the-middle attacks possible
- Session hijacking possible

**Recommendation**:
- Add HTTPS support with valid certificates
- Redirect all HTTP traffic to HTTPS
- Use secure cookies (httpOnly, secure, sameSite)

---

### 3. Path Traversal Vulnerability (CRITICAL)

**Location**: `server.js:437-444`

**Issue**: No validation on `req.params.filename` in report download endpoint.

**Vulnerable Code**:
```javascript
app.get('/api/reports/:filename', (req, res) => {
  const filepath = join(REPORTS_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.download(filepath);
});
```

**Risk**:
- Directory traversal attacks (e.g., `../../../etc/passwd`)
- Unauthorized file access
- Information disclosure

**Recommendation**:
```javascript
app.get('/api/reports/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // Prevent traversal
  const filepath = join(REPORTS_DIR, filename);

  // Validate filename pattern
  if (!/^[a-zA-Z0-9_-]+\.html$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  // Ensure resolved path is within REPORTS_DIR
  const resolvedPath = path.resolve(filepath);
  if (!resolvedPath.startsWith(path.resolve(REPORTS_DIR))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.download(filepath);
});
```

---

### 4. No Authentication/Authorization (CRITICAL)

**Location**: `server.js:1-535`

**Issue**: All API endpoints are publicly accessible with no authentication or authorization.

**Risk**:
- Anyone on network can access tool and reports
- No access control or audit trail
- No rate limiting prevents abuse
- Sensitive data exposed

**Recommendation**:
- Implement authentication middleware (JWT, session-based, OAuth)
- Add authorization checks for sensitive operations
- Implement rate limiting (express-rate-limit)
- Add request logging and audit trail

---

### 5. Secrets in Logs (HIGH)

**Location**: `base-processor.js:7-15`

**Issue**: All function parameters are logged, potentially including passwords.

**Vulnerable Code**:
```javascript
export function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data) {
    console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
}
```

**Risk**:
- Passwords and credentials logged to console
- Logs may be stored or forwarded to external systems
- Compliance violations (PCI-DSS, GDPR)

**Recommendation**:
```javascript
export function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  // Sanitize sensitive fields
  const sanitizedData = data ? sanitizeLogData(data) : null;

  if (sanitizedData) {
    console.log(`${prefix} ${message}`, JSON.stringify(sanitizedData, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function sanitizeLogData(data) {
  const sensitiveFields = ['password', 'envPassword', 'token', 'secret', 'apiKey'];
  const sanitized = { ...data };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '***REDACTED***';
    }
  }

  return sanitized;
}
```

---

## Medium Security Issues

### 6. CORS Not Configured

**Location**: `server.js:42-51`

**Issue**: No CORS headers configured.

**Impact**: May be intentional for internal tool, but worth documenting.

**Recommendation**: Document CORS policy or add explicit CORS configuration.

---

### 7. No Input Validation (MEDIUM)

**Location**: `server.js:187-223`, `server.js:267-293`

**Issue**:
- SKU input not validated (potential injection points)
- Username/password not validated for format
- No sanitization of user inputs

**Risk**:
- NoSQL/SQL injection if data stored in database
- Command injection possibilities
- Invalid data processing

**Recommendation**:
- Use express-validator or joi for input validation
- Validate SKU format (digits only)
- Sanitize all user inputs
- Validate username/password formats

**Example**:
```javascript
import { body, validationResult } from 'express-validator';

app.post('/api/sku/start', [
  body('skus').isArray({ min: 1 }).withMessage('SKUs must be a non-empty array'),
  body('skus.*').matches(/^\d+$/).withMessage('SKU must be numeric'),
  body('environment').isIn(['production', 'stage', 'uat']),
  body('region').isIn(['us', 'ca', 'mx', 'uk', 'ie', 'de', 'lt', 'nl', 'pl']),
  body('username').optional().isString().trim().isLength({ min: 1, max: 100 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  // ... rest of handler
});
```

---

### 8. WebSocket Security (MEDIUM)

**Location**: `server.js:55-73`

**Issue**:
- No authentication on WebSocket connections
- No origin validation
- Anyone can connect and receive real-time updates

**Risk**:
- Unauthorized access to progress updates
- Information disclosure

**Recommendation**:
- Implement WebSocket authentication
- Validate origin headers
- Use secure WebSocket (wss://)

---

## Code Quality Issues

### 9. Error Handling Inconsistency (HIGH)

**Location**: Multiple files

**Issue**:
- Silent error catching throughout codebase
- Inconsistent error response formats
- Empty catch blocks ignore errors

**Examples**:
```javascript
// sku-processor.js:280-283
try {
  await toggle.scrollIntoViewIfNeeded();
} catch {
  // Ignore scroll failures
}

// sku-processor.js:365-368
try {
  await option.scrollIntoViewIfNeeded();
} catch {
  // Ignore scroll failures
}
```

**Recommendation**:
- Standardize error handling with middleware
- Log all errors even if ignored
- Use consistent error response format
- Add error monitoring (Sentry, LogRocket)

---

### 10. Configuration Typo (HIGH)

**Location**: `config.js:209`

**Issue**: UAT Netherlands URL has typo: `uatl.melaleuca.com` should be `uatnl.melaleuca.com`

**Current Code**:
```javascript
uat: {
  // ...
  nl: "https://productstore2-uatl.melaleuca.com",  // TYPO: uatl
  // ...
}
```

**Recommendation**:
```javascript
uat: {
  // ...
  nl: "https://productstore2-uatnl.melaleuca.com",  // FIXED: uatnl
  // ...
}
```

---

### 11. Missing SKU Format Validation (MEDIUM)

**Location**: `server.js:190-192`

**Issue**: Empty SKU arrays rejected but invalid SKU formats not validated until later.

**Recommendation**: Validate SKU format (numeric) at API boundary.

---

### 12. Hardcoded Values (MEDIUM)

**Issue**:
- Browser version not configurable
- Many magic numbers without named constants
- Timeouts hardcoded throughout

**Examples**:
- `base-processor.js:40-43`: `headless: false`, `args: ['--start-maximized']`
- Multiple timeout values without documentation

**Recommendation**:
- Extract to configuration
- Use named constants
- Document timeout purposes

---

### 13. Resource Leaks (HIGH)

**Location**: `sku-processor.js:688-756`

**Issue**:
- Browser cleanup only in `finally` block
- No maximum concurrent browser instances
- May leak resources on exceptions

**Recommendation**:
- Add resource limits
- Implement browser pooling
- Add timeout for browser operations
- Monitor resource usage

---

### 14. Memory Issues (HIGH)

**Location**: `sku-processor.js:610`

**Issue**:
- Screenshots stored in memory as base64
- No limit on number of results stored
- History limited to 20 but results array unlimited
- Large reports can cause memory issues

**Recommendation**:
- Stream large screenshots to disk
- Implement pagination for results
- Add memory usage monitoring
- Compress screenshots before storing
- Implement result size limits

---

### 15. Race Conditions (HIGH)

**Location**: `server.js:214-223`

**Issue**: Check and start operations not atomic.

**Vulnerable Code**:
```javascript
if (skuProcessor.getStatus().isRunning) {
  return res.status(409).json({ error: 'SKU capture already in progress' });
}

skuProcessor.start(options).catch(err => {
  console.error('SKU capture error:', err);
});
```

**Risk**: Multiple captures could start simultaneously.

**Recommendation**:
```javascript
// Use atomic operation or mutex
const mutex = new Mutex();

app.post('/api/sku/start', async (req, res) => {
  const release = await mutex.acquire();
  try {
    if (skuProcessor.getStatus().isRunning) {
      return res.status(409).json({ error: 'SKU capture already in progress' });
    }

    await skuProcessor.start(options);
    res.json({ ok: true, message: 'SKU capture started' });
  } catch (err) {
    console.error('SKU capture error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    release();
  }
});
```

---

### 16. Singleton Pattern Issues (MEDIUM)

**Location**: `sku-processor.js:765-773`

**Issue**:
- Processors are singletons
- State can become stale between runs
- No cleanup mechanism

**Recommendation**:
- Reset state properly between runs
- Consider factory pattern instead
- Add explicit cleanup methods

---

## Best Practices Issues

### 17. No Request Validation Middleware (MEDIUM)

**Issue**: Manual validation in each route handler with inconsistent patterns.

**Recommendation**:
- Use express-validator or joi
- Create reusable validation middleware
- Standardize validation across all endpoints

---

### 18. Outdated Dependencies Risk (MEDIUM)

**Location**: `package.json`

**Issue**:
- Package versions use caret (^) allowing minor/patch updates
- No dependency vulnerability scanning
- No lock file verification mentioned

**Current**:
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "open": "^10.0.0",
    "playwright": "^1.40.0",
    "ws": "^8.14.2"
  }
}
```

**Recommendation**:
- Run `npm audit` regularly
- Consider using exact versions in production
- Implement automated dependency updates (Dependabot)
- Add npm audit to CI/CD pipeline

---

### 19. No Logging Framework (MEDIUM)

**Location**: `base-processor.js:7-15`

**Issue**:
- Custom logging function
- No log levels, rotation, or external logging
- Logs only to console

**Recommendation**:
- Use winston or pino
- Implement log rotation
- Add structured logging
- Send logs to external service (CloudWatch, Datadog)

---

### 20. No Health Check Endpoint (LOW)

**Issue**: No `/health` or `/status` endpoint for monitoring.

**Recommendation**:
```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: '1.0.0'
  });
});
```

---

### 21. Mixed Concerns (MEDIUM)

**Location**: `server.js`

**Issue**: Server setup, routing, business logic, and file operations all in one 535-line file.

**Recommendation**:
- Separate into modules:
  - `routes/` - Route definitions
  - `controllers/` - Business logic
  - `middleware/` - Validation, auth, error handling
  - `services/` - Processor management
  - `utils/` - Helper functions

---

### 22. No Type Safety (LOW)

**Issue**:
- No TypeScript
- No JSDoc comments
- Parameters and return types not documented

**Recommendation**:
- Add comprehensive JSDoc comments
- Consider migrating to TypeScript
- Document all function signatures

---

## Performance Issues

### 23. No Caching Headers for Static Assets (MEDIUM)

**Location**: `server.js:44-49`

**Issue**: Cache-Control disables all caching even for static assets.

**Current Code**:
```javascript
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(join(__dirname, 'public')));
```

**Recommendation**:
```javascript
// Apply no-cache only to API routes
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Enable caching for static assets
app.use(express.static(join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));
```

---

### 24. Sequential SKU Processing (LOW)

**Location**: `sku-processor.js:711-728`

**Issue**: SKUs processed one at a time, could parallelize.

**Recommendation**:
- Add option for concurrent processing
- Use multiple browser contexts
- Implement worker pool pattern

---

### 25. Synchronous File Operations (MEDIUM)

**Location**: Multiple locations

**Issue**: Using `fs.writeFileSync`, `fs.readFileSync` blocks event loop.

**Examples**:
- `server.js:251` - `fs.writeFileSync(filepath, html)`
- `server.js:322` - `fs.writeFileSync(filepath, html)`
- `server.js:413` - `fs.writeFileSync(HISTORY_FILE, ...)`

**Recommendation**:
```javascript
// Use async operations
await fs.promises.writeFile(filepath, html);
const data = await fs.promises.readFile(filepath, 'utf8');
```

---

### 26. No Response Compression (LOW)

**Issue**: Large reports not compressed before sending.

**Recommendation**:
```javascript
import compression from 'compression';
app.use(compression());
```

---

## Missing Features

### 27. No Tests (HIGH)

**Issue**: No unit tests, integration tests, or E2E tests.

**Recommendation**:
- Add Jest or Vitest for unit tests
- Add Playwright tests for E2E
- Add integration tests for API endpoints
- Target 80%+ code coverage

---

### 28. No API Documentation (MEDIUM)

**Issue**: No OpenAPI/Swagger documentation for API endpoints.

**Recommendation**:
- Add swagger-jsdoc and swagger-ui-express
- Document all API endpoints
- Generate interactive API documentation

---

### 29. No Environment Variables Validation (MEDIUM)

**Location**: `server.js:27-31`

**Issue**: Environment variables used without validation.

**Recommendation**:
```javascript
import { z } from 'zod';

const envSchema = z.object({
  TESTER_PORT: z.string().regex(/^\d+$/).optional(),
  TESTER_DATA_DIR: z.string().optional(),
  TESTER_NO_AUTO_OPEN: z.enum(['0', '1']).optional(),
  TESTER_BROWSER: z.enum(['chrome', 'edge', 'firefox']).optional(),
});

const env = envSchema.parse(process.env);
```

---

### 30. No Graceful Shutdown (HIGH)

**Issue**:
- No SIGTERM/SIGINT handlers
- Browser may not close properly on shutdown
- Active captures interrupted without cleanup

**Recommendation**:
```javascript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  // Stop all active processors
  skuProcessor.stop();
  bannerProcessor.stop();
  pslpProcessor.stop();

  // Wait for cleanup
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Close server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  // Same as SIGTERM
});
```

---

## Positive Aspects

The tool demonstrates several good practices:

1. **Clean Architecture**: Well-separated processors for SKU, Banner, and PSLP testing
2. **Event-Driven**: Good use of EventEmitter for real-time updates
3. **Comprehensive Configuration**: Detailed config file with helper functions
4. **Real-Time Updates**: WebSocket implementation for live progress
5. **User Experience**: Dark/light theme, progress indicators, history management
6. **Credential Management**: UI for managing credentials (though storage needs improvement)
7. **Report Generation**: Good HTML report generation with screenshots
8. **Error Recovery**: Retry logic in some areas (login, add to cart)

---

## Priority Recommendations

### Immediate Actions (Security - Do First)

1. **Fix path traversal vulnerability** in `/api/reports/:filename`
2. **Add input validation** to prevent injection attacks
3. **Remove or encrypt credentials** in localStorage
4. **Fix UAT Netherlands URL typo** in config.js
5. **Sanitize logs** to prevent password leakage

### Short Term (Reliability - Do Within 1 Week)

6. Add proper error handling and logging framework
7. Fix race condition in capture start endpoint
8. Convert synchronous file operations to async
9. Add request validation middleware
10. Implement graceful shutdown

### Medium Term (Quality - Do Within 1 Month)

11. Add comprehensive test coverage (unit, integration, E2E)
12. Add API documentation (OpenAPI/Swagger)
13. Refactor server.js into modular structure
14. Add TypeScript or comprehensive JSDoc
15. Implement authentication/authorization

### Long Term (Enhancement - Nice to Have)

16. Add HTTPS support
17. Implement response compression
18. Add health check and monitoring endpoints
19. Optimize with concurrent SKU processing
20. Add dependency vulnerability scanning to CI/CD

---

## Conclusion

The Melaleuca Unified Tester is a well-architected testing tool with good UX and functionality. However, it contains critical security vulnerabilities that must be addressed before production use:

- **Path traversal vulnerability** allowing unauthorized file access
- **Credential storage** in plaintext localStorage
- **No authentication/authorization** on any endpoints
- **Secrets logged** to console

Addressing the immediate security issues should be the top priority, followed by reliability improvements and code quality enhancements.

**Overall Risk Assessment**: HIGH
**Recommended Action**: Address critical security issues before deploying to shared/production environments

---

**End of Report**
