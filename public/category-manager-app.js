// category-manager-app.js - Category Management UI Logic

let categoriesData = {};
let currentRegion = null;
let expandedItems = new Set(); // Track which subcategory rows are expanded
let hasUnsavedChanges = false; // Track if there are unsaved changes

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
    const response = await fetch('/api/categories');
    if (!response.ok) throw new Error('Failed to load categories');

    categoriesData = await response.json();
    renderUI();
  } catch (err) {
    showStatus('error', 'Failed to load categories: ' + err.message);
  }
}

// Render the UI
function renderUI() {
  const regions = Object.keys(categoriesData);
  if (regions.length === 0) {
    document.getElementById('category-content').innerHTML = '<p>No categories found.</p>';
    return;
  }

  if (!currentRegion || !regions.includes(currentRegion)) {
    currentRegion = regions[0];
  }

  renderRegionTabs(regions);
  renderAddButtons();
  renderCategoryContent();
}

// Render add category/region buttons at top
function renderAddButtons() {
  const addButtonsContainer = document.getElementById('add-buttons');
  if (!addButtonsContainer) return;

  addButtonsContainer.innerHTML = `
    <button class="btn btn-primary" onclick="addCategory()">+ Add New Category</button>
    <button class="btn btn-secondary" onclick="addRegion()" style="margin-left: 12px;">+ Add New Region</button>
  `;
}

// Render region tabs
function renderRegionTabs(regions) {
  const tabsContainer = document.getElementById('region-tabs');
  tabsContainer.innerHTML = regions.map(region => `
    <button 
      class="region-tab ${region === currentRegion ? 'active' : ''}"
      onclick="switchRegion('${region}')"
    >
      ${region}
    </button>
  `).join('');
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

  const categoriesHTML = Object.entries(categories).map(([catName, items]) => `
    <div class="category-card">
      <div class="category-header">
        <input 
          type="text" 
          class="input-field category-name" 
          value="${escapeHtml(catName)}"
          onchange="renameCategory('${escapeHtml(catName)}', this.value)"
          style="font-size: 18px; font-weight: 600;"
        />
        <div class="category-actions">
          <button class="btn btn-small btn-secondary" onclick="addSubcategory('${escapeHtml(catName)}')">+ Add Subcategory</button>
          <button class="btn btn-small btn-danger" onclick="deleteCategory('${escapeHtml(catName)}')">Delete Category</button>
        </div>
      </div>
      
      <div class="subcategory-list">
        ${items.map((item, idx) => {
    const itemKey = `${catName}-${idx}`;
    const isExpanded = expandedItems.has(itemKey);
    const paths = item.paths || {};
    // For backward compatibility, if item.path exists but no paths, use it as default
    const defaultPath = item.path || '/productstore/path';

    return `
          <div class="subcategory-item-container">
            <div class="subcategory-item-header">
              <button class="expand-btn" onclick="toggleExpand('${escapeHtml(itemKey)}')">
                ${isExpanded ? '▼' : '▶'}
              </button>
              <input 
                type="text" 
                class="input-field subcategory-label" 
                value="${escapeHtml(item.label)}"
                onchange="updateSubcategory('${escapeHtml(catName)}', ${idx}, 'label', this.value)"
                placeholder="Label"
              />
              <span class="culture-count">${cultures.length} culture${cultures.length !== 1 ? 's' : ''}</span>
              <button class="btn btn-small btn-danger" onclick="deleteSubcategory('${escapeHtml(catName)}', ${idx})">Delete</button>
            </div>
            ${isExpanded ? `
            <div class="culture-paths">
              ${cultures.map(culture => `
                <div class="culture-path-row">
                  <span class="culture-label">${culture.label}</span>
                  <input 
                    type="text" 
                    class="input-field culture-path-input" 
                    value="${escapeHtml(paths[culture.code] || defaultPath)}"
                    onchange="updateCulturePath('${escapeHtml(catName)}', ${idx}, '${culture.code}', this.value)"
                    placeholder="/productstore/path"
                  />
                </div>
              `).join('')}
            </div>
            ` : ''}
          </div>
        `;
  }).join('')}
      </div>
    </div>
  `).join('');

  contentContainer.innerHTML = categoriesHTML;
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
  item.paths[cultureCode] = value;
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
function deleteCategory(catName) {
  if (!confirm(`Delete category "${catName}" and all its subcategories?`)) return;

  delete categoriesData[currentRegion][catName];
  markUnsaved();
  renderUI();
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
function deleteSubcategory(catName, idx) {
  if (!confirm('Delete this subcategory?')) return;

  categoriesData[currentRegion][catName].splice(idx, 1);
  markUnsaved();
  renderUI();
}

// Save categories
async function saveCategories() {
  try {
    showStatus('success', 'Saving categories...');

    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(categoriesData)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Failed to save');
    }

    clearUnsaved();
    showStatus('success', '✅ Categories saved successfully! Changes will apply to testers.');
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

// Escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadCategories();
});
