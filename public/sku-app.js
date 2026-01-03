// sku-app.js - Frontend JavaScript for SKU Tester UI

// Theme toggle functionality
function toggleTheme() {
  const body = document.body;
  const icon = document.getElementById('theme-icon');
  const text = document.getElementById('theme-text');

  body.classList.toggle('light-mode');
  const isLight = body.classList.contains('light-mode');

  icon.innerHTML = isLight ? '&#9790;' : '&#9788;';
  text.textContent = isLight ? 'Dark' : 'Light';

  localStorage.setItem('testerTheme', isLight ? 'light' : 'dark');
}

// Check for saved theme preference on load
(function initTheme() {
  const savedTheme = localStorage.getItem('testerTheme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon) icon.innerHTML = '&#9790;';
    if (text) text.textContent = 'Dark';
  }
})();

let configData = null;
let isCapturing = false;
let captureStartTime = null;
let ws = null;
let reconnectAttempts = 0;
let isWaitingForResume = false;
const MAX_RECONNECT_ATTEMPTS = 5;

// DOM Elements
const envSelect = document.getElementById('env-select');
const regionSelect = document.getElementById('region-select');
const cultureSelect = document.getElementById('culture-select');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const skuInput = document.getElementById('sku-input');
const skuCount = document.getElementById('sku-count');
const clearSkusBtn = document.getElementById('clear-skus');
const fullScreenshotCheck = document.getElementById('full-screenshot');
const topScreenshotCheck = document.getElementById('top-screenshot');
const addToCartCheck = document.getElementById('add-to-cart');
const startCaptureBtn = document.getElementById('start-capture');
const stopCaptureBtn = document.getElementById('stop-capture');
const saveReportBtn = document.getElementById('save-report');
const statusBanner = document.getElementById('status-banner');
const statusMain = document.getElementById('status-main');
const statusDetail = document.getElementById('status-detail');
const progressContainer = document.getElementById('progress-container');
const progressBarInner = document.getElementById('progress-bar-inner');
const progressCount = document.getElementById('progress-count');
const progressEta = document.getElementById('progress-eta');
const progressEnv = document.getElementById('progress-env');
const progressCulture = document.getElementById('progress-culture');
const progressSku = document.getElementById('progress-sku');
const currentSkuInfo = document.getElementById('current-sku-info');
const currentSkuName = document.getElementById('current-sku-name');
const currentSkuPrice = document.getElementById('current-sku-price');
const currentSkuStatus = document.getElementById('current-sku-status');
const connectionStatus = document.getElementById('connection-status');

async function init() {
  try {
    await loadConfig();
    setupEventListeners();
    updateCultureOptions();
    loadPreferences();
    connectWebSocket();
  } catch (err) {
    console.error('Initialization error:', err);
    setStatusError('Initialization failed', err.message);
  }
}

async function loadConfig() {
  const response = await fetch('/api/config');
  configData = await response.json();
}

function setupEventListeners() {
  regionSelect.addEventListener('change', () => {
    updateCultureOptions();
    applySavedCredentials();
    savePreferences();
  });

  envSelect.addEventListener('change', () => {
    applySavedCredentials();
    savePreferences();
  });
  cultureSelect.addEventListener('change', () => {
    applySavedCredentials();
    savePreferences();
  });
  fullScreenshotCheck.addEventListener('change', () => {
    if (fullScreenshotCheck.checked) {
      topScreenshotCheck.checked = false;
    }
    savePreferences();
  });
  topScreenshotCheck.addEventListener('change', () => {
    if (topScreenshotCheck.checked) {
      fullScreenshotCheck.checked = false;
    }
    savePreferences();
  });
  addToCartCheck.addEventListener('change', savePreferences);

  skuInput.addEventListener('input', () => {
    updateSkuCount();
    savePreferences();
  });

  clearSkusBtn.addEventListener('click', () => {
    skuInput.value = '';
    updateSkuCount();
    savePreferences();
  });

  startCaptureBtn.addEventListener('click', () => {
    if (isWaitingForResume) {
      resumeCapture();
    } else {
      startCapture();
    }
  });
  stopCaptureBtn.addEventListener('click', stopCapture);
}

function updateCultureOptions() {
  const region = regionSelect.value;
  const regionConfig = configData?.regions?.[region];

  if (!regionConfig) return;

  const currentCulture = cultureSelect.value;
  cultureSelect.innerHTML = '';

  regionConfig.cultures.forEach(culture => {
    const option = document.createElement('option');
    option.value = culture;
    option.textContent = configData.cultureNames[culture] || culture;
    cultureSelect.appendChild(option);
  });

  if (regionConfig.cultures.includes(currentCulture)) {
    cultureSelect.value = currentCulture;
  }
}

