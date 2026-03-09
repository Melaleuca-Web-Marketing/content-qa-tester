// sortorder-app.js - Frontend JavaScript for Sort Order Tester UI

let configData = null;
let isCapturing = false;
let isWaitingForResume = false;
let isWaitingForCredentials = false;
let captureStartTime = null;
let ws = null;
let reconnectAttempts = 0;

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_PATH = (window.__BASE_PATH || '').replace(/\/+$/, '');
const api = (path) => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
const userId = window.UserSession?.getId?.() || null;

const envSelect = document.getElementById('env-select');
const regionSelect = document.getElementById('region-select');
const testNameInput = document.getElementById('test-name-input');
const sortValidationToggle = document.getElementById('sort-validation-toggle');
const cultureOptions = document.getElementById('culture-options');
const loginToggle = document.getElementById('login-toggle');
const loginSection = document.getElementById('login-section');
const loginFields = document.getElementById('login-fields');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const categoryTree = document.getElementById('category-tree');
const startCaptureBtn = document.getElementById('start-capture');
const stopCaptureBtn = document.getElementById('stop-capture');
const statusBanner = document.getElementById('status-banner');
const statusMain = document.getElementById('status-main');
const statusDetail = document.getElementById('status-detail');
const progressContainer = document.getElementById('progress-container');
const progressBarInner = document.getElementById('progress-bar-inner');
const progressCount = document.getElementById('progress-count');
const progressEta = document.getElementById('progress-eta');
const progressCulture = document.getElementById('progress-culture');
const progressCategory = document.getElementById('progress-category');
const progressSort = document.getElementById('progress-sort');
const connectionStatus = document.getElementById('connection-status');
const activityFeed = document.getElementById('activity-feed');
const activityList = document.getElementById('activity-list');
const passedCountEl = document.getElementById('passed-count');
const failedCountEl = document.getElementById('failed-count');
const clearActivityBtn = document.getElementById('clear-activity');

const ACTIVITY_STORAGE_KEY = 'activityFeed-sortorder';
let activityItems = [];
const processedProgressKeys = new Set();

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
    renderCategoryTree();
    loadPreferences();
    connectWebSocket();
    loadActivityFromStorage();
    setStatusRunning('Checking status...', 'Loading job state');
    await checkStatus();
  } catch (err) {
    console.error('Initialization error:', err);
    setStatusError('Initialization failed', err.message);
  }
}

function initCultureMaps() {
  const cultureMap = (configData?.sortorder?.cultureLangMap && Object.keys(configData.sortorder.cultureLangMap).length > 0)
    ? configData.sortorder.cultureLangMap
    : (configData?.banner?.cultureLangMap || {});
  bannerToSkuCultureMap = { ...cultureMap };
  skuToBannerCultureMap = {};
  Object.entries(bannerToSkuCultureMap).forEach(([bannerCode, skuCulture]) => {
    if (!skuToBannerCultureMap[skuCulture]) {
      skuToBannerCultureMap[skuCulture] = bannerCode;
    }
  });
}

async function loadConfig() {
  const response = await fetch(api('/api/config'));
  configData = await response.json();
}

function isLoginMode() {
  return Boolean(loginToggle && loginToggle.checked);
}

function setLoginEnabled(enabled) {
  if (!loginFields) return;
  loginFields.style.display = enabled ? 'grid' : 'none';
  if (usernameInput) usernameInput.disabled = !enabled;
  if (passwordInput) passwordInput.disabled = !enabled;
}

function renderRegionOptions(useSkuRegions, selectedRegion = null) {
  const regionSource = useSkuRegions
    ? configData?.regions
    : ((configData?.sortorder?.regions && Object.keys(configData.sortorder.regions).length > 0)
      ? configData.sortorder.regions
      : configData?.banner?.regions);
  if (!regionSelect || !regionSource) return;

  let options = [];
  if (useSkuRegions) {
    options = Object.entries(regionSource).map(([code, value]) => ({
      value: code,
      label: value?.name || code
    }));
  } else {
    options = Object.entries(regionSource).map(([code, value]) => ({
      value: code,
      label: value?.name || code
    }));
  }

  regionSelect.innerHTML = options
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join('');

  if (selectedRegion && options.some((option) => option.value === selectedRegion)) {
    regionSelect.value = selectedRegion;
  }
}

