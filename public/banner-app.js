// banner-app.js - Frontend JavaScript for Banner Tester UI

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
const widthOptions = document.getElementById('width-options');
const categoryTree = document.getElementById('category-tree');
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
const progressCulture = document.getElementById('progress-culture');
const progressCategory = document.getElementById('progress-category');
const progressWidth = document.getElementById('progress-width');
const connectionStatus = document.getElementById('connection-status');

async function init() {
  try {
    await loadConfig();
    setupEventListeners();
    renderCultureOptions();
    renderWidthOptions();
    renderCategoryTree();
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
    renderCategoryTree();
    applySavedCredentials();
    savePreferences();
  });

  envSelect.addEventListener('change', () => {
    applySavedCredentials();
    savePreferences();
  });

  document.getElementById('select-all-cultures').addEventListener('click', () => toggleAllCheckboxes('culture-options', true));
  document.getElementById('deselect-all-cultures').addEventListener('click', () => toggleAllCheckboxes('culture-options', false));
  document.getElementById('select-all-widths').addEventListener('click', () => toggleAllCheckboxes('width-options', true));
  document.getElementById('deselect-all-widths').addEventListener('click', () => toggleAllCheckboxes('width-options', false));
  document.getElementById('select-all-categories').addEventListener('click', () => toggleAllCheckboxes('category-tree', true));
  document.getElementById('deselect-all-categories').addEventListener('click', () => toggleAllCheckboxes('category-tree', false));

  startCaptureBtn.addEventListener('click', () => {
    if (isWaitingForResume) {
      resumeCapture();
    } else {
      startCapture();
    }
  });
  stopCaptureBtn.addEventListener('click', stopCapture);
}

function toggleAllCheckboxes(containerId, checked) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
  });
  if (containerId === 'culture-options') {
    applySavedCredentials();
  }
  savePreferences();
}

function renderCultureOptions() {
  const region = regionSelect.value;
  const regionConfig = configData?.banner?.regions?.[region];

  if (!regionConfig) {
    cultureOptions.innerHTML = '<div class="meta">No cultures available</div>';
    return;
  }

  cultureOptions.innerHTML = regionConfig.cultures.map(culture => `
    <label class="checkbox-row">
      <input type="checkbox" name="culture" value="${culture.code}" checked>
      <span>${culture.label}</span>
    </label>
  `).join('');

  // Add change listeners
  cultureOptions.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', () => {
      applySavedCredentials();
      savePreferences();
    });
  });
}

function renderWidthOptions() {
  const widths = configData?.banner?.widths || [320, 415, 576, 768, 992, 1210];
  const defaultWidths = configData?.banner?.defaults?.widths || [320, 768, 1210];

  widthOptions.innerHTML = widths.map(width => `
    <label class="width-option ${defaultWidths.includes(width) ? 'selected' : ''}">
      <input type="checkbox" name="width" value="${width}" ${defaultWidths.includes(width) ? 'checked' : ''}>
      <span>${width}px</span>
    </label>
  `).join('');

  // Add change listeners to toggle selected class
  widthOptions.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.target.closest('.width-option').classList.toggle('selected', e.target.checked);
      savePreferences();
    });
  });
}

