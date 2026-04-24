// pdp-app.js - Frontend JavaScript for PDP Tester UI

let configData = null;
let isCapturing = false;
let isQueued = false;
let captureHadError = false;
let captureErrorMessage = '';
let jobSummary = '';
let completionNotified = false;
let audioContext = null;
let selectedSound = localStorage.getItem('notificationSound') || 'classic';
let captureStartTime = null;

// Sound options configuration
const SOUND_OPTIONS = [
  { id: 'classic', name: 'Classic', desc: 'Default two-tone alert' },
  { id: 'iphone', name: 'iPhone Tri-Tone', desc: 'Classic iOS notification' },
  { id: 'samsung', name: 'Samsung Whistle', desc: 'Classic Samsung notification' },
  { id: 'chime', name: 'Chime', desc: 'Pleasant bell sound' },
  { id: 'ping', name: 'Ping', desc: 'Simple soft ping' },
  { id: 'alert', name: 'Alert', desc: 'Attention-grabbing tone' },
  { id: 'bubble', name: 'Bubble', desc: 'Soft bubble pop' },
  { id: 'silent', name: 'Silent', desc: 'No sound' }
];
let ws = null;
let reconnectAttempts = 0;
let isWaitingForResume = false;
let activityItems = [];
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
const testNameInput = document.getElementById('test-name-input');
const cultureOptions = document.getElementById('culture-options');
const selectAllCulturesBtn = document.getElementById('select-all-cultures');
const deselectAllCulturesBtn = document.getElementById('deselect-all-cultures');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const loginFields = document.getElementById('login-fields');
if (loginFields && loginFields.tagName === 'FORM') {
  loginFields.addEventListener('submit', (event) => event.preventDefault());
}
const skuInput = document.getElementById('sku-input');
const skuCount = document.getElementById('sku-count');
const clearSkusBtn = document.getElementById('clear-skus');
const widthOptions = document.getElementById('width-options');
const selectAllWidthsBtn = document.getElementById('select-all-widths');
const deselectAllWidthsBtn = document.getElementById('deselect-all-widths');
const startCaptureBtn = document.getElementById('start-capture');
const stopCaptureBtn = document.getElementById('stop-capture');
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
const currentSkuContentType = document.getElementById('current-sku-content-type');
const currentSkuStatus = document.getElementById('current-sku-status');
const connectionStatus = document.getElementById('connection-status');

// Activity feed elements
const activityFeed = document.getElementById('activity-feed');
const activityList = document.getElementById('activity-list');
const passedCountEl = document.getElementById('passed-count');
const failedCountEl = document.getElementById('failed-count');
const clearActivityBtn = document.getElementById('clear-activity');

function isQueuedStatus(status) {
  return status?.type === 'queued' ||
    status?.statusType === 'queued' ||
    Number(status?.queue?.queuedInLane || 0) > 0;
}

function formatQueueDetail(status = {}) {
  const queue = status.queue || {};
  const position = status.position ?? status.queuePosition ?? queue.queuedGlobal;
  const running = status.running ?? queue.runningGlobal;
  const limit = status.limit ?? queue.globalConcurrencyLimit;
  const parts = [];

  if (Number.isFinite(position) && position > 0) {
    parts.push(`Position ${position}`);
  }
  if (Number.isFinite(running) && Number.isFinite(limit) && limit > 0) {
    parts.push(`${running}/${limit} running`);
  }

  return parts.length > 0
    ? parts.join(' | ')
    : 'Waiting for an available PDP worker';
}

async function init() {
  try {
    await loadConfig();
    setupEventListeners();
    renderCultureOptions();
    renderWidthOptions();
    loadPreferences();
    initSoundSettings();
    connectWebSocket();
    loadActivityFromStorage();
    setStatusRunning('Checking status...', 'Loading job state');
    await checkStatus();
  } catch (err) {
    console.error('Initialization error:', err);
    setStatusError('Initialization failed', err.message);
  }
}