function getBannerRegionValue() {
  const selected = regionSelect.value;
  if (!isLoginMode()) return selected;
  return skuRegionToBannerRegion[selected] || 'usca';
}

function getRequestRegion() {
  return getBannerRegionValue();
}

function getSelectedCultures() {
  return Array.from(cultureOptions.querySelectorAll('input:checked')).map((cb) => cb.value);
}

function getRequestCultures() {
  const selected = getSelectedCultures();
  if (!isLoginMode()) return selected;
  return selected
    .map((culture) => skuToBannerCultureMap[culture] || null)
    .filter(Boolean);
}

function applyRegionMode(enableLogin, options = {}) {
  const previousRegion = options.previousRegion ?? regionSelect.value;
  const previousCultures = Array.isArray(options.previousCultures) ? options.previousCultures : getSelectedCultures();

  let nextRegion = previousRegion;
  if (enableLogin) {
    nextRegion = bannerRegionToSkuRegion[previousRegion] || previousRegion;
  } else {
    nextRegion = skuRegionToBannerRegion[previousRegion] || previousRegion;
  }

  renderRegionOptions(enableLogin, nextRegion);
  renderCultureOptions(previousCultures);
  renderCategoryTree();
  applySavedCredentials();

  if (!options.skipSave) {
    savePreferences();
  }
}

function renderCultureOptions(previousCultures = null) {
  const region = regionSelect.value;
  const sortRegions = (configData?.sortorder?.regions && Object.keys(configData.sortorder.regions).length > 0)
    ? configData.sortorder.regions
    : configData?.banner?.regions;
  const regionConfig = isLoginMode()
    ? configData?.regions?.[region]
    : sortRegions?.[region];

  if (!regionConfig) {
    cultureOptions.innerHTML = '<div class="meta">No cultures available</div>';
    return;
  }

  const selectedSet = new Set(previousCultures || []);
  if (isLoginMode()) {
    cultureOptions.innerHTML = regionConfig.cultures.map((culture) => {
      const checked = selectedSet.size === 0 || selectedSet.has(culture);
      return `
      <label class="checkbox-row">
        <input type="checkbox" name="culture" value="${culture}" ${checked ? 'checked' : ''}>
        <span>${configData.cultureNames?.[culture] || culture}</span>
      </label>
      `;
    }).join('');
  } else {
    cultureOptions.innerHTML = regionConfig.cultures.map((culture) => {
      const checked = selectedSet.size === 0 || selectedSet.has(culture.code);
      return `
      <label class="checkbox-row">
        <input type="checkbox" name="culture" value="${culture.code}" ${checked ? 'checked' : ''}>
        <span>${culture.label}</span>
      </label>
      `;
    }).join('');
  }

  cultureOptions.querySelectorAll('input').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      applySavedCredentials();
      savePreferences();
    });
  });
}

