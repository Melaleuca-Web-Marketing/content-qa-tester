#!/usr/bin/env node
// server.js - Express + WebSocket server for Unified Tester

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import open, { apps } from 'open';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { SkuProcessor } from './processors/sku-processor.js';
import { BannerProcessor } from './processors/banner-processor.js';
import { PSLPProcessor } from './processors/pslp-processor.js';
import { MixInAdProcessor } from './processors/mixinad-processor.js';
import { SortOrderProcessor } from './processors/sortorder-processor.js';
import { PDPProcessor } from './processors/pdp-processor.js';
import { generateSkuReport } from './report-generators/sku-report.js';
import { generateBannerReport } from './report-generators/banner-report.js';
import { generatePslpReport } from './report-generators/pslp-report.js';
import { generateMixInAdReport } from './report-generators/mixinad-report.js';
import { generateSortOrderReport } from './report-generators/sortorder-report.js';
import { generatePdpReport } from './report-generators/pdp-report.js';
import { config, validateSkuConfig, validateBannerConfig, validatePslpConfig, validateMixInAdConfig, validateSortOrderConfig, validatePdpConfig, reloadCategories, getCategoriesPath, getCategoriesTemplatePath } from './config.js';
import { asyncHandler } from './utils/async-handler.js';
import { autoGenerateReport } from './utils/auto-generate-report.js';
import { loadHistory, saveToHistory, getHistoryLimit, setHistoryLimit, deleteFromHistory, clearHistory, markAsRead } from './utils/history.js';
import { initWebSocket, broadcast } from './utils/broadcast.js';
import { cleanupOldReports, getReportStats } from './utils/report-cleanup.js';
import { LaneJobScheduler } from './utils/lane-job-scheduler.js';
import { JobStateStore } from './utils/job-state-store.js';
import { SessionLaneStore } from './utils/session-lane-store.js';
import { log } from './utils/logger.js';
import { z } from 'zod';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawPort = process.env.TESTER_PORT || process.env.PORT || '3000';
const PORT = Number.isNaN(Number(rawPort)) ? 3000 : Number(rawPort);
const rawBasePath = process.env.TESTER_BASE_PATH || '/';
const normalizedBase = rawBasePath === '/' ? '' : `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`;
const BASE_PATH = normalizedBase === '/' ? '' : normalizedBase;
const DATA_DIR = process.env.TESTER_DATA_DIR || __dirname;
const REPORTS_DIR = join(DATA_DIR, 'reports');
const JOB_STATE_FILE = join(DATA_DIR, 'job-state.json');
const SESSION_LANE_FILE = join(DATA_DIR, 'session-lanes.json');
const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
// Stress tests are commonly one job per tester; per-lane limits still prevent duplicate jobs from one session.
const DEFAULT_TOOL_CONCURRENCY = parsePositiveInt(process.env.TESTER_TOOL_CONCURRENCY, 12);
const TOOL_QUEUE_LIMIT = parsePositiveInt(process.env.TESTER_TOOL_QUEUE_LIMIT, 50);
const DEFAULT_LANE_TOOL_CONCURRENCY = parsePositiveInt(process.env.TESTER_LANE_TOOL_CONCURRENCY, 1);
const TOOL_CONCURRENCY = {
  banner: parsePositiveInt(process.env.TESTER_BANNER_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  mixinad: parsePositiveInt(process.env.TESTER_MIXINAD_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  sortorder: parsePositiveInt(process.env.TESTER_SORTORDER_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  pslp: parsePositiveInt(process.env.TESTER_PSLP_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  sku: parsePositiveInt(process.env.TESTER_SKU_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  pdp: parsePositiveInt(process.env.TESTER_PDP_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY)
};
const LANE_TOOL_CONCURRENCY = {
  banner: parsePositiveInt(process.env.TESTER_BANNER_LANE_CONCURRENCY, DEFAULT_LANE_TOOL_CONCURRENCY),
  mixinad: parsePositiveInt(process.env.TESTER_MIXINAD_LANE_CONCURRENCY, DEFAULT_LANE_TOOL_CONCURRENCY),
  sortorder: parsePositiveInt(process.env.TESTER_SORTORDER_LANE_CONCURRENCY, DEFAULT_LANE_TOOL_CONCURRENCY),
  pslp: parsePositiveInt(process.env.TESTER_PSLP_LANE_CONCURRENCY, DEFAULT_LANE_TOOL_CONCURRENCY),
  sku: parsePositiveInt(process.env.TESTER_SKU_LANE_CONCURRENCY, DEFAULT_LANE_TOOL_CONCURRENCY),
  pdp: parsePositiveInt(process.env.TESTER_PDP_LANE_CONCURRENCY, DEFAULT_LANE_TOOL_CONCURRENCY)
};
const STRICT_EXECUTION_USER_ID = !['0', 'false', 'no', 'off'].includes(
  String(process.env.TESTER_STRICT_EXECUTION_USER_ID ?? 'true').toLowerCase()
);
const JOB_STATE_MAX_ENTRIES = parsePositiveInt(process.env.TESTER_JOB_STATE_MAX_ENTRIES, 5000);
const SESSION_TTL_HOURS = parsePositiveInt(process.env.TESTER_SESSION_TTL_HOURS, 24 * 7);
const TRUST_CLIENT_USER_ID = !['0', 'false', 'no', 'off'].includes(
  String(process.env.TESTER_TRUST_CLIENT_USER_ID ?? 'false').toLowerCase()
);
const SESSION_COOKIE_NAME = process.env.TESTER_SESSION_COOKIE_NAME || 'tester_sid';
const SESSION_COOKIE_SECURE = !['0', 'false', 'no', 'off'].includes(
  String(process.env.TESTER_SESSION_COOKIE_SECURE ?? 'false').toLowerCase()
);
const SESSION_MAX_ENTRIES = parsePositiveInt(process.env.TESTER_SESSION_MAX_ENTRIES, 10000);

const app = express();
const server = createServer(app);
const router = express.Router();

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

const sessionLaneStore = new SessionLaneStore(SESSION_LANE_FILE, {
  cookieName: SESSION_COOKIE_NAME,
  ttlMs: SESSION_TTL_HOURS * 60 * 60 * 1000,
  secureCookie: SESSION_COOKIE_SECURE,
  maxSessions: SESSION_MAX_ENTRIES
});
sessionLaneStore.load();
sessionLaneStore.pruneExpired(true);
initWebSocket(server, {
  resolveUserId: (req) => sessionLaneStore.resolveLaneFromRequest(req),
  allowQueryFallback: TRUST_CLIENT_USER_ID
});

// Middleware
router.use((req, res, next) => {
  sessionLaneStore.ensureHttpSession(req, res);
  next();
});

// Global JSON body limit to prevent memory exhaustion
router.use(express.json({
  limit: '10mb',  // Maximum request body size
  strict: true    // Only accept arrays and objects
}));

// Rate limiting to prevent abuse
// Dashboard now uses WebSocket for real-time updates with 60s HTTP polling backup
// Reduced from 5000 to 1000 since WebSocket handles most traffic
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each user to 1000 requests per windowMs
  message: { error: 'Too many requests', message: 'Please try again later' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Prefer server-issued lane ID for user scoping, fallback to IPv6-safe IP key
  keyGenerator: (req) => {
    const laneId = getUserId(req);
    if (laneId) return laneId;
    // Use library's ipKeyGenerator for proper IPv6 handling
    return ipKeyGenerator(req);
  }
});

// Apply rate limiter to all API routes
router.use('/api/', apiLimiter);

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function ensureCategoriesFile() {
  const categoriesPath = getCategoriesPath();
  if (fs.existsSync(categoriesPath)) {
    return categoriesPath;
  }

  let templateData = {};
  const templatePath = getCategoriesTemplatePath();
  if (fs.existsSync(templatePath)) {
    try {
      templateData = parseJsonFile(templatePath);
    } catch (err) {
      console.warn('[Categories] Failed to read template file:', err.message);
      templateData = {};
    }
  }

  const source = templateData && templateData.data ? templateData.data : templateData;
  const versionedData = {
    _version: crypto.randomUUID(),
    _lastModified: new Date().toISOString(),
    _modifiedBy: 'system-seed',
    data: source
  };

  fs.mkdirSync(dirname(categoriesPath), { recursive: true });
  fs.writeFileSync(categoriesPath, JSON.stringify(versionedData, null, 2), 'utf8');
  console.log('[Categories] Seeded categories file:', categoriesPath);
  return categoriesPath;
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
// Serve a tiny script that exposes the base path to the frontend
router.get('/base-path.js', (req, res) => {
  res.type('application/javascript').send(`window.__BASE_PATH = ${JSON.stringify(BASE_PATH)};`);
});

router.use(express.static(join(__dirname, 'public')));

// Per-user processor registry
const userProcessors = new Map();
const jobStateStore = new JobStateStore(JOB_STATE_FILE, {
  maxEntries: JOB_STATE_MAX_ENTRIES
});
jobStateStore.load();
jobStateStore.markInFlightAsInterrupted();

let flushedDurableState = false;
function flushDurableState() {
  if (flushedDurableState) return;
  flushedDurableState = true;
  jobStateStore.flush();
  sessionLaneStore.saveNow();
}

process.once('beforeExit', flushDurableState);
process.once('SIGINT', () => {
  flushDurableState();
  process.exit(0);
});
process.once('SIGTERM', () => {
  flushDurableState();
  process.exit(0);
});

function summarizeQueueOptions(options) {
  if (!options || typeof options !== 'object') return null;
  const summary = {
    environment: options.environment || null,
    region: options.region || null,
    culturesCount: Array.isArray(options.cultures) ? options.cultures.length : (options.culture ? 1 : 0),
    widthsCount: Array.isArray(options.widths) ? options.widths.length : null,
    categoriesCount: Array.isArray(options.categories) ? options.categories.length : null,
    skusCount: Array.isArray(options.skus) ? options.skus.length : null,
    loginEnabled: options.loginEnabled === true
  };
  if (options.excelValidation && typeof options.excelValidation === 'object') {
    summary.excelValidation = {
      enabled: options.excelValidation.enabled === true,
      filename: options.excelValidation.filename || null,
      dataCount: Array.isArray(options.excelValidation.data) ? options.excelValidation.data.length : 0
    };
  }
  return summary;
}

const queueScheduler = new LaneJobScheduler({
  globalConcurrencyByTool: TOOL_CONCURRENCY,
  perLaneConcurrencyByTool: LANE_TOOL_CONCURRENCY,
  defaultGlobalConcurrency: DEFAULT_TOOL_CONCURRENCY,
  defaultPerLaneConcurrency: DEFAULT_LANE_TOOL_CONCURRENCY,
  defaultQueueLimit: TOOL_QUEUE_LIMIT,
  globalQueueLimitByTool: {
    banner: TOOL_QUEUE_LIMIT,
    mixinad: TOOL_QUEUE_LIMIT,
    sortorder: TOOL_QUEUE_LIMIT,
    pslp: TOOL_QUEUE_LIMIT,
    sku: TOOL_QUEUE_LIMIT,
    pdp: TOOL_QUEUE_LIMIT
  },
  onEnqueued: (job) => {
    jobStateStore.recordEnqueued(job, {
      optionsSummary: job.meta?.optionsSummary || null,
      queueSize: job.queueSize,
      laneQueueSize: job.laneQueueSize
    });
  },
  onStarted: (job) => {
    jobStateStore.recordStarted(job, {
      runningGlobal: job.runningGlobal,
      runningInLane: job.runningInLane
    });
  },
  onFinished: (job) => {
    jobStateStore.recordFinished(job);
  },
  onCancelled: (job) => {
    jobStateStore.recordCancelled(job);
  }
});

function enqueueToolJob({ tool, userId, processor, options, startFn }) {
  if (processor && !processor.isRunning && options) {
    processor.currentOptions = options;
  }
  return queueScheduler.enqueue({
    tool,
    laneId: userId || 'anonymous',
    processor,
    options,
    startFn,
    meta: {
      optionsSummary: summarizeQueueOptions(options)
    }
  });
}

function cancelQueuedJob(userId, tool) {
  return queueScheduler.cancelQueued(userId || 'anonymous', tool);
}

function buildQueuedStartResponse(queueResult, message) {
  return {
    ok: true,
    queued: true,
    alreadyQueued: queueResult.alreadyQueued === true,
    jobId: queueResult.jobId,
    position: queueResult.position,
    lanePosition: queueResult.lanePosition,
    running: queueResult.running,
    limit: queueResult.limit,
    laneLimit: queueResult.laneLimit,
    message
  };
}

function buildStartedResponse(queueResult, message) {
  return {
    ok: true,
    jobId: queueResult.jobId,
    running: queueResult.running,
    limit: queueResult.limit,
    laneLimit: queueResult.laneLimit,
    message
  };
}

function normalizeUserId(value) {
  if (!value) return null;
  const raw = String(value).trim();
  return raw.length > 0 ? raw.slice(0, 120) : null;
}

function getUserId(req) {
  const sessionLaneId = sessionLaneStore.resolveLaneFromRequest(req);
  if (sessionLaneId) {
    return sessionLaneId;
  }

  let userId = null;
  if (TRUST_CLIENT_USER_ID) {
    const headerId = req.get('x-user-id') || req.get('X-User-Id');
    const queryId = req.query.userId;
    userId = normalizeUserId(headerId || queryId);
  }

  if (!userId && req.path.startsWith('/api/')) {
    console.warn(`[Server] API request without lane/session identity | path: ${req.method} ${req.path}`);
  }

  return userId;
}

function getExecutionLaneId(req, res) {
  const userId = getUserId(req);
  if (!userId && STRICT_EXECUTION_USER_ID) {
    res.status(400).json({
      error: 'Missing user identity',
      message: 'Execution endpoints require a valid session cookie. Refresh the page and try again.'
    });
    return null;
  }
  return userId || 'anonymous';
}

function attachProcessorEvents(processor, tool, userId) {
  processor.on('progress', (data) => {
    // Merge progress data with current processor status
    // This ensures isRunning and other fields are always included
    const fullStatus = { ...processor.getStatus(), progress: data };
    broadcast({ type: `${tool}-progress`, data: fullStatus }, userId);
  });

  processor.on('status', (data) => {
    // Merge status event data with current processor status
    // This ensures isRunning and other fields are always included
    const fullStatus = { ...processor.getStatus(), ...data };
    log('debug', `[Server] Broadcasting ${tool} status`, {
      type: fullStatus.type,
      isRunning: fullStatus.isRunning,
      statusType: fullStatus.statusType,
      message: fullStatus.message
    });
    broadcast({ type: `${tool}-status`, data: fullStatus }, userId);
  });

  processor.on('error', (data) => {
    broadcast({ type: `${tool}-error`, data }, userId);
  });

  processor.on('result', (data) => {
    broadcast({ type: `${tool}-result`, data }, userId);
  });
}

function createProcessor(tool, userId) {
  let processor = null;
  let reportGenerator = null;

  switch (tool) {
    case 'sku':
      processor = new SkuProcessor();
      reportGenerator = generateSkuReport;
      break;
    case 'banner':
      processor = new BannerProcessor();
      reportGenerator = generateBannerReport;
      break;
    case 'pslp':
      processor = new PSLPProcessor();
      reportGenerator = generatePslpReport;
      break;
    case 'mixinad':
      processor = new MixInAdProcessor();
      reportGenerator = generateMixInAdReport;
      break;
    case 'sortorder':
      processor = new SortOrderProcessor();
      reportGenerator = generateSortOrderReport;
      break;
    case 'pdp':
      processor = new PDPProcessor();
      reportGenerator = generatePdpReport;
      break;
    default:
      return null;
  }

  processor.userId = userId;
  attachProcessorEvents(processor, tool, userId);
  autoGenerateReport(processor, reportGenerator, tool, userId);

  return processor;
}

function getProcessor(userId, tool) {
  const id = userId || 'anonymous';
  if (!userProcessors.has(id)) {
    userProcessors.set(id, {});
  }
  const entry = userProcessors.get(id);
  if (!entry[tool]) {
    entry[tool] = createProcessor(tool, id);
  }
  return entry[tool];
}

function getProcessorStatus(userId, tool) {
  const laneId = userId || 'anonymous';
  const queue = queueScheduler.getToolLaneSnapshot(laneId, tool);
  const entry = userProcessors.get(laneId);
  const processor = entry ? entry[tool] : null;
  if (!processor) {
    return {
      isRunning: false,
      resultsCount: 0,
      options: null,
      statusType: null,
      message: null,
      laneId,
      queue
    };
  }
  return {
    ...processor.getStatus(),
    laneId,
    queue
  };
}

function getProcessorResults(userId, tool) {
  const entry = userProcessors.get(userId || 'anonymous');
  const processor = entry ? entry[tool] : null;
  if (!processor) return [];
  if (tool === 'pslp' && typeof processor.getActivityResults === 'function') {
    return processor.getActivityResults();
  }
  return processor.getResults();
}

// ============ API Routes ============

// Get unified configuration
router.get('/api/config', (req, res) => {
  res.json({
    environments: Object.keys(config.environments),
    regions: config.regions,
    cultureNames: config.cultureNames,
    banner: {
      widths: config.banner.widths,
      regions: config.banner.regions,
      cultureLangMap: config.banner.cultureLangMap,
      defaults: config.banner.defaults
    },
    pslp: {
      screenWidths: config.pslp.screenWidths,
      components: config.pslp.components,
      componentNames: config.pslp.componentNames,
      defaults: config.pslp.defaults
    },
    mixinad: {
      widths: config.mixinad.widths,
      regions: config.mixinad.regions,
      cultureLangMap: config.mixinad.cultureLangMap,
      defaults: config.mixinad.defaults
    },
    sortorder: {
      regions: config.sortorder.regions,
      cultureLangMap: config.sortorder.cultureLangMap,
      defaults: config.sortorder.defaults
    }
  });
});

router.get('/api/session', (req, res) => {
  const laneId = getUserId(req) || 'anonymous';
  res.json({
    laneId,
    sessionBound: true,
    trustClientUserIdFallback: TRUST_CLIENT_USER_ID
  });
});

// ============ Category Management API Routes ============

// Zod schema for category validation
const CategoryItemSchema = z.object({
  label: z.string().min(1).max(200),
  path: z.string().regex(/^\/[\w\-\/]*$/).optional(),
  paths: z.record(z.string(), z.string().regex(/^\/[\w\-\/]*$/)).optional()
}).refine(data => data.path || data.paths, {
  message: "Either 'path' or 'paths' must be provided"
});

const CategorySchema = z.record(
  z.string().min(1).max(100), // Region name
  z.record(
    z.string().min(1).max(100), // Category name
    z.array(CategoryItemSchema).min(1).max(100)
  )
);

router.get('/api/categories', (req, res) => {
  try {
    const categoriesPath = ensureCategoriesFile();
    const parsed = parseJsonFile(categoriesPath);

    // Check if data has version metadata
    if (parsed._version) {
      // New format with version metadata
      res.json({
        version: parsed._version,
        lastModified: parsed._lastModified,
        modifiedBy: parsed._modifiedBy,
        data: parsed.data
      });
    } else {
      // Legacy format without version - migrate on first read
      const version = crypto.randomUUID();
      const versionedData = {
        _version: version,
        _lastModified: new Date().toISOString(),
        _modifiedBy: 'system-migration',
        data: parsed
      };

      // Write migrated format back to file
      fs.writeFileSync(categoriesPath, JSON.stringify(versionedData, null, 2), 'utf8');

      res.json({
        version: version,
        lastModified: versionedData._lastModified,
        modifiedBy: 'system-migration',
        data: parsed
      });
    }
  } catch (err) {
    console.error('Failed to read categories:', err);
    res.status(500).json({ error: 'Failed to load categories', message: err.message });
  }
});

router.post('/api/categories', express.json(), (req, res) => {
  try {
    const userId = getUserId(req) || 'anonymous';
    const { categories, version } = req.body;

    if (!categories) {
      return res.status(400).json({ error: 'No categories data provided' });
    }

    // Validate with Zod schema
    const validationResult = CategorySchema.safeParse(categories);

    if (!validationResult.success) {
      const issues = validationResult.error?.issues || validationResult.error?.errors || [];
      const errors = issues.map(err => ({
        path: Array.isArray(err.path) ? err.path.join('.') : String(err.path || ''),
        message: err.message || 'Invalid value'
      }));
      console.warn('[Categories] Validation failed', { userId, errors });
      return res.status(400).json({
        error: 'Invalid categories data',
        details: errors
      });
    }

    const validatedCategories = validationResult.data;
    const categoriesPath = getCategoriesPath();
    fs.mkdirSync(dirname(categoriesPath), { recursive: true });

    // Read current file to check for conflicts
    let currentData;
    try {
      currentData = parseJsonFile(categoriesPath);
    } catch (err) {
      // File doesn't exist or is corrupted, create new
      currentData = null;
    }

    // Check for version conflict
    if (currentData && currentData._version) {
      if (version && currentData._version !== version) {
        return res.status(409).json({
          error: 'Conflict detected',
          message: 'Categories have been modified by another user. Please reload to get the latest version.',
          currentVersion: currentData._version,
          lastModifiedBy: currentData._modifiedBy,
          lastModified: currentData._lastModified
        });
      }
    }

    // Create new version
    const newVersion = crypto.randomUUID();
    const versionedData = {
      _version: newVersion,
      _lastModified: new Date().toISOString(),
      _modifiedBy: userId,
      data: validatedCategories
    };

    // Write with new version
    fs.writeFileSync(categoriesPath, JSON.stringify(versionedData, null, 2), 'utf8');

    // Reload categories in memory
    reloadCategories();

    res.json({
      success: true,
      message: 'Categories saved successfully',
      version: newVersion,
      lastModified: versionedData._lastModified
    });
  } catch (err) {
    console.error('Failed to save categories:', err);
    res.status(500).json({ error: 'Failed to save categories', message: err.message });
  }
});

// ============ SKU API Routes ============

router.get('/api/sku/status', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorStatus(userId, 'sku'));
});

router.post('/api/sku/start', asyncHandler(async (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  console.log(`[API] POST /api/sku/start | userId: ${effectiveUserId} | SKU count: ${req.body.skus?.length || 0}`);
  const { skus, environment, region, culture, cultures, fullScreenshot, topScreenshot, addToCart, username, password, testName } = req.body;
  const normalizedTestName = typeof testName === 'string' ? testName.trim() : '';

  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({ error: 'No SKUs provided' });
  }

  // Prevent excessive SKU counts to avoid memory exhaustion
  if (skus.length > 500) {
    return res.status(400).json({
      error: 'Too many SKUs',
      message: 'Maximum 500 SKUs allowed per batch. Please split into smaller batches.'
    });
  }

  if (typeof testName === 'string' && normalizedTestName.length > 120) {
    return res.status(400).json({ error: 'Test name too long', message: 'Maximum 120 characters allowed' });
  }

  const useTopScreenshot = topScreenshot === true;
  const normalizedCultures = Array.isArray(cultures)
    ? cultures.map(c => String(c).trim()).filter(Boolean)
    : (culture ? [String(culture).trim()] : []);
  const defaultCulture = config.sku.defaults?.culture || 'en-US';
  const selectedCultures = normalizedCultures.length > 0
    ? normalizedCultures
    : [defaultCulture];

  const options = {
    testName: normalizedTestName || null,
    skus: skus.map(s => String(s).trim()).filter(Boolean),
    environment: environment || 'production',
    region: region || 'us',
    culture: selectedCultures[0],
    cultures: selectedCultures,
    fullScreenshot: fullScreenshot !== false && !useTopScreenshot,
    topScreenshot: useTopScreenshot,
    addToCart: addToCart === true,
    username: username || null,
    password: password || null
  };

  const errors = validateSkuConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const skuProcessor = getProcessor(effectiveUserId, 'sku');
  if (skuProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'SKU capture already in progress' });
  }

  const queueResult = enqueueToolJob({
    tool: 'sku',
    userId: effectiveUserId,
    processor: skuProcessor,
    options,
    startFn: () => skuProcessor.start(options).catch(err => {
      console.error('SKU capture error:', err);
      broadcast({
        type: 'error',
        tool: 'sku',
        data: { message: err.message, stack: err.stack }
      }, effectiveUserId);
      throw err;
    })
  });

  if (queueResult.rejected) {
    return res.status(429).json({
      error: 'Queue is full',
      message: 'Too many captures are queued. Please try again later.'
    });
  }

  // Broadcast immediate status update via WebSocket
  broadcast({ type: 'sku-status', data: getProcessorStatus(effectiveUserId, 'sku') }, effectiveUserId);

  if (queueResult.queued) {
    return res.json(buildQueuedStartResponse(queueResult, 'SKU capture queued'));
  }

  res.json(buildStartedResponse(queueResult, 'SKU capture started'));
}));

