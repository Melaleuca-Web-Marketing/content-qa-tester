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

    if (Array.isArray(status.options?.widths) && status.options.widths.length > 0) {
      expectedWidths = status.options.widths;
    }

    if (status.isRunning) {
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

function buildMixInAdActivityItems(results, options = {}) {
  const expectedWidthCount = options.expectedWidthCount || 0;
  const filterIncomplete = options.filterIncomplete && expectedWidthCount > 0;
  const groups = {};

  results.forEach((result) => {
    const culture = result.culture || '';
    const mainCategory = result.mainCategory || '';
    const category = result.category || '';
    const adIndex = result.noAdsFound ? null : (Number.isFinite(result.adIndex) ? result.adIndex : null);
    const key = `${culture}|${mainCategory}|${category}|${adIndex ?? 'none'}`;

    if (!groups[key]) {
      groups[key] = {
        culture,
        mainCategory,
        category,
        adIndex,
        widths: new Set(),
        errors: [],
        validations: [],
        addToCartResult: null,
        noAdsFound: false,
        url: result.url || '',
        missing: {
          href: false,
          target: false,
          imageLocale: false
        },
        timestamp: result.timestamp || Date.now()
      };
    }

    const group = groups[key];
    if (result.width !== undefined) {
      group.widths.add(result.width);
    }

    if (result.error) {
      const errorMsg = result.message || 'Capture failed';
      group.errors.push(`${result.width}px: ${errorMsg}`);
    }

    if (result.noAdsFound) {
      group.noAdsFound = true;
    }

    if (result.validation) {
      group.validations.push(result.validation);
    } else if (!result.error && !result.noAdsFound) {
      if (!result.href) group.missing.href = true;
      if (!result.target) group.missing.target = true;
      if (!result.imageLocale) group.missing.imageLocale = true;
    }

    if (result.addToCartResult && !group.addToCartResult) {
      group.addToCartResult = result.addToCartResult;
    }

    if (result.url && !group.url) {
      group.url = result.url;
    }
  });

  const items = [];
  Object.values(groups).forEach((group) => {
    const widthCount = group.widths.size;
    if (filterIncomplete && widthCount < expectedWidthCount) {
      return;
    }

    const issues = new Set();
    group.validations.forEach((validation) => {
      if (validation.status === 'fail' && Array.isArray(validation.failures)) {
        validation.failures.forEach((failure) => {
          if (failure === 'link') issues.add('Link mismatch');
          if (failure === 'target') issues.add('Target mismatch');
          if (failure === 'position') issues.add('Position mismatch');
          if (failure === 'imageLocale') issues.add('Image locale mismatch');
          if (failure === 'sku') issues.add('SKU mismatch');
        });
      } else if (validation.status === 'not-found') {
        issues.add('Not in Excel');
      }
    });

    if (group.noAdsFound) {
      issues.add('No mix-in ads found');
    }

    if (group.addToCartResult && group.addToCartResult.attempted !== false && group.addToCartResult.success === false) {
      issues.add('Add to cart failed');
    }

    if (group.validations.length === 0) {
      if (group.missing.href) issues.add('Missing link');
      if (group.missing.target) issues.add('Missing target');
      if (group.missing.imageLocale) issues.add('Missing image locale');
    }

    let type = 'success';
    let error = undefined;
    if (group.errors.length > 0) {
      type = 'error';
      error = group.errors.join(', ');
    } else if (group.addToCartResult && group.addToCartResult.attempted !== false && group.addToCartResult.success === false) {
      type = 'error';
      error = group.addToCartResult.error || 'Add to cart failed';
    } else if (issues.size > 0) {
      type = 'warning';
    }

    const categoryPath = group.mainCategory
      ? `${group.mainCategory} › ${group.category}`
      : group.category;
    const adLabel = Number.isFinite(group.adIndex) ? ` - Mix-In Ad #${group.adIndex + 1}` : '';

    items.push({
      key: `${group.culture}|${categoryPath}${adLabel}`,
      type,
      culture: group.culture,
      categoryPath: `${categoryPath}${adLabel}`,
      detail: `${widthCount} widths captured`,
      issues: issues.size > 0 ? Array.from(issues) : undefined,
      error,
      url: group.url || undefined,
      timestamp: group.timestamp
    });
  });

  return items;
}

function addActivityItemsFromResults(results, options = {}) {
  const items = buildMixInAdActivityItems(results, options);
  if (options.replaceExisting) {
    activityItems = [];
  }
  items.forEach(item => addActivityItem(item));
  if (activityItems.length > 0 || isCapturing) {
    activityFeed.style.display = 'block';
  }
  return items.length;
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

    const expectedWidthCount = Array.isArray(expectedWidths) ? expectedWidths.length : 0;
    const addedCount = addActivityItemsFromResults(serverResults, {
      replaceExisting: true,
      filterIncomplete: isCapturing,
      expectedWidthCount
    });

    if (addedCount > 0) {
      console.log(`[Activity] Restored ${addedCount} mix-in ads from server`);
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
  if (progress.type === 'add-to-cart-complete') {
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
  bannerToSkuCultureMap = { ...(configData?.mixinad?.cultureLangMap || {}) };
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
  const regionSource = useSkuRegions ? configData?.regions : configData?.mixinad?.regions;
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
    : configData?.mixinad?.regions?.[region];

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
  const region = getBannerRegionValue();
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
    environment: envSelect.value,
    region: regionSelect.value,
    cultures: getSelectedCultures(),
    widths: getSelectedWidths(),
    categories: getSelectedCategories(),
    loginEnabled: loginToggle ? loginToggle.checked : false,
    username: usernameInput ? usernameInput.value.trim() || null : null
  };
  localStorage.setItem('mixinadTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('mixinadTesterPrefs'));
    if (prefs) {
      if (Object.prototype.hasOwnProperty.call(prefs, 'password')) {
        delete prefs.password;
        localStorage.setItem('mixinadTesterPrefs', JSON.stringify(prefs));
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
  if (message.type === 'mixinad-progress') {
    handleProgress(message.data);
  } else if (message.type === 'mixinad-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'mixinad-error') {
    handleError(message.data);
  }
}

function handleProgress(data) {
  syncCaptureStartTime(data.startedAt);
  const progress = data.progress;
  if (progress.type === 'add-to-cart-complete') {
    const activityResults = progress.result?.results || [];
    if (Array.isArray(activityResults) && activityResults.length > 0) {
      addActivityItemsFromResults(activityResults);
    }
    return;
  }
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
        totalWidths: expectedWidths.length || 1,
        url: ''
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

    if (resultData.url) {
      mixinProgress[categoryKey].url = resultData.url;
    }

    const mixin = mixinProgress[categoryKey];
    const completedWidths = Object.keys(mixin.widths).length;
    const errorWidths = Object.values(mixin.widths).filter(w => !w.success).length;

    // Aggregate results across widths
    const widthResults = Object.values(mixin.widths).filter(w => w.success);
    const totalAds = widthResults.reduce((sum, w) => sum + (w.adsFound || 0), 0);
    const hasNoAds = widthResults.some(w => w.noAdsFound);

    // Check if all widths for this category are complete
    if (completedWidths >= mixin.totalWidths) {
      delete mixinProgress[categoryKey];
    }
  }
}

function handleStatusUpdate(data) {
    switch (data.type) {
      case 'started':
        isCapturing = true;
        captureHadError = false;
        captureErrorMessage = '';
        completionNotified = false;
        jobSummary = buildJobSummary();
        requestNotificationPermission();
        primeAudio();
        captureStartTime = Number.isFinite(data.startedAt) ? data.startedAt : Date.now();
        setUICapturing();
      // Use category count (jobCount) for status message, not estimatedCaptures
      setStatusRunning('Starting capture...', `${data.jobCount || data.totalBanners} categories to process`);
      resetCredentialPromptState();
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
      captureStartTime = null;
      setStatusIdle('Capture cancelled', `${data.successCount} captures completed before cancellation`);
      if (saveReportBtn) saveReportBtn.disabled = !data.results?.length;
      break;

      case 'completed':
        isCapturing = false;
        isWaitingForResume = false;
        setUIIdle();
        captureStartTime = null;

        const successCount = Number.isFinite(data.successCount) ? data.successCount : 0;
        const errorCount = Number.isFinite(data.errorCount) ? data.errorCount : 0;
        const noAdsCount = Number.isFinite(data.noAdsCount) ? data.noAdsCount : 0;
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
        if (noAdsCount > 0) resultParts.push(`${noAdsCount} with no ads`);
        if (data.duration) resultParts.push(formatDuration(data.duration));
        const body = [jobSummary, resultParts.length ? `Result: ${resultParts.join(', ')}` : '']
          .filter(Boolean)
          .join(' | ');
        const title = hasErrors ? 'Mix-in ad capture finished with errors' : 'Mix-in ad capture completed';
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
      setStatusRunning('Resuming capture...', 'Continuing with mixinad processing');
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
  notifyJobComplete('Mix-in ad capture failed', body, true);
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

    const updateResponse = await fetch(api('/api/mixinad/update-credentials'), {
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

    const resumeResponse = await fetch(api('/api/mixinad/resume'), {
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
      const notification = new Notification('Mixin Ad Tester - Authentication Failed', {
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

  jobSummary = buildJobSummary();
  completionNotified = false;
  requestNotificationPermission();
  primeAudio();

  const options = {
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
    requestNotificationPermission();
    primeAudio();

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
  if (item.key) {
    activityItems = activityItems.filter(existing => existing.key !== item.key);
  }
  item.timestamp = item.timestamp ? new Date(item.timestamp) : new Date();

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
    const linkMarkup = item.url
      ? `<div class="activity-item-link"><a href="${item.url}" target="_blank" rel="noopener">Open page</a></div>`
      : '';
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
