// user-session.js - Per-browser user identity for scoping jobs/history

(function initUserSession() {
  const STORAGE_KEY = 'testerUserId';

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `user_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }

  function getId() {
    // Try localStorage first (persistent across browser restarts)
    try {
      let id = localStorage.getItem(STORAGE_KEY);
      if (!id) {
        id = generateId();
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    } catch (e) {
      console.warn('[UserSession] localStorage unavailable, trying sessionStorage:', e.message);

      // Fallback to sessionStorage (persistent during browser session)
      try {
        let id = sessionStorage.getItem(STORAGE_KEY);
        if (!id) {
          id = generateId();
          sessionStorage.setItem(STORAGE_KEY, id);
        }
        return id;
      } catch (e2) {
        console.warn('[UserSession] sessionStorage unavailable, using runtime-only ID:', e2.message);

        // Last resort: runtime-only ID (lost on page refresh)
        if (!window._runtimeUserId) {
          window._runtimeUserId = generateId();
          console.warn('[UserSession] Generated runtime-only ID (will not persist on refresh):', window._runtimeUserId);
        }
        return window._runtimeUserId;
      }
    }
  }

  function getStorageStatus() {
    try {
      localStorage.getItem('test');
      return 'localStorage';
    } catch (e) {
      try {
        sessionStorage.getItem('test');
        return 'sessionStorage';
      } catch (e2) {
        return 'runtime-only';
      }
    }
  }

  window.UserSession = {
    getId,
    getStorageStatus
  };
})();
