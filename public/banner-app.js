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
let isQueued = false;
let captureHadError = false;
let captureErrorMessage = '';
let jobSummary = '';
let completionNotified = false;
let audioContext = null;
let captureStartTime = null;
let ws = null;
let reconnectAttempts = 0;
let isWaitingForResume = false;
let isWaitingForCredentials = false;
let activityItems = []; // Activity feed items
let bannerProgress = {}; // Track progress per banner (culture-mainCategory-category)
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
const testNameInput = document.getElementById('test-name-input');
const cultureOptions = document.getElementById('culture-options');
const loginToggle = document.getElementById('login-toggle');
const loginSection = document.getElementById('login-section');
const loginFields = document.getElementById('login-fields');
if (loginFields && loginFields.tagName === 'FORM') {
  loginFields.addEventListener('submit', (event) => event.preventDefault());
}
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
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

const skuRegionToBannerRegion = {
  us: 'usca',
  ca: 'usca',
  mx: 'mx',
  uk: 'ukeu',
  ie: 'ukeu',
  de: 'ukeu',
  lt: 'ukeu',
  nl: 'ukeu',
  pl: 'ukeu'
};
const bannerRegionToSkuRegion = {
  usca: 'us',
  mx: 'mx',
  ukeu: 'uk'
};
let skuToBannerCultureMap = {};
let bannerToSkuCultureMap = {};

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
    : 'Waiting for an available banner worker';
}

async function init() {
  try {
    await loadConfig();
    initCultureMaps();
    renderRegionOptions(loginToggle ? loginToggle.checked : false);
    setupEventListeners();
    renderCultureOptions();
    renderWidthOptions();
    renderCategoryTree();
    loadPreferences();
    connectWebSocket();
    loadActivityFromStorage(); // Load cached activity first (may have old per-capture data)
    setStatusRunning('Checking status...', 'Loading job state');
    await checkStatus(); // Check status and restore from server (authoritative, grouped by banner)
  } catch (err) {
    console.error('Initialization error:', err);
    setStatusError('Initialization failed', err.message);
  }
}

