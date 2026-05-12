// category-manager-app.js - Category Management UI Logic

let categoriesData = {};
let currentRegion = null;
let expandedItems = new Set(); // Track which subcategory rows are expanded
let hasUnsavedChanges = false; // Track if there are unsaved changes
let currentVersion = null; // Track version for conflict detection
let lastModified = null;
let lastModifiedBy = null;
const BASE_PATH = (window.__BASE_PATH || '').replace(/\/+$/, '');
const api = (path) => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;

// Culture mappings per region
const REGION_CULTURES = {
  'US & Canada': [
    { code: 'US', label: 'United States' },
    { code: 'CA', label: 'Canada' }
  ],
  'Mexico': [
    { code: 'es-MX', label: 'Spanish (MX)' }
  ],
  'Europe': [
    { code: 'en-GB', label: 'English (UK)' },
    { code: 'en-IE', label: 'English (IE)' },
    { code: 'de-DE', label: 'German (DE)' },
    { code: 'pl-PL', label: 'Polish (PL)' },
    { code: 'nl-NL', label: 'Dutch (NL)' },
    { code: 'lt-LT', label: 'Lithuanian (LT)' }
  ]
};

// Get cultures for current region
function getCulturesForRegion(region) {
  return REGION_CULTURES[region] || [{ code: 'default', label: 'Default' }];
}

function normalizeCategoryPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    let path = parsed.pathname || '';
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }
    return path;
  } catch (err) {
    let path = raw;
    const queryIndex = path.indexOf('?');
    if (queryIndex >= 0) path = path.slice(0, queryIndex);
    const hashIndex = path.indexOf('#');
    if (hashIndex >= 0) path = path.slice(0, hashIndex);
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }
    return path;
  }
}