async function checkStatus() {
  try {
    const response = await fetch(api('/api/pdp/status'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const status = await response.json();

    if (isQueuedStatus(status)) {
      setUIQueued(formatQueueDetail(status));
    } else if (status.isRunning) {
      isCapturing = true;
      setUICapturing();
      setStatusRunning('Job in progress', 'Reconnected to running job');
      syncCaptureStartTime(status.startedAt);

      if (status.options) {
        if (status.options.environment) {
          progressEnv.textContent = `Env: ${status.options.environment}`;
        }
        if (Array.isArray(status.options.cultures) && status.options.cultures.length > 0) {
          progressCulture.textContent = `Culture: ${formatCultureList(status.options.cultures)}`;
        }
        if (Array.isArray(status.options.skus) && status.options.skus.length > 0) {
          const cultureCount = Array.isArray(status.options.cultures) ? status.options.cultures.length : 0;
          const cultureSuffix = cultureCount > 0 ? ` (${cultureCount} cultures)` : '';
          progressSku.textContent = `SKUs: ${status.options.skus.length}${cultureSuffix}`;
        }
      }

      if (status.statusType === 'waiting-for-auth') {
        isWaitingForResume = true;
        startCaptureBtn.textContent = 'Resume Test';
        startCaptureBtn.disabled = false;
        setStatusRunning('Waiting for manual sign-in', status.message || 'Please sign in and click Resume');
      } else if (status.statusType === 'waiting-for-credentials') {
        setStatusError('Authentication Failed', status.message);
        showCredentialErrorAlert(status.error || 'Invalid username or password');
        startCaptureBtn.textContent = 'Update & Resume';
        startCaptureBtn.disabled = false;
        stopCaptureBtn.disabled = false;
        usernameInput.disabled = false;
        passwordInput.disabled = false;
        const loginSection = document.getElementById('login-section');
        if (loginSection) {
          loginSection.classList.add('credential-error');
        }
      } else if (status.progress) {
        applyProgressSnapshot(status.progress);
      }

      await restoreActivityFromServer();
    } else if (status.resultsCount > 0) {
      await restoreActivityFromServer();
      setStatusIdle('Ready to test', `Previous job completed with ${status.resultsCount} results`);
    } else {
      setStatusIdle('Ready to test', '');
    }
  } catch (err) {
    console.error('Failed to check status:', err);
    setStatusIdle('Ready to test', '');
  }
}

async function restoreActivityFromServer() {
  try {
    const response = await fetch(api('/api/pdp/results'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const serverResults = await response.json();

    if (!Array.isArray(serverResults) || serverResults.length === 0) {
      renderActivityFeed();
      activityFeed.style.display = 'block';
      return;
    }

    const existingSkus = new Set(activityItems.map(item => `${item.sku}-${item.culture}`));

    let addedCount = 0;
    for (const result of serverResults) {
      const key = `${result.sku}-${result.culture}`;
      if (existingSkus.has(key)) {
        continue;
      }

      if (!result.success) {
        const item = {
          type: 'error',
          sku: result.sku,
          culture: result.culture,
          error: result.error || 'Failed',
          url: result.url,
          timestamp: result.timestamp ? new Date(result.timestamp) : new Date()
        };
        activityItems.unshift(item);
        addedCount++;
        continue;
      }

      const contentType = result.contentType || 'nothing';
      const sectionCount = result.sections?.length || 0;
      const screenshotCount = result.screenshots?.length || 0;

      const item = {
        type: 'success',
        sku: result.sku,
        culture: result.culture,
        contentType,
        sectionCount,
        screenshotCount,
        url: result.url,
        timestamp: result.timestamp ? new Date(result.timestamp) : new Date()
      };

      activityItems.push(item);
      addedCount++;
    }

    if (addedCount > 0) {
      console.log(`[Activity] Restored ${addedCount} results from server`);
    }

    saveActivityToStorage();
    renderActivityFeed();
    activityFeed.style.display = 'block';
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
  if (testNameInput) {
    testNameInput.addEventListener('input', savePreferences);
  }

  if (selectAllCulturesBtn && deselectAllCulturesBtn) {
    selectAllCulturesBtn.addEventListener('click', () => toggleAllCultures(true));
    deselectAllCulturesBtn.addEventListener('click', () => toggleAllCultures(false));
  }

  if (selectAllWidthsBtn && deselectAllWidthsBtn) {
    selectAllWidthsBtn.addEventListener('click', () => toggleAllWidths(true));
    deselectAllWidthsBtn.addEventListener('click', () => toggleAllWidths(false));
  }

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
    if (startCaptureBtn.textContent.includes('Update & Resume')) {
      await updateCredentialsAndResume();
    } else if (isWaitingForResume) {
      resumeCapture();
    } else {
      startCapture();
    }
  });
  stopCaptureBtn.addEventListener('click', stopCapture);

  if (clearActivityBtn) {
    clearActivityBtn.addEventListener('click', clearActivityFeed);
  }

  // Password visibility toggle
  const passwordToggleBtn = document.querySelector('.password-toggle-btn');

  if (passwordToggleBtn && passwordInput) {
    const updatePasswordToggle = () => {
      const isVisible = passwordInput.type === 'text';
      passwordToggleBtn.classList.toggle('is-visible', isVisible);
      passwordToggleBtn.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
    };

    updatePasswordToggle();
    passwordToggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      updatePasswordToggle();
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

function renderWidthOptions() {
  const widths = configData?.pdp?.screenWidths || [320, 415, 576, 768, 992, 1210];
  if (!widthOptions) return;

  widthOptions.innerHTML = widths.map(width => `
    <label class="width-option selected">
      <input type="checkbox" name="width" value="${width}" checked>
      <span>${width}px</span>
    </label>
  `).join('');

  widthOptions.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.target.closest('.width-option').classList.toggle('selected', e.target.checked);
      savePreferences();
    });
  });
}

function toggleAllWidths(checked) {
  if (!widthOptions) return;
  widthOptions.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
    cb.closest('.width-option').classList.toggle('selected', checked);
  });
  savePreferences();
}

