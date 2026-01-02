// base-processor.js - Abstract base class for processors

import { chromium } from 'playwright';
import { EventEmitter } from 'events';

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
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isRunning = false;
    this.shouldStop = false;
    this.shouldResume = false;
    this.results = [];
    this.currentOptions = null;
    log('info', `${name} processor initialized`);
  }

  // Launch browser with common settings
  async launchBrowser(options = {}) {
    log('info', 'Launching browser...');

    this.emit('progress', {
      type: 'browser',
      status: 'Launching browser'
    });

    this.browser = await chromium.launch({
      headless: options.headless !== undefined ? options.headless : false,
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
      await primaryButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await primaryButton.click({ timeout: 10000 }).catch(() => {});
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
      await page.waitForSelector(emailSelector, { timeout: 10000 }).catch(() => {});
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
      await page.waitForSelector(passwordSelector, { timeout: 20000 }).catch(() => {});
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
        await passwordInput.press('Enter').catch(() => {});
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
          await noButton.click().catch(() => {});
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

  // Close browser and cleanup
  async closeBrowser() {
    log('info', 'Closing browser...');
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      log('info', 'Browser closed');
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

    this.emit('status', {
      type: 'waiting-for-auth',
      message: `Please sign in to ${environment} in the browser window, then click "Resume Capture"`
    });

    // Poll until user clicks resume or stop
    while (!this.shouldResume && !this.shouldStop) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (this.shouldStop) {
      log('info', 'User cancelled during manual auth');
      throw new Error('Cancelled by user during manual authentication');
    }

    log('info', 'User resumed after manual auth');
    this.shouldResume = false;

    // Wait a moment for any post-auth redirects to complete
    await this.page.waitForTimeout(2000);
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      resultsCount: this.results.length,
      options: this.currentOptions
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
    this.emit('progress', data);
  }

  // Helper to emit error
  emitError(data) {
    this.emit('error', data);
  }
}