// Theme management - just read from localStorage (toggle is on main dashboard)
function initTheme() {
  // Dashboard uses 'testerTheme' key and 'light-mode' class (default is dark)
  const savedTheme = localStorage.getItem('testerTheme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  }
}

// Mark that changes have been made
function markUnsaved() {
  if (!hasUnsavedChanges) {
    hasUnsavedChanges = true;
    updateUnsavedIndicator();
  }
}

// Update the visual indicator for unsaved changes
function updateUnsavedIndicator() {
  const indicator = document.getElementById('unsaved-indicator');
  if (indicator) {
    indicator.style.display = hasUnsavedChanges ? 'flex' : 'none';
    document.body.classList.toggle('has-unsaved-indicator', hasUnsavedChanges);
  }

  // Update page title
  document.title = hasUnsavedChanges
    ? '* Category Manager - Melaleuca Unified Tester'
    : 'Category Manager - Melaleuca Unified Tester';
}

// Clear unsaved changes flag
function clearUnsaved() {
  hasUnsavedChanges = false;
  updateUnsavedIndicator();
}

// Warn before leaving with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Load categories on page load
async function loadCategories() {
  try {
    const response = await fetch(api('/api/categories'));
    if (!response.ok) throw new Error('Failed to load categories');

    const responseData = await response.json();

    // Extract version information
    if (responseData.version) {
      currentVersion = responseData.version;
      lastModified = responseData.lastModified;
      lastModifiedBy = responseData.modifiedBy;
      categoriesData = responseData.data;
    } else {
      // Legacy format without version
      categoriesData = responseData;
    }

    renderUI();
  } catch (err) {
    showStatus('error', 'Failed to load categories: ' + err.message);
  }
}

function clearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createButton(className, text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

// Render the UI
function renderUI() {
  const regions = Object.keys(categoriesData);
  if (regions.length === 0) {
    const content = document.getElementById('category-content');
    clearElement(content);
    const empty = document.createElement('p');
    empty.textContent = 'No categories found.';
    content.appendChild(empty);
    return;
  }

  if (!currentRegion || !regions.includes(currentRegion)) {
    currentRegion = regions[0];
  }

  renderRegionTabs(regions);
  renderAddButtons();
  renderCategoryContent();
}

// Render add category button at top
function renderAddButtons() {
  const addButtonsContainer = document.getElementById('add-buttons');
  if (!addButtonsContainer) return;

  clearElement(addButtonsContainer);
  addButtonsContainer.appendChild(createButton('btn btn-primary', '+ Add New Category', addCategory));
}

// Render region tabs
function renderRegionTabs(regions) {
  const tabsContainer = document.getElementById('region-tabs');
  clearElement(tabsContainer);

  regions.forEach((region) => {
    const button = createButton(
      `region-tab ${region === currentRegion ? 'active' : ''}`,
      region,
      () => switchRegion(region)
    );
    tabsContainer.appendChild(button);
  });
}

// Switch active region
function switchRegion(region) {
  currentRegion = region;
  renderUI();
}

// Render category content for current region
function renderCategoryContent() {
  const contentContainer = document.getElementById('category-content');
  const categories = categoriesData[currentRegion] || {};
  const cultures = getCulturesForRegion(currentRegion);

  clearElement(contentContainer);

  Object.entries(categories).forEach(([catName, items]) => {
    const card = document.createElement('div');
    card.className = 'category-card';

    const header = document.createElement('div');
    header.className = 'category-header';

    const categoryInput = document.createElement('input');
    categoryInput.type = 'text';
    categoryInput.className = 'input-field category-name';
    categoryInput.value = catName;
    categoryInput.style.fontSize = '18px';
    categoryInput.style.fontWeight = '600';
    categoryInput.addEventListener('change', () => renameCategory(catName, categoryInput.value));
    header.appendChild(categoryInput);

    const actions = document.createElement('div');
    actions.className = 'category-actions';
    actions.appendChild(createButton('btn btn-small btn-secondary', '+ Add Subcategory', () => addSubcategory(catName)));
    actions.appendChild(createButton('btn btn-small btn-danger', 'Delete Category', () => deleteCategory(catName)));
    header.appendChild(actions);
    card.appendChild(header);

    const list = document.createElement('div');
    list.className = 'subcategory-list';

    items.forEach((item, idx) => {
      const itemKey = `${catName}-${idx}`;
      const isExpanded = expandedItems.has(itemKey);
      const paths = item.paths || {};
      const defaultPath = item.path || '/productstore/path';

      const itemContainer = document.createElement('div');
      itemContainer.className = 'subcategory-item-container';

      const itemHeader = document.createElement('div');
      itemHeader.className = 'subcategory-item-header';

      itemHeader.appendChild(createButton('expand-btn', isExpanded ? 'v' : '>', () => toggleExpand(itemKey)));

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'input-field subcategory-label';
      labelInput.value = item.label || '';
      labelInput.placeholder = 'Label';
      labelInput.addEventListener('change', () => updateSubcategory(catName, idx, 'label', labelInput.value));
      itemHeader.appendChild(labelInput);

      const cultureCount = document.createElement('span');
      cultureCount.className = 'culture-count';
      cultureCount.textContent = `${cultures.length} culture${cultures.length !== 1 ? 's' : ''}`;
      itemHeader.appendChild(cultureCount);

      itemHeader.appendChild(createButton('btn btn-small btn-danger', 'Delete', () => deleteSubcategory(catName, idx)));
      itemContainer.appendChild(itemHeader);

      if (isExpanded) {
        const culturePaths = document.createElement('div');
        culturePaths.className = 'culture-paths';

        cultures.forEach((culture) => {
          const row = document.createElement('div');
          row.className = 'culture-path-row';

          const label = document.createElement('span');
          label.className = 'culture-label';
          label.textContent = culture.label;
          row.appendChild(label);

          const pathInput = document.createElement('input');
          pathInput.type = 'text';
          pathInput.className = 'input-field culture-path-input';
          pathInput.value = paths[culture.code] || defaultPath;
          pathInput.placeholder = '/productstore/path';
          pathInput.addEventListener('change', () => updateCulturePath(catName, idx, culture.code, pathInput.value));
          row.appendChild(pathInput);

          culturePaths.appendChild(row);
        });

        itemContainer.appendChild(culturePaths);
      }

      list.appendChild(itemContainer);
    });

    card.appendChild(list);
    contentContainer.appendChild(card);
  });
}

function getSaveErrorMessage(result) {
  const details = Array.isArray(result.details) && result.details.length > 0
    ? result.details.map(detail => `${detail.path || '(root)'}: ${detail.message}`).join('; ')
    : '';
  const message = result.error || result.message || 'Failed to save';
  return details ? `${message} (${details})` : message;
}

async function handleCategorySaveConflict(result) {
  const reloadConfirm = await showConfirmModal({
    icon: 'ƒsÿ‹,?',
    title: 'Conflict Detected',
    message: `Categories have been modified by ${result.lastModifiedBy || 'another user'}.\n\nYour changes cannot be saved. Would you like to reload and lose your changes?`,
    confirmText: 'Reload',
    cancelText: 'Cancel',
    confirmStyle: 'btn-warning'
  });

  if (reloadConfirm) {
    await loadCategories();
    clearUnsaved();
  }
}

// Toggle expand/collapse for subcategory
function toggleExpand(itemKey) {
  if (expandedItems.has(itemKey)) {
    expandedItems.delete(itemKey);
  } else {
    expandedItems.add(itemKey);
  }
  renderCategoryContent();
}

// Update culture-specific path
function updateCulturePath(catName, idx, cultureCode, value) {
  const item = categoriesData[currentRegion][catName][idx];
  if (!item.paths) {
    item.paths = {};
    // Migrate old path to all cultures if it exists
    const cultures = getCulturesForRegion(currentRegion);
    const defaultPath = item.path || '/productstore/path';
    cultures.forEach(c => {
      item.paths[c.code] = defaultPath;
    });
  }
  item.paths[cultureCode] = normalizeCategoryPath(value);
  markUnsaved();
}

// Add new category
function addCategory() {
  showModal('Add New Category', 'Category Name:', (name) => {
    if (categoriesData[currentRegion][name]) {
      alert('Category already exists!');
      return;
    }

    const cultures = getCulturesForRegion(currentRegion);
    const defaultPath = `/productstore/${name.toLowerCase().replace(/\s+/g, '-')}`;
    const paths = {};
    cultures.forEach(c => { paths[c.code] = defaultPath; });

    categoriesData[currentRegion][name] = [
      { label: 'Show All', paths }
    ];

    markUnsaved();
    renderUI();
    showStatus('success', `Category "${name}" added successfully!`);
  });
}

// Add new region  
function addRegion() {
  showModal('Add New Region', 'Region Name:', (name) => {
    if (categoriesData[name]) {
      alert('Region already exists!');
      return;
    }

    categoriesData[name] = {};
    currentRegion = name;
    markUnsaved();
    renderUI();
    showStatus('success', `Region "${name}" created successfully!`);
  });
}

// Show modal
let modalCallback = null;
function showModal(title, label, callback) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-label').textContent = label;
  document.getElementById('modal-input').value = '';
  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('modal-input').focus();
  modalCallback = callback;
}

// Close modal
function closeModal(event) {
  if (event && event.target.className !== 'modal-overlay') return;
  document.getElementById('modal-overlay').classList.remove('active');
  modalCallback = null;
}

// Submit modal
function submitModal() {
  const value = document.getElementById('modal-input').value.trim();
  if (!value) {
    alert('Please enter a name');
    return;
  }

  if (modalCallback) {
    modalCallback(value);
  }

  closeModal();
}

// Show confirmation modal (returns promise)
function showConfirmModal(options) {
  const {
    icon = '⚠️',
    title = 'Confirm Action',
    message = '',
    confirmText = 'Continue',
    cancelText = 'Cancel',
    confirmStyle = 'btn-primary'
  } = options;

  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal-overlay');
    const iconEl = document.getElementById('confirm-modal-icon');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const confirmBtn = document.getElementById('confirm-modal-confirm');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    // Set content
    iconEl.textContent = icon;
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    // Set button style
    confirmBtn.className = `btn ${confirmStyle}`;

    // Show modal
    overlay.classList.add('active');

    // Handle confirm
    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    // Handle cancel
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Handle overlay click
    const handleOverlayClick = (e) => {
      if (e.target === overlay) {
        handleCancel();
      }
    };

    // Cleanup function
    const cleanup = () => {
      overlay.classList.remove('active');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      overlay.removeEventListener('click', handleOverlayClick);
    };

    // Add event listeners
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleOverlayClick);
  });
}