router.post('/api/sku/stop', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const skuProcessor = getProcessor(effectiveUserId, 'sku');
  const cancelledJob = cancelQueuedJob(effectiveUserId, 'sku');
  if (cancelledJob) {
    broadcast({ type: 'sku-status', data: skuProcessor.getStatus() }, effectiveUserId);
    return res.json({ ok: true, jobId: cancelledJob.id, message: 'Removed from queue' });
  }
  skuProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'sku-status', data: skuProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/sku/resume', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const skuProcessor = getProcessor(effectiveUserId, 'sku');
  skuProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'sku-status', data: skuProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/sku/update-credentials', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const skuProcessor = getProcessor(effectiveUserId, 'sku');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  skuProcessor.updateCredentials(username, password);
  res.json({ ok: true, message: 'Credentials updated' });
});

router.get('/api/sku/results', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorResults(userId, 'sku'));
});

router.get('/api/banner/status', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorStatus(userId, 'banner'));
});

router.post('/api/banner/start', asyncHandler(async (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const { environment, region, cultures, widths, categories, excelValidation, loginEnabled, username, password, testName } = req.body;
  const normalizedTestName = typeof testName === 'string' ? testName.trim() : '';

  if (!cultures || !Array.isArray(cultures) || cultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  if (cultures.length > 50) {
    return res.status(400).json({ error: 'Too many cultures', message: 'Maximum 50 cultures allowed' });
  }

  if (!widths || !Array.isArray(widths) || widths.length === 0) {
    return res.status(400).json({ error: 'No widths selected' });
  }

  if (widths.length > 20) {
    return res.status(400).json({ error: 'Too many widths', message: 'Maximum 20 widths allowed' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  if (categories.length > 100) {
    return res.status(400).json({ error: 'Too many categories', message: 'Maximum 100 categories allowed' });
  }

  if (typeof testName === 'string' && normalizedTestName.length > 120) {
    return res.status(400).json({ error: 'Test name too long', message: 'Maximum 120 characters allowed' });
  }

  const bannerProcessor = getProcessor(effectiveUserId, 'banner');
  if (bannerProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Banner capture already in progress' });
  }

  const options = {
    testName: normalizedTestName || null,
    environment,
    region,
    cultures,
    widths,
    categories,
    loginEnabled: loginEnabled === true,
    username: loginEnabled ? (username || null) : null,
    password: loginEnabled ? (password || null) : null
  };

  const errors = validateBannerConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  // Include Excel validation data if provided
  if (excelValidation && excelValidation.enabled) {
    options.excelValidation = excelValidation;
  }

  const queueResult = enqueueToolJob({
    tool: 'banner',
    userId: effectiveUserId,
    processor: bannerProcessor,
    options,
    startFn: () => bannerProcessor.start(options).catch(err => {
      console.error('Banner capture error:', err);
      broadcast({ type: 'banner-error', data: { message: err.message } }, effectiveUserId);
      throw err;
    })
  });

  if (queueResult.rejected) {
    return res.status(429).json({
      error: 'Queue is full',
      message: 'Too many captures are queued. Please try again later.'
    });
  }

  // Broadcast immediate status update via WebSocket
  broadcast({ type: 'banner-status', data: getProcessorStatus(effectiveUserId, 'banner') }, effectiveUserId);

  if (queueResult.queued) {
    return res.json(buildQueuedStartResponse(queueResult, 'Banner capture queued'));
  }

  res.json(buildStartedResponse(queueResult, 'Banner capture started'));
}));

router.post('/api/banner/stop', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const bannerProcessor = getProcessor(effectiveUserId, 'banner');
  const cancelledJob = cancelQueuedJob(effectiveUserId, 'banner');
  if (cancelledJob) {
    broadcast({ type: 'banner-status', data: bannerProcessor.getStatus() }, effectiveUserId);
    return res.json({ ok: true, jobId: cancelledJob.id, message: 'Removed from queue' });
  }
  bannerProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'banner-status', data: bannerProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/banner/resume', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const bannerProcessor = getProcessor(effectiveUserId, 'banner');
  bannerProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'banner-status', data: bannerProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/banner/update-credentials', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const bannerProcessor = getProcessor(effectiveUserId, 'banner');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  bannerProcessor.updateCredentials(username, password);
  res.json({ ok: true, message: 'Credentials updated' });
});

router.get('/api/banner/results', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorResults(userId, 'banner'));
});

// ============ PSLP API Routes ============

router.get('/api/pslp/status', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorStatus(userId, 'pslp'));
});

