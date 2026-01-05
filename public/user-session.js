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
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  window.UserSession = {
    getId
  };
})();
