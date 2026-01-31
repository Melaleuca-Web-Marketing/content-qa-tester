// sku-processor.js - Playwright SKU processing engine

import { BaseProcessor, log, summarizeOptions } from './base-processor.js';
import { config, buildPdpUrl } from '../config.js';
import { getSingleton } from '../utils/singleton.js';

export class SkuProcessor extends BaseProcessor {
  constructor() {
    super('SKU');
  }

  // Perform login - goes to home page, clicks sign in, fills form
  async login(username, password, environment, region) {
    const baseUrl = config.environments[environment]?.[region];
    if (!baseUrl) {
      return { success: false, error: 'Invalid environment or region' };
    }

    log('info', 'Starting login process...');
    log('info', 'Step 1: Navigating to home page...', { url: baseUrl });

    this.emit('progress', {
      type: 'login',
      status: 'Navigating to home page'
    });

    try {
      // Step 1: Go to home page
      await this.page.goto(baseUrl, {
        waitUntil: 'load',
        timeout: config.sku.timeouts.pageLoad
      });

      // Wait for page to settle
      await this.page.waitForTimeout(2000);

      // Handle Microsoft authentication for stage/UAT environments (if intercepted)
      await this.handleMicrosoftAuthIfNeeded(environment, username, password);

      // Step 2: Click Sign In button on home page
      log('info', 'Step 2: Looking for Sign In button on home page...');
      this.emit('progress', {
        type: 'login',
        status: 'Clicking Sign In button'
      });

      const signInBtn = await this.page.$(config.sku.selectors.homePageSignInButton);
      if (!signInBtn) {
        log('error', 'Sign In button not found on home page');
        return { success: false, error: 'Sign In button not found on home page' };
      }

      await signInBtn.click();
      log('info', 'Clicked Sign In button');

      // Step 3: Wait for login form to appear
      log('info', 'Step 3: Waiting for login form to load...');
      this.emit('progress', {
        type: 'login',
        status: 'Waiting for login form'
      });

      await this.page.waitForSelector(config.sku.selectors.loginUsernameField, { timeout: 15000 });
      log('info', 'Login form loaded');

      // Wait a moment for form to be ready
      await this.page.waitForTimeout(1000);

      // Step 4: Fill in credentials
      log('info', 'Step 4: Entering credentials...');
      this.emit('progress', {
        type: 'login',
        status: 'Entering credentials'
      });

      log('info', 'Filling in username...');
      await this.page.fill(config.sku.selectors.loginUsernameField, username);

      log('info', 'Filling in password...');
      await this.page.fill(config.sku.selectors.loginPasswordField, password);

      // Step 5: Submit the form
      log('info', 'Step 5: Submitting login form...');
      this.emit('progress', {
        type: 'login',
        status: 'Submitting login'
      });

      await this.page.click(config.sku.selectors.loginSubmitButton);

      // Step 6: Wait for login to complete
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
        log('info', 'Left login page, checking for LoadProfile redirect...');

        let checkUrl = this.page.url();
        if (checkUrl.includes('LoadProfile')) {
          log('info', 'On LoadProfile page, waiting for redirect to home...');
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

      // Check for error message on the form
      const errorEl = await this.page.$(config.sku.selectors.loginErrorMessage);
      if (errorEl) {
        const isVisible = await errorEl.isVisible();
        if (isVisible) {
          const errorText = await errorEl.textContent();
          const errorMessage = errorText.trim() || 'Invalid username or password';
          log('error', 'Login failed - error message displayed', { error: errorMessage });

          // Pause and wait for credential update
          await this.waitForCredentialUpdate(errorMessage, environment);

          // Retry login with updated credentials
          log('info', 'Retrying login with updated credentials');
          return await this.login(this.currentOptions.username, this.currentOptions.password, this.currentOptions.environment, this.currentOptions.region);
        }
      }

      if (!currentUrl.includes('login') && !currentUrl.includes('Login') && !currentUrl.includes('singlesignon')) {
        log('info', 'Login successful! Redirected to:', { url: currentUrl });
        return { success: true };
      }

      // Still on login page - credentials likely incorrect
      log('warn', 'Still on login page, login may have failed');
      const errorMessage = 'Invalid username or password';

      // Pause and wait for credential update
      await this.waitForCredentialUpdate(errorMessage, environment);

      // Retry login with updated credentials
      log('info', 'Retrying login with updated credentials');
      return await this.login(this.currentOptions.username, this.currentOptions.password, this.currentOptions.environment, this.currentOptions.region);

    } catch (err) {
      log('error', 'Login failed with error', { error: err.message });

      // Check if it's a credential-related error
      const errorMsg = err.message.toLowerCase();
      if (errorMsg.includes('invalid') || errorMsg.includes('password') || errorMsg.includes('credentials') || errorMsg.includes('authentication')) {
        // Pause and wait for credential update
        await this.waitForCredentialUpdate(err.message, environment);

        // Retry login with updated credentials
        log('info', 'Retrying login with updated credentials after error');
        return await this.login(this.currentOptions.username, this.currentOptions.password, this.currentOptions.environment, this.currentOptions.region);
      }

      // Re-throw non-credential errors
      return { success: false, error: err.message };
    }
  }

  // Extract product data from page
  async extractProductData() {
    log('info', 'Extracting product data from page...');

    try {
      const result = await this.page.evaluate((selectors) => {
        const getText = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : null;
        };

        const getImageSrc = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.src : null;
        };

        const normalizeUrl = (url) => {
          if (!url) return null;
          const trimmed = url.trim();
          if (!trimmed) return null;
          if (trimmed.startsWith('//')) {
            return `${window.location.protocol}${trimmed}`;
          }
          return trimmed;
        };

        const filenameFromUrl = (url) => {
          const clean = url.split('?')[0];
          const parts = clean.split('/');
          return parts[parts.length - 1] || null;
        };

        const classifyImage = (filename) => {
          if (!filename) return 'Other';
          const lower = filename.toLowerCase();
          if (lower.includes('label')) return 'Label';
          if (/h-0*1/.test(lower)) return 'Hero';
          if (/h-0*[2-9]/.test(lower)) return 'Glamour';
          if (!/h-\d/.test(lower) && /_[a-z0-9]+\.(png|jpg|jpeg|gif)$/.test(lower)) return 'Label';
          return 'Other';
        };

        const hasImageWithSource = (root) => {
          if (!root) return false;
          const images = root.querySelectorAll('img');
          return Array.from(images).some((img) => {
            const src = img.getAttribute('src')
              || img.getAttribute('data-src')
              || img.getAttribute('srcset')
              || img.getAttribute('data-srcset');
            return src && src.trim();
          });
        };

        const hasInlineBackgroundImage = (root) => {
          if (!root) return false;
          const elements = root.querySelectorAll('[style]');
          return Array.from(elements).some((el) => {
            const style = el.getAttribute('style') || '';
            return /background-image\s*:\s*url\(/i.test(style);
          });
        };

        const hasSectionContent = (section, excludeSelector = null) => {
          if (!section) return false;
          const nodes = Array.from(section.children || []).filter((child) => {
            if (!excludeSelector) return true;
            return !child.matches(excludeSelector);
          });
          if (nodes.length === 0) return false;
          const text = nodes
            .map((node) => node.textContent || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length > 0) return true;
          return nodes.some((node) => hasImageWithSource(node) || hasInlineBackgroundImage(node));
        };

        const collectImageUrls = () => {
          const urlsByFilename = new Map();

          document.querySelectorAll('.m-prodMedia img').forEach((img) => {
            const src = img.getAttribute('src') || img.getAttribute('data-src');
            const normalized = normalizeUrl(src);
            if (!normalized) return;
            const filename = filenameFromUrl(normalized);
            if (!filename) return;
            const key = filename.toLowerCase();
            if (!urlsByFilename.has(key)) {
              urlsByFilename.set(key, normalized);
            }
          });

          return Array.from(urlsByFilename.values());
        };

        const name = getText(selectors.productName);
        const price = getText(selectors.productPrice);
        const description = getText(selectors.productDescription);
        const itemDetails = getText(selectors.itemNumber);
        const savingsText = getText(selectors.productSavings);

        const aboutSection = document.querySelector(selectors.aboutSection || '#section-pdp-about');
        const aboutHasContent = hasSectionContent(aboutSection, 'header');
        const ingredientsSection = document.querySelector(selectors.ingredientsSection || '#section-pdp-ingredients');
        const ingredientsHasLabel = ingredientsSection ? hasImageWithSource(ingredientsSection) : false;
        const ingredientsHasSmartIngredients = ingredientsSection
          ? Array.from(ingredientsSection.querySelectorAll('.m-packList__item, .m-packList__list li'))
            .some((item) => (item.textContent || '').trim().length > 0)
          : false;
        const ingredientsHasContent = ingredientsHasLabel || ingredientsHasSmartIngredients;

        let itemNumber = null;
        if (itemDetails) {
          const match = itemDetails.match(/Item:\s*(\d+)/i);
          if (match) itemNumber = match[1];
        }

        const imageUrls = collectImageUrls();
        const images = imageUrls
          .map((url) => {
            const filename = filenameFromUrl(url);
            if (!filename) return null;
            return {
              type: classifyImage(filename),
              filename,
              url
            };
          })
          .filter(Boolean);

        const savings = savingsText ? savingsText.replace(/\s+/g, ' ').trim() : null;
        const image = getImageSrc(selectors.productImage);
        const exists = !!name;

        return {
          exists,
          name,
          price,
          description,
          itemNumber,
          savings,
          aboutHasContent,
          ingredientsHasContent,
          ingredientsHasLabel,
          ingredientsHasSmartIngredients,
          images,
          image,
          pageTitle: document.title,
          url: window.location.href
        };
      }, config.sku.selectors);

      log('info', 'Product data extracted', { name: result.name, price: result.price, exists: result.exists });
      return result;
    } catch (err) {
      log('error', 'Failed to extract product data', { error: err.message });
      throw err;
    }
  }

