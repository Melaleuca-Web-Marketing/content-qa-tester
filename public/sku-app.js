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
let activityItems = []; // Activity feed items
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

// Activity feed elements
const activityFeed = document.getElementById('activity-feed');
const activityList = document.getElementById('activity-list');
const passedCountEl = document.getElementById('passed-count');
const failedCountEl = document.getElementById('failed-count');
const clearActivityBtn = document.getElementById('clear-activity');

async function init() {
  try {
    await loadConfig();
    setupEventListeners();
    renderCultureOptions();
    loadPreferences();
    connectWebSocket();
    setStatusRunning('Checking status...', 'Loading job state');
    await checkStatus(); // Check if a job is already running
    loadActivityFromStorage(); // Restore activity feed from session
  } catch (err) {
    console.error('Initialization error:', err);
    setStatusError('Initialization failed', err.message);
  }
}

async function checkStatus() {
  try {
    const response = await fetch(api('/api/sku/status'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const status = await response.json();

    if (status.isRunning) {
      isCapturing = true;
      setUICapturing();
      setStatusRunning('Job in progress', 'Reconnected to running job');

      if (status.statusType === 'waiting-for-auth') {
        isWaitingForResume = true;
        startCaptureBtn.textContent = 'Resume Capture';
        startCaptureBtn.disabled = false;
        setStatusRunning('Waiting for manual sign-in', status.message || 'Please sign in and click Resume');
      } else if (status.statusType === 'waiting-for-credentials') {
        // Restore credential error UI state
        setStatusError('Authentication Failed', status.message);
        showCredentialErrorAlert(status.error || 'Invalid username or password');
        startCaptureBtn.textContent = '🔄 Update & Resume';
        startCaptureBtn.disabled = false;
        stopCaptureBtn.disabled = false;
        usernameInput.disabled = false;
        passwordInput.disabled = false;
        const loginSection = document.getElementById('login-section');
        if (loginSection) {
          loginSection.classList.add('credential-error');
        }
      }

      // Restore activity feed from server-side results (catches SKUs processed while away)
      await restoreActivityFromServer();
    } else if (status.resultsCount > 0) {
      // Job completed but we may have missed some results - restore from server
      await restoreActivityFromServer();
    } else {
      setStatusIdle('Ready to capture', '');
    }
  } catch (err) {
    console.error('Failed to check status:', err);
  }
}

// Restore activity feed from server-side SKU results
async function restoreActivityFromServer() {
  try {
    const response = await fetch(api('/api/sku/results'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const serverResults = await response.json();

    if (!Array.isArray(serverResults) || serverResults.length === 0) {
      return;
    }

    // Get existing SKUs in activity feed to avoid duplicates
    const existingSkus = new Set(activityItems.map(item => `${item.sku}-${item.culture}`));

    // Add any missing results from server
    let addedCount = 0;
    for (const result of serverResults) {
      const key = `${result.sku}-${result.culture}`;
      if (existingSkus.has(key)) {
        continue; // Already have this result
      }

      // For failed results
      if (!result.success) {
        const item = {
          type: 'error',
          sku: result.sku,
          culture: result.culture,
          error: result.error || 'Failed',
          timestamp: result.timestamp ? new Date(result.timestamp) : new Date()
        };
        activityItems.unshift(item);
        addedCount++;
        continue;
      }

      // For successful results - compute validation issues (same as handleProgress)
      const data = result.data || {};
      const issues = [];

      if (result.addToCartResult && result.addToCartResult.success === false) {
        issues.push('Add to cart failed');
      }
      if (!data.description) {
        issues.push('Missing description');
      }
      if (data.aboutHasContent === false) {
        issues.push('Missing About content');
      }
      if (data.ingredientsHasContent === false) {
        issues.push('Missing Ingredients');
      }

      // Determine item type based on issues
      const hasErrors = result.addToCartResult && result.addToCartResult.success === false;
      const hasWarnings = issues.length > 0;
      const type = hasErrors ? 'error' : (hasWarnings ? 'warning' : 'success');

      const item = {
        type,
        sku: result.sku,
        culture: result.culture,
        name: data.name || `SKU ${result.sku}`,
        price: data.price,
        addToCart: result.addToCartResult,
        issues: issues,
        timestamp: result.timestamp ? new Date(result.timestamp) : new Date()
      };

      // Add item - errors/warnings at start, success at end
      if (type === 'error' || type === 'warning') {
        activityItems.unshift(item);
      } else {
        const firstSuccessIndex = activityItems.findIndex(i => i.type === 'success');
        if (firstSuccessIndex === -1) {
          activityItems.push(item);
        } else {
          activityItems.splice(firstSuccessIndex, 0, item);
        }
      }
      addedCount++;
    }

    if (addedCount > 0) {
      console.log(`[Activity] Restored ${addedCount} results from server`);
      saveActivityToStorage();
      renderActivityFeed();
      activityFeed.style.display = 'block';
    }
  } catch (err) {
    console.error('Failed to restore activity from server:', err);
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

  startCaptureBtn.addEventListener('click', async () => {
    // Check if we're in credential update mode
    if (startCaptureBtn.textContent.includes('Update & Resume')) {
      await updateCredentialsAndResume();
    } else if (isWaitingForResume) {
      resumeCapture();
    } else {
      startCapture();
    }
  });
  stopCaptureBtn.addEventListener('click', stopCapture);

  // Activity feed clear button
  if (clearActivityBtn) {
    clearActivityBtn.addEventListener('click', clearActivityFeed);
  }

  // Password visibility toggle
  const passwordInput = document.getElementById('password-input');
  const passwordToggleBtn = document.querySelector('.password-toggle-btn');

  if (passwordToggleBtn && passwordInput) {
    passwordToggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      passwordToggleBtn.querySelector('.eye-icon').textContent = isPassword ? '🙈' : '👁️';
    });
  }
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
      // Restore saved credentials
      if (prefs.username) usernameInput.value = prefs.username;
      if (prefs.password) passwordInput.value = prefs.password;
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

      // Check for validation issues
      const data = progress.data || {};
      const issues = [];
      if (data.addToCart && data.addToCart.success === false) {
        issues.push('Add to cart failed');
      }
      if (!data.description) {
        issues.push('Missing description');
      }
      if (data.aboutHasContent === false) {
        issues.push('Missing About content');
      }
      if (data.ingredientsHasContent === false) {
        issues.push('Missing Ingredients');
      }

      // Determine item type based on issues
      const hasErrors = data.addToCart && data.addToCart.success === false;
      const hasWarnings = issues.length > 0;

      addActivityItem({
        type: hasErrors ? 'error' : (hasWarnings ? 'warning' : 'success'),
        sku: progress.sku,
        culture: progress.culture,
        name: data.name || `SKU ${progress.sku}`,
        price: data.price,
        addToCart: data.addToCart,
        issues: issues
      });
      break;

    case 'sku-error':
      currentSkuStatus.textContent = `Error: ${progress.error}`;
      updateProgressBar(progress.current, progress.total);
      // Add to activity feed
      addActivityItem({
        type: 'error',
        sku: progress.sku,
        culture: progress.culture,
        error: progress.error
      });
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
      // Clear and show activity feed
      clearActivityFeed();
      activityFeed.style.display = 'block';
      break;

    case 'waiting-for-auth':
      setStatusRunning('Waiting for manual sign-in', data.message || 'Please sign in to the environment in the browser window, then click Resume Capture');
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Resume Capture';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      break;

    case 'waiting-for-credentials':
      setStatusError('Authentication Failed', data.message || 'Invalid username or password. Update credentials and click Resume.');
      showCredentialErrorAlert(data.error || 'Invalid username or password');
      isWaitingForResume = true;
      startCaptureBtn.textContent = '🔄 Update & Resume';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      // Enable credential inputs
      usernameInput.disabled = false;
      passwordInput.disabled = false;
      usernameInput.focus();
      // Add visual highlight to credential fields
      const loginSection = document.getElementById('login-section');
      if (loginSection) {
        loginSection.classList.add('credential-error');
      }
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
      if (saveReportBtn) saveReportBtn.disabled = !data.results?.length;
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

      if (saveReportBtn) saveReportBtn.disabled = !data.results?.length;
      break;
  }
}

function handleError(data) {
  isCapturing = false;
  setUIIdle();
  setStatusError('Error', data.message);
}

function showCredentialErrorAlert(errorMessage) {
  // Create or update alert banner
  let alertBanner = document.getElementById('credential-error-alert');

  if (!alertBanner) {
    alertBanner = document.createElement('div');
    alertBanner.id = 'credential-error-alert';
    alertBanner.className = 'credential-error-alert';
    document.querySelector('.container').prepend(alertBanner);
  }

  alertBanner.innerHTML = `
    <div class="alert-icon">⚠️</div>
    <div class="alert-content">
      <div class="alert-title">Authentication Failed</div>
      <div class="alert-message">${errorMessage}</div>
      <div class="alert-instructions">Please update your username and password below, then click "Update & Resume"</div>
    </div>
  `;

  alertBanner.style.display = 'flex';
}

function hideCredentialErrorAlert() {
  const alertBanner = document.getElementById('credential-error-alert');
  if (alertBanner) {
    alertBanner.style.display = 'none';
  }
  const loginSection = document.getElementById('login-section');
  if (loginSection) {
    loginSection.classList.remove('credential-error');
  }
}

function resetCredentialPromptState() {
  isWaitingForResume = false;
  startCaptureBtn.textContent = 'Start Capture';
  hideCredentialErrorAlert();
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
      if (response.status === 409) {
        alert('A SKU job is already running. Please wait for it to complete or stop it first.');
        await checkStatus();
      } else {
        setStatusError('Failed to start', result.error || 'Unknown error');
      }
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

async function updateCredentialsAndResume() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    setStatusError('Credentials Required', 'Enter username and password to retry');
    return;
  }

  try {
    setStatusRunning('Updating credentials...', 'Sending new credentials to server');
    startCaptureBtn.disabled = true;

    // Send updated credentials to server
    const updateResponse = await fetch(api('/api/sku/update-credentials'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'X-User-Id': userId } : {})
      },
      body: JSON.stringify({ username, password })
    });

    if (!updateResponse.ok) {
      const error = await updateResponse.json();
      setStatusError('Update Failed', error.error || 'Failed to update credentials');
      startCaptureBtn.disabled = false;
      return;
    }

    // Resume capture
    const resumeResponse = await fetch(api('/api/sku/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const result = await resumeResponse.json();

    if (!result.ok) {
      setStatusError('Failed to resume', result.message || 'Unknown error');
      startCaptureBtn.disabled = false;
      return;
    }

    // Hide error alert and remove highlighting
    hideCredentialErrorAlert();

    // Disable credential inputs
    usernameInput.disabled = true;
    passwordInput.disabled = true;

    setStatusRunning('Retrying authentication...', 'Logging in with updated credentials');
    isWaitingForResume = false;
    startCaptureBtn.textContent = 'Start Capture';

  } catch (err) {
    console.error('Error updating credentials:', err);
    setStatusError('Connection error', err.message);
    startCaptureBtn.disabled = false;
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
  if (saveReportBtn) saveReportBtn.disabled = true;
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
  resetCredentialPromptState();
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

// ===== Activity Feed Functions =====
const ACTIVITY_STORAGE_KEY = 'activityFeed-sku';

function loadActivityFromStorage() {
  try {
    const stored = sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (stored) {
      activityItems = JSON.parse(stored);
      // Restore Date objects
      activityItems.forEach(item => {
        if (item.timestamp) item.timestamp = new Date(item.timestamp);
      });
      renderActivityFeed();
      if (activityItems.length > 0) {
        activityFeed.style.display = 'block';
      }
    }
  } catch (e) {
    console.error('Failed to load activity feed:', e);
  }
}

function saveActivityToStorage() {
  try {
    sessionStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activityItems));
  } catch (e) {
    console.error('Failed to save activity feed:', e);
  }
}

