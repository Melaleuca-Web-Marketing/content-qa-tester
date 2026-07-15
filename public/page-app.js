// page-app.js - Frontend JavaScript for Page Tester UI

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Parse a fetch response as JSON, with a clear error when the server answers
// with HTML (typical when an old server process lacks the /api/page routes).
async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned HTTP ${response.status} with a non-JSON response — it is likely running an older version without the Page Tester API. Restart the server and reload this page.`);
  }
}

function safeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

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
const pagesInput = document.getElementById('pages-input');
const pagesCount = document.getElementById('pages-count');
const clearPagesBtn = document.getElementById('clear-pages');
const authModeOptions = document.getElementById('auth-mode-options');
const widthOptions = document.getElementById('width-options');
const selectAllWidthsBtn = document.getElementById('select-all-widths');
const deselectAllWidthsBtn = document.getElementById('deselect-all-widths');
const aiReviewCheckbox = document.getElementById('ai-review-checkbox');
const aiReviewMeta = document.getElementById('ai-review-meta');
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
const progressPage = document.getElementById('progress-page');
const currentPageInfo = document.getElementById('current-page-info');
const currentPageName = document.getElementById('current-page-name');
const currentPageMode = document.getElementById('current-page-mode');
const currentPageStatus = document.getElementById('current-page-status');
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
    : 'Waiting for an available Page worker';
}

async function init() {
  try {
    await loadConfig();
    setupEventListeners();
    renderCultureOptions();
    renderWidthOptions();
    updateAiReviewAvailability();
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
    const response = await fetch(api('/api/page/status'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const status = await parseJsonResponse(response);

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
    const response = await fetch(api('/api/page/results'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const serverResults = await response.json();

    if (!Array.isArray(serverResults) || serverResults.length === 0) {
      renderActivityFeed();
      activityFeed.style.display = 'block';
      return;
    }

    const existingKeys = new Set(activityItems.map(item => activityKey(item)));

    let addedCount = 0;
    for (const result of serverResults) {
      const key = `${result.page}-${result.culture}-${result.authMode}`;
      if (existingKeys.has(key)) {
        continue;
      }

      if (!result.success) {
        activityItems.unshift({
          type: 'error',
          page: result.page,
          culture: result.culture,
          authMode: result.authMode,
          error: result.error || 'Failed',
          url: result.url,
          timestamp: result.timestamp ? new Date(result.timestamp) : new Date()
        });
        addedCount++;
        continue;
      }

      activityItems.push({
        type: 'success',
        page: result.page,
        culture: result.culture,
        authMode: result.authMode,
        issueCount: result.issues?.length || 0,
        issues: result.issues || [],
        sectionCount: result.sections?.length || 0,
        screenshotCount: result.screenshots?.length || 0,
        url: result.url,
        timestamp: result.timestamp ? new Date(result.timestamp) : new Date()
      });
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

function activityKey(item) {
  return `${item.page}-${item.culture}-${item.authMode}`;
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

  pagesInput.addEventListener('input', () => {
    updatePagesCount();
    savePreferences();
  });

  clearPagesBtn.addEventListener('click', () => {
    pagesInput.value = '';
    updatePagesCount();
    savePreferences();
  });

  if (authModeOptions) {
    authModeOptions.querySelectorAll('input[name="auth-mode"]').forEach(cb => {
      cb.addEventListener('change', savePreferences);
    });
  }

  if (aiReviewCheckbox) {
    aiReviewCheckbox.addEventListener('change', savePreferences);
  }

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

function renderWidthOptions(selectedWidths = null) {
  const widths = configData?.page?.screenWidths || [320, 415, 576, 768, 992, 1210];
  const defaults = configData?.page?.defaults?.widths || [1210];
  const selection = Array.isArray(selectedWidths) && selectedWidths.length > 0 ? selectedWidths : defaults;
  if (!widthOptions) return;

  widthOptions.innerHTML = widths.map(width => `
    <label class="width-option ${selection.includes(width) ? 'selected' : ''}">
      <input type="checkbox" name="width" value="${width}" ${selection.includes(width) ? 'checked' : ''}>
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

