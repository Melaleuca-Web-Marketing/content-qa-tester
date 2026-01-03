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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

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

// WebSocket clients
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log('WebSocket client connected');

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    wsClients.delete(ws);
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('WebSocket client disconnected');
  });
});

// Broadcast to all WebSocket clients
function broadcast(message) {
  const data = JSON.stringify(message);
  wsClients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(data);
      } catch (err) {
        console.error('Error broadcasting to client:', err);
        wsClients.delete(client);
      }
    }
  });
}

// Set up processor event listeners
const skuProcessor = getSkuProcessor();
const bannerProcessor = getBannerProcessor();
const pslpProcessor = getPSLPProcessor();
const mixinAdProcessor = getMixInAdProcessor();

// SKU Processor events
skuProcessor.on('progress', (data) => {
  broadcast({ type: 'sku-progress', data });
});

skuProcessor.on('status', (data) => {
  broadcast({ type: 'sku-status', data });

  if (data.type === 'completed' && data.results?.length > 0) {
    saveToHistory({
      mode: 'sku',
      timestamp: Date.now(),
      environment: data.results[0]?.environment,
      region: data.results[0]?.region,
      culture: data.results[0]?.culture,
      count: data.results.length,
      successCount: data.successCount,
      errorCount: data.errorCount,
      duration: data.duration
    });
  }
});

skuProcessor.on('error', (data) => {
  broadcast({ type: 'sku-error', data });
});

// Banner Processor events
bannerProcessor.on('progress', (data) => {
  broadcast({ type: 'banner-progress', data });
});

bannerProcessor.on('status', (data) => {
  broadcast({ type: 'banner-status', data });

  if (data.type === 'completed' && data.results?.length > 0) {
    saveToHistory({
      mode: 'banner',
      timestamp: Date.now(),
      environment: data.results[0]?.environment,
      count: data.results.length,
      successCount: data.successCount,
      errorCount: data.errorCount,
      duration: data.duration
    });
  }
});

bannerProcessor.on('error', (data) => {
  broadcast({ type: 'banner-error', data });
});

// PSLP Processor events
pslpProcessor.on('progress', (data) => {
  broadcast({ type: 'pslp-progress', data });
});

pslpProcessor.on('status', (data) => {
  broadcast({ type: 'pslp-status', data });

  if (data.type === 'completed' && data.results) {
    saveToHistory({
      mode: 'pslp',
      timestamp: Date.now(),
      environment: data.results.environment,
      region: data.results.region,
      culture: data.results.culture,
      componentsCount: data.results.componentReports?.length || 0,
      screenshotsCount: data.results.screenshots?.length || 0,
      duration: data.duration
    });
  }
});

pslpProcessor.on('error', (data) => {
  broadcast({ type: 'pslp-error', data });
});

// Mix-In Ad Processor events
mixinAdProcessor.on('progress', (data) => {
  broadcast({ type: 'mixinad-progress', data });
});