router.post('/api/pslp/start', asyncHandler(async (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const { environment, region, culture, cultures, components, widths, screenWidths, username, password, excelValidation, testName } = req.body;
  const normalizedTestName = typeof testName === 'string' ? testName.trim() : '';

  const normalizedCultures = Array.isArray(cultures)
    ? cultures.map(c => String(c).trim()).filter(Boolean)
    : (culture ? [String(culture).trim()] : []);

  if (normalizedCultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  // Validate array sizes to prevent memory exhaustion
  if (components && Array.isArray(components) && components.length > 50) {
    return res.status(400).json({ error: 'Too many components', message: 'Maximum 50 components allowed' });
  }

  const widthsArray = screenWidths || widths;
  if (widthsArray && Array.isArray(widthsArray) && widthsArray.length > 20) {
    return res.status(400).json({ error: 'Too many screen widths', message: 'Maximum 20 screen widths allowed' });
  }

  if (typeof testName === 'string' && normalizedTestName.length > 120) {
    return res.status(400).json({ error: 'Test name too long', message: 'Maximum 120 characters allowed' });
  }

  const pslpProcessor = getProcessor(effectiveUserId, 'pslp');
  if (pslpProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'PSLP capture already in progress' });
  }

  const options = {
    testName: normalizedTestName || null,
    environment: environment || 'production',
    region: region || 'us',
    culture: normalizedCultures[0],
    cultures: normalizedCultures,
    components: components || config.pslp.defaults.components,
    screenWidths: screenWidths || widths || config.pslp.screenWidths,
    username: username || null,
    password: password || null
  };

  const errors = validatePslpConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  if (excelValidation && excelValidation.enabled) {
    options.excelValidation = excelValidation;
  }

  const queueResult = enqueueToolJob({
    tool: 'pslp',
    userId: effectiveUserId,
    processor: pslpProcessor,
    options,
    startFn: () => pslpProcessor.start(options).catch(err => {
      console.error('PSLP capture error:', err);
      broadcast({ type: 'pslp-error', data: { message: err.message } }, effectiveUserId);
      throw err;
    })
  });

  if (queueResult.rejected) {
    return res.status(429).json({
      error: 'Queue is full',
      message: 'Too many captures are queued. Please try again later.'
    });
  }

  // Broadcast immediate status update via WebSocket
  broadcast({ type: 'pslp-status', data: getProcessorStatus(effectiveUserId, 'pslp') }, effectiveUserId);

  if (queueResult.queued) {
    return res.json(buildQueuedStartResponse(queueResult, 'PSLP capture queued'));
  }

  res.json(buildStartedResponse(queueResult, 'PSLP capture started'));
}));