function getSelectedAuthModes() {
  return Array.from(authModeOptions.querySelectorAll('input[name="auth-mode"]:checked')).map(cb => cb.value);
}

function updateAiReviewAvailability() {
  const available = configData?.page?.aiReviewAvailable === true;
  const model = configData?.page?.aiModel || '';
  if (!aiReviewCheckbox || !aiReviewMeta) return;

  if (available) {
    aiReviewCheckbox.disabled = false;
    aiReviewMeta.textContent = `AI review available (model: ${model}). Runs once after all pages finish.`;
  } else {
    aiReviewCheckbox.checked = false;
    aiReviewCheckbox.disabled = true;
    aiReviewMeta.textContent = 'AI review unavailable: set ANTHROPIC_API_KEY in the server .env.local and restart.';
  }
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

function parsePages(input) {
  if (!input || !input.trim()) return [];
  return input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && (line.startsWith('/') || /^https?:\/\//i.test(line)));
}

function updatePagesCount() {
  const pages = parsePages(pagesInput.value);
  pagesCount.textContent = `${pages.length} page${pages.length !== 1 ? 's' : ''} entered — use site-relative paths or full URLs`;
}

function savePreferences() {
  const prefs = {
    testName: testNameInput ? testNameInput.value.trim() : '',
    environment: envSelect.value,
    region: regionSelect.value,
    cultures: getSelectedCultures(),
    widths: getSelectedWidths(),
    authModes: getSelectedAuthModes(),
    aiReview: aiReviewCheckbox ? aiReviewCheckbox.checked : false,
    pages: pagesInput.value,
    username: usernameInput.value.trim() || null
  };
  localStorage.setItem('pageTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('pageTesterPrefs'));
    if (prefs) {
      if (Object.prototype.hasOwnProperty.call(prefs, 'password')) {
        delete prefs.password;
        localStorage.setItem('pageTesterPrefs', JSON.stringify(prefs));
      }
      if (prefs.environment) envSelect.value = prefs.environment;
      if (prefs.region) {
        regionSelect.value = prefs.region;
        renderCultureOptions(Array.isArray(prefs.cultures) ? prefs.cultures : null);
      }
      if (Array.isArray(prefs.widths) && prefs.widths.length > 0) {
        renderWidthOptions(prefs.widths);
      }
      if (Array.isArray(prefs.authModes) && prefs.authModes.length > 0) {
        authModeOptions.querySelectorAll('input[name="auth-mode"]').forEach(cb => {
          cb.checked = prefs.authModes.includes(cb.value);
        });
      }
      if (aiReviewCheckbox && !aiReviewCheckbox.disabled && typeof prefs.aiReview === 'boolean') {
        aiReviewCheckbox.checked = prefs.aiReview;
      }
      if (typeof prefs.testName === 'string' && testNameInput) {
        testNameInput.value = prefs.testName;
      }
      if (prefs.pages) pagesInput.value = prefs.pages;
      if (prefs.username) usernameInput.value = prefs.username;
      updatePagesCount();
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
  if (message.type === 'page-progress') {
    handleProgress(message.data);
  } else if (message.type === 'page-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'page-error') {
    handleError(message.data);
  }
}

function formatAuthMode(mode) {
  return mode === 'signedIn' ? 'Signed In' : 'Signed Out';
}

function handleProgress(data) {
  syncCaptureStartTime(data.startedAt);
  const progress = data.progress;
  if (!progress) return;
  if (progress.culture) {
    progressCulture.textContent = `Culture: ${progress.culture}`;
  }
  switch (progress.type) {
    case 'browser':
      setStatusRunning('Starting...', progress.status);
      break;

    case 'lane-start':
      setStatusRunning('Preparing...', progress.status);
      break;

    case 'login':
      setStatusRunning('Logging in...', progress.status);
      break;

    case 'page-start':
      progressPage.textContent = `Page: ${progress.page}`;
      currentPageInfo.style.display = 'block';
      currentPageName.textContent = progress.page;
      currentPageMode.textContent = `${progress.culture || ''} | ${formatAuthMode(progress.authMode)}`;
      currentPageStatus.textContent = progress.status;
      setStatusRunning('Testing...', `${progress.page}: ${progress.status}`);
      break;

    case 'page-status':
      currentPageStatus.textContent = progress.status;
      setStatusRunning('Testing...', `${progress.page}: ${progress.status}`);
      break;

    case 'ai-review':
      setStatusRunning('AI review...', progress.status);
      currentPageStatus.textContent = progress.status;
      break;

    case 'page-complete':
      currentPageStatus.textContent = progress.data?.issueCount > 0
        ? `Complete — ${progress.data.issueCount} issue(s)`
        : 'Complete — clean';
      updateProgressBar(progress.current, progress.total);

      addActivityItem({
        type: 'success',
        page: progress.page,
        culture: progress.culture,
        authMode: progress.authMode,
        issueCount: progress.data?.issueCount || 0,
        issues: progress.data?.issues || [],
        sectionCount: progress.data?.sectionCount || 0,
        screenshotCount: progress.data?.screenshotCount || 0,
        httpStatus: progress.data?.httpStatus,
        url: progress.url
      });
      break;

    case 'page-error':
      currentPageStatus.textContent = `Error: ${progress.error}`;
      updateProgressBar(progress.current, progress.total);
      addActivityItem({
        type: 'error',
        page: progress.page,
        culture: progress.culture,
        authMode: progress.authMode,
        error: progress.error,
        url: progress.url
      });
      break;
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
      setStatusRunning('Starting test...', `${data.total || data.pageCount || '?'} page tests to run`);
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

    case 'waiting-for-credentials': {
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
    }

    case 'resuming':
      setStatusRunning('Resuming test...', 'Continuing with page processing');
      isWaitingForResume = false;
      startCaptureBtn.disabled = true;
      startCaptureBtn.textContent = 'Start Test';
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current page to complete');
      break;

    case 'cancelled': {
      isCapturing = false;
      isQueued = false;
      setUIIdle();
      captureStartTime = null;
      const cancelledCount = data.results?.filter(r => r.success).length || 0;
      setStatusIdle(
        'Test cancelled',
        data.message === 'Removed from queue' ? data.message : `${cancelledCount} page tests completed before cancellation`
      );
      break;
    }

    case 'completed': {
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
          setStatusError('Test complete with errors', `${successCount} page tests succeeded, ${errorCount} failed`);
        } else {
          setStatusError('Test failed', captureErrorMessage || 'Test did not complete');
        }
      } else {
        setStatusSuccess('Test complete!', `${successCount} page tests in ${formatDuration(data.duration)}`);
      }

      const resultParts = [];
      resultParts.push(`${successCount} ok`);
      if (errorCount > 0) resultParts.push(`${errorCount} failed`);
      if (data.duration) resultParts.push(formatDuration(data.duration));
      const body = [jobSummary, resultParts.length ? `Result: ${resultParts.join(', ')}` : '']
        .filter(Boolean)
        .join(' | ');
      const title = hasErrors ? 'Page test finished with errors' : 'Page test completed';
      notifyJobComplete(title, body, hasErrors);
      break;
    }
  }
}

function handleError(data) {
  isCapturing = false;
  setUIIdle();
  captureHadError = true;
  captureErrorMessage = data.message || 'Test failed';
  setStatusError('Error', data.message);
  const body = [jobSummary, data.message ? `Error: ${data.message}` : 'Error'].filter(Boolean).join(' | ');
  notifyJobComplete('Page test failed', body, true);
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
  const pages = parsePages(pagesInput?.value || '');
  const authModes = getSelectedAuthModes();
  const parts = [
    `Env: ${envSelect?.value || '-'}`,
    `Region: ${regionLabel}`
  ];

  if (cultures.length > 0) parts.push(`Cultures: ${formatList(cultures, 6)}`);
  if (authModes.length > 0) parts.push(`Auth: ${authModes.map(formatAuthMode).join(', ')}`);
  if (pages.length > 0) parts.push(`Pages: ${pages.length}`);

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

  const soundPlayer = SOUND_PLAYERS[selectedSound] || SOUND_PLAYERS.classic;
  soundPlayer(isError);
}

// Individual sound generators
const SOUND_PLAYERS = {
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

  silent: () => {}
};

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

  openBtn.addEventListener('click', () => {
    modal.classList.add('open');
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('open');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
    }
  });

  optionsList.addEventListener('click', (e) => {
    const option = e.target.closest('.sound-option');
    const playBtn = e.target.closest('.sound-option-play');

    if (playBtn) {
      const soundId = playBtn.dataset.preview;
      if (soundId && soundId !== 'silent') {
        playPreviewSound(soundId);
      }
      return;
    }

    if (option) {
      const soundId = option.dataset.sound;
      selectedSound = soundId;
      localStorage.setItem('notificationSound', soundId);

      optionsList.querySelectorAll('.sound-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.sound === soundId);
      });

      if (soundId !== 'silent') {
        playPreviewSound(soundId);
      }
    }
  });

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