mixinAdProcessor.on('status', (data) => {
  broadcast({ type: 'mixinad-status', data });

  if (data.type === 'completed' && data.results?.length > 0) {
    saveToHistory({
      mode: 'mixinad',
      timestamp: Date.now(),
      environment: data.results[0]?.environment,
      count: data.results.length,
      successCount: data.successCount,
      errorCount: data.errorCount,
      duration: data.duration
    });
  }
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
          if (!item.label || !item.path) {
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
  const { skus, environment, region, culture, fullScreenshot, topScreenshot, addToCart, username, password } = req.body;

  if (!skus || !Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({ error: 'No SKUs provided' });
  }

  const useTopScreenshot = topScreenshot === true;
  const options = {
    skus: skus.map(s => String(s).trim()).filter(Boolean),
    environment: environment || 'production',
    region: region || 'us',
    culture: culture || 'en-US',
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

app.post('/api/sku/report', (req, res) => {
  const results = skuProcessor.getResults();

  if (!results || results.length === 0) {
    return res.status(400).json({ error: 'No results to generate report' });
  }

  const duration = req.body.duration || null;
  const theme = req.body.theme || 'dark';
  const html = generateSkuReport(results, duration, theme);

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const env = results[0]?.environment || 'unknown';
  const filename = `sku-test-${env}-${timestamp}.html`;
  const filepath = join(REPORTS_DIR, filename);

  fs.writeFileSync(filepath, html);

  res.json({
    ok: true,
    filename,
    path: filepath,
    successCount: results.filter(r => r.success).length
  });
});

// ============ Banner API Routes ============

app.get('/api/banner/status', (req, res) => {
  res.json(bannerProcessor.getStatus());
});

app.post('/api/banner/start', asyncHandler(async (req, res) => {
  const { environment, region, cultures, categories, widths } = req.body;

  const options = {
    environment: environment || 'stage',
    region: region || 'usca',
    cultures: cultures || [],
    categories: categories || [],
    widths: widths || config.banner.defaults.widths
  };

  const errors = validateBannerConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  if (bannerProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Banner capture already in progress' });
  }

  bannerProcessor.start(options).catch(err => {
    console.error('Banner capture error:', err);
    broadcast({
      type: 'error',
      tool: 'banner',
      data: { message: err.message, stack: err.stack }
    });
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

app.post('/api/banner/report', (req, res) => {
  const results = bannerProcessor.getResults();

  if (!results || results.length === 0) {
    return res.status(400).json({ error: 'No results to generate report' });
  }

  const duration = req.body.duration || null;
  const theme = req.body.theme || 'dark';
  const { html, name } = generateBannerReport(results, duration, theme);

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const env = results[0]?.environment || 'unknown';
  const filename = `banner-test-${env}-${timestamp}.html`;
  const filepath = join(REPORTS_DIR, filename);

  fs.writeFileSync(filepath, html);

  res.json({
    ok: true,
    filename,
    path: filepath,
    successCount: results.filter(r => !r.error).length
  });
});

// ============ PSLP API Routes ============

app.get('/api/pslp/status', (req, res) => {
  res.json(pslpProcessor.getStatus());
});

app.post('/api/pslp/start', asyncHandler(async (req, res) => {
  const { environment, region, culture, components, username, password, screenWidths } = req.body;

  const options = {
    environment: environment || 'production',
    region: region || 'us',
    culture: culture || 'en-US',
    components: components || [],
    screenWidths: Array.isArray(screenWidths) && screenWidths.length > 0
      ? screenWidths.map(w => Number(w)).filter(w => Number.isFinite(w))
      : null,
    username: username || null,
    password: password || null
  };

  const errors = validatePslpConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  if (pslpProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'PSLP capture already in progress' });
  }

  pslpProcessor.start(options).catch(err => {
    console.error('PSLP capture error:', err);
    broadcast({
      type: 'error',
      tool: 'pslp',
      data: { message: err.message, stack: err.stack }
    });
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

app.post('/api/pslp/report', (req, res) => {
  const results = pslpProcessor.getResults();

  if (!results) {
    return res.status(400).json({ error: 'No results to generate report' });
  }

  const duration = req.body.duration || null;
  const theme = req.body.theme || 'dark';
  const { html } = generatePslpReport(results, duration, theme);

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const env = results.environment || 'unknown';
  const filename = `pslp-test-${env}-${timestamp}.html`;
  const filepath = join(REPORTS_DIR, filename);

  fs.writeFileSync(filepath, html);

  res.json({
    ok: true,
    filename,
    path: filepath,
    screenshotsCount: results.screenshots?.length || 0,
    componentsCount: results.componentReports?.length || 0
  });
});

// ============ Mix-In Ad API Routes ============

app.get('/api/mixinad/status', (req, res) => {
  res.json(mixinAdProcessor.getStatus());
});

app.post('/api/mixinad/start', asyncHandler(async (req, res) => {
  const { environment, region, cultures, categories, widths } = req.body;

  const options = {
    environment: environment || 'stage',
    region: region || 'usca',
    cultures: cultures || [],
    categories: categories || [],
    widths: widths || config.mixinad.defaults.widths
  };

  const errors = validateMixInAdConfig(options);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  if (mixinAdProcessor.getStatus().isRunning) {
    return res.status(409).json({ error: 'Mix-In Ad capture already in progress' });
  }

  mixinAdProcessor.start(options).catch(err => {
    console.error('Mix-In Ad capture error:', err);
    broadcast({
      type: 'error',
      tool: 'mixinad',
      data: { message: err.message, stack: err.stack }
    });
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

app.post('/api/mixinad/report', (req, res) => {
  const results = mixinAdProcessor.getResults();

  if (!results || results.length === 0) {
    return res.status(400).json({ error: 'No results to generate report' });
  }

  const duration = req.body.duration || null;
  const theme = req.body.theme || 'dark';
  const { html } = generateMixInAdReport(results, duration, theme);

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const env = results[0]?.environment || 'unknown';
  const filename = `mixinad-test-${env}-${timestamp}.html`;
  const filepath = join(REPORTS_DIR, filename);

  fs.writeFileSync(filepath, html);

  res.json({
    ok: true,
    filename,
    path: filepath,
    successCount: results.filter(r => !r.error && !r.noAdsFound).length
  });
});

// ============ Shared Routes ============

app.get('/api/history', (req, res) => {
  const history = loadHistory();
  res.json(history);
});

app.delete('/api/history', (req, res) => {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
  res.json({ ok: true });
});

app.get('/api/reports', (req, res) => {
  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => {
      const stat = fs.statSync(join(REPORTS_DIR, f));
      const isSku = f.startsWith('sku-');
      const isBanner = f.startsWith('banner-');
      const isPslp = f.startsWith('pslp-');
      const isMixInAd = f.startsWith('mixinad-');
      return {
        filename: f,
        type: isSku ? 'sku' : isBanner ? 'banner' : isPslp ? 'pslp' : isMixInAd ? 'mixinad' : 'unknown',
        created: stat.mtime,
        size: stat.size
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));

  res.json(files);
});

app.get('/api/reports/:filename', (req, res) => {
  const filename = req.params.filename;

  // Validate filename (no path separators or traversal)
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filepath = join(REPORTS_DIR, filename);

  // Ensure resolved path is still within REPORTS_DIR (defense in depth)
  const resolvedPath = resolve(filepath);
  const resolvedReportsDir = resolve(REPORTS_DIR);
  if (!resolvedPath.startsWith(resolvedReportsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.download(filepath);
});

app.get('/api/reports/:filename/open', (req, res) => {
  const filename = req.params.filename;

  // Validate filename (no path separators or traversal)
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filepath = join(REPORTS_DIR, filename);

  // Ensure resolved path is still within REPORTS_DIR (defense in depth)
  const resolvedPath = resolve(filepath);
  const resolvedReportsDir = resolve(REPORTS_DIR);
  if (!resolvedPath.startsWith(resolvedReportsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Report not found' });
  }

  open(filepath);
  res.json({ ok: true });
});

// ============ History Management ============

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading history:', e);
  }
  return [];
}

function saveToHistory(entry) {
  let history = loadHistory();
  history.unshift(entry);

  if (history.length > 20) {
    history = history.slice(0, 20);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function formatTimestamp(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('');
}

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