router.post('/api/pslp/stop', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const pslpProcessor = getProcessor(effectiveUserId, 'pslp');
  const cancelledJob = cancelQueuedJob(effectiveUserId, 'pslp');
  if (cancelledJob) {
    broadcast({ type: 'pslp-status', data: pslpProcessor.getStatus() }, effectiveUserId);
    return res.json({ ok: true, jobId: cancelledJob.id, message: 'Removed from queue' });
  }
  pslpProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pslp-status', data: pslpProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/pslp/resume', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const pslpProcessor = getProcessor(effectiveUserId, 'pslp');
  pslpProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pslp-status', data: pslpProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/pslp/update-credentials', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const pslpProcessor = getProcessor(effectiveUserId, 'pslp');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  pslpProcessor.updateCredentials(username, password);
  res.json({ ok: true, message: 'Credentials updated' });
});

router.get('/api/pslp/results', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorResults(userId, 'pslp'));
});

// ============ Mix-In Ad API Routes ============

router.get('/api/mixinad/status', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorStatus(userId, 'mixinad'));
});

router.post('/api/mixinad/start', asyncHandler(async (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const { environment, region, cultures, widths, categories, excelValidation, loginEnabled, username, password, testName } = req.body;
  const normalizedTestName = typeof testName === 'string' ? testName.trim() : '';

  if (!cultures || !Array.isArray(cultures) || cultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  if (cultures.length > 50) {
    return res.status(400).json({ error: 'Too many cultures', message: 'Maximum 50 cultures allowed' });
  }

  if (!widths || !Array.isArray(widths) || widths.length === 0) {
    return res.status(400).json({ error: 'No widths selected' });
  }

  if (widths.length > 20) {
    return res.status(400).json({ error: 'Too many widths', message: 'Maximum 20 widths allowed' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  if (categories.length > 100) {
    return res.status(400).json({ error: 'Too many categories', message: 'Maximum 100 categories allowed' });
  }

  if (typeof testName === 'string' && normalizedTestName.length > 120) {
    return res.status(400).json({ error: 'Test name too long', message: 'Maximum 120 characters allowed' });
  }

  const mixinAdProcessor = getProcessor(effectiveUserId, 'mixinad');
  if (mixinAdProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Mix-In Ad capture already in progress' });
  }

  const options = {
    testName: normalizedTestName || null,
    environment,
    region,
    cultures,
    widths,
    categories,
    loginEnabled: loginEnabled === true,
    username: loginEnabled ? (username || null) : null,
    password: loginEnabled ? (password || null) : null
  };

  const errors = validateMixInAdConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  // Include Excel validation data if provided
  if (excelValidation && excelValidation.enabled) {
    options.excelValidation = excelValidation;
  }

  const queueResult = enqueueToolJob({
    tool: 'mixinad',
    userId: effectiveUserId,
    processor: mixinAdProcessor,
    options,
    startFn: () => mixinAdProcessor.start(options).catch(err => {
      console.error('Mix-In Ad capture error:', err);
      broadcast({ type: 'mixinad-error', data: { message: err.message } }, effectiveUserId);
      throw err;
    })
  });

  if (queueResult.rejected) {
    return res.status(429).json({
      error: 'Queue is full',
      message: 'Too many captures are queued. Please try again later.'
    });
  }

  // Broadcast immediate status update via WebSocket
  broadcast({ type: 'mixinad-status', data: getProcessorStatus(effectiveUserId, 'mixinad') }, effectiveUserId);

  if (queueResult.queued) {
    return res.json(buildQueuedStartResponse(queueResult, 'Mix-In Ad capture queued'));
  }

  res.json(buildStartedResponse(queueResult, 'Mix-In Ad capture started'));
}));

router.post('/api/mixinad/stop', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const mixinAdProcessor = getProcessor(effectiveUserId, 'mixinad');
  const cancelledJob = cancelQueuedJob(effectiveUserId, 'mixinad');
  if (cancelledJob) {
    broadcast({ type: 'mixinad-status', data: mixinAdProcessor.getStatus() }, effectiveUserId);
    return res.json({ ok: true, jobId: cancelledJob.id, message: 'Removed from queue' });
  }
  mixinAdProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'mixinad-status', data: mixinAdProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/mixinad/resume', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const mixinAdProcessor = getProcessor(effectiveUserId, 'mixinad');
  mixinAdProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'mixinad-status', data: mixinAdProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/mixinad/update-credentials', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const mixinAdProcessor = getProcessor(effectiveUserId, 'mixinad');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  mixinAdProcessor.updateCredentials(username, password);
  res.json({ ok: true, message: 'Credentials updated' });
});

router.get('/api/mixinad/results', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorResults(userId, 'mixinad'));
});

// ============ Sort Order API Routes ============

router.get('/api/sortorder/status', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorStatus(userId, 'sortorder'));
});

