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
const MAX_RECONNECT_ATTEMPTS = 5;

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

async function init() {
  try {
    await loadConfig();
    setupEventListeners();
    updateCultureOptions();
    renderWidthOptions();
    loadPreferences();
    connectWebSocket();
    updateComponentCount();
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

  startCaptureBtn.addEventListener('click', () => {
    if (isWaitingForResume) {
      resumeCapture();
    } else {
      startCapture();
    }
  });
  stopCaptureBtn.addEventListener('click', stopCapture);
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
  // Only handle PSLP-related messages
  if (message.type === 'pslp-progress') {
    handleProgress(message.data);
  } else if (message.type === 'pslp-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'pslp-error') {
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
      break;

    case 'step':
      currentStepName.textContent = progress.step;
      currentStepStatus.textContent = progress.status;
      setStatusRunning(progress.step, progress.status);
      break;
  }
}

function handleStatusUpdate(data) {
  switch (data.type) {
    case 'started':
      isCapturing = true;
      captureStartTime = Date.now();
      setUICapturing();
      setStatusRunning('Starting PSLP capture...', `${data.componentsCount ?? data.componentCount ?? 0} components to extract`);
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current operation to complete');
      break;

    case 'cancelled':
      isCapturing = false;
      setUIIdle();
      setStatusIdle('Capture cancelled', 'Operation was cancelled by user');
      saveReportBtn.disabled = true;
      break;

    case 'completed':
      isCapturing = false;
      isWaitingForResume = false;
      setUIIdle();

      const screenshots = data.results?.screenshots?.length || 0;
      const components = data.results?.componentReports?.length || 0;

      setStatusSuccess('Capture complete!', `${screenshots} screenshots, ${components} components extracted in ${formatDuration(data.duration)}`);

      saveReportBtn.disabled = !data.results;
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
    const response = await fetch('/api/pslp/start', {
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
    await fetch('/api/pslp/stop', { method: 'POST' });
  } catch (err) {
    console.error('Error stopping capture:', err);
  }
}

async function resumeCapture() {
  try {
    setStatusRunning('Resuming...', 'Continuing capture after manual sign-in');
    startCaptureBtn.disabled = true;

    const response = await fetch('/api/pslp/resume', { method: 'POST' });
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
  currentStepInfo.style.display = 'none';
}

function setUIIdle() {
  isCapturing = false;
  startCaptureBtn.disabled = false;
  stopCaptureBtn.disabled = true;
  progressContainer.style.display = 'none';
  currentStepInfo.style.display = 'none';
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