  async expandConfiguratorAccordions() {
    const toggles = await this.page.$$(config.sku.selectors.configuratorAccordionToggle);
    if (toggles.length === 0) {
      return 0;
    }

    let opened = 0;
    for (const toggle of toggles) {
      const expanded = await toggle.getAttribute('aria-expanded');
      if (expanded === 'true') {
        continue;
      }

      try {
        await toggle.scrollIntoViewIfNeeded();
      } catch {
        // Ignore scroll failures
      }

      try {
        await toggle.click();
        opened += 1;
        await this.page.waitForTimeout(150);
      } catch {
        // Ignore toggles that are not clickable
      }
    }

    return opened;
  }

  async warmLazyImages() {
    const viewport = this.page.viewportSize();
    const step = viewport ? Math.floor(viewport.height * 0.75) : 600;
    const scrollHeight = await this.page.evaluate(() => document.body.scrollHeight);

    for (let y = 0; y < scrollHeight; y += step) {
      await this.page.evaluate((scrollTo) => window.scrollTo(0, scrollTo), y);
      await this.page.waitForTimeout(200);
    }

    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  async waitForImagesToLoad() {
    await this.page.evaluate(async ({ selector, timeoutMs }) => {
      const images = Array.from(document.querySelectorAll(selector));
      if (images.length === 0) {
        return;
      }

      const waitForImage = (img) => {
        if (img.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        });
      };

      await Promise.race([
        Promise.all(images.map(waitForImage)),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
    }, { selector: config.sku.selectors.productImages, timeoutMs: config.sku.timeouts.imageLoad });
  }

  async prepareForScreenshot() {
    await this.expandConfiguratorAccordions();
    await this.warmLazyImages();
    await this.waitForImagesToLoad();
  }

  async selectConfiguratorOptions() {
    const lists = await this.page.$$(config.sku.selectors.configuratorList);
    if (lists.length === 0) {
      return 0;
    }

    let selections = 0;
    for (const list of lists) {
      const hasSelection = await list.$(config.sku.selectors.configuratorSelectedOption);
      if (hasSelection) {
        continue;
      }

      const optionButtons = await list.$$(config.sku.selectors.configuratorOptionButton);
      for (const option of optionButtons) {
        const disabledAttr = await option.getAttribute('disabled');
        const ariaDisabled = (await option.getAttribute('aria-disabled')) || '';
        const dataDisabled = (await option.getAttribute('data-disabled')) || '';
        const className = (await option.getAttribute('class')) || '';
        const isDisabledClass = className.split(/\s+/).some((name) => name.includes('disabled'));
        const isAriaDisabled = ariaDisabled.toLowerCase() === 'true';
        const isDataDisabled = dataDisabled.toLowerCase() === 'true';

        if (disabledAttr !== null || isAriaDisabled || isDataDisabled || isDisabledClass) {
          continue;
        }

        try {
          await option.scrollIntoViewIfNeeded();
        } catch {
          // Ignore scroll failures
        }

        try {
          await option.click({ force: true });
          selections += 1;
          break;
        } catch {
          // Try the next option
        }
      }
    }

    return selections;
  }

  // Perform add to cart action
  async addToCart() {
    log('info', 'Attempting to add to cart...');

    try {
      const opened = await this.expandConfiguratorAccordions();
      const selections = await this.selectConfiguratorOptions();
      if (opened > 0 || selections > 0) {
        log('info', 'Prepared configurator selections', { opened, selections });
        await this.page.waitForTimeout(300);
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        const addToCartBtn = await this.page.$(config.sku.selectors.addToCartButton);

        if (!addToCartBtn) {
          log('warn', 'Add to Cart button not found');
          return { success: false, error: 'Add to Cart button not found' };
        }

        if (attempt > 0) {
          log('info', 'Retrying Add to Cart after selecting options...');
        } else {
          log('info', 'Clicking Add to Cart button...');
        }

        await addToCartBtn.click();

        try {
          log('info', 'Waiting for cart shelf or error message...');
          await Promise.race([
            this.page.waitForSelector(config.sku.selectors.cartShelf, {
              state: 'visible',
              timeout: config.sku.timeouts.shelfAppear
            }),
            this.page.waitForSelector(config.sku.selectors.errorMessage, {
              state: 'visible',
              timeout: config.sku.timeouts.shelfAppear
            })
          ]);
        } catch (e) {
          log('warn', 'Timeout waiting for cart response', { error: e.message });
        }

        const shelves = await this.page.$$(config.sku.selectors.cartShelf);
        let visibleShelf = null;
        for (const shelf of shelves) {
          try {
            if (await shelf.isVisible()) {
              visibleShelf = shelf;
              break;
            }
          } catch {
            // Ignore detached elements
          }
        }

        if (visibleShelf) {
          const headerEl = await visibleShelf.$(config.sku.selectors.addedToCartMessage)
            || await this.page.$(config.sku.selectors.addedToCartMessage);
          const message = headerEl ? await headerEl.textContent() : 'Added to cart';

          log('info', 'Cart shelf appeared - success', { message: message.trim() });

          const closeBtn = await visibleShelf.$(config.sku.selectors.closeShelfButton)
            || await this.page.$(config.sku.selectors.closeShelfButton);
          if (closeBtn) {
            await closeBtn.click();
            await this.page.waitForTimeout(500);
          }

          return { success: true, message: message.trim() };
        }

        const errorEl = await this.page.$(config.sku.selectors.errorMessage);
        if (errorEl) {
          const errorText = await errorEl.textContent();
          if (errorText && errorText.trim()) {
            const trimmedError = errorText.trim();
            if (attempt === 0) {
              const newSelections = await this.selectConfiguratorOptions();
              if (newSelections > 0) {
                log('info', 'Selected configurator options after error', { selections: newSelections });
                await this.page.waitForTimeout(300);
                continue;
              }
            }

            log('warn', 'Add to cart error message found', { error: trimmedError });
            return { success: false, error: trimmedError };
          }
        }

        log('warn', 'Cart shelf did not appear within timeout');
        return { success: false, error: 'Cart shelf did not appear within timeout' };
      }
    } catch (err) {
      log('error', 'Add to cart failed', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  // Process a single SKU
  async processSku(sku, currentIndex, total, culture) {
    const options = this.currentOptions;
    const url = buildPdpUrl(options.environment, options.region, culture, sku);
    const wantsTopScreenshot = options.topScreenshot === true;
    const wantsFullScreenshot = options.fullScreenshot && !wantsTopScreenshot;

    log('info', `Processing SKU ${currentIndex}/${total}`, { sku, culture, url });

    this.emit('progress', {
      type: 'sku-start',
      sku,
      culture,
      current: currentIndex,
      total,
      status: 'Loading page',
      url
    });

    const result = {
      sku,
      url,
      environment: options.environment,
      region: options.region,
      culture,
      timestamp: new Date().toISOString(),
      success: false,
      error: null,
      data: null,
      screenshot: null,
      screenshotType: null,
      addToCartResult: null
    };

    try {
      log('info', `Navigating to URL: ${url}`);

      const response = await this.page.goto(url, {
        waitUntil: 'load',
        timeout: config.sku.timeouts.pageLoad
      });

      log('info', 'Page navigation complete', {
        status: response?.status(),
        url: response?.url()
      });

      log('info', 'Waiting for product details section...');
      try {
        await this.page.waitForSelector('.o-productDetails', { timeout: 10000 });
        log('info', 'Product details section found');
      } catch (e) {
        log('warn', `Product details section not found for SKU ${sku}, continuing anyway...`);
      }

      log('info', `Waiting ${config.sku.timeouts.screenshotDelay}ms for page to settle...`);
      await this.page.waitForTimeout(config.sku.timeouts.screenshotDelay);

      // First SKU needs extra time for image gallery to fully initialize
      // (subsequent SKUs benefit from betweenSkus delay which allows the browser/page to warm up)
      if (currentIndex === 1 && wantsFullScreenshot) {
        log('info', 'First SKU - waiting for main product image to load...');
        try {
          await this.page.waitForFunction(() => {
            const mainImg = document.querySelector('.m-prodMedia__image');
            return mainImg && mainImg.complete && mainImg.naturalWidth > 0;
          }, { timeout: 3000 });
          await this.page.waitForTimeout(300);
          log('info', 'Main product image confirmed loaded');
        } catch (e) {
          log('warn', 'Main product image load check timed out, continuing anyway');
        }
      }

      if (this.shouldStop) {
        log('info', 'Capture cancelled by user');
        result.error = 'Capture cancelled';
        return result;
      }

      log('info', 'Extracting product data...');
      this.emit('progress', {
        type: 'sku-status',
        sku,
        culture,
        current: currentIndex,
        total,
        status: 'Extracting data',
        url
      });

      const productData = await this.extractProductData();

      if (!productData || !productData.exists) {
        log('error', 'Product not found or page did not load correctly', { productData });
        result.error = 'Product not found or page did not load correctly';
        result.data = productData;
        this.emit('progress', {
          type: 'sku-error',
          sku,
          culture,
          current: currentIndex,
          total,
          error: result.error,
          url
        });
        return result;
      }

      result.data = productData;
      log('info', 'Product data extracted successfully', { name: productData.name });

      // Capture screenshot
        if (wantsTopScreenshot || wantsFullScreenshot) {
          log('info', 'Preparing page for screenshot...');
          await this.prepareForScreenshot();
          if (currentIndex === 1) {
            log('info', 'First SKU - allowing extra time for images to settle before screenshot');
            await this.page.waitForTimeout(750);
          }
          this.emit('progress', {
            type: 'sku-status',
            sku,
            culture,
            current: currentIndex,
            total,
            status: 'Capturing screenshot',
            url
          });

            let screenshotBuffer = null;
            if (wantsTopScreenshot) {
              const topSection = await this.page.$(config.sku.selectors.pdpTopSection);
              if (topSection) {
                log('info', 'Capturing top PDP section screenshot...');
                screenshotBuffer = await topSection.screenshot({ type: 'jpeg', quality: 80 });
                result.screenshotType = 'top';
              } else {
                log('warn', 'Top PDP section not found, skipping screenshot');
              }
            }

            if (!screenshotBuffer && wantsFullScreenshot) {
              log('info', 'Capturing full page screenshot...');
              screenshotBuffer = await this.page.screenshot({
                fullPage: true,
                type: 'jpeg',
                quality: 80
              });
              result.screenshotType = 'full';
            }

            if (screenshotBuffer) {
              result.screenshot = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
              log('info', 'Screenshot captured successfully');
            }
        }

      if (this.shouldStop) {
        log('info', 'Capture cancelled by user');
        result.error = 'Capture cancelled';
        return result;
      }

      // Add to cart if requested
      if (options.addToCart) {
        log('info', 'Adding to cart...');
        this.emit('progress', {
          type: 'sku-status',
          sku,
          culture,
          current: currentIndex,
          total,
          status: 'Adding to cart',
          url
        });

        result.addToCartResult = await this.addToCart();
        log('info', 'Add to cart result', result.addToCartResult);
      }

      result.success = true;
      log('info', `SKU ${sku} processed successfully`);

      this.emit('progress', {
        type: 'sku-complete',
        sku,
        culture,
        current: currentIndex,
        total,
        status: 'Complete',
        url,
        data: {
          name: productData.name,
          price: productData.price,
          description: productData.description,
          aboutHasContent: productData.aboutHasContent,
          ingredientsHasContent: productData.ingredientsHasContent,
          ingredientsHasLabel: productData.ingredientsHasLabel,
          addToCart: result.addToCartResult
        }
      });

    } catch (err) {
      log('error', `Error processing SKU ${sku}`, { error: err.message, stack: err.stack });
      result.error = err.message;
      this.emit('progress', {
        type: 'sku-error',
        sku,
        culture,
        current: currentIndex,
        total,
        error: err.message,
        url
      });
    }

    return result;
  }

  // Start capture process
  async start(options) {
    log('info', '========================================');
    log('info', 'STARTING SKU CAPTURE PROCESS');
    log('info', '========================================');
    log('info', 'Options received', summarizeOptions(options));

    if (this.isRunning) {
      log('error', 'Capture already in progress');
      throw new Error('Capture already in progress');
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.results = [];
    const selectedCultures = Array.isArray(options.cultures) && options.cultures.length > 0
      ? options.cultures
      : (options.culture ? [options.culture] : []);
    this.currentOptions = {
      ...options,
      culture: selectedCultures[0] || options.culture || null,
      cultures: selectedCultures
    };

    const startTime = Date.now();
    const totalRuns = selectedCultures.length * options.skus.length;

    this.emitStatus( {
      type: 'started',
      skuCount: totalRuns,
      cultureCount: selectedCultures.length
    });

    try {
      // Launch browser
      await this.launchBrowser();
      await this.createContext({ viewport: { width: 1920, height: 1080 } });
      await this.createPage();

      // Login if credentials provided
      if (options.username && options.password) {
        log('info', 'Credentials provided, attempting login...');
        const loginResult = await this.login(options.username, options.password, options.environment, options.region);

        if (!loginResult.success) {
          log('error', 'Login failed, aborting capture', { error: loginResult.error });
          this.emit('error', { message: 'Login failed: ' + loginResult.error });
          throw new Error('Login failed: ' + loginResult.error);
        }

        log('info', 'Login successful, proceeding with SKU capture');
        await this.page.waitForTimeout(2000);
      }

      // Process each SKU
      log('info', `Processing ${options.skus.length} SKUs across ${selectedCultures.length} cultures...`);
      let runIndex = 0;
      outer: for (const culture of selectedCultures) {
        for (let i = 0; i < options.skus.length; i++) {
          if (this.shouldStop) {
            log('info', 'Capture stopped by user');
            this.emitStatus( { type: 'cancelled', results: this.results });
            break outer;
          }

          const sku = options.skus[i];
          log('info', `\n--- Processing SKU ${sku} (${culture}) ---`);
          const result = await this.processSku(sku, runIndex + 1, totalRuns, culture);
          this.results.push(result);
          runIndex += 1;

          // Wait between SKUs
          if (runIndex < totalRuns && !this.shouldStop) {
            log('info', `Waiting ${config.sku.timeouts.betweenSkus}ms before next SKU...`);
            await this.page.waitForTimeout(config.sku.timeouts.betweenSkus);
          }
        }
      }

    } catch (err) {
      log('error', 'FATAL ERROR during capture', { error: err.message, stack: err.stack });
      this.emit('error', { message: err.message });
    } finally {
      await this.closeBrowser();

      this.isRunning = false;

      const duration = Date.now() - startTime;
      const successCount = this.results.filter(r => r.success).length;
      const errorCount = this.results.filter(r => !r.success).length;

      log('info', '========================================');
      log('info', 'SKU CAPTURE PROCESS COMPLETE');
      log('info', '========================================');
      log('info', 'Results summary', { duration, successCount, errorCount, totalSkus: this.results.length });

      if (!this.shouldStop) {
        this.emitStatus( {
          type: 'completed',
          results: this.results,
          duration,
          successCount,
          errorCount
        });
      }
    }

    return {
      results: this.results,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Get or create the singleton SkuProcessor instance
 * @returns {SkuProcessor} The singleton instance
 */
export function getSkuProcessor() {
  return getSingleton('SkuProcessor', () => new SkuProcessor());
}