function renderCategoryTree() {
  const region = getBannerRegionValue();
  const sortRegions = (configData?.sortorder?.regions && Object.keys(configData.sortorder.regions).length > 0)
    ? configData.sortorder.regions
    : configData?.banner?.regions;
  const regionConfig = sortRegions?.[region];

  if (!regionConfig || !Array.isArray(regionConfig.categories)) {
    categoryTree.innerHTML = '<div class="meta">No categories available</div>';
    return;
  }

  categoryTree.innerHTML = regionConfig.categories.map((category) => `
    <div class="category-group">
      <div class="category-name">
        <input type="checkbox" class="category-parent" data-category="${category.name}" checked>
        <span>${category.name}</span>
      </div>
      <div class="category-items">
        ${category.items.map((item) => `
          <label class="category-item">
            <input type="checkbox" name="category" value="${category.name}|${item.label}" checked>
            <span>${item.label}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  categoryTree.querySelectorAll('.category-parent').forEach((parentCheckbox) => {
    parentCheckbox.addEventListener('change', (event) => {
      const categoryName = event.target.dataset.category;
      const children = categoryTree.querySelectorAll(`input[value^="${categoryName}|"]`);
      children.forEach((child) => {
        child.checked = event.target.checked;
      });
      savePreferences();
    });
  });

  categoryTree.querySelectorAll('input[name="category"]').forEach((checkbox) => {
    checkbox.addEventListener('change', savePreferences);
  });
}

function getSelectedCategories() {
  return Array.from(categoryTree.querySelectorAll('input[name="category"]:checked'))
    .map((checkbox) => checkbox.value);
}

function applySavedCredentials() {
  if (!window.CredentialStore) return;
  if (!isLoginMode()) return;
  const environment = envSelect.value;
  const cultures = getSelectedCultures();
  if (!environment || cultures.length === 0) return;

  let entry = null;
  for (const culture of cultures) {
    entry = window.CredentialStore.getEntry(environment, culture);
    if (entry) break;
  }

  if (!entry) return;
  if (entry.username !== null && entry.username !== undefined && usernameInput) {
    usernameInput.value = entry.username || '';
  }
}

function savePreferences() {
  const prefs = {
    testName: testNameInput ? testNameInput.value.trim() : '',
    sortValidationEnabled: sortValidationToggle ? sortValidationToggle.checked : true,
    environment: envSelect.value,
    region: regionSelect.value,
    cultures: getSelectedCultures(),
    categories: getSelectedCategories(),
    loginEnabled: isLoginMode(),
    username: usernameInput ? usernameInput.value.trim() || null : null
  };
  localStorage.setItem('sortorderTesterPrefs', JSON.stringify(prefs));
}

function loadPreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('sortorderTesterPrefs'));
    if (!prefs) return;

    if (Object.prototype.hasOwnProperty.call(prefs, 'password')) {
      delete prefs.password;
      localStorage.setItem('sortorderTesterPrefs', JSON.stringify(prefs));
    }

    if (prefs.environment) envSelect.value = prefs.environment;
    if (typeof prefs.testName === 'string' && testNameInput) {
      testNameInput.value = prefs.testName;
    }
    if (sortValidationToggle && typeof prefs.sortValidationEnabled === 'boolean') {
      sortValidationToggle.checked = prefs.sortValidationEnabled;
    }
    if (typeof prefs.loginEnabled === 'boolean' && loginToggle) {
      loginToggle.checked = prefs.loginEnabled;
    }
    setLoginEnabled(isLoginMode());

    applyRegionMode(isLoginMode(), {
      previousRegion: prefs.region,
      previousCultures: prefs.cultures,
      skipSave: true
    });

    if (Array.isArray(prefs.categories)) {
      categoryTree.querySelectorAll('input[name="category"]').forEach((checkbox) => {
        checkbox.checked = prefs.categories.includes(checkbox.value);
      });
    }

    if (prefs.username && usernameInput) {
      usernameInput.value = prefs.username;
    }
  } catch (err) {
    console.debug('Could not load preferences:', err);
  }

  setLoginEnabled(isLoginMode());
  applySavedCredentials();
}

function setupEventListeners() {
  envSelect.addEventListener('change', () => {
    applySavedCredentials();
    savePreferences();
  });

  regionSelect.addEventListener('change', () => {
    const prevCultures = getSelectedCultures();
    renderCultureOptions(prevCultures);
    renderCategoryTree();
    applySavedCredentials();
    savePreferences();
  });

  if (loginToggle) {
    loginToggle.addEventListener('change', () => {
      setLoginEnabled(loginToggle.checked);
      applyRegionMode(loginToggle.checked);
    });
  }

  if (usernameInput) usernameInput.addEventListener('input', savePreferences);
  if (passwordInput) passwordInput.addEventListener('input', savePreferences);
  if (testNameInput) testNameInput.addEventListener('input', savePreferences);
  if (sortValidationToggle) sortValidationToggle.addEventListener('change', savePreferences);

  document.getElementById('select-all-cultures').addEventListener('click', () => toggleAllCheckboxes('culture-options', true));
  document.getElementById('deselect-all-cultures').addEventListener('click', () => toggleAllCheckboxes('culture-options', false));
  document.getElementById('select-all-categories').addEventListener('click', () => toggleAllCheckboxes('category-tree', true));
  document.getElementById('deselect-all-categories').addEventListener('click', () => toggleAllCheckboxes('category-tree', false));

  startCaptureBtn.addEventListener('click', () => {
    if (isWaitingForResume) {
      resumeCapture();
      return;
    }
    if (isWaitingForCredentials) {
      updateCredentialsAndResume();
      return;
    }
    startCapture();
  });
  stopCaptureBtn.addEventListener('click', stopCapture);
  if (clearActivityBtn) clearActivityBtn.addEventListener('click', clearActivityFeed);

  setupPasswordToggle();
}

function setupPasswordToggle() {
  const toggleButton = document.querySelector('.password-toggle-btn');
  if (!toggleButton || !passwordInput) return;

  toggleButton.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    toggleButton.classList.toggle('is-visible', show);
    toggleButton.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}

