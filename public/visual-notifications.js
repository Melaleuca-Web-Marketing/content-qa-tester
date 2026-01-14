// visual-notifications.js - In-page notification fallback for HTTP environments

/**
 * Show a prominent in-page notification when desktop notifications are unavailable
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} type - 'success' or 'error'
 * @param {number} duration - Duration in ms (default: 8000)
 */
function showVisualNotification(title, message, type = 'success', duration = 8000) {
  // Check if desktop notifications are available
  const canUseDesktopNotifications =
    'Notification' in window &&
    Notification.permission === 'granted';

  // If desktop notifications work, don't show visual notification
  if (canUseDesktopNotifications) {
    return;
  }

  // Create notification container if it doesn't exist
  let container = document.getElementById('visual-notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'visual-notification-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      max-width: 400px;
    `;
    document.body.appendChild(container);
  }

  // Create notification element
  const notification = document.createElement('div');
  notification.className = `visual-notification visual-notification-${type}`;

  const bgColor = type === 'error' ? '#ef4444' : '#10b981';
  const icon = type === 'error' ? '❌' : '✅';

  notification.style.cssText = `
    background: ${bgColor};
    color: white;
    padding: 16px 20px;
    border-radius: 8px;
    margin-bottom: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideInRight 0.3s ease-out;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  `;

  notification.innerHTML = `
    <div style="display: flex; align-items: start; gap: 12px;">
      <div style="font-size: 24px; flex-shrink: 0;">${icon}</div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">${escapeHtml(title)}</div>
        <div style="font-size: 14px; opacity: 0.95; word-wrap: break-word;">${escapeHtml(message)}</div>
      </div>
      <button style="
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        flex-shrink: 0;
        font-size: 16px;
        line-height: 1;
      " onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  // Add progress bar
  const progressBar = document.createElement('div');
  progressBar.style.cssText = `
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    background: rgba(255,255,255,0.4);
    width: 100%;
    animation: shrinkWidth ${duration}ms linear;
  `;
  notification.appendChild(progressBar);

  // Add to container
  container.appendChild(notification);

  // Auto-dismiss
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => notification.remove(), 300);
  }, duration);

  // Click to dismiss
  notification.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') {
      notification.remove();
    }
  });

  // Focus window to bring attention (if minimized)
  window.focus();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add CSS animations
if (!document.getElementById('visual-notification-styles')) {
  const style = document.createElement('style');
  style.id = 'visual-notification-styles';
  style.textContent = `
    @keyframes slideInRight {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes slideOutRight {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }

    @keyframes shrinkWidth {
      from { width: 100%; }
      to { width: 0%; }
    }

    .visual-notification:hover {
      transform: scale(1.02);
      transition: transform 0.2s;
    }
  `;
  document.head.appendChild(style);
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.showVisualNotification = showVisualNotification;
}