router.post('/api/sortorder/start', asyncHandler(async (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const { environment, region, cultures, categories, loginEnabled, username, password, testName, sortValidationEnabled } = req.body;
  const normalizedTestName = typeof testName === 'string' ? testName.trim() : '';

  if (!cultures || !Array.isArray(cultures) || cultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  if (cultures.length > 50) {
    return res.status(400).json({ error: 'Too many cultures', message: 'Maximum 50 cultures allowed' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  if (categories.length > 100) {
    return res.status(400).json({ error: 'Too many categories', message: 'Maximum 100 categories allowed' });
  }

  if (typeof testName === 'string' && normalizedTestName.length > 120) {
    return res.status(400).json({ error: 'Test name too long', message: 'Maximum 120 characters allowed' });
  }

  const sortOrderProcessor = getProcessor(effectiveUserId, 'sortorder');
  if (sortOrderProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Sort order capture already in progress' });
  }

  const options = {
    testName: normalizedTestName || null,
    sortValidationEnabled: sortValidationEnabled !== false,
    environment,
    region,
    cultures,
    widths: [config.sortorder.defaults.width],
    categories,
    loginEnabled: loginEnabled === true,
    username: loginEnabled ? (username || null) : null,
    password: loginEnabled ? (password || null) : null
  };

  const errors = validateSortOrderConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const queueResult = enqueueToolJob({
    tool: 'sortorder',
    userId: effectiveUserId,
    processor: sortOrderProcessor,
    options,
    startFn: () => sortOrderProcessor.start(options).catch((err) => {
      console.error('Sort order capture error:', err);
      broadcast({ type: 'sortorder-error', data: { message: err.message } }, effectiveUserId);
      throw err;
    })
  });

  if (queueResult.rejected) {
    return res.status(429).json({
      error: 'Queue is full',
      message: 'Too many captures are queued. Please try again later.'
    });
  }

  broadcast({ type: 'sortorder-status', data: getProcessorStatus(effectiveUserId, 'sortorder') }, effectiveUserId);

  if (queueResult.queued) {
    return res.json(buildQueuedStartResponse(queueResult, 'Sort order capture queued'));
  }

  res.json(buildStartedResponse(queueResult, 'Sort order capture started'));
}));

router.post('/api/sortorder/stop', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const sortOrderProcessor = getProcessor(effectiveUserId, 'sortorder');
  const cancelledJob = cancelQueuedJob(effectiveUserId, 'sortorder');
  if (cancelledJob) {
    broadcast({ type: 'sortorder-status', data: sortOrderProcessor.getStatus() }, effectiveUserId);
    return res.json({ ok: true, jobId: cancelledJob.id, message: 'Removed from queue' });
  }
  sortOrderProcessor.stop();
  broadcast({ type: 'sortorder-status', data: sortOrderProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/sortorder/resume', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const sortOrderProcessor = getProcessor(effectiveUserId, 'sortorder');
  sortOrderProcessor.resume();
  broadcast({ type: 'sortorder-status', data: sortOrderProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/sortorder/update-credentials', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const sortOrderProcessor = getProcessor(effectiveUserId, 'sortorder');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  sortOrderProcessor.updateCredentials(username, password);
  res.json({ ok: true, message: 'Credentials updated' });
});

router.get('/api/sortorder/results', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorResults(userId, 'sortorder'));
});

// ============ PDP API Routes ============

router.get('/api/pdp/status', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorStatus(userId, 'pdp'));
});

router.post('/api/pdp/start', asyncHandler(async (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  console.log(`[API] POST /api/pdp/start | userId: ${effectiveUserId} | SKU count: ${req.body.skus?.length || 0}`);
  const { skus, environment, region, culture, cultures, username, password, testName } = req.body;
  const normalizedTestName = typeof testName === 'string' ? testName.trim() : '';

  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({ error: 'No SKUs provided' });
  }

  // Prevent excessive SKU counts to avoid memory exhaustion
  if (skus.length > 500) {
    return res.status(400).json({
      error: 'Too many SKUs',
      message: 'Maximum 500 SKUs allowed per batch. Please split into smaller batches.'
    });
  }

  if (typeof testName === 'string' && normalizedTestName.length > 120) {
    return res.status(400).json({ error: 'Test name too long', message: 'Maximum 120 characters allowed' });
  }

  const normalizedCultures = Array.isArray(cultures)
    ? cultures.map(c => String(c).trim()).filter(Boolean)
    : (culture ? [String(culture).trim()] : []);
  const defaultCulture = config.pdp.defaults?.culture || 'en-US';
  const selectedCultures = normalizedCultures.length > 0
    ? normalizedCultures
    : [defaultCulture];

  const options = {
    testName: normalizedTestName || null,
    skus: skus.map(s => String(s).trim()).filter(Boolean),
    environment: environment || 'production',
    region: region || 'us',
    culture: selectedCultures[0],
    cultures: selectedCultures,
    username: username || null,
    password: password || null
  };

  const errors = validatePdpConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const pdpProcessor = getProcessor(effectiveUserId, 'pdp');
  if (pdpProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'PDP capture already in progress' });
  }

  const queueResult = enqueueToolJob({
    tool: 'pdp',
    userId: effectiveUserId,
    processor: pdpProcessor,
    options,
    startFn: () => pdpProcessor.start(options).catch(err => {
      console.error('PDP capture error:', err);
      broadcast({
        type: 'error',
        tool: 'pdp',
        data: { message: err.message, stack: err.stack }
      }, effectiveUserId);
      throw err;
    })
  });

  if (queueResult.rejected) {
    return res.status(429).json({
      error: 'Queue is full',
      message: 'Too many captures are queued. Please try again later.'
    });
  }

  // Broadcast immediate status update via WebSocket
  broadcast({ type: 'pdp-status', data: getProcessorStatus(effectiveUserId, 'pdp') }, effectiveUserId);

  if (queueResult.queued) {
    return res.json(buildQueuedStartResponse(queueResult, 'PDP capture queued'));
  }

  res.json(buildStartedResponse(queueResult, 'PDP capture started'));
}));

