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
import { PDPProcessor } from './processors/pdp-processor.js';
import { generateSkuReport } from './report-generators/sku-report.js';
import { generateBannerReport } from './report-generators/banner-report.js';
import { generatePslpReport } from './report-generators/pslp-report.js';
import { generateMixInAdReport } from './report-generators/mixinad-report.js';
import { generatePdpReport } from './report-generators/pdp-report.js';
import { config, validateSkuConfig, validateBannerConfig, validatePslpConfig, validateMixInAdConfig, validatePdpConfig, reloadCategories, getCategoriesPath, getCategoriesTemplatePath } from './config.js';
import { asyncHandler } from './utils/async-handler.js';
import { autoGenerateReport } from './utils/auto-generate-report.js';
import { loadHistory, saveToHistory, getHistoryLimit, setHistoryLimit, deleteFromHistory, clearHistory, markAsRead } from './utils/history.js';
import { initWebSocket, broadcast } from './utils/broadcast.js';
import { cleanupOldReports, getReportStats } from './utils/report-cleanup.js';
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
const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const DEFAULT_TOOL_CONCURRENCY = parsePositiveInt(process.env.TESTER_TOOL_CONCURRENCY, 2);
const TOOL_QUEUE_LIMIT = parsePositiveInt(process.env.TESTER_TOOL_QUEUE_LIMIT, 50);
const TOOL_CONCURRENCY = {
  banner: parsePositiveInt(process.env.TESTER_BANNER_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  mixinad: parsePositiveInt(process.env.TESTER_MIXINAD_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  pslp: parsePositiveInt(process.env.TESTER_PSLP_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  sku: parsePositiveInt(process.env.TESTER_SKU_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY),
  pdp: parsePositiveInt(process.env.TESTER_PDP_CONCURRENCY, DEFAULT_TOOL_CONCURRENCY)
};


const app = express();
const server = createServer(app);
initWebSocket(server);
const router = express.Router();

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Middleware
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
  // Use X-User-Id header for user identification, fallback to IPv6-safe IP key
  keyGenerator: (req) => {
    const userId = req.get('X-User-Id');
    if (userId) return userId;
    // Use library's ipKeyGenerator for proper IPv6 handling
    return ipKeyGenerator(req);
  }
});

// Apply rate limiter to all API routes
router.use('/api/', apiLimiter);

function ensureCategoriesFile() {
  const categoriesPath = getCategoriesPath();
  if (fs.existsSync(categoriesPath)) {
    return categoriesPath;
  }

  let templateData = {};
  const templatePath = getCategoriesTemplatePath();
  if (fs.existsSync(templatePath)) {
    try {
      templateData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
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
const toolQueues = new Map();
const toolRunning = new Map();
const queuedJobs = new Map();

function getToolQueue(tool) {
  if (!toolQueues.has(tool)) {
    toolQueues.set(tool, []);
  }
  return toolQueues.get(tool);
}

function getToolLimit(tool) {
  return TOOL_CONCURRENCY[tool] ?? DEFAULT_TOOL_CONCURRENCY;
}

function getToolRunning(tool) {
  return toolRunning.get(tool) || 0;
}

function setToolRunning(tool, count) {
  toolRunning.set(tool, Math.max(0, count));
}

function getQueueKey(userId, tool) {
  return `${userId || 'anonymous'}:${tool}`;
}

function processToolQueue(tool) {
  const queue = getToolQueue(tool);
  const limit = getToolLimit(tool);
  let running = getToolRunning(tool);

  while (running < limit && queue.length > 0) {
    const job = queue.shift();
    queuedJobs.delete(job.key);
    running += 1;
    setToolRunning(tool, running);
    job.start()
      .catch(err => {
        console.error(`[Queue] ${tool} job failed`, err);
      })
      .finally(() => {
        setToolRunning(tool, getToolRunning(tool) - 1);
        processToolQueue(tool);
      });
  }
}

function enqueueToolJob({ tool, userId, processor, options, startFn }) {
  const queue = getToolQueue(tool);
  const running = getToolRunning(tool);
  const limit = getToolLimit(tool);
  const key = getQueueKey(userId, tool);

  if (queuedJobs.has(key)) {
    return { queued: true, alreadyQueued: true };
  }

  if (queue.length >= TOOL_QUEUE_LIMIT) {
    return { queued: false, rejected: true, reason: 'queue-full' };
  }

  if (running < limit && queue.length === 0) {
    setToolRunning(tool, running + 1);
    startFn()
      .catch(err => {
        console.error(`[Queue] ${tool} job failed`, err);
      })
      .finally(() => {
        setToolRunning(tool, getToolRunning(tool) - 1);
        processToolQueue(tool);
      });
    return { queued: false, started: true, running: running + 1, limit };
  }

  const position = queue.length + 1;
  queue.push({
    key,
    userId,
    tool,
    processor,
    options,
    start: startFn
  });
  queuedJobs.set(key, { key, tool, userId, processor });

  if (processor && typeof processor.emitStatus === 'function') {
    processor.emitStatus({
      type: 'queued',
      message: `Queued (position ${position} of ${queue.length})`,
      queuePosition: position,
      queueSize: queue.length
    });
  }

  processToolQueue(tool);
  return { queued: true, position, queueSize: queue.length, running, limit };
}

function cancelQueuedJob(userId, tool) {
  const key = getQueueKey(userId, tool);
  if (!queuedJobs.has(key)) return false;
  const queue = getToolQueue(tool);
  const index = queue.findIndex(job => job.key === key);
  if (index >= 0) {
    const [removed] = queue.splice(index, 1);
    queuedJobs.delete(key);
    if (removed?.processor && typeof removed.processor.emitStatus === 'function') {
      removed.processor.emitStatus({
        type: 'cancelled',
        message: 'Removed from queue'
      });
    }
  }
  return true;
}

function normalizeUserId(value) {
  if (!value) return null;
  const raw = String(value).trim();
  return raw.length > 0 ? raw.slice(0, 120) : null;
}

function getUserId(req) {
  const headerId = req.get('x-user-id') || req.get('X-User-Id');
  const queryId = req.query.userId;
  const userId = normalizeUserId(headerId || queryId);

  if (!userId && req.path.startsWith('/api/')) {
    console.warn(`[Server] API request without userId | path: ${req.method} ${req.path} | Will default to 'anonymous'`);
  }

  return userId;
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
    console.log(`[Server] Broadcasting ${tool} status:`, {
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
  const entry = userProcessors.get(userId || 'anonymous');
  const processor = entry ? entry[tool] : null;
  if (!processor) {
    return { isRunning: false, resultsCount: 0, options: null, statusType: null, message: null };
  }
  return processor.getStatus();
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
    }
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
    const categoriesData = fs.readFileSync(categoriesPath, 'utf8');
    const parsed = JSON.parse(categoriesData);

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
      const currentContent = fs.readFileSync(categoriesPath, 'utf8');
      currentData = JSON.parse(currentContent);
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
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  console.log(`[API] POST /api/sku/start | userId: ${userId || 'anonymous'} | SKU count: ${req.body.skus?.length || 0}`);
  const { skus, environment, region, culture, cultures, fullScreenshot, topScreenshot, addToCart, username, password } = req.body;

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

  const useTopScreenshot = topScreenshot === true;
  const normalizedCultures = Array.isArray(cultures)
    ? cultures.map(c => String(c).trim()).filter(Boolean)
    : (culture ? [String(culture).trim()] : []);
  const defaultCulture = config.sku.defaults?.culture || 'en-US';
  const selectedCultures = normalizedCultures.length > 0
    ? normalizedCultures
    : [defaultCulture];

  const options = {
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
  if (queuedJobs.has(getQueueKey(effectiveUserId, 'sku'))) {
    return res.status(409).json({ error: 'SKU capture already queued' });
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
      }, userId);
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
  broadcast({ type: 'sku-status', data: skuProcessor.getStatus() }, userId);

  if (queueResult.queued) {
    return res.json({
      ok: true,
      queued: true,
      position: queueResult.position,
      message: 'SKU capture queued'
    });
  }

  res.json({ ok: true, message: 'SKU capture started' });
}));

router.post('/api/sku/stop', (req, res) => {
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const skuProcessor = getProcessor(effectiveUserId, 'sku');
  if (cancelQueuedJob(effectiveUserId, 'sku')) {
    broadcast({ type: 'sku-status', data: skuProcessor.getStatus() }, userId);
    return res.json({ ok: true, message: 'Removed from queue' });
  }
  skuProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'sku-status', data: skuProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/sku/resume', (req, res) => {
  const userId = getUserId(req);
  const skuProcessor = getProcessor(userId, 'sku');
  skuProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'sku-status', data: skuProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/sku/update-credentials', (req, res) => {
  const userId = getUserId(req);
  const skuProcessor = getProcessor(userId, 'sku');
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
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const { environment, region, cultures, widths, categories, excelValidation, loginEnabled, username, password } = req.body;

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

  const bannerProcessor = getProcessor(effectiveUserId, 'banner');
  if (bannerProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Banner capture already in progress' });
  }
  if (queuedJobs.has(getQueueKey(effectiveUserId, 'banner'))) {
    return res.status(409).json({ error: 'Banner capture already queued' });
  }

  const options = {
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
      broadcast({ type: 'banner-error', data: { message: err.message } }, userId);
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
  broadcast({ type: 'banner-status', data: bannerProcessor.getStatus() }, userId);

  if (queueResult.queued) {
    return res.json({
      ok: true,
      queued: true,
      position: queueResult.position,
      message: 'Banner capture queued'
    });
  }

  res.json({ ok: true, message: 'Banner capture started' });
}));

router.post('/api/banner/stop', (req, res) => {
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const bannerProcessor = getProcessor(effectiveUserId, 'banner');
  if (cancelQueuedJob(effectiveUserId, 'banner')) {
    broadcast({ type: 'banner-status', data: bannerProcessor.getStatus() }, userId);
    return res.json({ ok: true, message: 'Removed from queue' });
  }
  bannerProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'banner-status', data: bannerProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/banner/resume', (req, res) => {
  const userId = getUserId(req);
  const bannerProcessor = getProcessor(userId, 'banner');
  bannerProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'banner-status', data: bannerProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/banner/update-credentials', (req, res) => {
  const userId = getUserId(req);
  const bannerProcessor = getProcessor(userId, 'banner');
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
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const { environment, region, culture, cultures, components, widths, screenWidths, username, password, excelValidation } = req.body;

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

  const pslpProcessor = getProcessor(effectiveUserId, 'pslp');
  if (pslpProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'PSLP capture already in progress' });
  }
  if (queuedJobs.has(getQueueKey(effectiveUserId, 'pslp'))) {
    return res.status(409).json({ error: 'PSLP capture already queued' });
  }

  const options = {
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
      broadcast({ type: 'pslp-error', data: { message: err.message } }, userId);
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
  broadcast({ type: 'pslp-status', data: pslpProcessor.getStatus() }, userId);

  if (queueResult.queued) {
    return res.json({
      ok: true,
      queued: true,
      position: queueResult.position,
      message: 'PSLP capture queued'
    });
  }

  res.json({ ok: true, message: 'PSLP capture started' });
}));

router.post('/api/pslp/stop', (req, res) => {
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const pslpProcessor = getProcessor(effectiveUserId, 'pslp');
  if (cancelQueuedJob(effectiveUserId, 'pslp')) {
    broadcast({ type: 'pslp-status', data: pslpProcessor.getStatus() }, userId);
    return res.json({ ok: true, message: 'Removed from queue' });
  }
  pslpProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pslp-status', data: pslpProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/pslp/resume', (req, res) => {
  const userId = getUserId(req);
  const pslpProcessor = getProcessor(userId, 'pslp');
  pslpProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pslp-status', data: pslpProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/pslp/update-credentials', (req, res) => {
  const userId = getUserId(req);
  const pslpProcessor = getProcessor(userId, 'pslp');
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
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const { environment, region, cultures, widths, categories, excelValidation, loginEnabled, username, password } = req.body;

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

  const mixinAdProcessor = getProcessor(effectiveUserId, 'mixinad');
  if (mixinAdProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Mix-In Ad capture already in progress' });
  }
  if (queuedJobs.has(getQueueKey(effectiveUserId, 'mixinad'))) {
    return res.status(409).json({ error: 'Mix-In Ad capture already queued' });
  }

  const options = {
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
      broadcast({ type: 'mixinad-error', data: { message: err.message } }, userId);
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
  broadcast({ type: 'mixinad-status', data: mixinAdProcessor.getStatus() }, userId);

  if (queueResult.queued) {
    return res.json({
      ok: true,
      queued: true,
      position: queueResult.position,
      message: 'Mix-In Ad capture queued'
    });
  }

  res.json({ ok: true, message: 'Mix-In Ad capture started' });
}));

router.post('/api/mixinad/stop', (req, res) => {
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const mixinAdProcessor = getProcessor(effectiveUserId, 'mixinad');
  if (cancelQueuedJob(effectiveUserId, 'mixinad')) {
    broadcast({ type: 'mixinad-status', data: mixinAdProcessor.getStatus() }, userId);
    return res.json({ ok: true, message: 'Removed from queue' });
  }
  mixinAdProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'mixinad-status', data: mixinAdProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/mixinad/resume', (req, res) => {
  const userId = getUserId(req);
  const mixinAdProcessor = getProcessor(userId, 'mixinad');
  mixinAdProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'mixinad-status', data: mixinAdProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/mixinad/update-credentials', (req, res) => {
  const userId = getUserId(req);
  const mixinAdProcessor = getProcessor(userId, 'mixinad');
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

// ============ PDP API Routes ============

router.get('/api/pdp/status', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorStatus(userId, 'pdp'));
});

router.post('/api/pdp/start', asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  console.log(`[API] POST /api/pdp/start | userId: ${userId || 'anonymous'} | SKU count: ${req.body.skus?.length || 0}`);
  const { skus, environment, region, culture, cultures, username, password } = req.body;

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

  const normalizedCultures = Array.isArray(cultures)
    ? cultures.map(c => String(c).trim()).filter(Boolean)
    : (culture ? [String(culture).trim()] : []);
  const defaultCulture = config.pdp.defaults?.culture || 'en-US';
  const selectedCultures = normalizedCultures.length > 0
    ? normalizedCultures
    : [defaultCulture];

  const options = {
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
  if (queuedJobs.has(getQueueKey(effectiveUserId, 'pdp'))) {
    return res.status(409).json({ error: 'PDP capture already queued' });
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
      }, userId);
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
  broadcast({ type: 'pdp-status', data: pdpProcessor.getStatus() }, userId);

  if (queueResult.queued) {
    return res.json({
      ok: true,
      queued: true,
      position: queueResult.position,
      message: 'PDP capture queued'
    });
  }

  res.json({ ok: true, message: 'PDP capture started' });
}));

router.post('/api/pdp/stop', (req, res) => {
  const userId = getUserId(req);
  const effectiveUserId = userId || 'anonymous';
  const pdpProcessor = getProcessor(effectiveUserId, 'pdp');
  if (cancelQueuedJob(effectiveUserId, 'pdp')) {
    broadcast({ type: 'pdp-status', data: pdpProcessor.getStatus() }, userId);
    return res.json({ ok: true, message: 'Removed from queue' });
  }
  pdpProcessor.stop();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pdp-status', data: pdpProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/pdp/resume', (req, res) => {
  const userId = getUserId(req);
  const pdpProcessor = getProcessor(userId, 'pdp');
  pdpProcessor.resume();
  // Broadcast status update via WebSocket
  broadcast({ type: 'pdp-status', data: pdpProcessor.getStatus() }, userId);
  res.json({ ok: true, message: 'Resume requested' });
});

router.post('/api/pdp/update-credentials', (req, res) => {
  const userId = getUserId(req);
  const pdpProcessor = getProcessor(userId, 'pdp');
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

// Auto-generate reports on completion (per-user processors are wired on creation)

router.use('/reports', express.static(REPORTS_DIR));

// ============ Shared Routes ============

router.get('/api/history', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  console.log(`[API] GET /api/history | userId: ${userId} | Requesting user's history`);
  const history = loadHistory(userId);
  console.log(`[API] GET /api/history | userId: ${userId} | Returning ${history.length} entries`);
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
  console.log(`[API] DELETE /api/history/${filename} | userId: ${userId} | Deleting single entry`);

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
  console.log(`[API] POST /api/history/${filename}/read | userId: ${userId}`);

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
  console.log(`[API] DELETE /api/history | userId: ${userId} | Clearing ALL history for this user | deleteReports: ${deleteReports}`);

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