function toggleAllCheckboxes(containerId, checked) {
  const container = document.getElementById(containerId);
  container?.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = checked;
    if (containerId === 'width-options') {
      checkbox.closest('.width-option')?.classList.toggle('selected', checked);
    }
  });
  if (containerId === 'culture-options') {
    applySavedCredentials();
  }
  savePreferences();
}

function setConnectionStatus(state) {
  if (!connectionStatus) return;
  connectionStatus.className = `connection-status ${state}`;
  const text = connectionStatus.querySelector('.connection-text');
  if (!text) return;
  if (state === 'connected') text.textContent = 'Connected';
  else if (state === 'disconnected') text.textContent = 'Disconnected';
  else text.textContent = 'Connecting...';
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}${BASE_PATH}?userId=${encodeURIComponent(userId || '')}`;

  ws = new WebSocket(wsUrl);
  setConnectionStatus('connecting');

  ws.onopen = () => {
    reconnectAttempts = 0;
    setConnectionStatus('connected');
  };

  ws.onclose = () => {
    setConnectionStatus('disconnected');
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts += 1;
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
    } catch (err) {
      console.error('Invalid WebSocket message:', err);
    }
  };
}

function handleWebSocketMessage(message) {
  if (message.type === 'sortorder-progress') {
    handleProgress(message.data);
  } else if (message.type === 'sortorder-status') {
    handleStatusUpdate(message.data);
  } else if (message.type === 'sortorder-error') {
    handleError(message.data);
  }
}

function syncCaptureStartTime(startedAt) {
  if (Number.isFinite(startedAt)) {
    captureStartTime = startedAt;
  } else if (!captureStartTime) {
    captureStartTime = Date.now();
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateProgressBar(completed, total) {
  const safeCompleted = Number.isFinite(completed) ? completed : 0;
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;

  progressCount.textContent = `${safeCompleted} / ${safeTotal}`;
  if (safeTotal > 0) {
    const percent = Math.max(0, Math.min(100, (safeCompleted / safeTotal) * 100));
    progressBarInner.style.width = `${percent}%`;

    if (captureStartTime && safeCompleted > 0 && safeCompleted < safeTotal) {
      const elapsed = Date.now() - captureStartTime;
      const remaining = (elapsed / safeCompleted) * (safeTotal - safeCompleted);
      progressEta.textContent = `ETR: ${formatDuration(remaining)}`;
    } else if (safeCompleted >= safeTotal) {
      progressEta.textContent = 'ETR: 00:00';
    } else {
      progressEta.textContent = 'ETR: --:--';
    }
  } else {
    progressBarInner.style.width = '0%';
    progressEta.textContent = 'ETR: --:--';
  }
}

function setUICapturing() {
  startCaptureBtn.disabled = true;
  stopCaptureBtn.disabled = false;
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
  isWaitingForResume = false;
  isWaitingForCredentials = false;
  startCaptureBtn.textContent = 'Start Capture';
  if (loginSection) loginSection.classList.remove('credential-error');
}

function setStatusIdle(main, detail) {
  statusBanner.className = 'status-banner idle';
  statusMain.textContent = main || 'Ready to capture';
  statusDetail.textContent = detail || '';
}

function setStatusRunning(main, detail) {
  statusBanner.className = 'status-banner running';
  statusMain.textContent = main || 'Running...';
  statusDetail.textContent = detail || '';
}

function setStatusSuccess(main, detail) {
  statusBanner.className = 'status-banner success';
  statusMain.textContent = main || 'Completed';
  statusDetail.textContent = detail || '';
}

function setStatusError(main, detail) {
  statusBanner.className = 'status-banner error';
  statusMain.textContent = main || 'Error';
  statusDetail.textContent = detail || '';
}

function handleProgress(data) {
  syncCaptureStartTime(data.startedAt);
  const progress = data.progress;
  if (!progress) return;

  if (progress.culture) progressCulture.textContent = `Culture: ${progress.culture}`;
  if (progress.category) {
    const path = progress.mainCategory
      ? `${progress.mainCategory} > ${progress.category}`
      : progress.category;
    progressCategory.textContent = `Category: ${path}`;
  }
  if (progress.sortLabel) progressSort.textContent = `Order: ${progress.sortLabel}`;

  const completed = Number.isFinite(progress.completed) ? progress.completed : progress.completedBanners;
  const total = Number.isFinite(progress.total) ? progress.total : progress.totalBanners;
  if (Number.isFinite(completed) && Number.isFinite(total)) {
    updateProgressBar(completed, total);
  }

  if (progress.state === 'sorting') {
    setStatusRunning('Collecting default order...', progress.sortLabel || '');
  } else if (progress.state === 'working') {
    setStatusRunning('Capturing...', `${progress.culture || ''} - ${progress.category || ''}`);
  } else if (progress.state === 'error') {
    setStatusRunning('Capture continuing with issues...', progress.sortLabel || 'Default order');
  }

  addCategoryActivityFromProgress(progress);
}

function handleStatusUpdate(data) {
  switch (data.type) {
    case 'started':
      isCapturing = true;
      captureStartTime = Number.isFinite(data.startedAt) ? data.startedAt : Date.now();
      setUICapturing();
      setStatusRunning('Starting capture...', `${data.jobCount || 0} categories`);
      clearActivityFeed();
      if (activityFeed) activityFeed.style.display = 'block';
      break;

    case 'stopping':
      setStatusRunning('Stopping...', 'Waiting for current step to complete');
      break;

    case 'waiting-for-auth':
      isWaitingForResume = true;
      startCaptureBtn.textContent = 'Resume Capture';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      setStatusRunning('Waiting for manual sign-in', data.message || 'Sign in, then click Resume Capture');
      break;

    case 'waiting-for-credentials':
      isWaitingForCredentials = true;
      startCaptureBtn.textContent = 'Update & Resume';
      startCaptureBtn.disabled = false;
      stopCaptureBtn.disabled = false;
      if (loginToggle) loginToggle.checked = true;
      setLoginEnabled(true);
      if (loginSection) loginSection.classList.add('credential-error');
      setStatusError('Authentication failed', data.message || 'Update credentials and resume');
      break;

    case 'resuming':
      isWaitingForResume = false;
      isWaitingForCredentials = false;
      startCaptureBtn.disabled = true;
      startCaptureBtn.textContent = 'Start Capture';
      if (loginSection) loginSection.classList.remove('credential-error');
      setStatusRunning('Resuming...', 'Continuing capture');
      break;

    case 'cancelled':
      setUIIdle();
      captureStartTime = null;
      setStatusIdle('Capture cancelled', `${data.successCount || 0} completed before cancellation`);
      break;

    case 'completed': {
      setUIIdle();
      captureStartTime = null;
      const successCount = Number.isFinite(data.successCount) ? data.successCount : 0;
      const errorCount = Number.isFinite(data.errorCount) ? data.errorCount : 0;
      const infoCount = Number.isFinite(data.infoCount) ? data.infoCount : 0;
      if (errorCount > 0) {
        setStatusError('Capture complete with issues', `${successCount} passed, ${errorCount} failed, ${infoCount} info`);
      } else {
        setStatusSuccess('Capture complete', `${successCount} passed in ${formatDuration(data.duration)}`);
      }
      break;
    }

    default:
      break;
  }
}

function handleError(data) {
  setStatusError('Capture error', data?.message || 'Unknown error');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCategoryPath(progress) {
  if (!progress) return '';
  return progress.mainCategory
    ? `${progress.mainCategory} > ${progress.category || ''}`.trim()
    : String(progress.category || '').trim();
}

function buildProgressEventKey(progress) {
  const path = getCategoryPath(progress);
  return [
    progress.culture || '',
    path,
    progress.currentBanner || '',
    progress.completed || '',
    progress.state || '',
    progress.result?.failedCaptures || 0,
    progress.result?.validationFailedRules || 0
  ].join('|');
}

function formatActivityTime(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  return date.toLocaleTimeString();
}

function saveActivityToStorage() {
  try {
    sessionStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activityItems));
  } catch (err) {
    console.error('Failed to save activity feed:', err);
  }
}

function renderActivityFeed() {
  if (!activityList || !passedCountEl || !failedCountEl) return;

  const passed = activityItems.filter((item) => item.type === 'success').length;
  const failed = activityItems.filter((item) => item.type !== 'success').length;

  passedCountEl.textContent = String(passed);
  failedCountEl.textContent = String(failed);

  if (activityItems.length === 0) {
    activityList.innerHTML = '<div class="activity-empty">No activity yet</div>';
    return;
  }

  activityList.innerHTML = activityItems.map((item) => {
    const icon = item.type === 'error' ? 'ERR' : (item.type === 'warning' ? 'WARN' : 'OK');
    const timeText = formatActivityTime(item.timestamp);
    const mainText = item.main || 'Category';
    const detailText = item.detail || '';
    const issues = Array.isArray(item.issues) ? item.issues : [];
    const issuesText = issues.length > 0
      ? `<div class="activity-item-detail">${issues.map((issue) => escapeHtml(issue)).join(' | ')}</div>`
      : '';
    const linkMarkup = item.url
      ? `<div class="activity-item-link"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open page</a></div>`
      : '';

    return `
      <div class="activity-item ${item.type}">
        <span class="activity-item-icon">${icon}</span>
        <div class="activity-item-content">
          <div class="activity-item-main">${escapeHtml(mainText)}</div>
          ${detailText ? `<div class="activity-item-detail">${escapeHtml(detailText)}</div>` : ''}
          ${issuesText}
          ${linkMarkup}
        </div>
        <span class="activity-item-time">${escapeHtml(timeText)}</span>
      </div>
    `;
  }).join('');
}

function addActivityItem(item) {
  if (!item || !item.type) return;
  const entry = {
    ...item,
    timestamp: item.timestamp || new Date()
  };

  if (entry.eventKey) {
    processedProgressKeys.add(entry.eventKey);
  }

  if (entry.type === 'success') {
    activityItems.push(entry);
  } else {
    activityItems.unshift(entry);
  }

  saveActivityToStorage();
  renderActivityFeed();
  if (activityFeed) activityFeed.style.display = 'block';
}

function clearActivityFeed() {
  activityItems = [];
  processedProgressKeys.clear();
  saveActivityToStorage();
  renderActivityFeed();
}

function loadActivityFromStorage() {
  if (!activityFeed) return;
  try {
    const stored = sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
    activityItems = stored ? JSON.parse(stored) : [];
    activityItems = activityItems.map((item) => ({
      ...item,
      timestamp: item?.timestamp ? new Date(item.timestamp) : new Date()
    }));
    for (const item of activityItems) {
      if (item?.eventKey) processedProgressKeys.add(item.eventKey);
    }
  } catch (err) {
    console.error('Failed to load activity feed:', err);
    activityItems = [];
    processedProgressKeys.clear();
  }
  renderActivityFeed();
  activityFeed.style.display = 'block';
}

function addCategoryActivityFromProgress(progress) {
  if (!progress || progress.type !== 'capture-progress') return;
  if (!progress.isLastWidthForBanner) return;
  if (progress.state !== 'done' && progress.state !== 'error') return;

  const eventKey = buildProgressEventKey(progress);
  if (processedProgressKeys.has(eventKey)) return;

  const categoryPath = getCategoryPath(progress);
  const result = progress.result || {};
  const failedCaptures = Number.isFinite(result.failedCaptures) ? result.failedCaptures : 0;
  const validationFailedRules = Number.isFinite(result.validationFailedRules) ? result.validationFailedRules : 0;
  const validationEnabled = result.validationEnabled !== false;
  const capturesCollected = Number.isFinite(result.capturesCollected) ? result.capturesCollected : 0;
  const products = Number.isFinite(result.products) ? result.products : null;
  const mixinAds = Number.isFinite(result.mixinAds) ? result.mixinAds : null;
  const issues = Array.isArray(result.validationIssues)
    ? result.validationIssues.slice(0, 6).map((issue) => String(issue))
    : [];

  if (result.captureError) {
    issues.unshift(`Capture error: ${result.captureError}`);
  }

  const detailParts = [];
  detailParts.push(`Captures: ${capturesCollected}`);
  if (products !== null) detailParts.push(`Products: ${products}`);
  if (mixinAds !== null) detailParts.push(`Mix-In Ads: ${mixinAds}`);
  if (failedCaptures > 0) detailParts.push(`${failedCaptures} capture failure${failedCaptures === 1 ? '' : 's'}`);
  if (validationEnabled) {
    if (validationFailedRules > 0) {
      detailParts.push(`${validationFailedRules} validation failure${validationFailedRules === 1 ? '' : 's'}`);
    } else {
      detailParts.push('Validation passed');
    }
  } else {
    detailParts.push('Validation disabled');
  }

  let type = 'success';
  if (progress.state === 'error' || failedCaptures > 0) {
    type = 'error';
  } else if (validationFailedRules > 0) {
    type = 'warning';
  }

  addActivityItem({
    eventKey,
    type,
    main: `${progress.culture || 'N/A'} | ${categoryPath || 'Category'}`,
    detail: detailParts.join(' | '),
    issues,
    url: result.url || ''
  });
}

async function checkStatus() {
  try {
    const response = await fetch(api('/api/sortorder/status'), {
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const status = await response.json();

    if (status.isRunning) {
      isCapturing = true;
      setUICapturing();
      setStatusRunning('Job in progress', 'Reconnected to running job');
      syncCaptureStartTime(status.startedAt);

      if (status.statusType === 'waiting-for-auth') {
        isWaitingForResume = true;
        startCaptureBtn.textContent = 'Resume Capture';
        startCaptureBtn.disabled = false;
      } else if (status.statusType === 'waiting-for-credentials') {
        isWaitingForCredentials = true;
        startCaptureBtn.textContent = 'Update & Resume';
        startCaptureBtn.disabled = false;
        if (loginToggle) loginToggle.checked = true;
        setLoginEnabled(true);
        if (loginSection) loginSection.classList.add('credential-error');
      } else if (status.progress) {
        handleProgress({ progress: status.progress, startedAt: status.startedAt });
      }
    } else if (status.resultsCount > 0) {
      setStatusIdle('Ready to capture', `Previous job completed with ${status.resultsCount} results`);
    } else {
      setStatusIdle('Ready to capture', '');
    }
  } catch (err) {
    console.error('Failed to check status:', err);
    setStatusIdle('Ready to capture', '');
  }
}

async function startCapture() {
  const testName = testNameInput ? testNameInput.value.trim() : '';
  const environment = envSelect.value;
  const region = getRequestRegion();
  const cultures = getRequestCultures();
  const categories = getSelectedCategories();
  const loginEnabled = isLoginMode();
  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (cultures.length === 0) {
    setStatusError('No cultures selected', 'Select at least one culture');
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

  const options = {
    testName,
    sortValidationEnabled: sortValidationToggle ? sortValidationToggle.checked : true,
    environment,
    region,
    cultures,
    categories,
    loginEnabled
  };
  if (loginEnabled) {
    options.username = username || null;
    options.password = password || null;
  }

  try {
    const response = await fetch(api('/api/sortorder/start'), {
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
        alert('A sort order job is already running. Stop it first or wait for completion.');
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
    await fetch(api('/api/sortorder/stop'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
  } catch (err) {
    console.error('Error stopping capture:', err);
  }
}

async function resumeCapture() {
  try {
    startCaptureBtn.disabled = true;
    const response = await fetch(api('/api/sortorder/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const result = await response.json();
    if (!result.ok) {
      setStatusError('Failed to resume', result.message || 'Unknown error');
      startCaptureBtn.disabled = false;
    }
  } catch (err) {
    setStatusError('Connection error', err.message);
    startCaptureBtn.disabled = false;
  }
}

async function updateCredentialsAndResume() {
  if (!usernameInput || !passwordInput) return;
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    setStatusError('Credentials required', 'Enter username and password to continue');
    return;
  }

  try {
    startCaptureBtn.disabled = true;
    const updateResponse = await fetch(api('/api/sortorder/update-credentials'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'X-User-Id': userId } : {})
      },
      body: JSON.stringify({ username, password })
    });
    const updateResult = await updateResponse.json();
    if (!updateResponse.ok || !updateResult.ok) {
      setStatusError('Failed to update credentials', updateResult.error || updateResult.message || 'Unknown error');
      startCaptureBtn.disabled = false;
      return;
    }

    const resumeResponse = await fetch(api('/api/sortorder/resume'), {
      method: 'POST',
      headers: userId ? { 'X-User-Id': userId } : {}
    });
    const resumeResult = await resumeResponse.json();
    if (!resumeResponse.ok || !resumeResult.ok) {
      setStatusError('Failed to resume', resumeResult.error || resumeResult.message || 'Unknown error');
      startCaptureBtn.disabled = false;
      return;
    }

    isWaitingForCredentials = false;
    startCaptureBtn.textContent = 'Start Capture';
    if (loginSection) loginSection.classList.remove('credential-error');
    setStatusRunning('Resuming...', 'Using updated credentials');
  } catch (err) {
    setStatusError('Connection error', err.message);
    startCaptureBtn.disabled = false;
  }
}

init();