router.post('/api/pdp/stop', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const pdpProcessor = getProcessor(effectiveUserId, 'pdp');
  const cancelledJob = cancelQueuedJob(effectiveUserId, 'pdp');
  if (cancelledJob) {
    broadcast({ type: 'pdp-status', data: pdpProcessor.getStatus() }, effectiveUserId);
    return res.json({ ok: true, jobId: cancelledJob.id, message: 'Removed from queue' });
  }
  pdpProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pdp-status', data: pdpProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/pdp/resume', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const pdpProcessor = getProcessor(effectiveUserId, 'pdp');
  pdpProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pdp-status', data: pdpProcessor.getStatus() }, effectiveUserId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/pdp/update-credentials', (req, res) => {
  const effectiveUserId = getExecutionLaneId(req, res);
  if (!effectiveUserId) return;
  const pdpProcessor = getProcessor(effectiveUserId, 'pdp');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  pdpProcessor.updateCredentials(username, password);
  res.json({ ok: true, message: 'Credentials updated' });
});

router.get('/api/pdp/results', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorResults(userId, 'pdp'));
});

router.get('/api/queues/me', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  res.json(queueScheduler.getLaneSnapshot(userId));
});

router.get('/api/jobs/me', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const limitRaw = Number.parseInt(String(req.query.limit || '100'), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
  const tool = req.query.tool ? String(req.query.tool) : '';
  const state = req.query.state ? String(req.query.state) : '';
  const jobs = jobStateStore.listByLane(userId, { limit, tool, state });
  res.json({ laneId: userId, count: jobs.length, jobs });
});

