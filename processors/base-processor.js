// base-processor.js - Abstract base class for processors

import { chromium } from 'playwright';
import { EventEmitter } from 'events';
import { TIMEOUTS } from '../utils/constants.js';

// Logging helper
export function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data) {
    console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export class BaseProcessor extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    // Default headless behavior can be overridden with TESTER_HEADLESS=0/false
    const envHeadless = process.env.TESTER_HEADLESS;
    this.defaultHeadless = envHeadless === undefined
      ? true
      : !['0', 'false', 'no'].includes(String(envHeadless).toLowerCase());
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isRunning = false;
    this.shouldStop = false;
    this.shouldResume = false;
    this.results = [];
    this.currentOptions = null;
    this.currentStatusType = null;
    this.currentStatusMessage = null;
    this.currentProgress = null; // Track current progress for status API
    this.on('progress', (data) => {
      this.currentProgress = data;
      if (data && (data.status || data.message)) {
        this.currentStatusMessage = data.status || data.message;
      }
    });
    log('info', `${name} processor initialized`);
  }

  // Launch browser with common settings
  async launchBrowser(options = {}) {
    log('info', 'Launching browser...');

    this.emit('progress', {
      type: 'browser',
      status: 'Launching browser'
    });

    // Default to headless (or env override), allow per-call override.
    const headless = options.headless !== undefined ? options.headless : this.defaultHeadless;
    this.browser = await chromium.launch({
      headless,
      args: options.args || ['--start-maximized']
    });

    log('info', 'Browser launched successfully');
    log('info', 'Browser version', await this.browser.version());

    return this.browser;
  }

  // Create browser context with viewport settings
  async createContext(contextOptions = {}) {
    log('info', 'Creating browser context...');

    const defaultOptions = {
      viewport: { width: 1920, height: 1080 }
    };

    this.context = await this.browser.newContext({
      ...defaultOptions,
      ...contextOptions
    });

    log('info', 'Browser context created');
    return this.context;
  }

  // Create a new page
  async createPage() {
    log('info', 'Creating new page...');
    this.page = await this.context.newPage();

    // Add console listener for debugging
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        log('debug', `[PAGE CONSOLE ERROR] ${msg.text()}`);
      }
    });

    this.page.on('pageerror', err => {
      log('debug', `[PAGE ERROR] ${err.message}`);
    });

    log('info', 'Page created successfully');
    return this.page;
  }

  // Handle Microsoft authentication flow for stage/uat environments
  async handleMicrosoftAuth(email, password, page = this.page, emitProgress = true) {
    if (!page || !email || !password) return false;

    const loginDomains = ['login.microsoftonline.com', 'login.windows.net'];
    const emailSelector = '#i0116';
    const passwordSelector = '#i0118';
    const primaryButtonSelector = '#idSIButton9';
    const staySignedInSelector = '#KmsiDescription';
    const staySignedInNoSelector = '#idBtn_Back';

    const url = page.url();
    const isMicrosoftLogin = loginDomains.some(domain => url.includes(domain));
    const emailInput = page.locator(emailSelector);
    const passwordInput = page.locator(passwordSelector);
    const clickPrimaryButton = async () => {
      const primaryButton = page.locator(primaryButtonSelector).first();
      await primaryButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      await primaryButton.click({ timeout: 10000 }).catch(() => { });
    };
    const readAuthError = async () => {
      const selectors = ['#usernameError', '#passwordError', '#errorText', 'div[role="alert"]'];
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        const isVisible = await locator.isVisible().catch(() => false);
        if (!isVisible) continue;
        const text = (await locator.innerText().catch(() => '')).trim();
        if (text) return text;
      }
      return null;
    };

    if (!isMicrosoftLogin) {
      const emailCount = await emailInput.count();
      const passwordCount = await passwordInput.count();
      if (emailCount === 0 && passwordCount === 0) {
        return false;
      }
    }

    if ((await emailInput.count()) === 0 && (await passwordInput.count()) === 0) {
      await page.waitForSelector(emailSelector, { timeout: 10000 }).catch(() => { });
    }

    if (emitProgress) {
      this.emit('progress', { message: 'Microsoft sign-in: entering email...' });
    }

    if ((await emailInput.count()) > 0) {
      await emailInput.fill(email);
      await clickPrimaryButton();
      await page.waitForTimeout(800);

      const emailError = await readAuthError();
      if (emailError) {
        throw new Error(`Microsoft authentication failed: ${emailError}`);
      }
    }

    if ((await passwordInput.count()) === 0) {
      await page.waitForSelector(passwordSelector, { timeout: 20000 }).catch(() => { });
    }

    if ((await passwordInput.count()) > 0) {
      if (emitProgress) {
        this.emit('progress', { message: 'Microsoft sign-in: entering password...' });
      }
      await passwordInput.fill(password);
      await clickPrimaryButton();
      await page.waitForTimeout(800);

      const passwordStillVisible = await passwordInput.first().isVisible().catch(() => false);
      if (passwordStillVisible) {
        await passwordInput.press('Enter').catch(() => { });
        await page.waitForTimeout(800);
      }

      const passwordError = await readAuthError();
      if (passwordError) {
        throw new Error(`Microsoft authentication failed: ${passwordError}`);
      }
    }

    const staySignedIn = await page.waitForSelector(staySignedInSelector, { timeout: 5000 }).catch(() => null);
    if (staySignedIn) {
      if (emitProgress) {
        this.emit('progress', { message: 'Microsoft sign-in: confirming stay signed in...' });
      }
      const yesButton = await page.$(primaryButtonSelector);
      if (yesButton) {
        await clickPrimaryButton();
        await page.waitForTimeout(800);
      } else {
        const noButton = await page.$(staySignedInNoSelector);
        if (noButton) {
          await noButton.click().catch(() => { });
          await page.waitForTimeout(800);
        }
      }
    }

    await page.waitForTimeout(1000);

    const stillOnMicrosoft = loginDomains.some(domain => page.url().includes(domain));
    const emailVisible = await emailInput.first().isVisible().catch(() => false);
    const passwordVisible = await passwordInput.first().isVisible().catch(() => false);

    if (stillOnMicrosoft && (emailVisible || passwordVisible)) {
      const authError = await readAuthError();
      if (authError) {
        throw new Error(`Microsoft authentication failed: ${authError}`);
      }
      throw new Error('Microsoft authentication failed');
    }

    return true;
  }

  /**
   * Consolidated Microsoft authentication handler for stage/UAT environments
   * Detects Microsoft login and handles it automatically (with credentials) or manually
   * @param {string} environment - Environment name (stage/uat/production)
   * @param {string} username - Optional username for automatic auth
   * @param {string} password - Optional password for automatic auth
   * @param {object} page - Page object (defaults to this.page)
   * @returns {Promise<boolean>} True if Microsoft auth was handled, false if not on Microsoft login
   */
  async handleMicrosoftAuthIfNeeded(environment, username = null, password = null, page = this.page) {
    if (!page) return false;

    // Only check for Microsoft auth on stage/UAT environments
    if (environment !== 'stage' && environment !== 'uat') {
      return false;
    }

    const loginDomains = ['login.microsoftonline.com', 'login.windows.net'];
    const url = page.url();
    const isMicrosoftLogin = loginDomains.some(domain => url.includes(domain));

    if (!isMicrosoftLogin) {
      return false;
    }

    log('info', 'Detected Microsoft login page');

    // If credentials provided, try automatic authentication
    if (username && password) {
      log('info', 'Attempting automatic Microsoft authentication...');
      try {
        const result = await this.handleMicrosoftAuth(username, password, page, true);
        if (result) {
          log('info', 'Automatic Microsoft authentication successful');
          return true;
        }
      } catch (err) {
        log('warn', 'Automatic Microsoft authentication failed, falling back to manual', { error: err.message });
      }
    }

    // Fall back to manual authentication
    log('info', 'Waiting for manual Microsoft sign-in...');
    await this.waitForManualAuth(environment.toUpperCase());
    return true;
  }

  async loginToMelaleuca({ baseUrl, environment, username, password, selectors = {}, timeouts = {} }) {
    if (!this.page) {
      return { success: false, error: 'Login page not initialized' };
    }

    if (!baseUrl) {
      return { success: false, error: 'Invalid base URL' };
    }

    const loginSelectors = {
      homePageSignInButton: selectors.homePageSignInButton,
      loginUsernameField: selectors.loginUsernameField || selectors.username,
      loginPasswordField: selectors.loginPasswordField || selectors.password,
      loginSubmitButton: selectors.loginSubmitButton || selectors.loginButton,
      loginErrorMessage: selectors.loginErrorMessage || selectors.errorMessage
    };

    if (!loginSelectors.homePageSignInButton || !loginSelectors.loginUsernameField
      || !loginSelectors.loginPasswordField || !loginSelectors.loginSubmitButton) {
      return { success: false, error: 'Login selectors not configured' };
    }

    const pageLoadTimeout = timeouts.pageLoad || 30000;
    const loginWait = timeouts.loginWait || 10000;

    log('info', 'Starting login process...');
    log('info', 'Step 1: Navigating to home page...', { url: baseUrl });

    this.emit('progress', {
      type: 'login',
      status: 'Navigating to home page'
    });

    try {
      await this.page.goto(baseUrl, {
        waitUntil: 'load',
        timeout: pageLoadTimeout
      });

      await this.page.waitForTimeout(2000);

      await this.handleMicrosoftAuthIfNeeded(environment, username, password);

      log('info', 'Step 2: Looking for Sign In button on home page...');
      this.emit('progress', {
        type: 'login',
        status: 'Clicking Sign In button'
      });

      const tryClickSignIn = async () => {
        try {
          const signInLocator = this.page.locator(loginSelectors.homePageSignInButton).first();
          await signInLocator.waitFor({ state: 'visible', timeout: Math.min(pageLoadTimeout, 10000) });
          await signInLocator.click();
          return true;
        } catch (err) {
          log('warn', 'Primary Sign In button click failed', { error: err.message });
          return false;
        }
      };

      const tryClickSignInByRole = async (role) => {
        try {
          const locator = this.page.getByRole(role, { name: /sign in/i }).first();
          const count = await locator.count();
          if (!count) return false;
          await locator.waitFor({ state: 'visible', timeout: Math.min(pageLoadTimeout, 10000) });
          await locator.click();
          return true;
        } catch (err) {
          log('warn', `Fallback Sign In click failed (${role})`, { error: err.message });
          return false;
        }
      };

      let signInClicked = await tryClickSignIn();
      if (!signInClicked) {
        const originalViewport = this.page.viewportSize();
        const fallbackViewport = {
          width: Math.max(originalViewport?.width || 0, 1200),
          height: Math.max(originalViewport?.height || 0, 900)
        };
        log('info', 'Retrying Sign In click with desktop viewport', {
          from: originalViewport || null,
          to: fallbackViewport
        });
        await this.page.setViewportSize(fallbackViewport);
        await this.page.waitForTimeout(500);
        signInClicked = await tryClickSignIn();
      }

      if (!signInClicked) {
        signInClicked = await tryClickSignInByRole('link');
      }

      if (!signInClicked) {
        signInClicked = await tryClickSignInByRole('button');
      }

      if (!signInClicked) {
        log('error', 'Sign In button not found on home page');
        return { success: false, error: 'Sign In button not found on home page' };
      }

      log('info', 'Clicked Sign In button');

      log('info', 'Step 3: Waiting for login form to load...');
      this.emit('progress', {
        type: 'login',
        status: 'Waiting for login form'
      });

      await this.page.waitForSelector(loginSelectors.loginUsernameField, { timeout: Math.max(loginWait, 15000) });
      await this.page.waitForTimeout(1000);

      log('info', 'Step 4: Entering credentials...');
      this.emit('progress', {
        type: 'login',
        status: 'Entering credentials'
      });

      await this.page.fill(loginSelectors.loginUsernameField, username);
      await this.page.fill(loginSelectors.loginPasswordField, password);

      log('info', 'Step 5: Submitting login form...');
      this.emit('progress', {
        type: 'login',
        status: 'Submitting login'
      });

      await this.page.click(loginSelectors.loginSubmitButton);

      log('info', 'Step 6: Waiting for login to complete...');
      this.emit('progress', {
        type: 'login',
        status: 'Loading profile...'
      });

      try {
        await this.page.waitForURL((url) => !url.href.includes('singlesignon'), {
          timeout: 20000,
          waitUntil: 'load'
        });

        let checkUrl = this.page.url();
        if (checkUrl.includes('LoadProfile')) {
          this.emit('progress', {
            type: 'login',
            status: 'Loading profile, please wait...'
          });

          await this.page.waitForURL((url) => !url.href.includes('LoadProfile'), {
            timeout: 30000,
            waitUntil: 'load'
          });
        }

        await this.page.waitForTimeout(2000);
      } catch (e) {
        log('debug', 'URL wait completed or timed out, checking current state...', { error: e.message });
        await this.page.waitForTimeout(3000);
      }

      const currentUrl = this.page.url();
      log('info', 'Current URL after login attempt:', { url: currentUrl });

      if (loginSelectors.loginErrorMessage) {
        const errorEl = await this.page.$(loginSelectors.loginErrorMessage);
        if (errorEl) {
          const isVisible = await errorEl.isVisible();
          if (isVisible) {
            const errorText = await errorEl.textContent();
            const errorMessage = errorText.trim() || 'Invalid username or password';
            log('error', 'Login failed - error message displayed', { error: errorMessage });

            await this.waitForCredentialUpdate(errorMessage, environment);

            log('info', 'Retrying login with updated credentials');
            return await this.loginToMelaleuca({
              baseUrl,
              environment,
              username: this.currentOptions.username,
              password: this.currentOptions.password,
              selectors,
              timeouts
            });
          }
        }
      }

      if (!currentUrl.includes('login') && !currentUrl.includes('Login') && !currentUrl.includes('singlesignon')) {
        log('info', 'Login successful! Redirected to:', { url: currentUrl });
        return { success: true };
      }

      log('warn', 'Still on login page, login may have failed');
      const errorMessage = 'Invalid username or password';

      await this.waitForCredentialUpdate(errorMessage, environment);

      log('info', 'Retrying login with updated credentials');
      return await this.loginToMelaleuca({
        baseUrl,
        environment,
        username: this.currentOptions.username,
        password: this.currentOptions.password,
        selectors,
        timeouts
      });

    } catch (err) {
      log('error', 'Login failed with error', { error: err.message });

      const errorMsg = err.message.toLowerCase();
      if (errorMsg.includes('invalid') || errorMsg.includes('password') || errorMsg.includes('credentials') || errorMsg.includes('authentication')) {
        await this.waitForCredentialUpdate(err.message, environment);
        log('info', 'Retrying login with updated credentials after error');
        return await this.loginToMelaleuca({
          baseUrl,
          environment,
          username: this.currentOptions.username,
          password: this.currentOptions.password,
          selectors,
          timeouts
        });
      }

      return { success: false, error: err.message };
    }
  }

  // Close browser and cleanup
  async closeBrowser() {
    log('info', 'Closing browser...');
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        log('error', 'Error closing browser', { error: err.message });
      } finally {
        this.browser = null;
        this.context = null;
        this.page = null;
        // Clear status type and message on cleanup
        this.currentStatusType = null;
        this.currentStatusMessage = null;
        this.currentProgress = null; // Clear progress on cleanup
        log('info', 'Browser cleanup complete');
      }
    }
  }

  // Abstract method - must be implemented by subclasses
  async start(options) {
    throw new Error('start() must be implemented by subclass');
  }

  // Stop the capture process
  stop() {
    log('info', 'Stop requested');
    if (this.isRunning) {
      this.shouldStop = true;
      this.emit('status', { type: 'stopping' });
    }
  }

  // Resume the capture process after manual auth
  resume() {
    log('info', 'Resume requested');
    if (this.isRunning) {
      this.shouldResume = true;
      this.emit('status', { type: 'resuming' });
    }
  }

  // Wait for user to manually authenticate in browser
  async waitForManualAuth(environment) {
    log('info', `Waiting for user to manually sign in to ${environment}...`);
    this.shouldResume = false;

    // Store current status
    this.currentStatusType = 'waiting-for-auth';
    this.currentStatusMessage = `Please sign in to ${environment} in the browser window, then click "Resume Capture"`;

    this.emit('status', {
      type: 'waiting-for-auth',
      message: this.currentStatusMessage
    });

    // Poll until user clicks resume or stop (with timeout)
    const timeout = TIMEOUTS.MANUAL_AUTH;
    const start = Date.now();

    while (!this.shouldResume && !this.shouldStop) {
      if (Date.now() - start > timeout) {
        log('error', 'Manual authentication timeout after 5 minutes');
        throw new Error('Manual authentication timeout after 5 minutes. Please try again.');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (this.shouldStop) {
      log('info', 'User cancelled during manual auth');
      throw new Error('Cancelled by user during manual authentication');
    }

    log('info', 'User resumed after manual auth');
    this.shouldResume = false;

    // Clear waiting-for-auth status
    this.currentStatusType = null;
    this.currentStatusMessage = null;

    // Wait a moment for any post-auth redirects to complete
    await this.page.waitForTimeout(2000);
  }

  /**
   * Pauses job and waits for user to update credentials and resume
   * @param {string} errorMessage - The authentication error message
   * @param {string} environment - The environment that failed
   */
  async waitForCredentialUpdate(errorMessage, environment) {
    log('warn', `Authentication failed: ${errorMessage}. Pausing for credential update...`);
    this.shouldResume = false;

    // Store current status
    this.currentStatusType = 'waiting-for-credentials';
    this.currentStatusMessage = `Authentication failed: ${errorMessage}. Update credentials and click Resume.`;

    this.emit('status', {
      type: 'waiting-for-credentials',
      message: this.currentStatusMessage,
      error: errorMessage,
      environment: environment
    });

    // Poll until user clicks resume or stop (with 10-minute timeout)
    const timeout = 10 * 60 * 1000;
    const start = Date.now();

    while (!this.shouldResume && !this.shouldStop) {
      if (Date.now() - start > timeout) {
        log('error', 'Credential update timeout after 10 minutes');
        throw new Error('Credential update timeout after 10 minutes. Please try again.');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (this.shouldStop) {
      log('info', 'User cancelled during credential update');
      throw new Error('Cancelled by user during credential update');
    }

    log('info', 'User resumed with updated credentials');
    this.shouldResume = false;

    // Set resuming status
    this.currentStatusType = 'resuming';
    this.currentStatusMessage = 'Retrying authentication with updated credentials...';

    // Brief delay before retry
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Updates credentials for retry
   * @param {string} username - New username
   * @param {string} password - New password
   */
  updateCredentials(username, password) {
    if (this.currentOptions) {
      this.currentOptions.username = username;
      this.currentOptions.password = password;
      log('info', 'Credentials updated, ready for retry');
    }
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      resultsCount: this.results.length,
      options: this.currentOptions,
      statusType: this.currentStatusType,
      message: this.currentStatusMessage,
      progress: this.currentProgress // Include current progress for dashboard polling
    };
  }

  // Get results
  getResults() {
    return this.results;
  }

  // Clear results
  clearResults() {
    this.results = [];
  }

  // Helper to emit status
  emitStatus(data) {
    this.emit('status', data);
  }

  // Helper to emit progress
  emitProgress(data) {
    // Store progress for status API polling
    this.currentProgress = data;
    this.emit('progress', data);
  }

  // Helper to emit error
  emitError(data) {
    this.emit('error', data);
  }
}