// Rename category
function renameCategory(oldName, newName) {
  if (!newName || oldName === newName) return;

  if (categoriesData[currentRegion][newName]) {
    alert('Category name already exists!');
    renderUI();
    return;
  }

  categoriesData[currentRegion][newName] = categoriesData[currentRegion][oldName];
  delete categoriesData[currentRegion][oldName];
  markUnsaved();
  renderUI();
}

// Delete category
async function deleteCategory(catName) {
  // First warning: affects this app instance
  const continueDelete = await showConfirmModal({
    icon: '⚠️',
    title: 'WARNING',
    message: 'Deleting this category updates the categories for this app instance.\n\nDo you want to continue?',
    confirmText: 'Continue',
    cancelText: 'Cancel',
    confirmStyle: 'btn-warning'
  });

  if (!continueDelete) return;

  // Second confirmation: are you sure?
  const confirmDelete = await showConfirmModal({
    icon: '🗑️',
    title: 'Confirm Deletion',
    message: `Are you sure you want to delete category "${catName}" and all its subcategories?`,
    confirmText: 'Yes, Delete',
    cancelText: 'Cancel',
    confirmStyle: 'btn-danger'
  });

  if (!confirmDelete) return;

  delete categoriesData[currentRegion][catName];
  renderUI();

  // Auto-save the deletion
  try {
    showStatus('success', 'Saving changes...');

    const response = await fetch(api('/api/categories'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: categoriesData,
        version: currentVersion
      })
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 409) {
        await handleCategorySaveConflict(result);
        return;
      }
      throw new Error(getSaveErrorMessage(result));
    }

    clearUnsaved();
    showStatus('success', `✅ Category "${catName}" deleted successfully!`);
  } catch (err) {
    showStatus('error', 'Failed to save deletion: ' + err.message);
  }
}

