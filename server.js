#!/usr/bin/env node
// server.js - Express + WebSocket server for Unified Tester

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import fs from 'fs';
import open, { apps } from 'open';

import { getSkuProcessor } from './processors/sku-processor.js';
import { getBannerProcessor } from './processors/banner-processor.js';
import { getPSLPProcessor } from './processors/pslp-processor.js';
import { getMixInAdProcessor } from './processors/mixinad-processor.js';
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

const app = express();
const server = createServer(app);
initWebSocket(server);

const rawPort = process.env.TESTER_PORT || process.env.PORT || '3000';
const PORT = Number.isNaN(Number(rawPort)) ? 3000 : Number(rawPort);
const DATA_DIR = process.env.TESTER_DATA_DIR || __dirname;
const REPORTS_DIR = join(DATA_DIR, 'reports');
const HISTORY_FILE = join(DATA_DIR, 'history.json');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(join(__dirname, 'public')));

// Set up processor event listeners
const skuProcessor = getSkuProcessor();
const bannerProcessor = getBannerProcessor();
const pslpProcessor = getPSLPProcessor();
const mixinAdProcessor = getMixInAdProcessor();

// SKU Processor events
skuProcessor.on('progress', (data) => {
  broadcast({ type: 'sku-progress', data: { progress: data } });
});

skuProcessor.on('status', (data) => {
  broadcast({ type: 'sku-status', data });
});

skuProcessor.on('error', (data) => {
  broadcast({ type: 'sku-error', data });
});

// Banner Processor events
bannerProcessor.on('progress', (data) => {
  broadcast({ type: 'banner-progress', data: { progress: data } });
});

bannerProcessor.on('status', (data) => {
  broadcast({ type: 'banner-status', data });
});

bannerProcessor.on('error', (data) => {
  broadcast({ type: 'banner-error', data });
});

// PSLP Processor events
pslpProcessor.on('progress', (data) => {
  broadcast({ type: 'pslp-progress', data: { progress: data } });
});

pslpProcessor.on('status', (data) => {
  broadcast({ type: 'pslp-status', data });
});

pslpProcessor.on('error', (data) => {
  broadcast({ type: 'pslp-error', data });
});

// Mix-In Ad Processor events
mixinAdProcessor.on('progress', (data) => {
  broadcast({ type: 'mixinad-progress', data: { progress: data } });
});

mixinAdProcessor.on('status', (data) => {
  broadcast({ type: 'mixinad-status', data });
});

mixinAdProcessor.on('error', (data) => {
  broadcast({ type: 'mixinad-error', data });
});

// ============ API Routes ============

