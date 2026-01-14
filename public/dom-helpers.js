// dom-helpers.js - Safe DOM manipulation helpers to prevent XSS

/**
 * Safely create an element with text content
 * @param {string} tag - HTML tag name
 * @param {string} text - Text content (will be escaped)
 * @param {string} className - Optional class name
 * @returns {HTMLElement}
 */
function createTextElement(tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

/**
 * Safely create an element with attributes
 * @param {string} tag - HTML tag name
 * @param {Object} attributes - Attributes to set
 * @param {string} textContent - Optional text content
 * @returns {HTMLElement}
 */
function createElement(tag, attributes = {}, textContent = '') {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('data-')) {
      element.setAttribute(key, value);
    } else {
      element[key] = value;
    }
  }
  if (textContent) element.textContent = textContent;
  return element;
}

/**
 * Safely replace innerHTML with an array of elements
 * @param {HTMLElement} container - Container element
 * @param {HTMLElement[]} elements - Array of elements to append
 */
function replaceChildren(container, elements) {
  container.innerHTML = ''; // Clear existing content
  elements.forEach(el => container.appendChild(el));
}

/**
 * Safely create an option element for select dropdowns
 * @param {string} value - Option value
 * @param {string} label - Option label (will be escaped)
 * @param {boolean} selected - Whether option is selected
 * @returns {HTMLOptionElement}
 */
function createOption(value, label, selected = false) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  return option;
}

/**
 * Escape HTML to prevent XSS (for cases where we absolutely need HTML string)
 * @param {string} html - HTML string to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(html) {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.DOMHelpers = {
    createTextElement,
    createElement,
    replaceChildren,
    createOption,
    escapeHtml
  };
}
