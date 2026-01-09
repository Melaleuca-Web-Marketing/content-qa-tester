// mixinad-app.js - Frontend JavaScript for mixinad Tester UI

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
let mixinProgress = {}; // Track progress per category (culture-mainCategory-category)
let expectedWidths = []; // Widths selected for current job
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
    renderWidthOptions();
    renderCategoryTree();
    loadPreferences();
    connectWebSocket();
    loadActivityFromStorage(); // Load cached activity first (may have old per-capture data)
    setStatusRunning('Checking status...', 'Loading job state');
    await checkStatus(); // Check status and restore from server (authoritative, grouped by category)
  } catch (err) {
    console.error('Initialization error:', err);
    setStatusError('Initialization failed', err.message);
  }
}

async function checkStatus() {
  try {
    const response = await fetch(api('/api/mixinad/status'), {
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
      }

      // Restore activity feed from server-side results (catches items processed while away)
      await restoreActivityFromServer();
    } else if (status.resultsCount > 0) {
      // Job completed but we may have missed some results - restore from server
      await restoreActivityFromServer();
      // Set status to idle since job is no longer running
      setStatusIdle('Ready to capture', `Previous job completed with ${status.resultsCount} results`);
    } else {
      setStatusIdle('Ready to capture', '');
    }
  } catch (err) {
    console.error('Failed to check status:', err);
    // Even on error, set status to idle so user isn't stuck
    setStatusIdle('Ready to capture', '');
  }
}

