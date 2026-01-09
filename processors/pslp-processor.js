// pslp-processor.js - PSLP (Product Store Landing Page) testing engine

import { BaseProcessor, log } from './base-processor.js';
import { config, getBaseUrl, buildPslpUrl, validatePslpConfig } from '../config.js';
import { SCREEN } from '../utils/constants.js';

// Component extractors
import { extractHeroCarouselData } from './pslp-components/heroCarousel.js';
import { extractVariableWindowsData } from './pslp-components/variableWindows.js';
import { extractFullWidthBannerData } from './pslp-components/fullWidthBanner.js';
import { extractMonthlySpecialsData } from './pslp-components/monthlySpecials.js';
import { extractFeaturedCategoriesData } from './pslp-components/featuredCategories.js';
import { extractSeasonalCarouselData } from './pslp-components/seasonalCarousel.js';
import { extractBrandCTAWindowsData } from './pslp-components/brandCTAWindows.js';
import { extractProductCarouselData } from './pslp-components/productCarousel.js';

const componentExtractors = {
  heroCarousel: extractHeroCarouselData,
  variableWindows: extractVariableWindowsData,
  fullWidthBanner: extractFullWidthBannerData,
  monthlySpecials: extractMonthlySpecialsData,
  featuredCategories: extractFeaturedCategoriesData,
  seasonalCarousel: extractSeasonalCarouselData,
  brandCTAWindows: extractBrandCTAWindowsData,
  productCarousel: extractProductCarouselData
};

export class PSLPProcessor extends BaseProcessor {
  constructor() {
    super('PSLP');
  }