function getSelectedWidths() {
  if (!widthOptions) return [];
  return Array.from(widthOptions.querySelectorAll('input[name="width"]:checked'))
    .map(cb => parseInt(cb.value, 10))
    .filter(Number.isFinite);
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
    testName: testNameInput ? testNameInput.value.trim() : '',
    environment: envSelect.value,
    region: regionSelect.value,
    cultures: getSelectedCultures(),
    widths: getSelectedWidths(),
    skus: skuInput.value,
    username: usernameInput.value.trim() || null
  };
  localStorage.setItem('pdpTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('pdpTesterPrefs'));
    if (prefs) {
      if (Object.prototype.hasOwnProperty.call(prefs, 'password')) {
        delete prefs.password;
        localStorage.setItem('pdpTesterPrefs', JSON.stringify(prefs));
      }
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
      if (prefs.widths && widthOptions) {
        widthOptions.querySelectorAll('input').forEach(cb => {
          const checked = prefs.widths.includes(parseInt(cb.value, 10));
          cb.checked = checked;
          cb.closest('.width-option').classList.toggle('selected', checked);
        });
      }
      if (typeof prefs.testName === 'string' && testNameInput) {
        testNameInput.value = prefs.testName;
      }
      if (prefs.skus) skuInput.value = prefs.skus;
      if (prefs.username) usernameInput.value = prefs.username;
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
  if (message.type === 'pdp-progress') {
    handleProgress(message.data);
  } else if (message.type === 'pdp-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'pdp-error') {
    handleError(message.data);
  }
}

function handleProgress(data) {
  syncCaptureStartTime(data.startedAt);
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

    case 'pdp-start':
      progressSku.textContent = `SKU: ${progress.sku}`;
      currentSkuInfo.style.display = 'block';
      currentSkuName.textContent = progress.culture
        ? `SKU ${progress.sku} (${progress.culture})`
        : `SKU ${progress.sku}`;
      currentSkuContentType.textContent = '-';
      currentSkuStatus.textContent = progress.status;
      setStatusRunning('Testing...', `SKU ${progress.sku}: ${progress.status}`);
      break;

    case 'pdp-status':
    case 'pdp-screenshot':
      currentSkuStatus.textContent = progress.status;
      setStatusRunning('Testing...', `SKU ${progress.sku}: ${progress.status}`);
      break;

    case 'pdp-complete':
      if (progress.data) {
        currentSkuContentType.textContent = getContentTypeLabel(progress.data.contentType);
      }
      currentSkuStatus.textContent = 'Complete';
      updateProgressBar(progress.current, progress.total);

      addActivityItem({
        type: 'success',
        sku: progress.sku,
        culture: progress.culture,
        contentType: progress.data?.contentType || 'nothing',
        sectionCount: progress.data?.sectionCount || 0,
        screenshotCount: progress.data?.screenshotCount || 0,
        url: progress.url
      });
      break;

    case 'pdp-error':
      currentSkuStatus.textContent = `Error: ${progress.error}`;
      updateProgressBar(progress.current, progress.total);
      addActivityItem({
        type: 'error',
        sku: progress.sku,
        culture: progress.culture,
        error: progress.error,
        url: progress.url
      });
      break;
  }
}

function getContentTypeLabel(contentType) {
  switch (contentType) {
    case 'pdp': return 'PDP Content';
    case 'longDescription': return 'Long Description';
    case 'nothing': return 'No Content';
    default: return 'Unknown';
  }
}