// Restore activity feed from server-side Mix-In Ad results
async function restoreActivityFromServer() {
  try {
    const response = await fetch(api('/api/mixinad/results'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const serverResults = await response.json();

    if (!Array.isArray(serverResults) || serverResults.length === 0) {
      return;
    }

    // Clear existing activity items - server data is authoritative and properly grouped
    activityItems.length = 0;


    // GROUP results by category (culture-mainCategory-category), not per capture
    const categoryGroups = {};
    for (const result of serverResults) {
      const categoryPath = result.mainCategory
        ? `${result.mainCategory} › ${result.category}`
        : result.category;
      const key = `${result.culture}-${categoryPath}`;

      if (!categoryGroups[key]) {
        categoryGroups[key] = {
          culture: result.culture,
          categoryPath: categoryPath,
          mainCategory: result.mainCategory,
          category: result.category,
          widths: [],
          hasError: false,
          errorMessages: [],
          issues: [],
          timestamp: result.timestamp || Date.now()
        };
      }

      // Track this width result
      categoryGroups[key].widths.push(result.width);

      // Check if this is an error result (error: true is set, not a boolean check on success)
      const isError = result.error === true;
      if (isError) {
        categoryGroups[key].hasError = true;
        // Error message is in result.message, not result.error
        const errorMsg = result.message || 'Capture failed';
        categoryGroups[key].errorMessages.push(`${result.width}px: ${errorMsg}`);
      }

      // Collect validation issues (only for successful captures)
      if (!isError) {
        const validation = result.validation || {};
        if (validation.status === 'fail' && validation.failures) {
          validation.failures.forEach(f => {
            if (f === 'link' && !categoryGroups[key].issues.includes('Link mismatch')) {
              categoryGroups[key].issues.push('Link mismatch');
            }
            if (f === 'target' && !categoryGroups[key].issues.includes('Target mismatch')) {
              categoryGroups[key].issues.push('Target mismatch');
            }
            if (f === 'imageLocale' && !categoryGroups[key].issues.includes('Image locale mismatch')) {
              categoryGroups[key].issues.push('Image locale mismatch');
            }
          });
        } else if (validation.status === 'not-found' && !categoryGroups[key].issues.includes('Not in Excel')) {
          categoryGroups[key].issues.push('Not in Excel');
        } else {
          // Fallback checks for missing data on successful captures
          if (!result.href && !categoryGroups[key].issues.includes('Missing link')) {
            categoryGroups[key].issues.push('Missing link');
          }
          if (!result.target && !categoryGroups[key].issues.includes('Missing target')) {
            categoryGroups[key].issues.push('Missing target');
          }
          if (!result.imageLocale && !categoryGroups[key].issues.includes('Missing image locale')) {
            categoryGroups[key].issues.push('Missing image locale');
          }
        }
      }
    }

    // Now create ONE activity item per category group
    let addedCount = 0;
    for (const key of Object.keys(categoryGroups)) {
      const group = categoryGroups[key];
      const uniqueWidths = [...new Set(group.widths)].length;

      let type = 'success';
      let detail = `${uniqueWidths} widths captured`;

      if (group.hasError) {
        type = 'error';
        detail = group.errorMessages.length > 0 ? group.errorMessages.join(', ') : 'Capture failed';
      } else if (group.issues.length > 0) {
        type = 'warning';
      }

      const item = {
        type,
        culture: group.culture,
        categoryPath: group.categoryPath,
        detail: detail,
        issues: group.issues.length > 0 ? group.issues : undefined,
        error: group.hasError ? (group.errorMessages[0] || 'Capture failed') : undefined,
        timestamp: new Date(group.timestamp)
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
      console.log(`[Activity] Restored ${addedCount} categories from server`);
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

  // Activity feed clear button
  if (clearActivityBtn) {
    clearActivityBtn.addEventListener('click', clearActivityFeed);
  }
}

function toggleAllCheckboxes(containerId, checked) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = checked;
    // Update highlight for width options
    if (containerId === 'width-options') {
      cb.closest('.width-option')?.classList.toggle('selected', checked);
    }
  });
  if (containerId === 'culture-options') {
    applySavedCredentials();
  }
  savePreferences();
}

function renderCultureOptions() {
  const region = regionSelect.value;
  const regionConfig = configData?.mixinad?.regions?.[region];

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
  const widths = configData?.mixinad?.widths || [320, 415, 576, 768, 992, 1210];
  const defaultWidths = configData?.mixinad?.defaults?.widths || [320, 768, 1210];

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
  const regionConfig = configData?.mixinad?.regions?.[region];

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
  localStorage.setItem('mixinadTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('mixinadTesterPrefs'));
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
  if (message.type === 'mixinad-progress') {
    handleProgress(message.data);
  } else if (message.type === 'mixinad-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'mixinad-error') {
    handleError(message.data);
  }
}

function handleProgress(data) {
  const progress = data.progress;
  progressCulture.textContent = `Culture: ${progress.culture || '-'}`;
  progressCategory.textContent = `Category: ${progress.mainCategory ? `${progress.mainCategory} › ${progress.category}` : progress.category || '-'}`;
  progressWidth.textContent = `Width: ${progress.width}px`;

  if (progress.state === 'working') {
    setStatusRunning('Capturing...', `${progress.culture} - ${progress.category} at ${progress.width}px`);
  } else if (progress.state === 'done' || progress.state === 'error') {
    // Use category-level progress for display (if available), fall back to capture-level
    const displayCompleted = progress.completedBanners ?? progress.completed;
    const displayTotal = progress.totalBanners ?? progress.total;
    updateProgressBar(displayCompleted, displayTotal);

    // Track progress by culture-mainCategory-category key
    const categoryKey = `${progress.culture}|${progress.mainCategory || ''}|${progress.category}`;

    if (!mixinProgress[categoryKey]) {
      mixinProgress[categoryKey] = {
        culture: progress.culture,
        mainCategory: progress.mainCategory || '',
        category: progress.category,
        widths: {},
        totalWidths: expectedWidths.length || 1
      };
    }

    // Track this width result with validation data
    const resultData = progress.result || {};
    mixinProgress[categoryKey].widths[progress.width] = {
      success: progress.state === 'done',
      error: progress.state === 'error' ? (resultData.errorMessage || progress.error || 'Unknown error') : null,
      adsFound: resultData.adsFound || 0,
      noAdsFound: resultData.noAdsFound || false,
      validations: resultData.validations || []
    };

    const mixin = mixinProgress[categoryKey];
    const completedWidths = Object.keys(mixin.widths).length;
    const errorWidths = Object.values(mixin.widths).filter(w => !w.success).length;

    // Aggregate results across widths
    const widthResults = Object.values(mixin.widths).filter(w => w.success);
    const totalAds = widthResults.reduce((sum, w) => sum + (w.adsFound || 0), 0);
    const hasNoAds = widthResults.some(w => w.noAdsFound);

    // Collect validation issues from all widths
    const validationIssues = [];
    widthResults.forEach(w => {
      if (w.validations && w.validations.length > 0) {
        w.validations.forEach(v => {
          if (v.validation && v.validation.status === 'fail' && v.validation.failures) {
            v.validation.failures.forEach(f => {
              if (f === 'link') validationIssues.push('Link mismatch');
              if (f === 'target') validationIssues.push('Target mismatch');
              if (f === 'imageLocale') validationIssues.push('Image locale mismatch');
            });
          } else if (v.validation && v.validation.status === 'not-found') {
            validationIssues.push('Not in Excel');
          }
        });
      }
    });
    const uniqueIssues = [...new Set(validationIssues)];

    // Check if all widths for this category are complete
    if (completedWidths >= mixin.totalWidths) {
      const categoryPath = mixin.mainCategory ? `${mixin.mainCategory} › ${mixin.category}` : mixin.category;

      if (errorWidths > 0) {
        const errorMessages = Object.entries(mixin.widths)
          .filter(([_, w]) => !w.success)
          .map(([width, w]) => `${width}px: ${w.error}`)
          .join(', ');

        addActivityItem({
          type: 'error',
          culture: mixin.culture,
          categoryPath: categoryPath,
          detail: `${completedWidths - errorWidths}/${completedWidths} widths captured`,
          error: errorMessages
        });
      } else if (uniqueIssues.length > 0) {
        addActivityItem({
          type: 'warning',
          culture: mixin.culture,
          categoryPath: categoryPath,
          detail: `${totalAds} ads • ${completedWidths} widths`,
          issues: uniqueIssues
        });
      } else if (hasNoAds) {
        addActivityItem({
          type: 'warning',
          culture: mixin.culture,
          categoryPath: categoryPath,
          detail: `${completedWidths} widths captured`,
          issues: ['No mix-in ads found']
        });
      } else {
        addActivityItem({
          type: 'success',
          culture: mixin.culture,
          categoryPath: categoryPath,
          detail: `${totalAds} ads • ${completedWidths} widths`
        });
      }

      // Clean up tracked category
      delete mixinProgress[categoryKey];
    }
  }
}

function handleStatusUpdate(data) {
  switch (data.type) {
    case 'started':
      isCapturing = true;
      captureStartTime = Date.now();
      setUICapturing();
      // Use category count (jobCount) for status message, not estimatedCaptures
      setStatusRunning('Starting capture...', `${data.jobCount || data.totalBanners} categories to process`);
      // Reset tracking
      mixinProgress = {};
      expectedWidths = data.widths || [];
      // Clear and show activity feed
      clearActivityFeed();
      activityFeed.style.display = 'block';
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current capture to complete');
      break;

    case 'cancelled':
      isCapturing = false;
      setUIIdle();
      setStatusIdle('Capture cancelled', `${data.successCount} captures completed before cancellation`);
      if (saveReportBtn) saveReportBtn.disabled = !data.results?.length;
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

      if (saveReportBtn) saveReportBtn.disabled = !data.results?.length;
      break;

    case 'waiting-for-auth':
      setStatusRunning('Waiting for manual sign-in', data.message || 'Please sign in to the environment in the browser window, then click Resume Capture');
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Resume Capture';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      break;

    case 'resuming':
      setStatusRunning('Resuming capture...', 'Continuing with mixinad processing');
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
    const avgPerCategory = elapsed / current;
    const remaining = (total - current) * avgPerCategory;
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
    const response = await fetch(api('/api/mixinad/start'), {
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
        alert('A Mix-In Ad job is already running. Please wait for it to complete or stop it first.');
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
    await fetch(api('/api/mixinad/stop'), {
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

    const response = await fetch(api('/api/mixinad/resume'), {
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

// ===== Activity Feed Functions =====
const ACTIVITY_STORAGE_KEY = 'activityFeed-mixinad';

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
    // Use categoryPath for grouped items, fallback to old format
    const location = item.categoryPath
      ? `${item.culture} › ${item.categoryPath}`
      : `${item.culture} › ${item.category}`;

    if (item.type === 'error') {
      return `
        <div class="activity-item error">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">${location}</div>
            <div class="activity-item-detail">${item.detail || ''} ${item.error ? '- ' + item.error : ''}</div>
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    } else if (item.type === 'warning') {
      const issueText = item.issues ? item.issues.join(' • ') : '';
      return `
        <div class="activity-item warning">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">${location}</div>
            <div class="activity-item-detail">${item.detail || ''} ${issueText ? '- ' + issueText : ''}</div>
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    } else {
      return `
        <div class="activity-item success">
          <span class="activity-item-icon">${icon}</span>
          <div class="activity-item-content">
            <div class="activity-item-main">${location}</div>
            <div class="activity-item-detail">${item.detail || 'Captured'}</div>
          </div>
          <span class="activity-item-time">${timeStr}</span>
        </div>
      `;
    }
  }).join('');

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