router.get('/api/jobs/:jobId', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const jobId = String(req.params.jobId || '').trim();
  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId' });
  }
  const job = jobStateStore.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.laneId !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(job);
});

// Auto-generate reports on completion (per-user processors are wired on creation)

router.use('/reports', express.static(REPORTS_DIR));

// ============ Shared Routes ============

router.get('/api/history', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const history = loadHistory(userId);
  log('debug', '[API] Returning history entries', { userId, count: history.length });
  res.json({ history, limit: getHistoryLimit(userId) });
});

router.post('/api/history/limit', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const { limit } = req.body;
  if (setHistoryLimit(userId, limit)) {
    res.json({ ok: true, limit: getHistoryLimit(userId) });
  } else {
    res.status(400).json({ error: 'Invalid limit' });
  }
});

// Delete a single history entry and its report file
router.delete('/api/history/:filename', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const { filename } = req.params;
  log('debug', '[API] Deleting history entry', { userId, filename });

  // Validate filename to prevent path traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const history = loadHistory(userId);
  const entry = history.find((item) => item.filename === filename);
  if (!entry) {
    return res.status(404).json({ error: 'History item not found' });
  }

  const reportPath = join(REPORTS_DIR, filename);

  // Delete report file if it exists
  try {
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
  } catch (err) {
    console.error('Error deleting report file:', err);
  }

  // Remove from history
  if (deleteFromHistory(filename, userId)) {
    res.json({ ok: true, message: 'History item deleted' });
  } else {
    res.status(404).json({ error: 'History item not found' });
  }
});

