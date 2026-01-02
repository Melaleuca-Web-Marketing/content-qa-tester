// credentials-app.js - Manage saved credentials per environment and culture

let configData = null;
let cultureList = [];
let bannerCultureMap = {};
let bannerCultureReverseMap = {};
let activeStoredCulture = null;

const envSelect = document.getElementById('cred-env');
const cultureSelect = document.getElementById('cred-culture');
const loginUsernameInput = document.getElementById('login-username-input');
const loginPasswordInput = document.getElementById('login-password-input');
const saveBtn = document.getElementById('save-credentials');
const clearBtn = document.getElementById('clear-credentials');
const deleteBtn = document.getElementById('delete-credentials');
const statusNote = document.getElementById('status-note');
const savedTableBody = document.getElementById('saved-table-body');
const savedEmpty = document.getElementById('saved-empty');

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

async function init() {
  try {
    await loadConfig();
    renderEnvironmentOptions();
    renderCultureOptions();
    setupEventListeners();
    loadSelectedEntry();
    renderSavedEntries();
  } catch (err) {
    setStatus('Failed to load configuration.', true);
    console.error(err);
  }
}

async function loadConfig() {
  const response = await fetch('/api/config');
  configData = await response.json();
  bannerCultureMap = configData?.banner?.cultureLangMap || {};
  bannerCultureReverseMap = buildReverseCultureMap(bannerCultureMap);
  cultureList = buildCultureList(configData, bannerCultureMap);
}

function buildReverseCultureMap(cultureMap) {
  const reverseMap = {};
  Object.entries(cultureMap || {}).forEach(([bannerCode, standardCode]) => {
    if (!reverseMap[standardCode]) {
      reverseMap[standardCode] = [];
    }
    reverseMap[standardCode].push(bannerCode);
  });
  return reverseMap;
}