function applySavedCredentials() {
  if (!window.CredentialStore) return;
  const env = envSelect.value;
  const culture = cultureSelect.value;
  if (!env || !culture) return;
  const entry = window.CredentialStore.getEntry(env, culture);
  if (!entry) return;

  if (entry.username !== null && entry.username !== undefined) {
    usernameInput.value = entry.username || '';
  }
  if (entry.password !== null && entry.password !== undefined) {
    passwordInput.value = entry.password || '';
  }
}

function parseSkus(input) {
  if (!input || !input.trim()) return [];
  return input
    .split(/[,\s\n]+/)
    .map(s => s.trim())
    .filter(s => s && /^\d+$/.test(s));
}

function updateSkuCount() {
  const skus = parseSkus(skuInput.value);
  skuCount.textContent = `${skus.length} SKU${skus.length !== 1 ? 's' : ''} entered`;
}

function savePreferences() {
  const prefs = {
    environment: envSelect.value,
    region: regionSelect.value,
    culture: cultureSelect.value,
    skus: skuInput.value,
    fullScreenshot: fullScreenshotCheck.checked,
    topScreenshot: topScreenshotCheck.checked,
    addToCart: addToCartCheck.checked,
    username: usernameInput.value.trim() || null,
    password: passwordInput.value || null
  };
  localStorage.setItem('skuTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('skuTesterPrefs'));
    if (prefs) {
      if (prefs.environment) envSelect.value = prefs.environment;
      if (prefs.region) {
        regionSelect.value = prefs.region;
        updateCultureOptions();
      }
      if (prefs.culture) cultureSelect.value = prefs.culture;
      if (prefs.skus) skuInput.value = prefs.skus;
      if (typeof prefs.fullScreenshot === 'boolean') fullScreenshotCheck.checked = prefs.fullScreenshot;
      if (typeof prefs.topScreenshot === 'boolean') {
        topScreenshotCheck.checked = prefs.topScreenshot;
        if (prefs.topScreenshot) fullScreenshotCheck.checked = false;
      }
      if (typeof prefs.addToCart === 'boolean') addToCartCheck.checked = prefs.addToCart;
      updateSkuCount();
    }
  } catch (e) {
    console.debug('Could not load preferences:', e);
  }
  applySavedCredentials();
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    reconnectAttempts = 0;
    setConnectionStatus('connected');
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    setConnectionStatus('disconnected');

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(connectWebSocket, 2000 * reconnectAttempts);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (e) {
      console.error('Invalid WebSocket message:', e);
    }
  };
}

function handleWebSocketMessage(message) {
  // Only handle SKU-related messages
  if (message.type === 'sku-progress') {
    handleProgress(message.data);
  } else if (message.type === 'sku-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'sku-error') {
    handleError(message.data);
  }
}

function handleProgress(data) {
  const progress = data.progress;
  switch (progress.type) {
    case 'browser':
      setStatusRunning('Starting...', progress.status);
      break;

    case 'login':
      setStatusRunning('Logging in...', progress.status);
      break;

    case 'sku-start':
      progressSku.textContent = `SKU: ${progress.sku}`;
      currentSkuInfo.style.display = 'block';
      currentSkuName.textContent = `SKU ${progress.sku}`;
      currentSkuPrice.textContent = '-';
      currentSkuStatus.textContent = progress.status;
      setStatusRunning('Capturing...', `SKU ${progress.sku}: ${progress.status}`);
      break;

    case 'sku-status':
      currentSkuStatus.textContent = progress.status;
      setStatusRunning('Capturing...', `SKU ${progress.sku}: ${progress.status}`);
      break;

    case 'sku-complete':
      if (progress.data) {
        currentSkuName.textContent = progress.data.name || `SKU ${progress.sku}`;
        currentSkuPrice.textContent = progress.data.price || '-';
      }
      currentSkuStatus.textContent = 'Complete';
      updateProgressBar(progress.current, progress.total);
      break;

    case 'sku-error':
      currentSkuStatus.textContent = `Error: ${progress.error}`;
      updateProgressBar(progress.current, progress.total);
      break;
  }
}

function handleStatusUpdate(data) {
  switch (data.type) {
    case 'started':
      isCapturing = true;
      captureStartTime = Date.now();
      setUICapturing();
      setStatusRunning('Starting capture...', `${data.skuCount} SKUs to process`);
      break;

    case 'waiting-for-auth':
      setStatusRunning('Waiting for manual sign-in', data.message || 'Please sign in to the environment in the browser window, then click Resume Capture');
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Resume Capture';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      break;

    case 'resuming':
      setStatusRunning('Resuming capture...', 'Continuing with SKU processing');
      isWaitingForResume = false;
      startCaptureBtn.disabled = true;
      startCaptureBtn.textContent = 'Start Capture';
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current SKU to complete');
      break;

    case 'cancelled':
      isCapturing = false;
      setUIIdle();
      const cancelledCount = data.results?.filter(r => r.success).length || 0;
      setStatusIdle('Capture cancelled', `${cancelledCount} SKUs captured before cancellation`);
      saveReportBtn.disabled = !data.results?.length;
      break;

    case 'completed':
      isCapturing = false;
      isWaitingForResume = false;
      setUIIdle();

      if (data.errorCount === 0) {
        setStatusSuccess('Capture complete!', `${data.successCount} SKUs captured in ${formatDuration(data.duration)}`);
      } else {
        setStatusSuccess('Capture complete with errors', `${data.successCount} succeeded, ${data.errorCount} failed`);
      }

      saveReportBtn.disabled = !data.results?.length;
      break;
  }
}

