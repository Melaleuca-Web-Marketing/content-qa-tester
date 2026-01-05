#!/usr/bin/env node
// server.js - Express + WebSocket server for Unified Tester

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import open, { apps } from 'open';

import { SkuProcessor } from './processors/sku-processor.js';
import { BannerProcessor } from './processors/banner-processor.js';
import { PSLPProcessor } from './processors/pslp-processor.js';
import { MixInAdProcessor } from './processors/mixinad-processor.js';
import { generateSkuReport } from './report-generators/sku-report.js';
import { generateBannerReport } from './report-generators/banner-report.js';
import { generatePslpReport } from './report-generators/pslp-report.js';
import { generateMixInAdReport } from './report-generators/mixinad-report.js';
import { config, validateSkuConfig, validateBannerConfig, validatePslpConfig, validateMixInAdConfig, reloadCategories } from './config.js';
import { asyncHandler } from './utils/async-handler.js';
import { autoGenerateReport } from './utils/auto-generate-report.js';
import { loadHistory, saveToHistory, getHistoryLimit, setHistoryLimit, deleteFromHistory, clearHistory } from './utils/history.js';
import { initWebSocket, broadcast } from './utils/broadcast.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawPort = process.env.TESTER_PORT || process.env.PORT || '3000';
const PORT = Number.isNaN(Number(rawPort)) ? 3000 : Number(rawPort);
const rawBasePath = process.env.TESTER_BASE_PATH || '/';
const normalizedBase = rawBasePath === '/' ? '' : `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`;
const BASE_PATH = normalizedBase === '/' ? '' : normalizedBase;
const DATA_DIR = process.env.TESTER_DATA_DIR || __dirname;
const REPORTS_DIR = join(DATA_DIR, 'reports');

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
router.use(express.json());
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

function normalizeUserId(value) {
  if (!value) return null;
  const raw = String(value).trim();
  return raw.length > 0 ? raw.slice(0, 120) : null;
}

function getUserId(req) {
  const headerId = req.get('x-user-id') || req.get('X-User-Id');
  const queryId = req.query.userId;
  return normalizeUserId(headerId || queryId);
}