// Mark a history entry as read
router.post('/api/history/:filename/read', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const { filename } = req.params;
  log('debug', '[API] Marking history entry as read', { userId, filename });

  // Validate filename
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const marked = markAsRead(filename, userId);
  if (marked) {
    // Return updated history for frontend refresh
    const history = loadHistory(userId);
    res.json({ ok: true, history });
  } else {
    res.json({ ok: true, message: 'Already read or not found' });
  }
});

// Clear all history
router.delete('/api/history', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const deleteReports = req.query.deleteReports === 'true';
  log('debug', '[API] Clearing history entries', { userId, deleteReports });

  if (deleteReports) {
    const history = loadHistory(userId);
    try {
      for (const entry of history) {
        if (entry.filename && entry.filename.endsWith('.html')) {
          const filePath = join(REPORTS_DIR, entry.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (err) {
      console.error('Error deleting report files:', err);
    }
  }

  clearHistory(userId);
  res.json({ ok: true, message: 'History cleared' });
});

// Download a report file
router.get('/api/reports/:filename', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const { filename } = req.params;

  // Validate filename to prevent path traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const history = loadHistory(userId);
  const entry = history.find((item) => item.filename === filename);
  if (!entry) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const reportPath = join(REPORTS_DIR, filename);

  if (!fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  if (req.query.download === 'true') {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(reportPath);
});

// ============ Report Cleanup Routes ============

router.get('/api/reports/stats', (req, res) => {
  const stats = getReportStats(REPORTS_DIR);
  if (stats) {
    res.json(stats);
  } else {
    res.status(500).json({ error: 'Failed to get report stats' });
  }
});

router.post('/api/reports/cleanup', express.json(), (req, res) => {
  const { daysToKeep = 30 } = req.body;

  if (typeof daysToKeep !== 'number' || daysToKeep < 1) {
    return res.status(400).json({ error: 'Invalid daysToKeep value' });
  }

  const result = cleanupOldReports(REPORTS_DIR, daysToKeep);
  res.json({ ok: true, ...result });
});


// ============ Start Server ============

function resolveBrowserApp(browserName) {
  if (!browserName) return null;
  const key = browserName.toLowerCase();
  switch (key) {
    case 'chrome':
      return apps.chrome;
    case 'edge':
    case 'msedge':
      return apps.edge;
    case 'firefox':
      return apps.firefox;
    default:
      return null;
  }
}

// Global error handler (must be defined after all routes)
router.use((err, req, res, next) => {
  console.error('Express error:', err);

  // Send error response
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Mount router at base path
app.use(BASE_PATH || '/', router);

// Auto-cleanup old reports on startup (configurable)
const autoCleanupDays = process.env.TESTER_CLEANUP_DAYS
  ? parseInt(process.env.TESTER_CLEANUP_DAYS)
  : null;

if (autoCleanupDays && autoCleanupDays > 0) {
  console.log(`[Startup] Auto-cleanup enabled: deleting reports older than ${autoCleanupDays} days`);
  const result = cleanupOldReports(REPORTS_DIR, autoCleanupDays);
  console.log(`[Startup] Cleanup result: ${result.deleted} deleted, ${result.kept} kept, ${result.errors} errors`);
} else {
  console.log('[Startup] Auto-cleanup disabled (set TESTER_CLEANUP_DAYS to enable)');
}

server.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  const url = `http://localhost:${port}${BASE_PATH}`;
  console.log('');
  console.log('='.repeat(50));
  console.log('  Melaleuca Content QA Tester');
  console.log('='.repeat(50));
  console.log(`  Server running at: ${url}`);
  console.log('  Press Ctrl+C to stop');
  console.log('='.repeat(50));
  console.log('');

  const disableAutoOpen = process.env.TESTER_NO_AUTO_OPEN === '1';
  if (!disableAutoOpen) {
    const browserApp = resolveBrowserApp(process.env.TESTER_BROWSER);
    if (browserApp) {
      open(url, { app: { name: browserApp } });
    } else {
      open(url);
    }
  }
});