function renderCategoryTree() {
  const region = regionSelect.value;
  const regionConfig = configData?.banner?.regions?.[region];

  if (!regionConfig || !regionConfig.categories) {
    categoryTree.innerHTML = '<div class="meta">No categories available</div>';
    return;
  }

  categoryTree.innerHTML = regionConfig.categories.map(category => `
    <div class="category-group">
      <div class="category-name">
        <input type="checkbox" class="category-parent" data-category="${category.name}" checked>
        <span>${category.name}</span>
      </div>
      <div class="category-items">
        ${category.items.map(item => `
          <label class="category-item">
            <input type="checkbox" name="category" value="${category.name}|${item.label}" checked>
            <span>${item.label}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  // Add parent checkbox toggle behavior
  categoryTree.querySelectorAll('.category-parent').forEach(parent => {
    parent.addEventListener('change', (e) => {
      const categoryName = e.target.dataset.category;
      const items = categoryTree.querySelectorAll(`input[value^="${categoryName}|"]`);
      items.forEach(item => item.checked = e.target.checked);
      savePreferences();
    });
  });

  // Add change listeners to items
  categoryTree.querySelectorAll('input[name="category"]').forEach(cb => {
    cb.addEventListener('change', savePreferences);
  });
}

function getSelectedCultures() {
  return Array.from(cultureOptions.querySelectorAll('input:checked')).map(cb => cb.value);
}

function applySavedCredentials() {
  // Environment credentials are no longer stored for security reasons
  // Users must manually sign in to Stage/UAT when prompted
}

function getSelectedWidths() {
  return Array.from(widthOptions.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
}

function getSelectedCategories() {
  return Array.from(categoryTree.querySelectorAll('input[name="category"]:checked')).map(cb => cb.value);
}

function savePreferences() {
  const prefs = {
    environment: envSelect.value,
    region: regionSelect.value,
    cultures: getSelectedCultures(),
    widths: getSelectedWidths(),
    categories: getSelectedCategories()
  };
  localStorage.setItem('bannerTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('bannerTesterPrefs'));
    if (prefs) {
      if (prefs.environment) envSelect.value = prefs.environment;
      if (prefs.region) {
        regionSelect.value = prefs.region;
        renderCultureOptions();
        renderCategoryTree();
      }

      // Restore culture selections
      if (prefs.cultures) {
        cultureOptions.querySelectorAll('input').forEach(cb => {
          cb.checked = prefs.cultures.includes(cb.value);
        });
      }

      // Restore width selections
      if (prefs.widths) {
        widthOptions.querySelectorAll('input').forEach(cb => {
          const checked = prefs.widths.includes(parseInt(cb.value));
          cb.checked = checked;
          cb.closest('.width-option').classList.toggle('selected', checked);
        });
      }

      // Restore category selections
      if (prefs.categories) {
        categoryTree.querySelectorAll('input[name="category"]').forEach(cb => {
          cb.checked = prefs.categories.includes(cb.value);
        });
      }
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
  if (message.type === 'banner-progress') {
    handleProgress(message.data);
  } else if (message.type === 'banner-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'banner-error') {
    handleError(message.data);
  }
}

function handleProgress(data) {
  const progress = data.progress;
  progressCulture.textContent = `Culture: ${progress.culture || '-'}`;
  progressCategory.textContent = `Category: ${progress.category || '-'}`;
  progressWidth.textContent = `Width: ${progress.width}px`;

  if (progress.state === 'working') {
    setStatusRunning('Capturing...', `${progress.culture} - ${progress.category} at ${progress.width}px`);
  } else if (progress.state === 'done') {
    updateProgressBar(progress.completed, progress.total);
  } else if (progress.state === 'error') {
    updateProgressBar(progress.completed, progress.total);
  }
}

function handleStatusUpdate(data) {
  switch (data.type) {
    case 'started':
      isCapturing = true;
      captureStartTime = Date.now();
      setUICapturing();
      setStatusRunning('Starting capture...', `${data.totalCaptures} captures to process`);
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current capture to complete');
      break;

    case 'cancelled':
      isCapturing = false;
      setUIIdle();
      setStatusIdle('Capture cancelled', `${data.successCount} captures completed before cancellation`);
      saveReportBtn.disabled = !data.results?.length;
      break;

    case 'completed':
      isCapturing = false;
      isWaitingForResume = false;
      setUIIdle();

      if (data.errorCount === 0) {
        setStatusSuccess('Capture complete!', `${data.successCount} captures in ${formatDuration(data.duration)}`);
      } else {
        setStatusSuccess('Capture complete with errors', `${data.successCount} succeeded, ${data.errorCount} failed`);
      }

      saveReportBtn.disabled = !data.results?.length;
      break;

    case 'waiting-for-auth':
      setStatusRunning('Waiting for manual sign-in', data.message || 'Please sign in to the environment in the browser window, then click Resume Capture');
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Resume Capture';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      break;

    case 'resuming':
      setStatusRunning('Resuming capture...', 'Continuing with banner processing');
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
  const cultures = getSelectedCultures();
  const widths = getSelectedWidths();
  const categories = getSelectedCategories();
  const environment = envSelect.value;

  if (cultures.length === 0) {
    setStatusError('No cultures selected', 'Select at least one culture');
    return;
  }

  if (widths.length === 0) {
    setStatusError('No widths selected', 'Select at least one viewport width');
    return;
  }

  if (categories.length === 0) {
    setStatusError('No categories selected', 'Select at least one category');
    return;
  }

  const options = {
    environment,
    region: regionSelect.value,
    cultures,
    widths,
    categories
  };

  // Check if Excel validation is enabled and include data
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

  try {
    const response = await fetch(api('/api/banner/start'), {
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
    await fetch(api('/api/banner/stop'), {
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

    const response = await fetch(api('/api/banner/resume'), {
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
}

function setUIIdle() {
  isCapturing = false;
  startCaptureBtn.disabled = false;
  stopCaptureBtn.disabled = true;
  progressContainer.style.display = 'none';
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