function attachProcessorEvents(processor, tool, userId) {
  processor.on('progress', (data) => {
    broadcast({ type: `${tool}-progress`, data: { progress: data } }, userId);
  });

  processor.on('status', (data) => {
    broadcast({ type: `${tool}-status`, data }, userId);
  });

  processor.on('error', (data) => {
    broadcast({ type: `${tool}-error`, data }, userId);
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
  return processor ? processor.getResults() : [];
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

router.get('/api/categories', (req, res) => {
  try {
    const categoriesPath = join(__dirname, 'categories.json');
    const categoriesData = fs.readFileSync(categoriesPath, 'utf8');
    res.json(JSON.parse(categoriesData));
  } catch (err) {
    console.error('Failed to read categories:', err);
    res.status(500).json({ error: 'Failed to load categories', message: err.message });
  }
});

router.post('/api/categories', express.json(), (req, res) => {
  try {
    const categories = req.body;

    // Basic validation
    if (!categories || typeof categories !== 'object') {
      return res.status(400).json({ error: 'Invalid categories data' });
    }

    // Validate structure
    for (const [region, cats] of Object.entries(categories)) {
      if (typeof cats !== 'object') {
        return res.status(400).json({ error: `Invalid data for region: ${region}` });
      }
      for (const [catName, items] of Object.entries(cats)) {
        if (!Array.isArray(items)) {
          return res.status(400).json({ error: `Invalid items for category: ${catName}` });
        }
        for (const item of items) {
          // Accept either old 'path' format or new 'paths' format
          if (!item.label || (!item.path && !item.paths)) {
            return res.status(400).json({ error: `Invalid item in category: ${catName}` });
          }
        }
      }
    }

    const categoriesPath = join(__dirname, 'categories.json');
    fs.writeFileSync(categoriesPath, JSON.stringify(categories, null, 2), 'utf8');

    // Reload categories in memory
    reloadCategories();

    res.json({ success: true, message: 'Categories saved successfully' });
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
  const { skus, environment, region, culture, cultures, fullScreenshot, topScreenshot, addToCart, username, password } = req.body;

  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({ error: 'No SKUs provided' });
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

  const skuProcessor = getProcessor(userId, 'sku');
  if (skuProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'SKU capture already in progress' });
  }

  skuProcessor.start(options).catch(err => {
    console.error('SKU capture error:', err);
    broadcast({
      type: 'error',
      tool: 'sku',
      data: { message: err.message, stack: err.stack }
    }, userId);
  });

  res.json({ ok: true, message: 'SKU capture started' });
}));

router.post('/api/sku/stop', (req, res) => {
  const userId = getUserId(req);
  const skuProcessor = getProcessor(userId, 'sku');
  skuProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/sku/resume', (req, res) => {
  const userId = getUserId(req);
  const skuProcessor = getProcessor(userId, 'sku');
  skuProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
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
  const { environment, region, cultures, widths, categories, excelValidation } = req.body;

  if (!cultures || !Array.isArray(cultures) || cultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  if (!widths || !Array.isArray(widths) || widths.length === 0) {
    return res.status(400).json({ error: 'No widths selected' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  const bannerProcessor = getProcessor(userId, 'banner');
  if (bannerProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Banner capture already in progress' });
  }

  const options = { environment, region, cultures, widths, categories };

  // Include Excel validation data if provided
  if (excelValidation && excelValidation.enabled) {
    options.excelValidation = excelValidation;
  }

  bannerProcessor.start(options).catch(err => {
    console.error('Banner capture error:', err);
    broadcast({ type: 'banner-error', data: { message: err.message } }, userId);
  });

  res.json({ ok: true, message: 'Banner capture started' });
}));

router.post('/api/banner/stop', (req, res) => {
  const userId = getUserId(req);
  const bannerProcessor = getProcessor(userId, 'banner');
  bannerProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/banner/resume', (req, res) => {
  const userId = getUserId(req);
  const bannerProcessor = getProcessor(userId, 'banner');
  bannerProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
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
  const { environment, region, culture, components, widths, screenWidths, username, password, excelValidation } = req.body;

  if (!culture) {
    return res.status(400).json({ error: 'No culture selected' });
  }

  const pslpProcessor = getProcessor(userId, 'pslp');
  if (pslpProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'PSLP capture already in progress' });
  }

  const options = {
    environment: environment || 'production',
    region: region || 'us',
    culture,
    components: components || config.pslp.defaults.components,
    screenWidths: screenWidths || widths || config.pslp.screenWidths,
    username: username || null,
    password: password || null
  };

  if (excelValidation && excelValidation.enabled) {
    options.excelValidation = excelValidation;
  }

  pslpProcessor.start(options).catch(err => {
    console.error('PSLP capture error:', err);
    broadcast({ type: 'pslp-error', data: { message: err.message } }, userId);
  });

  res.json({ ok: true, message: 'PSLP capture started' });
}));

router.post('/api/pslp/stop', (req, res) => {
  const userId = getUserId(req);
  const pslpProcessor = getProcessor(userId, 'pslp');
  pslpProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/pslp/resume', (req, res) => {
  const userId = getUserId(req);
  const pslpProcessor = getProcessor(userId, 'pslp');
  pslpProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
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
  const { environment, region, cultures, widths, categories, excelValidation } = req.body;

  if (!cultures || !Array.isArray(cultures) || cultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  if (!widths || !Array.isArray(widths) || widths.length === 0) {
    return res.status(400).json({ error: 'No widths selected' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  const mixinAdProcessor = getProcessor(userId, 'mixinad');
  if (mixinAdProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Mix-In Ad capture already in progress' });
  }

  const options = { environment, region, cultures, widths, categories };

  // Include Excel validation data if provided
  if (excelValidation && excelValidation.enabled) {
    options.excelValidation = excelValidation;
  }

  mixinAdProcessor.start(options).catch(err => {
    console.error('Mix-In Ad capture error:', err);
    broadcast({ type: 'mixinad-error', data: { message: err.message } }, userId);
  });

  res.json({ ok: true, message: 'Mix-In Ad capture started' });
}));

router.post('/api/mixinad/stop', (req, res) => {
  const userId = getUserId(req);
  const mixinAdProcessor = getProcessor(userId, 'mixinad');
  mixinAdProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

router.post('/api/mixinad/resume', (req, res) => {
  const userId = getUserId(req);
  const mixinAdProcessor = getProcessor(userId, 'mixinad');
  mixinAdProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
});

router.get('/api/mixinad/results', (req, res) => {
  const userId = getUserId(req);
  res.json(getProcessorResults(userId, 'mixinad'));
});

// Auto-generate reports on completion (per-user processors are wired on creation)

router.use('/reports', express.static(REPORTS_DIR));

// ============ Shared Routes ============

router.get('/api/history', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const history = loadHistory(userId);
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

// Clear all history
router.delete('/api/history', (req, res) => {
  const userId = getUserId(req) || 'anonymous';
  const deleteReports = req.query.deleteReports === 'true';

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