function handleStatusUpdate(data) {
  switch (data.type || data.statusType) {
    case 'queued':
      setUIQueued(formatQueueDetail(data));
      break;

    case 'started':
      isQueued = false;
      isCapturing = true;
      captureHadError = false;
      captureErrorMessage = '';
      completionNotified = false;
      jobSummary = buildJobSummary();
      requestNotificationPermission();
      primeAudio();
      captureStartTime = Number.isFinite(data.startedAt) ? data.startedAt : Date.now();
      setUICapturing();
      setStatusRunning('Starting test...', `${data.skuCount} SKUs to process`);
      clearActivityFeed();
      activityFeed.style.display = 'block';
      break;

    case 'waiting-for-auth':
      setStatusRunning('Waiting for manual sign-in', data.message || 'Please sign in to the environment in the browser window, then click Resume');
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Resume Test';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      progressEta.textContent = 'ETR: --:--';
      break;

    case 'waiting-for-credentials':
      setStatusError('Authentication Failed', data.message || 'Invalid username or password. Update credentials and click Resume.');
      showCredentialErrorAlert(data.error || 'Invalid username or password');
      notifyCredentialError(data.error || 'Invalid username or password');
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Update & Resume';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      progressEta.textContent = 'ETR: --:--';
      usernameInput.disabled = false;
      passwordInput.disabled = false;
      usernameInput.focus();
      const loginSection = document.getElementById('login-section');
      if (loginSection) {
        loginSection.classList.add('credential-error');
      }
      break;

    case 'resuming':
      setStatusRunning('Resuming test...', 'Continuing with SKU processing');
      isWaitingForResume = false;
      startCaptureBtn.disabled = true;
      startCaptureBtn.textContent = 'Start Test';
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current SKU to complete');
      break;

    case 'cancelled':
      isCapturing = false;
      isQueued = false;
      setUIIdle();
      captureStartTime = null;
      const cancelledCount = data.results?.filter(r => r.success).length || 0;
      setStatusIdle(
        'Test cancelled',
        data.message === 'Removed from queue' ? data.message : `${cancelledCount} SKUs completed before cancellation`
      );
      break;

    case 'completed':
      isCapturing = false;
      isQueued = false;
      isWaitingForResume = false;
      setUIIdle();
      captureStartTime = null;

      const successCount = Number.isFinite(data.successCount) ? data.successCount : 0;
      const errorCount = Number.isFinite(data.errorCount) ? data.errorCount : 0;
      const hasErrors = captureHadError || errorCount > 0 || successCount === 0;

      if (hasErrors) {
        if (errorCount > 0) {
          setStatusError('Test complete with errors', `${successCount} SKUs succeeded, ${errorCount} failed`);
        } else {
          setStatusError('Test failed', captureErrorMessage || 'Test did not complete');
        }
      } else {
        setStatusSuccess('Test complete!', `${successCount} SKUs tested in ${formatDuration(data.duration)}`);
      }

      const resultParts = [];
      resultParts.push(`${successCount} ok`);
      if (errorCount > 0) resultParts.push(`${errorCount} failed`);
      if (data.duration) resultParts.push(formatDuration(data.duration));
      const body = [jobSummary, resultParts.length ? `Result: ${resultParts.join(', ')}` : '']
        .filter(Boolean)
        .join(' | ');
      const title = hasErrors ? 'PDP test finished with errors' : 'PDP test completed';
      notifyJobComplete(title, body, hasErrors);
      break;
  }
}

function handleError(data) {
  isCapturing = false;
  setUIIdle();
  captureHadError = true;
  captureErrorMessage = data.message || 'Test failed';
  setStatusError('Error', data.message);
  const body = [jobSummary, data.message ? `Error: ${data.message}` : 'Error'].filter(Boolean).join(' | ');
  notifyJobComplete('PDP test failed', body, true);
}

function showCredentialErrorAlert(errorMessage) {
  let alertBanner = document.getElementById('credential-error-alert');

  if (!alertBanner) {
    alertBanner = document.createElement('div');
    alertBanner.id = 'credential-error-alert';
    alertBanner.className = 'credential-error-alert';
    document.querySelector('.container').prepend(alertBanner);
  }

  alertBanner.innerHTML = `
    <div class="alert-icon">Warning</div>
    <div class="alert-content">
      <div class="alert-title">Authentication Failed</div>
      <div class="alert-message"></div>
      <div class="alert-instructions">Please update your username and password below, then click "Update & Resume"</div>
    </div>
  `;
  const messageDiv = alertBanner.querySelector('.alert-message');
  messageDiv.textContent = errorMessage;

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
  startCaptureBtn.textContent = 'Start Test';
  hideCredentialErrorAlert();
}

function syncCaptureStartTime(startedAt) {
  if (!Number.isFinite(startedAt)) return;
  if (!captureStartTime || Math.abs(captureStartTime - startedAt) > 1000) {
    captureStartTime = startedAt;
  }
}

function ensureCaptureStartTime() {
  if (!captureStartTime) {
    captureStartTime = Date.now();
  }
}