  async start(options) {
    log('info', '========================================');
    log('info', 'STARTING PSLP TEST PROCESS');
    log('info', '========================================');
    log('info', 'Options received', options);

    if (this.isRunning) {
      log('error', 'Test already in progress');
      throw new Error('Test already in progress');
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.results = [];
    this.currentOptions = options;

    const startTime = Date.now();

    // Validate options
    const errors = validatePslpConfig(options);
    if (errors.length > 0) {
      this.isRunning = false;
      this.emit('error', { message: errors.join(', ') });
      throw new Error(errors.join(', '));
    }

    const pslpUrl = buildPslpUrl(options.environment, options.region, options.culture);
    if (!pslpUrl) {
      this.isRunning = false;
      this.emit('error', { message: 'Could not build PSLP URL' });
      throw new Error('Could not build PSLP URL');
    }

    const baseUrl = getBaseUrl(options.environment, options.region);

    this.emit('status', {
      type: 'started',
      componentCount: options.components.length,
      screenshotCount: (options.screenWidths && options.screenWidths.length > 0)
        ? options.screenWidths.length
        : config.pslp.screenWidths.length
    });

    let screenshots = [];
    let componentReports = [];

    try {
      // Launch browser
      await this.launchBrowser();
      await this.createContext({ viewport: { width: 1920, height: 1080 } });
      await this.createPage();

      this.emit('progress', { type: 'navigation', status: 'Navigating to home page...' });
      await this.page.goto(baseUrl, { waitUntil: 'load', timeout: config.pslp.timeouts.pageLoad });
      await this.page.waitForTimeout(2000);

      if (this.shouldStop) throw new Error('Operation stopped by user');

      // Handle Microsoft authentication for stage/UAT environments
      const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(options.environment, options.username, options.password);
      if (msAuthHandled) {
        // Navigate back to the base URL after auth
        await this.page.goto(baseUrl, { waitUntil: 'load', timeout: config.pslp.timeouts.pageLoad });
        await this.page.waitForTimeout(2000);
      }

      if (this.shouldStop) throw new Error('Operation stopped by user');

      // Login
      this.emit('progress', { type: 'login', status: 'Opening login form...' });
      const signInButton = await this.page.$(config.pslp.selectors.login.homePageSignInButton);
      if (!signInButton) {
        throw new Error('Sign in button not found on home page');
      }
      await signInButton.click();
      await this.page.waitForSelector(config.pslp.selectors.login.username, { timeout: config.pslp.timeouts.loginWait });

      this.emit('progress', { type: 'login', status: 'Logging in...' });
      await this.page.fill(config.pslp.selectors.login.username, options.username);
      await this.page.fill(config.pslp.selectors.login.password, options.password);

      try {
        await Promise.all([
          this.page.waitForNavigation({ timeout: config.pslp.timeouts.loginWait }),
          this.page.click(config.pslp.selectors.login.loginButton)
        ]);
      } catch (e) {
        await this.page.waitForTimeout(3000);
      }

      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      await this.page.waitForTimeout(500);

      try {
        await this.page.waitForURL((url) => !url.href.includes('singlesignon'), {
          timeout: 20000,
          waitUntil: 'load'
        });

        if (this.page.url().includes('LoadProfile')) {
          await this.page.waitForURL((url) => !url.href.includes('LoadProfile'), {
            timeout: 30000,
            waitUntil: 'load'
          });
        }
      } catch (e) {
        await this.page.waitForTimeout(1000);
      }

      const loginErrorLocator = this.page.locator(config.pslp.selectors.login.errorMessage).first();
      if (await loginErrorLocator.isVisible().catch(() => false)) {
        const errorText = await loginErrorLocator.textContent().catch(() => '');
        const errorMessage = errorText?.trim() || 'Invalid username or password';
        log('error', 'Login failed - error message displayed', { error: errorMessage });

        // Pause and wait for credential update
        await this.waitForCredentialUpdate(errorMessage, options.environment);

        // Retry login with updated credentials
        log('info', 'Retrying login with updated credentials');

        // Fill in the new credentials and try again
        await this.page.fill(config.pslp.selectors.login.username, this.currentOptions.username);
        await this.page.fill(config.pslp.selectors.login.password, this.currentOptions.password);

        try {
          await Promise.all([
            this.page.waitForNavigation({ timeout: config.pslp.timeouts.loginWait }),
            this.page.click(config.pslp.selectors.login.loginButton)
          ]);
        } catch (e) {
          await this.page.waitForTimeout(3000);
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        await this.page.waitForTimeout(500);

        try {
          await this.page.waitForURL((url) => !url.href.includes('singlesignon'), {
            timeout: 20000,
            waitUntil: 'load'
          });

          if (this.page.url().includes('LoadProfile')) {
            await this.page.waitForURL((url) => !url.href.includes('LoadProfile'), {
              timeout: 30000,
              waitUntil: 'load'
            });
          }
        } catch (e) {
          await this.page.waitForTimeout(1000);
        }

        // Check again for errors after retry
        const retryErrorLocator = this.page.locator(config.pslp.selectors.login.errorMessage).first();
        if (await retryErrorLocator.isVisible().catch(() => false)) {
          const retryErrorText = await retryErrorLocator.textContent().catch(() => '');
          throw new Error(retryErrorText?.trim() || 'Login still failed after credential update');
        }
      }

      const loginFieldVisible = await this.page.locator(config.pslp.selectors.login.username).first()
        .isVisible()
        .catch(() => false);
      if (loginFieldVisible) {
        const errorMessage = 'Invalid username or password';
        log('warn', 'Login failed - still on login page');

        // Pause and wait for credential update
        await this.waitForCredentialUpdate(errorMessage, options.environment);

        // Retry login with updated credentials
        log('info', 'Retrying login with updated credentials');

        // Fill in the new credentials and try again
        await this.page.fill(config.pslp.selectors.login.username, this.currentOptions.username);
        await this.page.fill(config.pslp.selectors.login.password, this.currentOptions.password);

        try {
          await Promise.all([
            this.page.waitForNavigation({ timeout: config.pslp.timeouts.loginWait }),
            this.page.click(config.pslp.selectors.login.loginButton)
          ]);
        } catch (e) {
          await this.page.waitForTimeout(3000);
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        await this.page.waitForTimeout(500);

        try {
          await this.page.waitForURL((url) => !url.href.includes('singlesignon'), {
            timeout: 20000,
            waitUntil: 'load'
          });

          if (this.page.url().includes('LoadProfile')) {
            await this.page.waitForURL((url) => !url.href.includes('LoadProfile'), {
              timeout: 30000,
              waitUntil: 'load'
            });
          }
        } catch (e) {
          await this.page.waitForTimeout(1000);
        }

        // Check again if still on login page after retry
        const stillOnLoginPage = await this.page.locator(config.pslp.selectors.login.username).first()
          .isVisible()
          .catch(() => false);
        if (stillOnLoginPage) {
          throw new Error('Login still failed after credential update - still on login page');
        }
      }

      await this.dismissModalIfPresent();

      if (this.shouldStop) throw new Error('Operation stopped by user');

      // Navigate to PSLP
      this.emit('progress', { type: 'navigation', status: `Navigating to PSLP: ${pslpUrl}...` });
      await this.page.goto(pslpUrl, { waitUntil: 'domcontentloaded', timeout: config.pslp.timeouts.pageLoad });
      await this.page.waitForTimeout(1500);
      await this.dismissModalIfPresent();

      // Wait for components to load
      this.emit('progress', { type: 'step', step: 'Components', status: 'Waiting for components to load...' });
      await this.waitForComponentsToLoad(options.components);
      await this.dismissModalIfPresent();
      await this.primeMonthlySpecialsSlides(options.components);

      if (this.shouldStop) throw new Error('Operation stopped by user');

      const rawWidths = Array.isArray(options.screenWidths) && options.screenWidths.length > 0
        ? options.screenWidths
        : Array.isArray(options.widths) && options.widths.length > 0
          ? options.widths
          : config.pslp.screenWidths;

      const screenWidths = rawWidths.filter(w => typeof w === 'number' && w >= SCREEN.MIN_WIDTH && w <= SCREEN.MAX_WIDTH);

      if (screenWidths.length === 0) {
        throw new Error(`No valid screen widths provided (must be between ${SCREEN.MIN_WIDTH}-${SCREEN.MAX_WIDTH}px)`);
      }

      // Take screenshots at different widths
      this.emit('progress', { type: 'screenshot', status: 'Preparing screenshots...', current: 0, total: screenWidths.length });
      const totalSteps = screenWidths.length + options.components.length;
      let completedSteps = 0;

      await this.setScrollbarVisibility(true);
      try {
        for (const width of screenWidths) {
          if (this.shouldStop) throw new Error('Operation stopped by user');

          completedSteps++;
          const progress = (completedSteps / totalSteps) * 100;

          this.emit('progress', {
            type: 'screenshot',
            status: `Taking screenshot at ${width}px...`,
            progress,
            width,
            current: completedSteps,
            total: screenWidths.length
          });

          await this.page.setViewportSize({ width, height: 1080 });
          await this.applyCarouselStacking({ stackMonthlySpecials: width >= 768 });
          await this.injectCarouselSlideArrows(width);
          await this.normalizeTabletLayout(width);
          await this.prepareForScreenshot();
          await this.dismissModalIfPresent();

          const screenshotBuffer = await this.page.screenshot({
            fullPage: true,
            type: 'jpeg',
            quality: 80
          });

          screenshots.push({
            width,
            data: screenshotBuffer.toString('base64')
          });

          await this.page.waitForTimeout(500);
        }
      } finally {
        await this.setScrollbarVisibility(false);
      }

      // Extract component data
      for (const componentName of options.components) {
        if (this.shouldStop) throw new Error('Operation stopped by user');

        completedSteps++;
        const progress = (completedSteps / totalSteps) * 100;

        this.emit('progress', {
          type: 'component',
          status: `Extracting data: ${config.pslp.componentNames[componentName] || componentName}...`,
          progress,
          component: componentName,
          componentName: config.pslp.componentNames[componentName] || componentName,
          current: completedSteps - config.pslp.screenWidths.length,
          total: options.components.length
        });

        const extractor = componentExtractors[componentName];
        if (extractor) {
          await this.dismissModalIfPresent();
          const data = await extractor(this.page, config.pslp.selectors);
          componentReports.push({ name: componentName, data });

          // Emit result for activity feed
          this.emit('result', {
            component: componentName,
            componentName: config.pslp.componentNames[componentName] || componentName,
            data,
            success: true
          });
        } else {
          // Emit result for missing component
          this.emit('result', {
            component: componentName,
            componentName: config.pslp.componentNames[componentName] || componentName,
            success: false,
            error: 'Component extractor not found'
          });
        }

        await this.page.waitForTimeout(config.pslp.timeouts.betweenComponents);
      }

      await this.removeCarouselStacking();

      this.results = {
        environment: options.environment,
        region: options.region,
        culture: options.culture,
        screenshots,
        componentReports,
        options
      };

    } catch (err) {
      log('error', 'PSLP test error', { error: err.message, stack: err.stack });
      this.emit('error', { message: err.message });
    } finally {
      await this.closeBrowser();
      this.isRunning = false;

      const duration = Date.now() - startTime;

      if (!this.shouldStop && this.results) {
        log('info', '========================================');
        log('info', 'PSLP TEST COMPLETE');
        log('info', '========================================');

        this.emit('status', {
          type: 'completed',
          results: this.results,
          duration,
          screenshotCount: screenshots.length,
          componentCount: componentReports.length
        });
      } else {
        this.emit('status', {
          type: 'cancelled',
          duration
        });
      }
    }

    return {
      results: this.results,
      duration: Date.now() - startTime
    };
  }

  async dismissModalIfPresent() {
    const modal = this.page.locator(config.pslp.selectors.modal.dialog);

    for (let attempt = 0; attempt < 3; attempt++) {
      const count = await modal.count();
      if (count === 0) return false;

      const visible = await modal.first().isVisible().catch(() => false);
      if (!visible) return false;

      const closeButton = modal.locator(config.pslp.selectors.modal.closeButton);
      if (await closeButton.count()) {
        await closeButton.first().click({ timeout: 2000 }).catch(() => { });
      } else {
        await this.page.keyboard.press('Escape').catch(() => { });
      }

      await this.page.waitForTimeout(500);
      const remaining = await modal.count();
      if (remaining === 0 || !(await modal.first().isVisible().catch(() => false))) {
        return true;
      }
    }

    return true;
  }

  async waitForComponentsToLoad(components = []) {
    if (!components.length) return;

    const selectorsByComponent = {
      heroCarousel: config.pslp.selectors.heroCarousel?.slide,
      variableWindows: config.pslp.selectors.variableWindows?.window,
      fullWidthBanner: config.pslp.selectors.fullWidthBanner?.link,
      monthlySpecials: config.pslp.selectors.monthlySpecials?.card,
      featuredCategories: config.pslp.selectors.featuredCategories?.item,
      seasonalCarousel: config.pslp.selectors.seasonalCarousel?.slide,
      brandCTAWindows: config.pslp.selectors.brandCTAWindows?.link,
      productCarousel: config.pslp.selectors.productCarousel?.card
    };

    for (const componentName of components) {
      const selector = selectorsByComponent[componentName];
      if (!selector) {
        log('warn', `No selector configured for component: ${componentName}`);
        continue;
      }
      try {
        await this.page.waitForSelector(selector, { timeout: config.pslp.timeouts.componentLoad });
      } catch (e) {
        log('warn', `Component not found or failed to load: ${componentName}`, {
          selector,
          error: e.message
        });
        this.emit('progress', {
          type: 'component-missing',
          component: componentName,
          selector
        });
      }
    }
  }

  async primeMonthlySpecialsSlides(components = []) {
    if (!components.includes('monthlySpecials')) return;
    const selectorConfig = config.pslp.selectors?.monthlySpecials || {};
    const dotSelector = selectorConfig.dot || 'button[data-testid="button-monthlySpecialDot"], .o-monthlySpecial__dot';

    const component = await this.page.$('.o-monthlySpecial');
    if (!component) {
      return;
    }

    const dots = await this.page.$$(dotSelector);
    if (!dots.length) {
      return;
    }

    log('info', 'Priming Monthly Specials slides', { dotCount: dots.length });
    for (let i = 0; i < dots.length; i++) {
      await dots[i].evaluate((el) => el.click()).catch(() => { });
      await this.page.waitForTimeout(400);
    }
  }

  async setScrollbarVisibility(hidden) {
    await this.page.evaluate((hide) => {
      const styleId = 'pslp-hide-scrollbars';
      const existing = document.getElementById(styleId);
      if (hide) {
        if (existing) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          * { scrollbar-width: none !important; }
          *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
        `;
        document.head.appendChild(style);
      } else if (existing) {
        existing.remove();
      }
    }, hidden);
  }

  async prepareForScreenshot() {
    await this.hydrateLazySources();
    await this.warmLazyImages();
    await this.waitForImagesToLoad(15000);
  }

  async normalizeTabletLayout(width) {
    if (width < 768 || width >= 992) return;
    await this.page.evaluate(() => {
      const selectors = [
        'body > div',
        '#app',
        '#root',
        'main',
        '.o-page',
        '.o-page__content',
        '.o-productStore',
        '.o-productStore__content',
        '.o-layout',
        '.o-main'
      ];
      const elements = new Set();
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => elements.add(el));
      });

      elements.forEach((el) => {
        el.style.width = '100%';
        el.style.maxWidth = '100%';
        el.style.marginLeft = '0';
        el.style.marginRight = '0';
      });

      document.documentElement.style.width = '100%';
      document.documentElement.style.maxWidth = '100%';
      document.body.style.width = '100%';
      document.body.style.maxWidth = '100%';
    });
  }

  async hydrateLazySources() {
    await this.page.evaluate(() => {
      document.querySelectorAll('source').forEach((source) => {
        const dataSrcset = source.getAttribute('data-srcset');
        if (dataSrcset && !source.getAttribute('srcset')) {
          source.setAttribute('srcset', dataSrcset);
        }
      });

      document.querySelectorAll('img').forEach((img) => {
        const dataSrc = img.getAttribute('data-src');
        const dataSrcset = img.getAttribute('data-srcset');
        if (dataSrc && (!img.getAttribute('src') || img.getAttribute('src') === '')) {
          img.setAttribute('src', dataSrc);
        }
        if (dataSrcset && !img.getAttribute('srcset')) {
          img.setAttribute('srcset', dataSrcset);
        }
      });
    });
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
    await this.page.waitForTimeout(200);
  }

  async waitForImagesToLoad(timeoutMs) {
    await this.page.evaluate(async (timeout) => {
      const images = Array.from(document.images || []);
      if (images.length === 0) return;

      const waitForImage = (img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        });
      };

      await Promise.race([
        Promise.all(images.map(waitForImage)),
        new Promise((resolve) => setTimeout(resolve, timeout))
      ]);
    }, timeoutMs);
  }

  async applyCarouselStacking(options = {}) {
    const { stackMonthlySpecials = true } = options;
    await this.page.evaluate(({ stackMonthlySpecials }) => {
      let style = document.getElementById('pslp-carousel-stack');
      if (!style) {
        style = document.createElement('style');
        style.id = 'pslp-carousel-stack';
        document.head.appendChild(style);
      }

      const monthlySpecialsCss = stackMonthlySpecials ? `
        .o-monthlySpecial__list {
          transform: none !important;
          flex-direction: column !important;
          height: auto !important;
          overflow: visible !important;
          display: flex !important;
        }
        .o-monthlySpecial__slide {
          width: 100% !important;
          min-width: 100% !important;
          max-width: 100% !important;
          display: block !important;
          opacity: 1 !important;
          visibility: visible !important;
          position: static !important;
          transform: none !important;
          flex-shrink: 0 !important;
          margin-bottom: 20px !important;
        }
        .o-monthlySpecial__slide[aria-hidden="true"] {
          display: block !important;
          opacity: 1 !important;
          visibility: visible !important;
          height: auto !important;
        }
        .o-monthlySpecial {
          overflow: visible !important;
          height: auto !important;
        }
        .o-monthlySpecial__nav {
          display: none !important;
        }
        .o-monthlySpecial__header {
          position: static !important;
          margin-bottom: 24px !important;
        }
        .o-monthlySpecial__wrapper,
        .o-monthlySpecial__cards {
          height: auto !important;
        }
      ` : '';

      style.textContent = `
        .o-heroCarousel__slider .slick-slide.slick-cloned,
        .o-seasonalCarousel__slider .slick-slide.slick-cloned {
          display: none !important;
        }
        .o-heroCarousel__slider .slick-track,
        .o-seasonalCarousel__slider .slick-track {
          transform: none !important;
          width: 100% !important;
          display: block !important;
        }
        .o-heroCarousel__slider .slick-slide:not(.slick-cloned),
        .o-seasonalCarousel__slider .slick-slide:not(.slick-cloned) {
          display: block !important;
          float: none !important;
          height: auto !important;
        }
        .o-heroCarousel__slider .slick-list,
        .o-seasonalCarousel__slider .slick-list {
          overflow: visible !important;
          height: auto !important;
        }
        .o-heroCarousel__actions,
        .o-heroCarousel__arrows,
        .o-seasonalCarousel__slider .slick-arrow {
          display: none !important;
        }
        ${monthlySpecialsCss}
        .m-consentBanner {
          display: none !important;
        }
      `;
    }, { stackMonthlySpecials });
  }

  async injectCarouselSlideArrows(width) {
    // Only inject arrows for specific widths: 768, 992, 1210
    const arrowWidths = [768, 992, 1210];
    if (!arrowWidths.includes(width)) return;

    await this.page.evaluate((currentWidth) => {
      // Remove any previously injected arrows
      document.querySelectorAll('.pslp-injected-arrows').forEach(el => el.remove());

      // Width-specific sizing
      let buttonSize, marginSize;
      if (currentWidth === 1210) {
        buttonSize = 70;
        marginSize = 40;
      } else {
        // 768 and 992
        buttonSize = 50;
        marginSize = 20;
      }

      // Get all non-cloned hero carousel slides
      const slides = document.querySelectorAll('.o-heroCarousel .slick-slide:not(.slick-cloned)');

      slides.forEach(slide => {
        // Make the slide position relative for arrow positioning
        slide.style.position = 'relative';

        // Create arrow container
        const arrowContainer = document.createElement('div');
        arrowContainer.className = 'pslp-injected-arrows';
        arrowContainer.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          z-index: 10;
        `;

        // Common arrow button styles
        const arrowBaseStyle = `
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: ${buttonSize}px;
          height: ${buttonSize}px;
          background-color: white;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          pointer-events: none;
        `;

        // SVG size scales with button
        const svgSize = Math.round(buttonSize * 0.5);

        // Additional inset for 1210px width (moves entire button, not just content)
        const insetAdjustment = currentWidth === 1210 ? 20 : 0;

        // Left arrow (prev)
        const prevArrow = document.createElement('button');
        prevArrow.className = 'pslp-arrow-prev';
        prevArrow.setAttribute('aria-label', 'Previous Slide');
        prevArrow.style.cssText = arrowBaseStyle + `left: ${marginSize + insetAdjustment}px;`;
        prevArrow.innerHTML = `
          <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 18L9 12L15 6" stroke="#3a913f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;

        // Right arrow (next)
        const nextArrow = document.createElement('button');
        nextArrow.className = 'pslp-arrow-next';
        nextArrow.setAttribute('aria-label', 'Next Slide');
        nextArrow.style.cssText = arrowBaseStyle + `right: ${marginSize + insetAdjustment}px;`;
        nextArrow.innerHTML = `
          <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 18L15 12L9 6" stroke="#3a913f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;

        arrowContainer.appendChild(prevArrow);
        arrowContainer.appendChild(nextArrow);
        slide.appendChild(arrowContainer);

        // Create navigation dots container with play button
        const dotsNav = document.createElement('nav');
        dotsNav.className = 'pslp-injected-dots';
        dotsNav.style.cssText = `
          position: absolute;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 15;
          pointer-events: none;
        `;

        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'pslp-dots-container';
        dotsContainer.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          background-color: #000000;
          height: 30px;
          padding: 0 16px;
          border-radius: 15px;
        `;

        // Play button with SVG triangle
        const playButton = document.createElement('button');
        playButton.className = 'pslp-play-button';
        playButton.setAttribute('type', 'button');
        playButton.setAttribute('aria-label', 'Stop automatic slide show.');
        playButton.style.cssText = `
          width: 14px;
          height: 14px;
          background: transparent;
          border: none;
          cursor: pointer;
          margin-right: 8px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        `;
        playButton.innerHTML = `<svg width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0V12L10 6L0 0Z" fill="white"/></svg>`;

        // Dots list
        const dotsList = document.createElement('ul');
        dotsList.className = 'pslp-dots-list';
        dotsList.style.cssText = `
          display: flex !important;
          gap: 8px;
          list-style: none !important;
          list-style-type: none !important;
          margin: 0 !important;
          padding: 0 !important;
        `;

        // Create dots matching the number of slides
        const slideCount = slides.length;
        for (let i = 0; i < slideCount; i++) {
          const dotLi = document.createElement('li');
          dotLi.style.cssText = `list-style: none !important; margin: 0 !important; padding: 0 !important;`;

          const dotButton = document.createElement('button');
          dotButton.setAttribute('type', 'button');
          dotButton.setAttribute('aria-label', `Slide ${i + 1}`);
          dotButton.style.cssText = `
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: ${i === 0 ? 'white' : 'rgba(255, 255, 255, 0.5)'};
            border: none;
            font-size: 0;
            line-height: 0;
            text-indent: -9999px;
            overflow: hidden;
            cursor: pointer;
            padding: 0;
            margin: 0;
          `;

          dotLi.appendChild(dotButton);
          dotsList.appendChild(dotLi);
        }

        dotsContainer.appendChild(playButton);
        dotsContainer.appendChild(dotsList);
        dotsNav.appendChild(dotsContainer);
        slide.appendChild(dotsNav);
      });
    }, width);
  }

  async removeCarouselStacking() {
    await this.page.evaluate(() => {
      const style = document.getElementById('pslp-carousel-stack');
      if (style) style.remove();
    });
  }
}

// Singleton instance
let processorInstance = null;

export function getPSLPProcessor() {
  if (!processorInstance) {
    processorInstance = new PSLPProcessor();
  }
  return processorInstance;
}