// Get unified configuration
app.get('/api/config', (req, res) => {
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

app.get('/api/categories', (req, res) => {
  try {
    const categoriesPath = join(__dirname, 'categories.json');
    const categoriesData = fs.readFileSync(categoriesPath, 'utf8');
    res.json(JSON.parse(categoriesData));
  } catch (err) {
    console.error('Failed to read categories:', err);
    res.status(500).json({ error: 'Failed to load categories', message: err.message });
  }
});

app.post('/api/categories', express.json(), (req, res) => {
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

app.get('/api/sku/status', (req, res) => {
  res.json(skuProcessor.getStatus());
});

app.post('/api/sku/start', asyncHandler(async (req, res) => {
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

  if (skuProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'SKU capture already in progress' });
  }

  skuProcessor.start(options).catch(err => {
    console.error('SKU capture error:', err);
    broadcast({
      type: 'error',
      tool: 'sku',
      data: { message: err.message, stack: err.stack }
    });
  });

  res.json({ ok: true, message: 'SKU capture started' });
}));

app.post('/api/sku/stop', (req, res) => {
  skuProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

app.post('/api/sku/resume', (req, res) => {
  skuProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
});

app.get('/api/sku/results', (req, res) => {
  res.json(skuProcessor.getResults());
});

app.get('/api/banner/status', (req, res) => {
  res.json(bannerProcessor.getStatus());
});

app.post('/api/banner/start', asyncHandler(async (req, res) => {
  const { environment, region, cultures, widths, categories } = req.body;

  if (!cultures || !Array.isArray(cultures) || cultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  if (!widths || !Array.isArray(widths) || widths.length === 0) {
    return res.status(400).json({ error: 'No widths selected' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  if (bannerProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Banner capture already in progress' });
  }

  const options = { environment, region, cultures, widths, categories };

  bannerProcessor.start(options).catch(err => {
    console.error('Banner capture error:', err);
    broadcast({ type: 'banner-error', data: { message: err.message } });
  });

  res.json({ ok: true, message: 'Banner capture started' });
}));

app.post('/api/banner/stop', (req, res) => {
  bannerProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

app.post('/api/banner/resume', (req, res) => {
  bannerProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
});

app.get('/api/banner/results', (req, res) => {
  res.json(bannerProcessor.getResults());
});

// ============ PSLP API Routes ============

app.get('/api/pslp/status', (req, res) => {
  res.json(pslpProcessor.getStatus());
});

app.post('/api/pslp/start', asyncHandler(async (req, res) => {
  const { environment, region, culture, components, widths, username, password } = req.body;

  if (!culture) {
    return res.status(400).json({ error: 'No culture selected' });
  }

  if (pslpProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'PSLP capture already in progress' });
  }

  const options = {
    environment: environment || 'production',
    region: region || 'us',
    culture,
    components: components || config.pslp.defaults.components,
    widths: widths || config.pslp.defaults.widths,
    username: username || null,
    password: password || null
  };

  pslpProcessor.start(options).catch(err => {
    console.error('PSLP capture error:', err);
    broadcast({ type: 'pslp-error', data: { message: err.message } });
  });

  res.json({ ok: true, message: 'PSLP capture started' });
}));

app.post('/api/pslp/stop', (req, res) => {
  pslpProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

app.post('/api/pslp/resume', (req, res) => {
  pslpProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
});

app.get('/api/pslp/results', (req, res) => {
  res.json(pslpProcessor.getResults());
});

// ============ Mix-In Ad API Routes ============

app.get('/api/mixinad/status', (req, res) => {
  res.json(mixinAdProcessor.getStatus());
});

app.post('/api/mixinad/start', asyncHandler(async (req, res) => {
  const { environment, region, cultures, widths, categories } = req.body;

  if (!cultures || !Array.isArray(cultures) || cultures.length === 0) {
    return res.status(400).json({ error: 'No cultures selected' });
  }

  if (!widths || !Array.isArray(widths) || widths.length === 0) {
    return res.status(400).json({ error: 'No widths selected' });
  }

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'No categories selected' });
  }

  if (mixinAdProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Mix-In Ad capture already in progress' });
  }

  const options = { environment, region, cultures, widths, categories };

  mixinAdProcessor.start(options).catch(err => {
    console.error('Mix-In Ad capture error:', err);
    broadcast({ type: 'mixinad-error', data: { message: err.message } });
  });

  res.json({ ok: true, message: 'Mix-In Ad capture started' });
}));

app.post('/api/mixinad/stop', (req, res) => {
  mixinAdProcessor.stop();
  res.json({ ok: true, message: 'Stop requested' });
});

app.post('/api/mixinad/resume', (req, res) => {
  mixinAdProcessor.resume();
  res.json({ ok: true, message: 'Resume requested' });
});

app.get('/api/mixinad/results', (req, res) => {
  res.json(mixinAdProcessor.getResults());
});

// Auto-generate reports on completion
autoGenerateReport(skuProcessor, generateSkuReport, 'sku');
autoGenerateReport(bannerProcessor, generateBannerReport, 'banner');
autoGenerateReport(pslpProcessor, generatePslpReport, 'pslp');
autoGenerateReport(mixinAdProcessor, generateMixInAdReport, 'mixinad');

app.use('/reports', express.static(REPORTS_DIR));

// ============ Shared Routes ============

app.get('/api/history', (req, res) => {
  const history = loadHistory();
  res.json({ history, limit: getHistoryLimit() });
});

app.post('/api/history/limit', (req, res) => {
  const { limit } = req.body;
  if (setHistoryLimit(limit)) {
    res.json({ ok: true, limit: getHistoryLimit() });
  } else {
    res.status(400).json({ error: 'Invalid limit' });
  }
});

// Delete a single history entry and its report file
app.delete('/api/history/:filename', (req, res) => {
  const { filename } = req.params;

  // Validate filename to prevent path traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
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
  if (deleteFromHistory(filename)) {
    res.json({ ok: true, message: 'History item deleted' });
  } else {
    res.status(404).json({ error: 'History item not found' });
  }
});

// Clear all history
app.delete('/api/history', (req, res) => {
  const deleteReports = req.query.deleteReports === 'true';

  if (deleteReports) {
    // Optionally delete all report files
    try {
      const files = fs.readdirSync(REPORTS_DIR);
      for (const file of files) {
        if (file.endsWith('.html')) {
          fs.unlinkSync(join(REPORTS_DIR, file));
        }
      }
    } catch (err) {
      console.error('Error deleting report files:', err);
    }
  }

  clearHistory();
  res.json({ ok: true, message: 'History cleared' });
});

// Download a report file
app.get('/api/reports/:filename', (req, res) => {
  const { filename } = req.params;

  // Validate filename to prevent path traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const reportPath = join(REPORTS_DIR, filename);

  if (!fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
app.use((err, req, res, next) => {
  console.error('Express error:', err);

  // Send error response
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

server.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  const url = `http://localhost:${port}`;
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