function buildCultureList(config, bannerMap = {}) {
  const cultureMap = new Map();
  const nameMap = config?.cultureNames || {};

  const addCulture = (code, label) => {
    if (!code) return;
    if (!cultureMap.has(code)) {
      cultureMap.set(code, label || code);
    }
  };

  Object.values(config?.regions || {}).forEach((region) => {
    (region?.cultures || []).forEach((cultureCode) => {
      const label = nameMap[cultureCode] || cultureCode;
      addCulture(cultureCode, label);
    });
  });

  Object.values(config?.banner?.regions || {}).forEach((region) => {
    (region?.cultures || []).forEach((culture) => {
      if (!culture || !culture.code) return;
      const canonicalCode = bannerMap[culture.code] || culture.code;
      const label = nameMap[canonicalCode] || culture.label || canonicalCode;
      addCulture(canonicalCode, label);
    });
  });

  return Array.from(cultureMap.entries())
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function renderEnvironmentOptions() {
  const environments = Array.isArray(configData?.environments) ? configData.environments : Object.keys(configData?.environments || {});
  envSelect.innerHTML = environments.map((env) => `<option value="${env}">${capitalize(env)}</option>`).join('');
}

function renderCultureOptions() {
  cultureSelect.innerHTML = cultureList
    .map((culture) => `<option value="${culture.code}">${culture.label} (${culture.code})</option>`)
    .join('');
}

function getCanonicalCulture(code) {
  return bannerCultureMap[code] || code;
}

function getSelectableCulture(code) {
  if (cultureList.some((culture) => culture.code === code)) {
    return code;
  }
  const canonicalCode = getCanonicalCulture(code);
  if (cultureList.some((culture) => culture.code === canonicalCode)) {
    return canonicalCode;
  }
  return code;
}

function getAlternateCultures(code) {
  const canonicalCode = getCanonicalCulture(code);
  if (canonicalCode !== code) {
    return [canonicalCode];
  }
  return bannerCultureReverseMap[canonicalCode] || [];
}

function findStoredEntry(environment, culture, preferredCulture) {
  if (!window.CredentialStore || !environment || !culture) return null;

  if (preferredCulture) {
    const preferredEntry = window.CredentialStore.getEntry(environment, preferredCulture);
    if (preferredEntry) {
      return { entry: preferredEntry, culture: preferredCulture };
    }
  }

  const directEntry = window.CredentialStore.getEntry(environment, culture);
  if (directEntry) {
    return { entry: directEntry, culture };
  }

  const alternates = getAlternateCultures(culture);
  for (const alt of alternates) {
    const altEntry = window.CredentialStore.getEntry(environment, alt);
    if (altEntry) {
      return { entry: altEntry, culture: alt };
    }
  }

  return null;
}

function setupEventListeners() {
  envSelect.addEventListener('change', loadSelectedEntry);
  cultureSelect.addEventListener('change', loadSelectedEntry);
  saveBtn.addEventListener('click', saveCredentials);
  clearBtn.addEventListener('click', clearForm);
  deleteBtn.addEventListener('click', deleteCredentials);
}

function loadSelectedEntry(preferredCulture) {
  clearStatus();
  activeStoredCulture = null;
  const preferredCultureCode = typeof preferredCulture === 'string' ? preferredCulture : null;

  const result = findStoredEntry(envSelect.value, cultureSelect.value, preferredCultureCode);
  if (!result) {
    loginUsernameInput.value = '';
    loginPasswordInput.value = '';
    return;
  }

  activeStoredCulture = result.culture;
  const entry = result.entry;
  loginUsernameInput.value = entry.username || '';
  loginPasswordInput.value = entry.password || '';
}

function saveCredentials() {
  clearStatus();

  const environment = envSelect.value;
  const selectedCulture = cultureSelect.value;
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  const hasLogin = username || password;

  if (hasLogin && (!username || !password)) {
    setStatus('Provide both login username and password.', true);
    return;
  }

  if (!hasLogin) {
    setStatus('Enter credentials to save.', true);
    return;
  }

  if (!environment || !selectedCulture) {
    setStatus('Select an environment and culture to save login credentials.', true);
    return;
  }

  window.CredentialStore?.setEntry(environment, selectedCulture, {
    username,
    password
  });

  if (activeStoredCulture && activeStoredCulture !== selectedCulture) {
    const activeCanonical = getCanonicalCulture(activeStoredCulture);
    if (activeCanonical === selectedCulture) {
      window.CredentialStore?.removeEntry(environment, activeStoredCulture);
    }
  }

  activeStoredCulture = selectedCulture;
  renderSavedEntries();
  setStatus('Login credentials saved.');
}

function deleteCredentials() {
  clearStatus();
  const environment = envSelect.value;
  const selectedCulture = cultureSelect.value;
  let cultureKey = selectedCulture;

  if (activeStoredCulture) {
    const activeCanonical = getCanonicalCulture(activeStoredCulture);
    if (activeCanonical === selectedCulture || activeStoredCulture === selectedCulture) {
      cultureKey = activeStoredCulture;
    }
  }

  window.CredentialStore?.removeEntry(environment, cultureKey);
  activeStoredCulture = null;
  setStatus('Login entry deleted.');
  loadSelectedEntry();
  renderSavedEntries();
}

function clearForm() {
  loginUsernameInput.value = '';
  loginPasswordInput.value = '';
  clearStatus();
}

function renderSavedEntries() {
  const entries = window.CredentialStore?.listEntries() || [];
  savedTableBody.innerHTML = '';

  if (entries.length === 0) {
    savedEmpty.style.display = 'block';
    return;
  }

  savedEmpty.style.display = 'none';
  entries
    .sort((a, b) => a.environment.localeCompare(b.environment) || a.culture.localeCompare(b.culture))
    .forEach((entry) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(entry.environment)}</td>
        <td>${escapeHtml(resolveCultureLabel(entry.culture))}</td>
        <td>${entry.username ? escapeHtml(entry.username) : '<small>Not set</small>'}</td>
        <td>
          <div class="table-actions">
            <button class="secondary" data-action="use" data-env="${entry.environment}" data-culture="${entry.culture}">Use</button>
            <button class="danger" data-action="delete" data-env="${entry.environment}" data-culture="${entry.culture}">Delete</button>
          </div>
        </td>
      `;
      savedTableBody.appendChild(row);
    });

  savedTableBody.querySelectorAll('button[data-action="use"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const requestedCulture = btn.dataset.culture;
      envSelect.value = btn.dataset.env;
      cultureSelect.value = getSelectableCulture(requestedCulture);
      loadSelectedEntry(requestedCulture);
    });
  });

  savedTableBody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const requestedCulture = btn.dataset.culture;
      envSelect.value = btn.dataset.env;
      cultureSelect.value = getSelectableCulture(requestedCulture);
      activeStoredCulture = requestedCulture;
      deleteCredentials();
    });
  });
}

function resolveCultureLabel(code) {
  const match = cultureList.find((culture) => culture.code === code);
  if (match) return `${match.label} (${match.code})`;

  const canonicalCode = getCanonicalCulture(code);
  const canonicalMatch = cultureList.find((culture) => culture.code === canonicalCode);
  if (canonicalMatch) return `${canonicalMatch.label} (${code})`;

  return code;
}

function setStatus(message, isError = false) {
  statusNote.textContent = message;
  statusNote.classList.toggle('error', isError);
}

function clearStatus() {
  statusNote.textContent = '';
  statusNote.classList.remove('error');
}

function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

init();
