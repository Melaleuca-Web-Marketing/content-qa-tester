// category-manager-app.js - Category Management UI Logic

let categoriesData = {};
let currentRegion = null;

// Theme management
function initTheme() {
  const theme = localStorage.getItem('theme') || 'light';
  if (theme === 'dark') {
    document.body.classList.add('dark-mode');
    document.getElementById('theme-icon').textContent = '☀️';
    document.getElementById('theme-text').textContent = 'Light';
  }
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
  document.getElementById('theme-text').textContent = isDark ? 'Light' : 'Dark';
}

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
        ${items.map((item, idx) => `
          <div class="subcategory-item">
            <input 
              type="text" 
              class="input-field" 
              value="${escapeHtml(item.label)}"
              onchange="updateSubcategory('${escapeHtml(catName)}', ${idx}, 'label', this.value)"
              placeholder="Label"
            />
            <input 
              type="text" 
              class="input-field" 
              value="${escapeHtml(item.path)}"
              onchange="updateSubcategory('${escapeHtml(catName)}', ${idx}, 'path', this.value)"
              placeholder="/productstore/path"
            />
            <button class="btn btn-small btn-danger" onclick="deleteSubcategory('${escapeHtml(catName)}', ${idx})">Delete</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  contentContainer.innerHTML = categoriesHTML;
}

// Add new category
function addCategory() {
  showModal('Add New Category', 'Category Name:', (name) => {
    if (categoriesData[currentRegion][name]) {
      alert('Category already exists!');
      return;
    }

    categoriesData[currentRegion][name] = [
      { label: 'Show All', path: `/productstore/${name.toLowerCase().replace(/\s+/g, '-')}` }
    ];

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
  renderUI();
}

// Delete category
function deleteCategory(catName) {
  if (!confirm(`Delete category "${catName}" and all its subcategories?`)) return;

  delete categoriesData[currentRegion][catName];
  renderUI();
}

// Add subcategory
function addSubcategory(catName) {
  categoriesData[currentRegion][catName].push({
    label: 'New Subcategory',
    path: '/productstore/path'
  });
  renderUI();
}

// Update subcategory
function updateSubcategory(catName, idx, field, value) {
  categoriesData[currentRegion][catName][idx][field] = value;
}

// Delete subcategory
function deleteSubcategory(catName, idx) {
  if (!confirm('Delete this subcategory?')) return;

  categoriesData[currentRegion][catName].splice(idx, 1);
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

    showStatus('success', '✅ Categories saved successfully! Changes will apply to testers.');
  } catch (err) {
    showStatus('error', 'Failed to save: ' + err.message);
  }
}

// Reload categories
async function reloadCategories() {
  if (confirm('Reload categories from file? Any unsaved changes will be lost.')) {
    await loadCategories();
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