// Add subcategory
function addSubcategory(catName) {
  const cultures = getCulturesForRegion(currentRegion);
  const categoryItems = categoriesData[currentRegion][catName];

  // Get the "Show All" item (first item) to use as base path
  const showAllItem = categoryItems.find(item => item.label === 'Show All') || categoryItems[0];

  const paths = {};
  cultures.forEach(c => {
    // Get the base path from the Show All item for this culture
    let basePath = '/productstore/category';
    if (showAllItem) {
      if (showAllItem.paths && showAllItem.paths[c.code]) {
        basePath = showAllItem.paths[c.code];
      } else if (showAllItem.path) {
        basePath = showAllItem.path;
      }
    }
    // Add placeholder subcategory suffix
    paths[c.code] = `${basePath}/new-subcategory`;
  });

  categoriesData[currentRegion][catName].push({
    label: 'New Subcategory',
    paths
  });
  markUnsaved();
  renderUI();
}

// Update subcategory
function updateSubcategory(catName, idx, field, value) {
  categoriesData[currentRegion][catName][idx][field] = value;
  markUnsaved();
}

// Delete subcategory
async function deleteSubcategory(catName, idx) {
  const subcategoryLabel = categoriesData[currentRegion][catName][idx].label;

  // First warning: affects this app instance
  const continueDelete = await showConfirmModal({
    icon: '⚠️',
    title: 'WARNING',
    message: 'Deleting this subcategory updates the categories for this app instance.\n\nDo you want to continue?',
    confirmText: 'Continue',
    cancelText: 'Cancel',
    confirmStyle: 'btn-warning'
  });

  if (!continueDelete) return;

  // Second confirmation: are you sure?
  const confirmDelete = await showConfirmModal({
    icon: '🗑️',
    title: 'Confirm Deletion',
    message: `Are you sure you want to delete the subcategory "${subcategoryLabel}"?`,
    confirmText: 'Yes, Delete',
    cancelText: 'Cancel',
    confirmStyle: 'btn-danger'
  });

  if (!confirmDelete) return;

  categoriesData[currentRegion][catName].splice(idx, 1);
  renderUI();

  // Auto-save the deletion
  try {
    showStatus('success', 'Saving changes...');

    const response = await fetch(api('/api/categories'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: categoriesData,
        version: currentVersion
      })
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 409) {
        await handleCategorySaveConflict(result);
        return;
      }
      throw new Error(getSaveErrorMessage(result));
    }

    clearUnsaved();
    showStatus('success', `✅ Subcategory "${subcategoryLabel}" deleted successfully!`);
  } catch (err) {
    showStatus('error', 'Failed to save deletion: ' + err.message);
  }
}