function updateProgressBar(current, total) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const clampedCurrent = safeTotal > 0 ? Math.min(safeCurrent, safeTotal) : safeCurrent;
  const percentage = safeTotal > 0 ? Math.min(100, (clampedCurrent / safeTotal) * 100) : 0;
  progressBarInner.style.width = `${percentage}%`;
  progressCount.textContent = safeTotal > 0 ? `${clampedCurrent} / ${safeTotal}` : '-- / --';

  if (safeTotal > 0 && clampedCurrent > 0) {
    ensureCaptureStartTime();
    const progressPercent = Math.min(100, (clampedCurrent / safeTotal) * 100);
    const elapsed = Date.now() - captureStartTime;
    const remaining = progressPercent > 0
      ? (elapsed * (100 - progressPercent)) / progressPercent
      : null;
    progressEta.textContent = Number.isFinite(remaining) && remaining >= 0
      ? `ETR: ${formatTime(remaining)}`
      : 'ETR: --:--';
  } else {
    progressEta.textContent = 'ETR: --:--';
  }
}

function formatList(items, limit = 6) {
  const list = Array.isArray(items) ? items.filter(Boolean).map(String) : [];
  if (list.length === 0) return '-';
  if (list.length <= limit) return list.join(', ');
  return `${list.slice(0, limit).join(', ')} +${list.length - limit} more`;
}

function isNotificationsEnabled() {
  const stored = localStorage.getItem('qaNotificationsEnabled');
  return stored === null ? true : stored === 'true';
}

function buildJobSummary() {
  const regionLabel = regionSelect?.options?.[regionSelect.selectedIndex]?.textContent || regionSelect?.value || '-';
  const cultures = getSelectedCultures();
  const skus = parseSkus(skuInput?.value || '');
  const parts = [
    `Env: ${envSelect?.value || '-'}`,
    `Region: ${regionLabel}`
  ];

  if (cultures.length > 0) parts.push(`Cultures: ${formatList(cultures, 6)}`);
  if (skus.length > 0) parts.push(`SKUs: ${formatList(skus, 6)} (${skus.length})`);

  return parts.join(' | ');
}

function requestNotificationPermission() {
  if (!isNotificationsEnabled()) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}

function primeAudio() {
  if (!isNotificationsEnabled()) return;
  if (audioContext) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    audioContext = new AudioCtx();
  } catch {
    audioContext = null;
  }
}

function playCompletionSound(isError) {
  if (selectedSound === 'silent') return;
  primeAudio();
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

  // Play the selected sound
  const soundPlayer = SOUND_PLAYERS[selectedSound] || SOUND_PLAYERS.classic;
  soundPlayer(isError);
}

// Individual sound generators
const SOUND_PLAYERS = {
  // Classic: Two-tone alert (original)
  classic: (isError) => {
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.value = 0.12;
    gain.connect(audioContext.destination);
    const tones = isError ? [220, 180] : [880, 660];
    tones.forEach((freq, index) => {
      const osc = audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + index * 0.2);
      osc.stop(now + index * 0.2 + 0.15);
    });
  },

  // iPhone Tri-Tone: Three ascending notes
  iphone: (isError) => {
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.value = 0.15;
    gain.connect(audioContext.destination);
    const tones = isError ? [392, 330, 262] : [1047, 1319, 1568];
    tones.forEach((freq, index) => {
      const osc = audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + index * 0.12);
      osc.stop(now + index * 0.12 + 0.1);
    });
  },

  // Samsung Whistle: Distinctive whistle pattern
  samsung: (isError) => {
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.value = 0.12;
    gain.connect(audioContext.destination);
    const pattern = isError ? [523, 392, 330] : [784, 1047, 784, 1175, 1047];
    const durations = isError ? [0.15, 0.15, 0.2] : [0.08, 0.08, 0.08, 0.08, 0.15];
    let time = now;
    pattern.forEach((freq, index) => {
      const osc = audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + durations[index]);
      time += durations[index] + 0.02;
    });
  },

  // Chime: Pleasant bell-like sound
  chime: (isError) => {
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    gain.connect(audioContext.destination);
    const freq = isError ? 440 : 880;
    [1, 2, 3, 4].forEach((harmonic) => {
      const osc = audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * harmonic;
      const hGain = audioContext.createGain();
      hGain.gain.value = 0.3 / harmonic;
      osc.connect(hGain);
      hGain.connect(gain);
      osc.start(now);
      osc.stop(now + 0.8);
    });
  },

  // Ping: Simple soft ping
  ping: (isError) => {
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    gain.connect(audioContext.destination);
    const osc = audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = isError ? 440 : 1200;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.3);
  },

  // Alert: Urgent attention-grabbing tone
  alert: (isError) => {
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.value = 0.1;
    gain.connect(audioContext.destination);
    const baseFreq = isError ? 400 : 800;
    [0, 0.15, 0.3].forEach((delay) => {
      const osc = audioContext.createOscillator();
      osc.type = 'square';
      osc.frequency.value = baseFreq;
      osc.connect(gain);
      osc.start(now + delay);
      osc.stop(now + delay + 0.1);
    });
  },

  // Bubble: Soft bubble pop sound
  bubble: (isError) => {
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    gain.connect(audioContext.destination);
    const osc = audioContext.createOscillator();
    osc.type = 'sine';
    const startFreq = isError ? 300 : 600;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.5, now + 0.15);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.15);
  },

  // Silent: No sound
  silent: () => {}
};