// Urgent alarm sound for credential errors
function playCredentialAlertSound() {
  primeAudio();
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

  const now = audioContext.currentTime;
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

    osc.type = 'square';
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

  playCredentialAlertSound();

  if (typeof showVisualNotification === 'function') {
    showVisualNotification('Authentication Failed', errorMessage || 'Please update your credentials', 'error');
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification('Page Tester - Authentication Failed', {
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
  const pages = parsePages(pagesInput.value);
  const cultures = getSelectedCultures();
  const widths = getSelectedWidths();
  const authModes = getSelectedAuthModes();

  if (pages.length === 0) {
    setStatusError('No pages entered', 'Enter at least one page path or URL (one per line)');
    return;
  }

  if (cultures.length === 0) {
    setStatusError('No cultures selected', 'Select at least one culture');
    return;
  }

  if (authModes.length === 0) {
    setStatusError('No auth mode selected', 'Select Signed Out, Signed In, or both');
    return;
  }

  if (widths.length === 0) {
    setStatusError('No widths selected', 'Select at least one viewport width for screenshots');
    return;
  }

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (authModes.includes('signedIn') && (!username || !password)) {
    setStatusError('Credentials required', 'Signed-in testing needs a username and password');
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
    pages,
    environment: envSelect.value,
    region: regionSelect.value,
    cultures,
    authModes,
    widths,
    aiReview: aiReviewCheckbox ? aiReviewCheckbox.checked : false,
    username: username || null,
    password: password || null
  };

  progressEnv.textContent = `Env: ${options.environment}`;
  progressCulture.textContent = `Culture: ${formatCultureList(cultures)}`;
  progressPage.textContent = `Pages: ${pages.length} (${authModes.length} auth mode${authModes.length !== 1 ? 's' : ''})`;

  try {
    isQueued = false;
    startCaptureBtn.disabled = true;
    stopCaptureBtn.disabled = false;
    setStatusRunning('Starting test...', 'Submitting page test job');

    const response = await fetch(api('/api/page/start'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'X-User-Id': userId } : {})
      },
      body: JSON.stringify(options)
    });

    const result = await parseJsonResponse(response);

    if (!response.ok) {
      if (response.status === 409) {
        const message = result.error || result.message || 'Page test already in progress';
        if (/queued/i.test(message)) {
          setUIQueued(formatQueueDetail(result));
        } else {
          setUIIdle();
          setStatusError('Page job already running', message);
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
      setStatusRunning('Starting test...', result.message || 'Page test started');
    }

  } catch (err) {
    setUIIdle();
    setStatusError('Connection error', err.message);
  }
}

async function stopCapture() {
  try {
    await fetch(api('/api/page/stop'), {
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

    const updateResponse = await fetch(api('/api/page/update-credentials'), {
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

    const resumeResponse = await fetch(api('/api/page/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const result = await parseJsonResponse(resumeResponse);

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

    const response = await fetch(api('/api/page/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const result = await parseJsonResponse(response);

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
  currentPageInfo.style.display = 'none';
}

function setUIQueued(detail) {
  isQueued = true;
  isCapturing = false;
  startCaptureBtn.disabled = true;
  stopCaptureBtn.disabled = false;
  progressContainer.style.display = 'none';
  currentPageInfo.style.display = 'none';
  setStatusRunning('Queued', detail || 'Waiting for an available Page worker');
}

function setUIIdle() {
  isCapturing = false;
  isQueued = false;
  startCaptureBtn.disabled = false;
  stopCaptureBtn.disabled = true;
  progressContainer.style.display = 'none';
  currentPageInfo.style.display = 'none';
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
const ACTIVITY_STORAGE_KEY = 'activityFeed-page';

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
    case 'lane-start':
      setStatusRunning('Preparing...', progress.status || '');
      break;
    case 'login':
      setStatusRunning('Logging in...', progress.status || '');
      break;
    case 'page-start':
      if (progress.page) {
        progressPage.textContent = `Page: ${progress.page}`;
      }
      currentPageInfo.style.display = 'block';
      currentPageName.textContent = progress.page || '-';
      currentPageMode.textContent = `${progress.culture || ''} | ${formatAuthMode(progress.authMode)}`;
      currentPageStatus.textContent = progress.status || 'Starting';
      setStatusRunning('Testing...', `${progress.page}: ${progress.status || 'Starting'}`);
      break;
    case 'page-status':
      currentPageStatus.textContent = progress.status || '';
      setStatusRunning('Testing...', `${progress.page}: ${progress.status || 'In progress'}`);
      break;
    case 'ai-review':
      setStatusRunning('AI review...', progress.status || 'Reviewing results');
      break;
    case 'page-complete':
      currentPageStatus.textContent = 'Complete';
      setStatusRunning('Testing...', `${progress.page}: Complete`);
      break;
    case 'page-error':
      currentPageStatus.textContent = `Error: ${progress.error || 'Unknown error'}`;
      setStatusRunning('Testing...', `${progress.page}: Error`);
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
    // Screenshots never enter activity items, so this stays small
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
    const timeStr = escapeHtml(formatActivityTime(item.timestamp));
    const itemClass = item.type === 'error' ? 'error' : 'success';
    const itemUrl = safeHttpUrl(item.url);
    const linkMarkup = itemUrl
      ? `<div class="activity-item-link"><a href="${escapeHtml(itemUrl)}" target="_blank" rel="noopener noreferrer">Open page</a></div>`
      : '';
    const pageLabel = escapeHtml(`${item.page} (${item.culture || '?'} | ${formatAuthMode(item.authMode)})`);

    if (item.type === 'error') {
      return `
        <div class="activity-item error">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">${pageLabel}</div>
            <div class="activity-item-detail">${escapeHtml(item.error)}</div>
            ${linkMarkup}
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    } else {
      const details = [];
      details.push(item.issueCount > 0 ? `${item.issueCount} issue(s)` : 'Clean');
      if (item.issueCount > 0 && Array.isArray(item.issues) && item.issues.length > 0) {
        details.push(item.issues.slice(0, 2).join('; '));
      }
      if (item.sectionCount > 0) details.push(`${item.sectionCount} sections`);
      if (item.screenshotCount > 0) details.push(`${item.screenshotCount} screenshots`);

      return `
        <div class="activity-item ${itemClass}">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">${pageLabel}</div>
            <div class="activity-item-detail">${escapeHtml(details.join(' | '))}</div>
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