async function checkStatus() {
  try {
    const response = await fetch(api('/api/banner/status'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const status = await response.json();

    if (Array.isArray(status.options?.widths) && status.options.widths.length > 0) {
      expectedWidths = status.options.widths;
    }

    if (isQueuedStatus(status)) {
      setUIQueued(formatQueueDetail(status));
    } else if (status.isRunning) {
      isCapturing = true;
      setUICapturing();
      setStatusRunning('Job in progress', 'Reconnected to running job');
      syncCaptureStartTime(status.startedAt);

      if (status.statusType === 'waiting-for-auth') {
        isWaitingForResume = true;
        startCaptureBtn.textContent = 'Resume Capture';
        startCaptureBtn.disabled = false;
        setStatusRunning('Waiting for manual sign-in', status.message || 'Please sign in and click Resume');
      } else if (status.statusType === 'waiting-for-credentials') {
        isWaitingForCredentials = true;
        setStatusError('Authentication Failed', status.message);
        showCredentialErrorAlert(status.error || 'Invalid username or password');
        startCaptureBtn.textContent = 'Update & Resume';
        startCaptureBtn.disabled = false;
        stopCaptureBtn.disabled = false;
        if (loginToggle) loginToggle.checked = true;
        setLoginEnabled(true);
        if (loginSection) {
          loginSection.classList.add('credential-error');
        }
      } else if (status.progress) {
        applyProgressSnapshot(status.progress);
      }

      // Restore activity feed from server-side results (catches banners processed while away)
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

// Restore activity feed from server-side Banner results
async function restoreActivityFromServer() {
  try {
    const response = await fetch(api('/api/banner/results'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const serverResults = await response.json();

    if (!Array.isArray(serverResults) || serverResults.length === 0) {
      return;
    }

    // Clear existing activity items - server data is authoritative and properly grouped
    activityItems.length = 0;


    // GROUP results by banner (culture-mainCategory-category), not per capture
    const bannerGroups = {};
    for (const result of serverResults) {
      const categoryPath = result.mainCategory
        ? `${result.mainCategory} › ${result.category}`
        : result.category;
      const key = `${result.culture}-${categoryPath}`;

      if (!bannerGroups[key]) {
        bannerGroups[key] = {
          culture: result.culture,
          categoryPath: categoryPath,
          mainCategory: result.mainCategory,
          category: result.category,
          url: result.url || '',
          widths: [],
          widthResults: {},
          hasError: false,
          errorMessages: [],
          issues: [],
          timestamp: result.timestamp || Date.now()
        };
      }

      const isError = result.error === true;

      // Track this width result
      bannerGroups[key].widths.push(result.width);

      // Check if this is an error result (error: true is set, not a boolean check on success)
      if (isError) {
        bannerGroups[key].hasError = true;
        // Error message is in result.message, not result.error
        const errorMsg = result.message || 'Capture failed';
        bannerGroups[key].errorMessages.push(`${result.width}px: ${errorMsg}`);
      }

      bannerGroups[key].widthResults[String(result.width)] = {
        success: !isError,
        error: isError ? (result.message || 'Capture failed') : null,
        href: result.href,
        target: result.target,
        imageLocale: result.imageLocale,
        validation: result.validation || null,
        url: result.url
      };

      if (result.url && !bannerGroups[key].url) {
        bannerGroups[key].url = result.url;
      }

      // Collect validation issues (only for successful captures)
      if (!isError) {
        const validation = result.validation || {};
        if (validation.status === 'fail' && validation.failures) {
          validation.failures.forEach(f => {
            if (f === 'link' && !bannerGroups[key].issues.includes('Link mismatch')) {
              bannerGroups[key].issues.push('Link mismatch');
            }
            if (f === 'target' && !bannerGroups[key].issues.includes('Target mismatch')) {
              bannerGroups[key].issues.push('Target mismatch');
            }
          });
        } else if (validation.status === 'not-found' && !bannerGroups[key].issues.includes('Not in Excel')) {
          bannerGroups[key].issues.push('Not in Excel');
        } else {
          // Fallback checks for missing data on successful captures
          if (!result.href && !bannerGroups[key].issues.includes('Missing link')) {
            bannerGroups[key].issues.push('Missing link');
          }
          if (!result.target && !bannerGroups[key].issues.includes('Missing target')) {
            bannerGroups[key].issues.push('Missing target');
          }
        }
      }
    }

    const expectedWidthCount = Array.isArray(expectedWidths) ? expectedWidths.length : 0;
    const filterIncomplete = isCapturing && expectedWidthCount > 0;

    // Now create ONE activity item per banner group
    let addedCount = 0;
    for (const key of Object.keys(bannerGroups)) {
      const group = bannerGroups[key];
      const uniqueWidths = [...new Set(group.widths)].length;
      const isComplete = !filterIncomplete || uniqueWidths >= expectedWidthCount;

      if (!isComplete) {
        const bannerKey = `${group.culture}|${group.mainCategory || ''}|${group.category}`;
        if (!bannerProgress[bannerKey]) {
          bannerProgress[bannerKey] = {
            culture: group.culture,
            mainCategory: group.mainCategory || '',
            category: group.category,
            widths: {},
            totalWidths: expectedWidthCount,
            url: group.url || ''
          };
        }
        Object.entries(group.widthResults).forEach(([width, result]) => {
          bannerProgress[bannerKey].widths[width] = result;
        });
        continue;
      }

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
        url: group.url || undefined,
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
      console.log(`[Activity] Restored ${addedCount} banners from server`);
    }

    saveActivityToStorage();
    renderActivityFeed();
    if (activityItems.length > 0 || isCapturing) {
      activityFeed.style.display = 'block';
    }
  } catch (err) {
    console.error('Failed to restore activity from server:', err);
  }
}

function applyProgressSnapshot(progress) {
  if (!progress) return;

  if (progress.type === 'login') {
    setStatusRunning('Logging in...', progress.status || '');
    return;
  }

  if (progress.culture) {
    progressCulture.textContent = `Culture: ${progress.culture}`;
  }
  if (progress.category) {
    progressCategory.textContent = `Category: ${progress.mainCategory ? `${progress.mainCategory} › ${progress.category}` : progress.category}`;
  }
  if (progress.width) {
    progressWidth.textContent = `Width: ${progress.width}px`;
  }

  const displayCompleted = progress.completedBanners ?? progress.completed;
  const displayTotal = progress.totalBanners ?? progress.total;
  if (displayCompleted !== undefined && displayTotal !== undefined) {
    updateProgressBar(displayCompleted, displayTotal);
  }

  const progressStatus = progress.status || progress.message;
  if (progressStatus) {
    setStatusRunning(progressStatus, '');
    return;
  }

  if (progress.state) {
    const detailParts = [];
    if (progress.culture) detailParts.push(progress.culture);
    if (progress.category) detailParts.push(progress.category);
    if (progress.width) detailParts.push(`${progress.width}px`);
    const detail = detailParts.length > 0 ? detailParts.join(' - ') : '';
    setStatusRunning('Capturing...', detail);
  }
}

async function loadConfig() {
  const response = await fetch(api('/api/config'));
  configData = await response.json();
}

function initCultureMaps() {
  bannerToSkuCultureMap = { ...(configData?.banner?.cultureLangMap || {}) };
  skuToBannerCultureMap = {};
  Object.entries(bannerToSkuCultureMap).forEach(([bannerCode, skuCulture]) => {
    if (!skuToBannerCultureMap[skuCulture]) {
      skuToBannerCultureMap[skuCulture] = bannerCode;
    }
  });
}

function isLoginMode() {
  return Boolean(loginToggle && loginToggle.checked);
}

function renderRegionOptions(useSkuRegions, selectedRegion = null) {
  const regionSource = useSkuRegions ? configData?.regions : configData?.banner?.regions;
  if (!regionSelect || !regionSource) return;

  regionSelect.innerHTML = Object.entries(regionSource).map(([key, region]) => (
    `<option value="${key}">${region.name}</option>`
  )).join('');

  const fallbackRegion = Object.keys(regionSource)[0];
  const resolvedRegion = selectedRegion && regionSource[selectedRegion] ? selectedRegion : fallbackRegion;
  if (resolvedRegion) {
    regionSelect.value = resolvedRegion;
  }
}

function normalizeRegionForMode(region, loginMode) {
  if (!region) return region;
  return loginMode
    ? (bannerRegionToSkuRegion[region] || region)
    : (skuRegionToBannerRegion[region] || region);
}

function mapBannerToSkuCultures(cultures) {
  if (!Array.isArray(cultures)) return [];
  return cultures.map(culture => bannerToSkuCultureMap[culture] || culture);
}

function mapSkuToBannerCultures(cultures) {
  if (!Array.isArray(cultures)) return [];
  const mapped = cultures.map(culture => skuToBannerCultureMap[culture] || culture);
  return Array.from(new Set(mapped));
}

function getBannerRegionValue() {
  const region = regionSelect.value;
  return isLoginMode() ? (skuRegionToBannerRegion[region] || region) : region;
}

function applyRegionMode(loginMode, { previousRegion, previousCultures, skipSave = false } = {}) {
  const targetRegion = normalizeRegionForMode(previousRegion || regionSelect.value, loginMode);
  renderRegionOptions(loginMode, targetRegion);
  renderCultureOptions();

  if (Array.isArray(previousCultures) && previousCultures.length > 0) {
    const mappedCultures = loginMode
      ? mapBannerToSkuCultures(previousCultures)
      : mapSkuToBannerCultures(previousCultures);
    cultureOptions.querySelectorAll('input').forEach(cb => {
      cb.checked = mappedCultures.includes(cb.value);
    });
  }

  renderCategoryTree();
  applySavedCredentials();
  if (!skipSave) {
    savePreferences();
  }
}

function getRequestCultures() {
  const cultures = getSelectedCultures();
  return isLoginMode() ? mapSkuToBannerCultures(cultures) : cultures;
}

function getRequestRegion() {
  const region = regionSelect.value;
  return isLoginMode() ? (skuRegionToBannerRegion[region] || region) : region;
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

  if (loginToggle) {
    loginToggle.addEventListener('change', () => {
      const previousRegion = regionSelect.value;
      const previousCultures = getSelectedCultures();
      setLoginEnabled(loginToggle.checked);
      applyRegionMode(loginToggle.checked, { previousRegion, previousCultures, skipSave: true });
      savePreferences();
    });
  }

  if (usernameInput) {
    usernameInput.addEventListener('input', savePreferences);
  }
  if (passwordInput) {
    passwordInput.addEventListener('input', savePreferences);
  }
  if (testNameInput) {
    testNameInput.addEventListener('input', savePreferences);
  }

  document.getElementById('select-all-cultures').addEventListener('click', () => toggleAllCheckboxes('culture-options', true));
  document.getElementById('deselect-all-cultures').addEventListener('click', () => toggleAllCheckboxes('culture-options', false));
  document.getElementById('select-all-widths').addEventListener('click', () => toggleAllCheckboxes('width-options', true));
  document.getElementById('deselect-all-widths').addEventListener('click', () => toggleAllCheckboxes('width-options', false));
  document.getElementById('select-all-categories').addEventListener('click', () => toggleAllCheckboxes('category-tree', true));
  document.getElementById('deselect-all-categories').addEventListener('click', () => toggleAllCheckboxes('category-tree', false));

  startCaptureBtn.addEventListener('click', () => {
    if (isWaitingForCredentials) {
      updateCredentialsAndResume();
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
  const regionConfig = isLoginMode()
    ? configData?.regions?.[region]
    : configData?.banner?.regions?.[region];

  if (!regionConfig) {
    cultureOptions.innerHTML = '<div class="meta">No cultures available</div>';
    return;
  }

  if (isLoginMode()) {
    cultureOptions.innerHTML = regionConfig.cultures.map(culture => `
      <label class="checkbox-row">
        <input type="checkbox" name="culture" value="${culture}" checked>
        <span>${configData.cultureNames?.[culture] || culture}</span>
      </label>
    `).join('');
  } else {
    cultureOptions.innerHTML = regionConfig.cultures.map(culture => `
      <label class="checkbox-row">
        <input type="checkbox" name="culture" value="${culture.code}" checked>
        <span>${culture.label}</span>
      </label>
    `).join('');
  }

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
  const region = getBannerRegionValue();
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

function setLoginEnabled(enabled) {
  if (!loginFields) return;
  loginFields.style.display = enabled ? 'grid' : 'none';
  if (usernameInput) usernameInput.disabled = !enabled;
  if (passwordInput) passwordInput.disabled = !enabled;
}

function applySavedCredentials() {
  if (!window.CredentialStore) return;
  if (!loginToggle || !loginToggle.checked) return;
  const env = envSelect.value;
  const cultures = getSelectedCultures();
  if (!env || cultures.length === 0) return;
  const lookupCultures = isLoginMode()
    ? cultures
    : cultures.map(culture => bannerToSkuCultureMap[culture] || culture);
  let entry = null;

  for (const culture of lookupCultures) {
    entry = window.CredentialStore.getEntry(env, culture);
    if (entry) break;
  }

  if (!entry) return;

  if (entry.username !== null && entry.username !== undefined) {
    usernameInput.value = entry.username || '';
  }
}

function getSelectedWidths() {
  return Array.from(widthOptions.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
}

function getSelectedCategories() {
  return Array.from(categoryTree.querySelectorAll('input[name="category"]:checked')).map(cb => cb.value);
}

function savePreferences() {
  const prefs = {
    testName: testNameInput ? testNameInput.value.trim() : '',
    environment: envSelect.value,
    region: regionSelect.value,
    cultures: getSelectedCultures(),
    widths: getSelectedWidths(),
    categories: getSelectedCategories(),
    loginEnabled: loginToggle ? loginToggle.checked : false,
    username: usernameInput ? usernameInput.value.trim() || null : null
  };
  localStorage.setItem('bannerTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('bannerTesterPrefs'));
    if (prefs) {
      if (Object.prototype.hasOwnProperty.call(prefs, 'password')) {
        delete prefs.password;
        localStorage.setItem('bannerTesterPrefs', JSON.stringify(prefs));
      }
      if (prefs.environment) envSelect.value = prefs.environment;
      if (loginToggle && typeof prefs.loginEnabled === 'boolean') {
        loginToggle.checked = prefs.loginEnabled;
      }
      setLoginEnabled(loginToggle ? loginToggle.checked : false);
      applyRegionMode(loginToggle ? loginToggle.checked : false, {
        previousRegion: prefs.region,
        previousCultures: prefs.cultures,
        skipSave: true
      });

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
      if (typeof prefs.testName === 'string' && testNameInput) {
        testNameInput.value = prefs.testName;
      }
      if (prefs.username && usernameInput) usernameInput.value = prefs.username;
    }
  } catch (e) {
    console.debug('Could not load preferences:', e);
  }
  setLoginEnabled(loginToggle ? loginToggle.checked : false);
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
  syncCaptureStartTime(data.startedAt);
  const progress = data.progress;
  if (progress.type === 'login') {
    setStatusRunning('Logging in...', progress.status || '');
    return;
  }
  progressCulture.textContent = `Culture: ${progress.culture || '-'}`;
  progressCategory.textContent = `Category: ${progress.mainCategory ? `${progress.mainCategory} › ${progress.category}` : progress.category || '-'}`;
  progressWidth.textContent = `Width: ${progress.width}px`;

  if (progress.state === 'working') {
    setStatusRunning('Capturing...', `${progress.culture} - ${progress.category} at ${progress.width}px`);
  } else if (progress.state === 'done' || progress.state === 'error') {
    // Use banner-level progress for display (if available), fall back to capture-level
    const displayCompleted = progress.completedBanners ?? progress.completed;
    const displayTotal = progress.totalBanners ?? progress.total;
    updateProgressBar(displayCompleted, displayTotal);

    // Track banner progress by culture-mainCategory-category key
    const bannerKey = `${progress.culture}|${progress.mainCategory || ''}|${progress.category}`;

    if (!bannerProgress[bannerKey]) {
      bannerProgress[bannerKey] = {
        culture: progress.culture,
        mainCategory: progress.mainCategory || '',
        category: progress.category,
        widths: {},
        totalWidths: expectedWidths.length || 1,
        url: ''
      };
    }

    // Track this width result with validation data
    const resultData = progress.result || {};
    const validation = resultData.validation || null;

    bannerProgress[bannerKey].widths[progress.width] = {
      success: progress.state === 'done',
      error: progress.state === 'error' ? (resultData.message || progress.error || 'Unknown error') : null,
      href: resultData.href,
      target: resultData.target,
      imageLocale: resultData.imageLocale,
      validation: validation
    };

    if (resultData.url) {
      bannerProgress[bannerKey].url = resultData.url;
    }

    const banner = bannerProgress[bannerKey];
    const completedWidths = Object.keys(banner.widths).length;
    const errorWidths = Object.values(banner.widths).filter(w => !w.success).length;

    // Check for validation issues in successful captures
    const widthResults = Object.values(banner.widths).filter(w => w.success);
    const validationIssues = [];

    // Prioritize Excel validation failures over basic missing field checks
    widthResults.forEach(w => {
      if (w.validation) {
        // Excel validation was performed
        if (w.validation.status === 'fail' && w.validation.failures) {
          w.validation.failures.forEach(f => {
            if (f === 'link') validationIssues.push('Link mismatch');
            if (f === 'target') validationIssues.push('Target mismatch');
          });
        } else if (w.validation.status === 'not-found') {
          validationIssues.push('Not in Excel');
        }
      } else {
        // Fallback to basic missing field checks when no Excel data
        if (!w.href) validationIssues.push('Missing link');
        if (!w.target) validationIssues.push('Missing target');
      }
    });
    // Deduplicate issues
    const uniqueIssues = [...new Set(validationIssues)];

    // Check if all widths for this banner are complete
    if (completedWidths >= banner.totalWidths) {
      const categoryPath = banner.mainCategory ? `${banner.mainCategory} › ${banner.category}` : banner.category;

      if (errorWidths > 0) {
        const errorMessages = Object.entries(banner.widths)
          .filter(([_, w]) => !w.success)
          .map(([width, w]) => `${width}px: ${w.error}`)
          .join(', ');

        addActivityItem({
          type: 'error',
          culture: banner.culture,
          categoryPath: categoryPath,
          detail: `${completedWidths - errorWidths}/${completedWidths} widths captured`,
          error: errorMessages,
          url: banner.url
        });
      } else if (uniqueIssues.length > 0) {
        // Show warning for validation issues
        addActivityItem({
          type: 'warning',
          culture: banner.culture,
          categoryPath: categoryPath,
          detail: `${completedWidths} widths captured`,
          issues: uniqueIssues,
          url: banner.url
        });
      } else {
        addActivityItem({
          type: 'success',
          culture: banner.culture,
          categoryPath: categoryPath,
          detail: `${completedWidths} widths captured`,
          url: banner.url
        });
      }

      // Clean up tracked banner
      delete bannerProgress[bannerKey];
    }
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
      // Use banner count (jobCount) for status message, not totalCaptures
      setStatusRunning('Starting capture...', `${data.jobCount || data.totalBanners} banners to process`);
      resetCredentialPromptState();
      // Reset banner tracking
      bannerProgress = {};
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
      isQueued = false;
      setUIIdle();
      captureStartTime = null;
      {
        const completed = Number.isFinite(data.successCount) ? data.successCount : 0;
        const detail = data.message === 'Removed from queue'
          ? data.message
          : `${completed} captures completed before cancellation`;
        setStatusIdle('Capture cancelled', detail);
      }
      if (saveReportBtn) saveReportBtn.disabled = !data.results?.length;
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
            setStatusError('Capture complete with errors', `${successCount} succeeded, ${errorCount} failed`);
          } else {
            setStatusError('Capture failed', captureErrorMessage || 'Capture did not complete');
          }
        } else {
          setStatusSuccess('Capture complete!', `${successCount} captures in ${formatDuration(data.duration)}`);
        }

        const resultParts = [];
        resultParts.push(`${successCount} ok`);
        if (errorCount > 0) resultParts.push(`${errorCount} failed`);
        if (data.duration) resultParts.push(formatDuration(data.duration));
        const body = [jobSummary, resultParts.length ? `Result: ${resultParts.join(', ')}` : '']
          .filter(Boolean)
          .join(' | ');
        const title = hasErrors ? 'Banner capture finished with errors' : 'Banner capture completed';
        notifyJobComplete(title, body, hasErrors);

        if (saveReportBtn) saveReportBtn.disabled = !data.results?.length;
        break;

    case 'waiting-for-auth':
      setStatusRunning('Waiting for manual sign-in', data.message || 'Please sign in to the environment in the browser window, then click Resume Capture');
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Resume Capture';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      progressEta.textContent = 'ETR: --:--';
      break;

    case 'waiting-for-credentials':
      setStatusError('Authentication Failed', data.message || 'Invalid username or password. Update credentials and click Resume.');
      showCredentialErrorAlert(data.error || 'Invalid username or password');
      notifyCredentialError(data.error || 'Invalid username or password');
      isWaitingForCredentials = true;
      startCaptureBtn.textContent = 'Update & Resume';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      progressEta.textContent = 'ETR: --:--';
      if (loginToggle) loginToggle.checked = true;
      setLoginEnabled(true);
      if (loginSection) {
        loginSection.classList.add('credential-error');
      }
      break;

    case 'resuming':
      setStatusRunning('Resuming capture...', 'Continuing with banner processing');
      isWaitingForResume = false;
      isWaitingForCredentials = false;
      startCaptureBtn.disabled = true;
      startCaptureBtn.textContent = 'Start Capture';
      break;
  }
}

function handleError(data) {
  isCapturing = false;
  setUIIdle();
  captureHadError = true;
  captureErrorMessage = data.message || 'Capture failed';
  setStatusError('Error', data.message);
  const body = [jobSummary, data.message ? `Error: ${data.message}` : 'Error'].filter(Boolean).join(' | ');
  notifyJobComplete('Banner capture failed', body, true);
}

function showCredentialErrorAlert(errorMessage) {
  let alertBanner = document.getElementById('credential-error-alert');

  if (!alertBanner) {
    alertBanner = document.createElement('div');
    alertBanner.id = 'credential-error-alert';
    alertBanner.className = 'credential-error-alert';
    document.querySelector('.container').prepend(alertBanner);
  }

  // Safely create alert content to prevent XSS
  alertBanner.innerHTML = `
    <div class="alert-icon">&#9888;</div>
    <div class="alert-content">
      <div class="alert-title">Authentication Failed</div>
      <div class="alert-message"></div>
      <div class="alert-instructions">Update your username and password, then click "Update & Resume"</div>
    </div>
  `;
  // Set error message as text content to prevent XSS
  const messageDiv = alertBanner.querySelector('.alert-message');
  messageDiv.textContent = errorMessage;

  alertBanner.style.display = 'flex';
}

function hideCredentialErrorAlert() {
  const alertBanner = document.getElementById('credential-error-alert');
  if (alertBanner) {
    alertBanner.style.display = 'none';
  }
  if (loginSection) {
    loginSection.classList.remove('credential-error');
  }
}

function resetCredentialPromptState() {
  isWaitingForCredentials = false;
  isWaitingForResume = false;
  startCaptureBtn.textContent = 'Start Capture';
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

    const updateResponse = await fetch(api('/api/banner/update-credentials'), {
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

    const resumeResponse = await fetch(api('/api/banner/resume'), {
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
    isWaitingForCredentials = false;
    startCaptureBtn.textContent = 'Start Capture';
  } catch (err) {
    console.error('Error updating credentials:', err);
    setStatusError('Connection error', err.message);
    startCaptureBtn.disabled = false;
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

function formatCategoryList(items, limit = 4) {
  const formatted = (items || []).map((item) => {
    if (!item) return null;
    const parts = item.split('|');
    return parts.length > 1 ? `${parts[0]} > ${parts[1]}` : item;
  }).filter(Boolean);
  return formatList(formatted, limit);
}

function buildJobSummary() {
  const regionLabel = regionSelect?.options?.[regionSelect.selectedIndex]?.textContent || regionSelect?.value || '-';
  const cultures = getSelectedCultures();
  const widths = getSelectedWidths();
  const categories = getSelectedCategories();
  const parts = [
    `Env: ${envSelect?.value || '-'}`,
    `Region: ${regionLabel}`
  ];

  if (cultures.length > 0) parts.push(`Cultures: ${formatList(cultures, 6)}`);
  if (categories.length > 0) parts.push(`Categories: ${formatCategoryList(categories, 4)}`);
  if (widths.length > 0) parts.push(`Widths: ${formatList(widths, 6)}`);

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
  primeAudio();
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

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
    const start = now + (index * 0.2);
    const stop = start + 0.15;
    osc.start(start);
    osc.stop(stop);
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

  // Show visual notification fallback for HTTP environments
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
      const notification = new Notification('Banner Tester - Authentication Failed', {
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

async function startCapture() {
  if (isCapturing || isQueued) {
    return;
  }

  const testName = testNameInput ? testNameInput.value.trim() : '';
  const cultures = getSelectedCultures();
  const widths = getSelectedWidths();
  const categories = getSelectedCategories();
  const environment = envSelect.value;
  const loginEnabled = loginToggle ? loginToggle.checked : false;
  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

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

  if (loginEnabled && (!username || !password)) {
    setStatusError('Credentials required', 'Enter username and password to sign in');
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
    environment,
    region: getRequestRegion(),
    cultures: getRequestCultures(),
    widths,
    categories,
    loginEnabled
  };

  if (loginEnabled) {
    options.username = username || null;
    options.password = password || null;
  }

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
          filename: excelData.filename,
          format: excelData.format || excelData.preview?.format || null,
          linkColumns: excelData.linkColumns || excelData.preview?.linkColumns || null
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
    isQueued = false;
    startCaptureBtn.disabled = true;
    stopCaptureBtn.disabled = false;
    if (saveReportBtn) saveReportBtn.disabled = true;
    setStatusRunning('Starting capture...', 'Submitting banner job');

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
      if (response.status === 409) {
        const message = result.error || result.message || 'Banner capture already in progress';
        if (/queued/i.test(message)) {
          setUIQueued(formatQueueDetail(result));
        } else {
          setUIIdle();
          setStatusError('Banner job already running', message);
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
      setStatusRunning('Starting capture...', result.message || 'Banner capture started');
    }

  } catch (err) {
    setUIIdle();
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
    requestNotificationPermission();
    primeAudio();

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
  isQueued = false;
  startCaptureBtn.disabled = true;
  stopCaptureBtn.disabled = false;
  if (saveReportBtn) saveReportBtn.disabled = true;
  progressContainer.style.display = 'block';
  progressBarInner.style.width = '0%';
  progressCount.textContent = '0 / 0';
  progressEta.textContent = 'ETR: --:--';
}

function setUIQueued(detail) {
  isQueued = true;
  isCapturing = false;
  startCaptureBtn.disabled = true;
  stopCaptureBtn.disabled = false;
  if (saveReportBtn) saveReportBtn.disabled = true;
  progressContainer.style.display = 'none';
  setStatusRunning('Queued', detail || 'Waiting for an available banner worker');
}

function setUIIdle() {
  isCapturing = false;
  isQueued = false;
  startCaptureBtn.disabled = false;
  stopCaptureBtn.disabled = true;
  progressContainer.style.display = 'none';
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
const ACTIVITY_STORAGE_KEY = 'activityFeed-banner';

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
    const itemClass = item.type === 'error' ? 'error' : (item.type === 'warning' ? 'warning' : 'success');
    const linkMarkup = item.url
      ? `<div class="activity-item-link"><a href="${item.url}" target="_blank" rel="noopener">Open page</a></div>`
      : '';
    // Use categoryPath for grouped banners, fallback to old format for compatibility
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
            ${linkMarkup}
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
            ${linkMarkup}
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
            ${linkMarkup}
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
