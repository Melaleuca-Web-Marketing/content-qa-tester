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
const BASE_PATH = (window.__BASE_PATH || '').replace(/\/+$/, '');
const api = (path) => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
const userId = window.UserSession?.getId?.() || null;

// Log user session info
if (userId) {
  const storageStatus = window.UserSession?.getStorageStatus?.() || 'unknown';
  console.log(`[Session] User ID: ${userId} | Storage: ${storageStatus}`);
} else {
  console.error('[Critical] Failed to get userId - multi-user isolation may not work properly');
}

// DOM Elements
const envSelect = document.getElementById('env-select');
const regionSelect = document.getElementById('region-select');
const cultureOptions = document.getElementById('culture-options');
const selectAllCulturesBtn = document.getElementById('select-all-cultures');
const deselectAllCulturesBtn = document.getElementById('deselect-all-cultures');
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
    renderCultureOptions();
    loadPreferences();
    connectWebSocket();
  } catch (err) {
    console.error('Initialization error:', err);
    setStatusError('Initialization failed', err.message);
  }
}

async function loadConfig() {
  const response = await fetch(api('/api/config'));
  configData = await response.json();
}

function setupEventListeners() {
  regionSelect.addEventListener('change', () => {
    renderCultureOptions();
    applySavedCredentials();
    savePreferences();
  });

  envSelect.addEventListener('change', () => {
    applySavedCredentials();
    savePreferences();
  });
  if (selectAllCulturesBtn && deselectAllCulturesBtn) {
    selectAllCulturesBtn.addEventListener('click', () => toggleAllCultures(true));
    deselectAllCulturesBtn.addEventListener('click', () => toggleAllCultures(false));
  }
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

function renderCultureOptions(selectedCultures = null) {
  const region = regionSelect.value;
  const regionConfig = configData?.regions?.[region];

  if (!regionConfig) {
    cultureOptions.innerHTML = '<div class="meta">No cultures available</div>';
    return;
  }

  const defaultSelection = Array.isArray(selectedCultures) && selectedCultures.length > 0
    ? selectedCultures
    : regionConfig.cultures;

  cultureOptions.innerHTML = regionConfig.cultures.map(culture => `
    <label class="checkbox-row">
      <input type="checkbox" name="culture" value="${culture}" ${defaultSelection.includes(culture) ? 'checked' : ''}>
      <span>${configData.cultureNames?.[culture] || culture}</span>
    </label>
  `).join('');

  cultureOptions.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', () => {
      applySavedCredentials();
      savePreferences();
    });
  });
}

function toggleAllCultures(checked) {
  cultureOptions.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
  });
  applySavedCredentials();
  savePreferences();
}

function getSelectedCultures() {
  return Array.from(cultureOptions.querySelectorAll('input:checked')).map(cb => cb.value);
}

function applySavedCredentials() {
  if (!window.CredentialStore) return;
  const env = envSelect.value;
  const cultures = getSelectedCultures();
  const culture = cultures[0];
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
    cultures: getSelectedCultures(),
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
        const selectedCultures = Array.isArray(prefs.cultures)
          ? prefs.cultures
          : (prefs.culture ? [prefs.culture] : null);
        renderCultureOptions(selectedCultures);
      }
      if (!prefs.region) {
        const selectedCultures = Array.isArray(prefs.cultures)
          ? prefs.cultures
          : (prefs.culture ? [prefs.culture] : null);
        if (selectedCultures) {
          cultureOptions.querySelectorAll('input').forEach(cb => {
            cb.checked = selectedCultures.includes(cb.value);
          });
        }
      }
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
  const wsUrl = `${protocol}//${window.location.host}${BASE_PATH}?userId=${encodeURIComponent(userId || '')}`;

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
  if (progress.culture) {
    progressCulture.textContent = `Culture: ${progress.culture}`;
  }
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
      currentSkuName.textContent = progress.culture
        ? `SKU ${progress.sku} (${progress.culture})`
        : `SKU ${progress.sku}`;
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
      setStatusRunning('Starting capture...', `${data.skuCount} captures to process`);
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
      setStatusIdle('Capture cancelled', `${cancelledCount} captures completed before cancellation`);
      saveReportBtn.disabled = !data.results?.length;
      break;

    case 'completed':
      isCapturing = false;
      isWaitingForResume = false;
      setUIIdle();

      if (data.errorCount === 0) {
        setStatusSuccess('Capture complete!', `${data.successCount} captures completed in ${formatDuration(data.duration)}`);
      } else {
        setStatusSuccess('Capture complete with errors', `${data.successCount} captures succeeded, ${data.errorCount} failed`);
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

function formatCultureList(cultures) {
  if (!cultures || cultures.length === 0) return '-';
  if (cultures.length <= 2) return cultures.join(', ');
  return `${cultures.length} cultures`;
}

async function startCapture() {
  const skus = parseSkus(skuInput.value);
  const cultures = getSelectedCultures();

  if (skus.length === 0) {
    setStatusError('No SKUs entered', 'Enter at least one SKU number');
    return;
  }

  if (cultures.length === 0) {
    setStatusError('No cultures selected', 'Select at least one culture');
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
    cultures,
    fullScreenshot,
    topScreenshot,
    addToCart: addToCartCheck.checked,
    username: usernameInput.value.trim() || null,
    password: passwordInput.value || null
  };

  progressEnv.textContent = `Env: ${options.environment}`;
  progressCulture.textContent = `Culture: ${formatCultureList(cultures)}`;
  progressSku.textContent = `SKUs: ${skus.length} (${cultures.length} cultures)`;

  try {
    const response = await fetch(api('/api/sku/start'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'X-User-Id': userId } : {})
      },
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
    await fetch(api('/api/sku/stop'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
  } catch (err) {
    console.error('Error stopping capture:', err);
  }
}

async function resumeCapture() {
  try {
    setStatusRunning('Resuming...', 'Continuing capture after manual sign-in');
    startCaptureBtn.disabled = true;

    const response = await fetch(api('/api/sku/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
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