function handleError(data) {
  isCapturing = false;
  setUIIdle();
  setStatusError('Error', data.message);
}

function updateProgressBar(current, total) {
  const percentage = (current / total) * 100;
  progressBarInner.style.width = `${percentage}%`;
  progressCount.textContent = `${current} / ${total}`;

  if (captureStartTime && current > 0) {
    const elapsed = Date.now() - captureStartTime;
    const avgPerItem = elapsed / current;
    const remaining = (total - current) * avgPerItem;
    progressEta.textContent = `ETR: ${formatTime(remaining)}`;
  }
}

function formatDuration(ms) {
  if (!ms) return '-';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

async function startCapture() {
  const skus = parseSkus(skuInput.value);

  if (skus.length === 0) {
    setStatusError('No SKUs entered', 'Enter at least one SKU number');
    return;
  }

  const addToCart = addToCartCheck.checked;
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const topScreenshot = topScreenshotCheck.checked;
  const fullScreenshot = fullScreenshotCheck.checked && !topScreenshot;
  const environment = envSelect.value;

  if (addToCart && (!username || !password)) {
    setStatusError('Credentials required', 'Enter username and password to use Add to Cart');
    return;
  }

  const options = {
    skus,
    environment,
    region: regionSelect.value,
    culture: cultureSelect.value,
    fullScreenshot,
    topScreenshot,
    addToCart: addToCartCheck.checked,
    username: usernameInput.value.trim() || null,
    password: passwordInput.value || null
  };

  progressEnv.textContent = `Env: ${options.environment}`;
  progressCulture.textContent = `Culture: ${options.culture}`;
  progressSku.textContent = `SKUs: ${skus.length}`;

  try {
    const response = await fetch('/api/sku/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    const result = await response.json();

    if (!response.ok) {
      setStatusError('Failed to start', result.error || 'Unknown error');
      return;
    }

  } catch (err) {
    setStatusError('Connection error', err.message);
  }
}

async function stopCapture() {
  try {
    await fetch('/api/sku/stop', { method: 'POST' });
  } catch (err) {
    console.error('Error stopping capture:', err);
  }
}

async function resumeCapture() {
  try {
    setStatusRunning('Resuming...', 'Continuing capture after manual sign-in');
    startCaptureBtn.disabled = true;

    const response = await fetch('/api/sku/resume', { method: 'POST' });
    const result = await response.json();

    if (!result.ok) {
      setStatusError('Failed to resume', result.message || 'Unknown error');
      startCaptureBtn.disabled = false;
    }
  } catch (err) {
    console.error('Error resuming capture:', err);
    setStatusError('Connection error', err.message);
    startCaptureBtn.disabled = false;
  }
}

function setUICapturing() {
  startCaptureBtn.disabled = true;
  stopCaptureBtn.disabled = false;
  saveReportBtn.disabled = true;
  progressContainer.style.display = 'block';
  progressBarInner.style.width = '0%';
  progressCount.textContent = '0 / 0';
  progressEta.textContent = 'ETR: --:--';
  currentSkuInfo.style.display = 'none';
}

function setUIIdle() {
  isCapturing = false;
  startCaptureBtn.disabled = false;
  stopCaptureBtn.disabled = true;
  progressContainer.style.display = 'none';
  currentSkuInfo.style.display = 'none';
}

function setStatusIdle(main, detail) {
  statusBanner.className = 'status-banner idle';
  statusMain.textContent = main || 'Ready to capture';
  statusDetail.textContent = detail || '';
}

function setStatusRunning(main, detail) {
  statusBanner.className = 'status-banner running';
  statusMain.textContent = main;
  statusDetail.textContent = detail || '';
}

function setStatusSuccess(main, detail) {
  statusBanner.className = 'status-banner success';
  statusMain.textContent = main;
  statusDetail.textContent = detail || '';
}

function setStatusError(main, detail) {
  statusBanner.className = 'status-banner error';
  statusMain.textContent = main;
  statusDetail.textContent = detail || '';
}

function setConnectionStatus(status) {
  connectionStatus.className = `connection-status ${status}`;
  const text = connectionStatus.querySelector('.connection-text');

  switch (status) {
    case 'connected':
      text.textContent = 'Connected';
      break;
    case 'disconnected':
      text.textContent = 'Disconnected';
      break;
    default:
      text.textContent = 'Connecting...';
  }
}

document.addEventListener('DOMContentLoaded', init);
