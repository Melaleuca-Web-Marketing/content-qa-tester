// pslp-app.js - Frontend JavaScript for PSLP Tester UI

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
const cultureSelect = document.getElementById('culture-select');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const widthOptions = document.getElementById('width-options');
const componentsGrid = document.getElementById('components-grid');
const componentCount = document.getElementById('component-count');
const selectAllWidthsBtn = document.getElementById('select-all-widths');
const deselectAllWidthsBtn = document.getElementById('deselect-all-widths');
const selectAllBtn = document.getElementById('select-all-components');
const deselectAllBtn = document.getElementById('deselect-all-components');
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
const progressStep = document.getElementById('progress-step');
const progressWidths = document.getElementById('progress-widths');
const currentStepInfo = document.getElementById('current-step-info');
const currentStepName = document.getElementById('current-step-name');
const currentStepStatus = document.getElementById('current-step-status');
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
    updateCultureOptions();
    renderWidthOptions();
    loadPreferences();
    connectWebSocket();
    updateComponentCount();
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
    const response = await fetch(api('/api/pslp/status'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const status = await response.json();

    if (status.isRunning) {
      isCapturing = true;
      setUICapturing();
      setStatusRunning('Job in progress', 'Reconnected to running job');

      if (status.options) {
        if (status.options.environment) {
          progressEnv.textContent = `Env: ${status.options.environment}`;
        }
        if (status.options.culture) {
          progressCulture.textContent = `Culture: ${status.options.culture}`;
        }
      }

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
      } else if (status.progress) {
        applyProgressSnapshot(status.progress);
      }

      // Restore activity feed from server-side results (catches components processed while away)
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

function applyProgressSnapshot(progress) {
  if (!progress) return;

  switch (progress.type) {
    case 'browser':
      setStatusRunning('Starting...', progress.status || 'Launching browser');
      break;
    case 'login':
      setStatusRunning('Logging in...', progress.status || '');
      currentStepInfo.style.display = 'block';
      currentStepName.textContent = 'Login';
      currentStepStatus.textContent = progress.status || '';
      break;
    case 'navigation':
      setStatusRunning('Navigating...', progress.status || '');
      currentStepInfo.style.display = 'block';
      currentStepName.textContent = 'Navigation';
      currentStepStatus.textContent = progress.status || '';
      break;
    case 'screenshot':
      progressStep.textContent = `Step: ${progress.status || 'Capturing screenshots'}`;
      currentStepInfo.style.display = 'block';
      currentStepName.textContent = 'Screenshot Capture';
      currentStepStatus.textContent = progress.status || '';
      setStatusRunning('Capturing screenshots...', progress.status || '');
      break;
    case 'component':
      progressStep.textContent = `Component: ${progress.component || ''}`;
      currentStepInfo.style.display = 'block';
      currentStepName.textContent = `Extracting: ${progress.componentName || progress.component || ''}`;
      currentStepStatus.textContent = progress.status || '';
      setStatusRunning('Extracting component data...', `${progress.componentName || progress.component || ''}: ${progress.status || ''}`.trim());
      break;
    case 'step':
      currentStepInfo.style.display = 'block';
      currentStepName.textContent = progress.step || '';
      currentStepStatus.textContent = progress.status || '';
      setStatusRunning(progress.step || 'Processing...', progress.status || '');
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

// Restore activity feed from server-side PSLP results
async function restoreActivityFromServer() {
  try {
    const response = await fetch(api('/api/pslp/results'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const serverResults = await response.json();

    if (!Array.isArray(serverResults) || serverResults.length === 0) {
      return;
    }

    // Get existing components in activity feed to avoid duplicates
    const existingKeys = new Set(activityItems.map(item => `${item.component}-${item.width || ''}`));

    // Add any missing results from server
    let addedCount = 0;
    for (const result of serverResults) {
      const key = `${result.componentName || result.component}-${result.width || ''}`;
      if (existingKeys.has(key)) {
        continue; // Already have this result
      }

      // For failed results
      if (!result.success) {
        const item = {
          type: 'error',
          component: result.componentName || result.component,
          error: result.error || 'Failed to extract component',
          timestamp: result.timestamp ? new Date(result.timestamp) : new Date()
        };
        activityItems.unshift(item);
        addedCount++;
        continue;
      }

      // For successful results - compute validation issues (same as handleResult)
      const componentData = result.data || {};
      const issues = [];
      const warnings = [];

      // Check for links
      if (componentData.links && Array.isArray(componentData.links)) {
        componentData.links.forEach((link, index) => {
          if (!link.href || link.href === '#' || link.href === '') {
            issues.push(`Link ${index + 1}: Missing or invalid URL`);
          }
          if (!link.text || link.text.trim() === '') {
            warnings.push(`Link ${index + 1}: No link text`);
          }
        });
      }

      // Check for slides
      if (componentData.slides && Array.isArray(componentData.slides)) {
        componentData.slides.forEach((slide, index) => {
          if (!slide.image || slide.image === '') {
            issues.push(`Slide ${index + 1}: Missing image`);
          }
          if (slide.link && (!slide.link.href || slide.link.href === '#')) {
            issues.push(`Slide ${index + 1}: Invalid link`);
          }
        });
      }

      // Check for images
      if (componentData.images && Array.isArray(componentData.images)) {
        componentData.images.forEach((image, index) => {
          if (!image.src || image.src === '') {
            issues.push(`Image ${index + 1}: Missing source`);
          }
          if (!image.alt || image.alt === '') {
            warnings.push(`Image ${index + 1}: Missing alt text`);
          }
        });
      }

      // Check for CTA buttons
      if (componentData.ctas && Array.isArray(componentData.ctas)) {
        componentData.ctas.forEach((cta, index) => {
          if (!cta.href || cta.href === '#') {
            issues.push(`CTA ${index + 1}: Invalid link`);
          }
          if (!cta.text || cta.text.trim() === '') {
            warnings.push(`CTA ${index + 1}: No button text`);
          }
        });
      }

      // Determine item type
      const hasErrors = issues.length > 0;
      const hasWarnings = warnings.length > 0;
      const type = hasErrors ? 'error' : (hasWarnings ? 'warning' : 'success');

      const item = {
        type,
        component: result.componentName || result.component,
        componentData: componentData,
        issues: hasErrors ? issues : undefined,
        warnings: hasWarnings ? warnings : undefined,
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
    updateCultureOptions();
    applySavedCredentials();
    savePreferences();
  });

  envSelect.addEventListener('change', () => {
    applySavedCredentials();
    savePreferences();
  });
  cultureSelect.addEventListener('change', () => {
    // Auto-correct region if culture doesn't match current region
    const selectedCulture = cultureSelect.value;
    const currentRegion = regionSelect.value;
    const currentRegionConfig = configData?.regions?.[currentRegion];

    // If selected culture is not valid for current region, update region
    if (currentRegionConfig && !currentRegionConfig.cultures.includes(selectedCulture)) {
      const correctRegion = getRegionFromCulture(selectedCulture);
      if (correctRegion && correctRegion !== currentRegion) {
        regionSelect.value = correctRegion;
        updateCultureOptions();
        cultureSelect.value = selectedCulture; // Re-set culture after update
      }
    }

    applySavedCredentials();
    savePreferences();
  });

  if (selectAllWidthsBtn && deselectAllWidthsBtn) {
    selectAllWidthsBtn.addEventListener('click', () => toggleAllWidths(true));
    deselectAllWidthsBtn.addEventListener('click', () => toggleAllWidths(false));
  }

  // Component checkboxes
  const componentCheckboxes = componentsGrid.querySelectorAll('input[name="component"]');
  componentCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      updateComponentCount();
      savePreferences();
    });
  });

  selectAllBtn.addEventListener('click', () => {
    componentCheckboxes.forEach(cb => cb.checked = true);
    updateComponentCount();
    savePreferences();
  });

  deselectAllBtn.addEventListener('click', () => {
    componentCheckboxes.forEach(cb => cb.checked = false);
    updateComponentCount();
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

// Helper function to infer region from culture code
function getRegionFromCulture(culture) {
  if (!configData) return null;

  // Search through all regions to find which one contains this culture
  for (const [regionKey, regionConfig] of Object.entries(configData.regions)) {
    if (regionConfig.cultures && regionConfig.cultures.includes(culture)) {
      return regionKey;
    }
  }
  return null;
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
  // Environment credentials are no longer stored for security reasons
  // Users must manually sign in to Stage/UAT when prompted

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

function renderWidthOptions() {
  const widths = configData?.pslp?.screenWidths || [320, 415, 576, 768, 992, 1210];
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

function getSelectedComponents() {
  const checkboxes = componentsGrid.querySelectorAll('input[name="component"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function getSelectedWidths() {
  if (!widthOptions) return [];
  return Array.from(widthOptions.querySelectorAll('input[name="width"]:checked'))
    .map(cb => parseInt(cb.value, 10))
    .filter(Number.isFinite);
}

function updateComponentCount() {
  const selected = getSelectedComponents();
  componentCount.textContent = `${selected.length} component${selected.length !== 1 ? 's' : ''} selected`;
}

function savePreferences() {
  const prefs = {
    environment: envSelect.value,
    region: regionSelect.value,
    culture: cultureSelect.value,
    widths: getSelectedWidths(),
    components: getSelectedComponents(),
    username: usernameInput.value.trim() || null,
    password: passwordInput.value || null
  };
  localStorage.setItem('pslpTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('pslpTesterPrefs'));
    if (prefs) {
      if (prefs.environment) envSelect.value = prefs.environment;
      // If we have a culture but no region, try to infer the region from the culture
      if (prefs.culture && !prefs.region) {
        const inferredRegion = getRegionFromCulture(prefs.culture);
        if (inferredRegion) {
          regionSelect.value = inferredRegion;
          updateCultureOptions();
        }
      } else if (prefs.region) {
        regionSelect.value = prefs.region;
        updateCultureOptions();
      }
      if (prefs.culture) cultureSelect.value = prefs.culture;
      if (prefs.widths && widthOptions) {
        widthOptions.querySelectorAll('input').forEach(cb => {
          const checked = prefs.widths.includes(parseInt(cb.value, 10));
          cb.checked = checked;
          cb.closest('.width-option').classList.toggle('selected', checked);
        });
      }
      if (prefs.components && Array.isArray(prefs.components)) {
        const allCheckboxes = componentsGrid.querySelectorAll('input[name="component"]');
        allCheckboxes.forEach(cb => {
          cb.checked = prefs.components.includes(cb.value);
        });
      }
      if (prefs.username) usernameInput.value = prefs.username;
      if (prefs.password) passwordInput.value = prefs.password;
      updateComponentCount();
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
  // Only handle PSLP-related messages
  if (message.type === 'pslp-progress') {
    handleProgress(message.data);
  } else if (message.type === 'pslp-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'pslp-error') {
    handleError(message.data);
  } else if (message.type === 'pslp-result') {
    handleResult(message.data);
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
      currentStepInfo.style.display = 'block';
      currentStepName.textContent = 'Login';
      currentStepStatus.textContent = progress.status;
      break;

    case 'navigation':
      setStatusRunning('Navigating...', progress.status);
      currentStepName.textContent = 'Navigation';
      currentStepStatus.textContent = progress.status;
      break;

    case 'screenshot':
      progressStep.textContent = `Step: ${progress.status}`;
      currentStepName.textContent = 'Screenshot Capture';
      currentStepStatus.textContent = progress.status;
      setStatusRunning('Capturing screenshots...', progress.status);
      if (progress.current !== undefined && progress.total !== undefined) {
        updateProgressBar(progress.current, progress.total);
        // Add to activity feed when a width is complete
        if (progress.width && progress.status && progress.status.includes('captured')) {
          addActivityItem({
            type: 'success',
            component: 'Screenshot',
            width: progress.width,
            detail: progress.status
          });
        }
      }
      break;

    case 'component':
      progressStep.textContent = `Component: ${progress.component}`;
      currentStepName.textContent = `Extracting: ${progress.componentName || progress.component}`;
      currentStepStatus.textContent = progress.status;
      setStatusRunning('Extracting component data...', `${progress.componentName || progress.component}: ${progress.status}`);
      if (progress.current !== undefined && progress.total !== undefined) {
        updateProgressBar(progress.current, progress.total);
      }
      // Add component completion to activity feed
      if (progress.status === 'Complete' || progress.status === 'Extracted') {
        addActivityItem({
          type: 'success',
          component: progress.componentName || progress.component,
          detail: 'Data extracted successfully'
        });
      } else if (progress.status && progress.status.toLowerCase().includes('error')) {
        addActivityItem({
          type: 'error',
          component: progress.componentName || progress.component,
          error: progress.status
        });
      }
      break;

    case 'step':
      currentStepName.textContent = progress.step;
      currentStepStatus.textContent = progress.status;
      setStatusRunning(progress.step, progress.status);
      break;
  }
}

function handleResult(data) {
  if (!data.success) {
    // Component failed to extract
    addActivityItem({
      type: 'error',
      component: data.componentName || data.component,
      error: data.error || 'Failed to extract component'
    });
    return;
  }

  // Analyze component data for issues
  const issues = [];
  const warnings = [];
  const componentData = data.data;

  // Check for links
  if (componentData.links && Array.isArray(componentData.links)) {
    componentData.links.forEach((link, index) => {
      if (!link.href || link.href === '#' || link.href === '') {
        issues.push(`Link ${index + 1}: Missing or invalid URL`);
      }
      if (!link.text || link.text.trim() === '') {
        warnings.push(`Link ${index + 1}: No link text`);
      }
    });
  }

  // Check for slides (carousels, monthly specials, etc.)
  if (componentData.slides && Array.isArray(componentData.slides)) {
    componentData.slides.forEach((slide, index) => {
      if (!slide.image || slide.image === '') {
        issues.push(`Slide ${index + 1}: Missing image`);
      }
      if (slide.link && (!slide.link.href || slide.link.href === '#')) {
        issues.push(`Slide ${index + 1}: Invalid link`);
      }
    });
  }

  // Check for images
  if (componentData.images && Array.isArray(componentData.images)) {
    componentData.images.forEach((image, index) => {
      if (!image.src || image.src === '') {
        issues.push(`Image ${index + 1}: Missing source`);
      }
      if (!image.alt || image.alt === '') {
        warnings.push(`Image ${index + 1}: Missing alt text`);
      }
    });
  }

  // Check for CTA buttons
  if (componentData.ctas && Array.isArray(componentData.ctas)) {
    componentData.ctas.forEach((cta, index) => {
      if (!cta.href || cta.href === '#') {
        issues.push(`CTA ${index + 1}: Invalid link`);
      }
      if (!cta.text || cta.text.trim() === '') {
        warnings.push(`CTA ${index + 1}: No button text`);
      }
    });
  }

  // Determine item type
  const hasErrors = issues.length > 0;
  const hasWarnings = warnings.length > 0;

  addActivityItem({
    type: hasErrors ? 'error' : (hasWarnings ? 'warning' : 'success'),
    component: data.componentName || data.component,
    componentData: componentData,
    issues: hasErrors ? issues : undefined,
    warnings: hasWarnings ? warnings : undefined
  });
}

function handleStatusUpdate(data) {
  switch (data.type) {
    case 'started':
      isCapturing = true;
      captureStartTime = Date.now();
      setUICapturing();
      setStatusRunning('Starting PSLP capture...', `${data.componentsCount ?? data.componentCount ?? 0} components to extract`);
      // Clear and show activity feed
      clearActivityFeed();
      activityFeed.style.display = 'block';
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current operation to complete');
      break;

    case 'cancelled':
      isCapturing = false;
      setUIIdle();
      setStatusIdle('Capture cancelled', 'Operation was cancelled by user');
      if (saveReportBtn) saveReportBtn.disabled = true;
      break;

    case 'completed':
      isCapturing = false;
      isWaitingForResume = false;
      setUIIdle();

      const screenshots = data.results?.screenshots?.length || 0;
      const components = data.results?.componentReports?.length || 0;

      setStatusSuccess('Capture complete!', `${screenshots} screenshots, ${components} components extracted in ${formatDuration(data.duration)}`);

      if (saveReportBtn) saveReportBtn.disabled = !data.results;
      break;

    case 'error':
      isCapturing = false;
      setUIIdle();
      setStatusError('Error', data.message);
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
      setStatusRunning('Resuming capture...', 'Continuing with PSLP processing');
      isWaitingForResume = false;
      startCaptureBtn.disabled = true;
      startCaptureBtn.textContent = 'Start Capture';
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
  const percentage = total > 0 ? (current / total) * 100 : 0;
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
  const components = getSelectedComponents();
  const widths = getSelectedWidths();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const environment = envSelect.value;

  if (widths.length === 0) {
    setStatusError('No widths selected', 'Select at least one viewport width');
    return;
  }

  if (!username || !password) {
    setStatusError('Credentials required', 'Enter username and password to access PSLP');
    return;
  }

  const options = {
    environment,
    region: regionSelect.value,
    culture: cultureSelect.value,
    screenWidths: widths,
    components,
    username,
    password
  };

  const excelEnabled = localStorage.getItem('excelValidationEnabled') === 'true';
  if (excelEnabled) {
    const excelDataStr = localStorage.getItem('excelValidationData');
    if (excelDataStr) {
      try {
        const excelData = JSON.parse(excelDataStr);
        options.excelValidation = {
          enabled: true,
          data: excelData.data,
          filename: excelData.filename
        };
      } catch (e) {
        console.error('Failed to parse Excel validation data:', e);
      }
    } else {
      setStatusError('Excel validation enabled but no file uploaded', 'Please upload an Excel file or disable Excel validation');
      return;
    }
  }

  progressEnv.textContent = `Env: ${options.environment}`;
  progressCulture.textContent = `Culture: ${options.culture}`;
  progressStep.textContent = `Screens: ${widths.length}`;
  if (progressWidths) {
    progressWidths.textContent = `Widths: ${widths.join(', ')}`;
  }

  try {
    const response = await fetch(api('/api/pslp/start'), {
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
        alert('A PSLP job is already running. Please wait for it to complete or stop it first.');
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
    await fetch(api('/api/pslp/stop'), {
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
    const updateResponse = await fetch(api('/api/pslp/update-credentials'), {
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
    const resumeResponse = await fetch(api('/api/pslp/resume'), {
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

    const response = await fetch(api('/api/pslp/resume'), {
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
  currentStepInfo.style.display = 'none';
}

function setUIIdle() {
  isCapturing = false;
  startCaptureBtn.disabled = false;
  stopCaptureBtn.disabled = true;
  progressContainer.style.display = 'none';
  currentStepInfo.style.display = 'none';
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
const ACTIVITY_STORAGE_KEY = 'activityFeed-pslp';

function loadActivityFromStorage() {
  try {
    const stored = sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (stored) {
      activityItems = JSON.parse(stored);
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

  // Errors and warnings go to the top, success items go after warnings
  if (item.type === 'error' || item.type === 'warning') {
    activityItems.unshift(item);
  } else {
    // Find the first success item and insert before it, or add to end
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
  const failed = activityItems.filter(i => i.type === 'error' || i.type === 'warning').length;

  passedCountEl.textContent = passed;
  failedCountEl.textContent = failed;

  if (activityItems.length === 0) {
    activityList.innerHTML = '<div class="activity-empty">No activity yet</div>';
    return;
  }

  activityList.innerHTML = activityItems.map(item => {
    let icon;
    let cssClass;

    if (item.type === 'error') {
      icon = '❌';
      cssClass = 'error';
    } else if (item.type === 'warning') {
      icon = '⚠️';
      cssClass = 'warning';
    } else {
      icon = '✅';
      cssClass = 'success';
    }

    const timeStr = formatActivityTime(item.timestamp);
    const main = item.width ? `${item.component} @ ${item.width}px` : item.component;

    // Build details section
    let detailsHTML = '';

    if (item.error) {
      detailsHTML = `<div class="activity-item-detail">${item.error}</div>`;
    } else if (item.issues && item.issues.length > 0) {
      detailsHTML = `
        <div class="activity-item-detail">
          <strong>Issues:</strong>
          <ul style="margin: 4px 0 0 20px; font-size: 12px;">
            ${item.issues.map(issue => `<li>${issue}</li>`).join('')}
          </ul>
        </div>
      `;
    } else if (item.warnings && item.warnings.length > 0) {
      detailsHTML = `
        <div class="activity-item-detail">
          <strong>Warnings:</strong>
          <ul style="margin: 4px 0 0 20px; font-size: 12px;">
            ${item.warnings.map(warning => `<li>${warning}</li>`).join('')}
          </ul>
        </div>
      `;
    } else if (item.detail) {
      detailsHTML = `<div class="activity-item-detail">${item.detail}</div>`;
    } else {
      detailsHTML = `<div class="activity-item-detail">Captured successfully</div>`;
    }

    return `
      <div class="activity-item ${cssClass}">
        <span class="activity-item-icon">${icon}</span>
        <div class="activity-item-content">
          <div class="activity-item-main">${main}</div>
          ${detailsHTML}
        </div>
        <span class="activity-item-time">${timeStr}</span>
      </div>
    `;
  }).join('');

  // Scroll to top if there are errors or warnings
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