// Play a specific sound for preview
function playPreviewSound(soundId) {
  primeAudio();
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  const soundPlayer = SOUND_PLAYERS[soundId] || SOUND_PLAYERS.classic;
  soundPlayer(false);
}

// Sound Settings Modal Functions
function initSoundSettings() {
  const modal = document.getElementById('sound-settings-modal');
  const openBtn = document.getElementById('sound-settings-btn');
  const closeBtn = document.getElementById('sound-settings-close');
  const optionsList = document.getElementById('sound-options-list');

  if (!modal || !openBtn || !optionsList) return;

  // Render sound options
  optionsList.innerHTML = SOUND_OPTIONS.map(opt => `
    <div class="sound-option${opt.id === selectedSound ? ' selected' : ''}" data-sound="${opt.id}">
      <div class="sound-option-radio"></div>
      <div class="sound-option-info">
        <div class="sound-option-name">${opt.name}</div>
        <div class="sound-option-desc">${opt.desc}</div>
      </div>
      <button class="sound-option-play" data-preview="${opt.id}">${opt.id === 'silent' ? '—' : 'Play'}</button>
    </div>
  `).join('');

  // Open modal
  openBtn.addEventListener('click', () => {
    modal.classList.add('open');
  });

  // Close modal
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('open');
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
    }
  });

  // Handle option selection
  optionsList.addEventListener('click', (e) => {
    const option = e.target.closest('.sound-option');
    const playBtn = e.target.closest('.sound-option-play');

    if (playBtn) {
      // Preview sound
      const soundId = playBtn.dataset.preview;
      if (soundId && soundId !== 'silent') {
        playPreviewSound(soundId);
      }
      return;
    }

    if (option) {
      // Select sound
      const soundId = option.dataset.sound;
      selectedSound = soundId;
      localStorage.setItem('notificationSound', soundId);

      // Update UI
      optionsList.querySelectorAll('.sound-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.sound === soundId);
      });

      // Play preview of selected sound
      if (soundId !== 'silent') {
        playPreviewSound(soundId);
      }
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      modal.classList.remove('open');
    }
  });
}

function notifyJobComplete(title, body, isError) {
  if (!isNotificationsEnabled()) return;
  if (completionNotified) return;
  completionNotified = true;

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      // Ignore notification failures
    }
  }

  if (typeof showVisualNotification === 'function') {
    showVisualNotification(title, body, isError ? 'error' : 'success');
  }

  playCompletionSound(isError);
}

// Urgent alarm sound for credential errors - distinct "attention needed!" pattern
function playCredentialAlertSound() {
  primeAudio();
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

  const now = audioContext.currentTime;

  // Create a more urgent, alarm-like sound pattern
  // Three rapid high-pitched beeps followed by two lower warning tones
  const pattern = [
    { freq: 880, start: 0, duration: 0.1 },
    { freq: 880, start: 0.15, duration: 0.1 },
    { freq: 880, start: 0.3, duration: 0.1 },
    { freq: 440, start: 0.5, duration: 0.15 },
    { freq: 330, start: 0.7, duration: 0.2 }
  ];

  pattern.forEach(({ freq, start, duration }) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'square';  // Harsher sound for urgency
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0.08, now + start);
    gain.gain.exponentialRampToValueAtTime(0.01, now + start + duration);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(now + start);
    osc.stop(now + start + duration);
  });
}