function addActivityItem(item) {
  item.timestamp = new Date();

  // Add to array - errors/warnings at start, success at end
  if (item.type === 'error' || item.type === 'warning') {
    activityItems.unshift(item);
  } else {
    // Find first success index or push to end
    const firstSuccessIndex = activityItems.findIndex(i => i.type === 'success');
    if (firstSuccessIndex === -1) {
      activityItems.push(item);
    } else {
      activityItems.splice(firstSuccessIndex, 0, item);
    }
  }

  saveActivityToStorage();
  renderActivityFeed();
}

function clearActivityFeed() {
  activityItems = [];
  saveActivityToStorage();
  renderActivityFeed();
}

function renderActivityFeed() {
  const passed = activityItems.filter(i => i.type === 'success').length;
  const warnings = activityItems.filter(i => i.type === 'warning').length;
  const failed = activityItems.filter(i => i.type === 'error').length;

  passedCountEl.textContent = passed;
  failedCountEl.textContent = failed + warnings; // Count warnings as issues

  if (activityItems.length === 0) {
    activityList.innerHTML = '<div class="activity-empty">No activity yet</div>';
    return;
  }

  activityList.innerHTML = activityItems.map(item => {
    const icon = item.type === 'error' ? '❌' : (item.type === 'warning' ? '⚠️' : '✅');
    const timeStr = formatActivityTime(item.timestamp);
    const itemClass = item.type === 'error' ? 'error' : (item.type === 'warning' ? 'warning' : 'success');

    if (item.type === 'error') {
      return `
        <div class="activity-item error">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">SKU ${item.sku}${item.culture ? ` (${item.culture})` : ''}</div>
            <div class="activity-item-detail">${item.error}</div>
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    } else {
      const details = [];
      if (item.name && item.name !== `SKU ${item.sku}`) details.push(item.name);
      if (item.price) details.push(item.price);
      if (item.addToCart?.success) details.push('Added to Cart ✓');

      // Show issues for warnings
      const issueText = item.issues && item.issues.length > 0 ? item.issues.join(' • ') : '';

      return `
        <div class="activity-item ${itemClass}">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">SKU ${item.sku}${item.culture ? ` (${item.culture})` : ''}</div>
            ${issueText ? `<div class="activity-item-detail">${issueText}</div>` : (details.length ? `<div class="activity-item-detail">${details.join(' • ')}</div>` : '')}
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    }
  }).join('');

  // Auto-scroll to top if there are errors/warnings (they appear at top)
  if (failed > 0 || warnings > 0) {
    activityList.scrollTop = 0;
  }
}

function formatActivityTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return date.toLocaleTimeString();
}

document.addEventListener('DOMContentLoaded', init);
