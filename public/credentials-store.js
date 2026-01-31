// credentials-store.js - Shared credential storage helpers

(function initCredentialStore() {
  const STORAGE_KEY = 'testerCredentialsV1';

  function normalizeStore(raw) {
    const base = { entries: {} };
    if (!raw || typeof raw !== 'object') return base;
    if (raw.entries && typeof raw.entries === 'object') {
      Object.entries(raw.entries).forEach(([key, entry]) => {
        base.entries[key] = {
          username: entry && entry.username ? entry.username : null
        };
      });
    }
    // Note: envSignIn storage removed for security - users must manually sign in to Stage/UAT
    return base;
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeStore(null);
      const parsed = JSON.parse(raw);
      const normalized = normalizeStore(parsed);
      // Strip any stored passwords from prior versions
      if (parsed && parsed.entries && typeof parsed.entries === 'object') {
        let hadPassword = false;
        Object.values(parsed.entries).forEach((entry) => {
          if (entry && entry.password) {
            hadPassword = true;
          }
        });
        if (hadPassword) {
          writeStore(normalized);
        }
      }
      return normalized;
    } catch (e) {
      return normalizeStore(null);
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function makeKey(environment, culture) {
    return `${environment}|${culture}`;
  }

  function getEntry(environment, culture) {
    if (!environment || !culture) return null;
    const store = readStore();
    return store.entries[makeKey(environment, culture)] || null;
  }

  function setEntry(environment, culture, entry) {
    if (!environment || !culture) return;
    const store = readStore();
    store.entries[makeKey(environment, culture)] = {
      username: entry.username || null
    };
    writeStore(store);
  }

  function removeEntry(environment, culture) {
    if (!environment || !culture) return;
    const store = readStore();
    delete store.entries[makeKey(environment, culture)];
    writeStore(store);
  }

  function listEntries() {
    const store = readStore();
    return Object.entries(store.entries).map(([key, entry]) => {
      const [environment, culture] = key.split('|');
      return {
        key,
        environment,
        culture,
        username: entry.username || null
      };
    });
  }

  // Environment sign-in functions removed for security
  // Users must manually sign in to Stage/UAT when prompted by the tool

  window.CredentialStore = {
    getEntry,
    setEntry,
    removeEntry,
    listEntries
  };
})();