function notifyCredentialError(errorMessage) {
  if (!isNotificationsEnabled()) return;

  // Play urgent credential alert sound
  playCredentialAlertSound();

  // Show visual notification
  if (typeof showVisualNotification === 'function') {
    showVisualNotification('Authentication Failed', errorMessage || 'Please update your credentials', 'error');
  }

  // Show desktop notification with click handler to focus this window/tab
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification('PDP Tester - Authentication Failed', {
        body: errorMessage || 'Please update your credentials and click Resume',
        icon: `${BASE_PATH}/favicon.ico`,
        tag: 'credential-error',
        requireInteraction: true
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Ignore notification failures
    }
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
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
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
  if (isCapturing || isQueued) {
    return;
  }

  const testName = testNameInput ? testNameInput.value.trim() : '';
  const skus = parseSkus(skuInput.value);
  const cultures = getSelectedCultures();
  const widths = getSelectedWidths();

  if (skus.length === 0) {
    setStatusError('No SKUs entered', 'Enter at least one SKU number');
    return;
  }

  if (cultures.length === 0) {
    setStatusError('No cultures selected', 'Select at least one culture');
    return;
  }

  if (widths.length === 0) {
    setStatusError('No widths selected', 'Select at least one viewport width');
    return;
  }

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    setStatusError('Credentials required', 'Enter username and password for PDP testing');
    return;
  }

  if (testName.length > 120) {
    setStatusError('Test name too long', 'Use 120 characters or fewer');
    return;
  }

  jobSummary = buildJobSummary();
  completionNotified = false;
  requestNotificationPermission();
  primeAudio();

  const options = {
    testName,
    skus,
    environment: envSelect.value,
    region: regionSelect.value,
    cultures,
    screenWidths: widths,
    username,
    password
  };

  progressEnv.textContent = `Env: ${options.environment}`;
  progressCulture.textContent = `Culture: ${formatCultureList(cultures)}`;
  progressSku.textContent = `SKUs: ${skus.length} (${cultures.length} cultures)`;

  try {
    isQueued = false;
    startCaptureBtn.disabled = true;
    stopCaptureBtn.disabled = false;
    setStatusRunning('Starting test...', 'Submitting PDP job');

    const response = await fetch(api('/api/pdp/start'), {
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
        const message = result.error || result.message || 'PDP capture already in progress';
        if (/queued/i.test(message)) {
          setUIQueued(formatQueueDetail(result));
        } else {
          setUIIdle();
          setStatusError('PDP job already running', message);
        }
        await checkStatus();
      } else {
        setUIIdle();
        setStatusError('Failed to start', result.error || 'Unknown error');
      }
      return;
    }

    if (result.queued || result.alreadyQueued) {
      setUIQueued(formatQueueDetail(result));
    } else {
      setUICapturing();
      setStatusRunning('Starting test...', result.message || 'PDP capture started');
    }

  } catch (err) {
    setUIIdle();
    setStatusError('Connection error', err.message);
  }
}