// Save categories
async function saveCategories() {
  // Show warning before saving if there are unsaved changes
  if (hasUnsavedChanges) {
    const confirmSave = await showConfirmModal({
      icon: '⚠️',
      title: 'WARNING',
      message: 'Saving these changes updates the categories for this app instance.\n\nDo you want to continue?',
      confirmText: 'Continue',
      cancelText: 'Cancel',
      confirmStyle: 'btn-warning'
    });

    if (!confirmSave) return;
  }

  try {
    showStatus('success', 'Saving categories...');

    const response = await fetch(api('/api/categories'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: categoriesData,
        version: currentVersion
      })
    });

    const result = await response.json();

    if (!response.ok) {
      // Handle conflict error (409)
      if (response.status === 409) {
        const reloadConfirm = await showConfirmModal({
          icon: '⚠️',
          title: 'Conflict Detected',
          message: `Categories have been modified by ${result.lastModifiedBy || 'another user'}.\n\nYour changes cannot be saved. Would you like to reload and lose your changes?`,
          confirmText: 'Reload',
          cancelText: 'Cancel',
          confirmStyle: 'btn-warning'
        });

        if (reloadConfirm) {
          await loadCategories();
          clearUnsaved();
        }
        return;
      }

      const details = Array.isArray(result.details) && result.details.length > 0
        ? result.details.map(detail => `${detail.path || '(root)'}: ${detail.message}`).join('; ')
        : '';
      const message = result.error || result.message || 'Failed to save';
      throw new Error(details ? `${message} (${details})` : message);
    }

    // Update version after successful save
    if (result.version) {
      currentVersion = result.version;
      lastModified = result.lastModified;
    }

    clearUnsaved();
    showStatus('success', 'Categories saved successfully. Changes will apply to this app instance.');
  } catch (err) {
    showStatus('error', 'Failed to save: ' + err.message);
  }
}

// Reload categories
async function reloadCategories() {
  if (confirm('Reload categories from file? Any unsaved changes will be lost.')) {
    await loadCategories();
    clearUnsaved();
    showStatus('success', 'Categories reloaded');
  }
}

// Show status message
function showStatus(type, message) {
  const existing = document.querySelector('.status-message');
  if (existing) existing.remove();

  const statusDiv = document.createElement('div');
  statusDiv.className = `status-message status-${type}`;
  statusDiv.textContent = message;
  document.body.appendChild(statusDiv);

  setTimeout(() => statusDiv.remove(), 3000);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadCategories();
});