async function stopCapture() {
  try {
    await fetch(api('/api/pdp/stop'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
  } catch (err) {
    console.error('Error stopping test:', err);
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

    const updateResponse = await fetch(api('/api/pdp/update-credentials'), {
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

    const resumeResponse = await fetch(api('/api/pdp/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const result = await resumeResponse.json();

    if (!result.ok) {
      setStatusError('Failed to resume', result.message || 'Unknown error');
      startCaptureBtn.disabled = false;
      return;
    }

    hideCredentialErrorAlert();
    usernameInput.disabled = true;
    passwordInput.disabled = true;
    setStatusRunning('Retrying authentication...', 'Logging in with updated credentials');
    isWaitingForResume = false;
    startCaptureBtn.textContent = 'Start Test';

  } catch (err) {
    console.error('Error updating credentials:', err);
    setStatusError('Connection error', err.message);
    startCaptureBtn.disabled = false;
  }
}

async function resumeCapture() {
  try {
    setStatusRunning('Resuming...', 'Continuing test after manual sign-in');
    startCaptureBtn.disabled = true;
    requestNotificationPermission();
    primeAudio();

    const response = await fetch(api('/api/pdp/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const result = await response.json();

    if (!result.ok) {
      setStatusError('Failed to resume', result.message || 'Unknown error');
      startCaptureBtn.disabled = false;
    }
  } catch (err) {
    console.error('Error resuming test:', err);
    setStatusError('Connection error', err.message);
    startCaptureBtn.disabled = false;
  }
}

function setUICapturing() {
  isQueued = false;
  startCaptureBtn.disabled = true;
  stopCaptureBtn.disabled = false;
  progressContainer.style.display = 'block';
  progressBarInner.style.width = '0%';
  progressCount.textContent = '0 / 0';
  progressEta.textContent = 'ETR: --:--';
  currentSkuInfo.style.display = 'none';
}

function setUIQueued(detail) {
  isQueued = true;
  isCapturing = false;
  startCaptureBtn.disabled = true;
  stopCaptureBtn.disabled = false;
  progressContainer.style.display = 'none';
  currentSkuInfo.style.display = 'none';
  setStatusRunning('Queued', detail || 'Waiting for an available PDP worker');
}

function setUIIdle() {
  isCapturing = false;
  isQueued = false;
  startCaptureBtn.disabled = false;
  stopCaptureBtn.disabled = true;
  progressContainer.style.display = 'none';
  currentSkuInfo.style.display = 'none';
  resetCredentialPromptState();
}

function setStatusIdle(main, detail) {
  statusBanner.className = 'status-banner idle';
  statusMain.textContent = main || 'Ready to test';
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
const ACTIVITY_STORAGE_KEY = 'activityFeed-pdp';

function loadActivityFromStorage() {
  try {
    const stored = sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (stored) {
      activityItems = JSON.parse(stored);
      activityItems.forEach(item => {
        if (item.timestamp) item.timestamp = new Date(item.timestamp);
      });
    }
    renderActivityFeed();
    activityFeed.style.display = 'block';
  } catch (e) {
    console.error('Failed to load activity feed:', e);
    renderActivityFeed();
    activityFeed.style.display = 'block';
  }
}

function applyProgressSnapshot(progress) {
  if (!progress) return;

  if (progress.culture) {
    progressCulture.textContent = `Culture: ${progress.culture}`;
  }

  switch (progress.type) {
    case 'browser':
      setStatusRunning('Starting...', progress.status || 'Launching browser');
      break;
    case 'login':
      setStatusRunning('Logging in...', progress.status || '');
      break;
    case 'pdp-start':
      if (progress.sku) {
        progressSku.textContent = `SKU: ${progress.sku}`;
      }
      currentSkuInfo.style.display = 'block';
      currentSkuName.textContent = progress.culture ? `SKU ${progress.sku} (${progress.culture})` : `SKU ${progress.sku}`;
      currentSkuContentType.textContent = '-';
      currentSkuStatus.textContent = progress.status || 'Starting';
      setStatusRunning('Testing...', `SKU ${progress.sku}: ${progress.status || 'Starting'}`);
      break;
    case 'pdp-status':
    case 'pdp-screenshot':
      currentSkuStatus.textContent = progress.status || '';
      setStatusRunning('Testing...', `SKU ${progress.sku}: ${progress.status || 'In progress'}`);
      break;
    case 'pdp-complete':
      if (progress.data) {
        currentSkuContentType.textContent = getContentTypeLabel(progress.data.contentType);
      }
      currentSkuStatus.textContent = 'Complete';
      setStatusRunning('Testing...', `SKU ${progress.sku}: Complete`);
      break;
    case 'pdp-error':
      currentSkuStatus.textContent = `Error: ${progress.error || 'Unknown error'}`;
      setStatusRunning('Testing...', `SKU ${progress.sku}: Error`);
      break;
    default: {
      const progressStatus = progress.status || progress.message;
      if (progressStatus) {
        setStatusRunning('Job in progress', progressStatus);
      }
      break;
    }
  }

  if (progress.current !== undefined && progress.total !== undefined) {
    updateProgressBar(progress.current, progress.total);
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

  if (item.type === 'error') {
    activityItems.unshift(item);
  } else {
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
  const failed = activityItems.filter(i => i.type === 'error').length;

  passedCountEl.textContent = passed;
  failedCountEl.textContent = failed;

  if (activityItems.length === 0) {
    activityList.innerHTML = '<div class="activity-empty">No activity yet</div>';
    return;
  }

  activityList.innerHTML = activityItems.map(item => {
    const icon = item.type === 'error' ? 'X' : 'OK';
    const timeStr = formatActivityTime(item.timestamp);
    const itemClass = item.type === 'error' ? 'error' : 'success';
    const linkMarkup = item.url
      ? `<div class="activity-item-link"><a href="${item.url}" target="_blank" rel="noopener">Open page</a></div>`
      : '';

    if (item.type === 'error') {
      return `
        <div class="activity-item error">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">SKU ${item.sku}${item.culture ? ` (${item.culture})` : ''}</div>
            <div class="activity-item-detail">${item.error}</div>
            ${linkMarkup}
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    } else {
      const contentTypeLabel = getContentTypeLabel(item.contentType);
      const details = [`${contentTypeLabel}`];
      if (item.sectionCount > 0) details.push(`${item.sectionCount} sections`);
      if (item.screenshotCount > 0) details.push(`${item.screenshotCount} screenshots`);

      return `
        <div class="activity-item ${itemClass}">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">SKU ${item.sku}${item.culture ? ` (${item.culture})` : ''}</div>
            <div class="activity-item-detail">${details.join(' | ')}</div>
            ${linkMarkup}
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    }
  }).join('');

  if (failed > 0) {
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
