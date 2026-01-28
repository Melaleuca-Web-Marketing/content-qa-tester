// banner-processor.js - Playwright Banner processing engine

import { BaseProcessor, log } from './base-processor.js';
import { config, buildBannerUrl } from '../config.js';
import { detectImageLocale } from '../utils/image-utils.js';
import { MEMORY } from '../utils/constants.js';
import { validateSingleResult } from '../utils/excel-validation.js';
import { getMemoryUsageMB, checkMemoryThreshold } from '../utils/memory-monitor.js';
import { getSingleton } from '../utils/singleton.js';

export class BannerProcessor extends BaseProcessor {
  constructor() {
    super('Banner');
  }

  /**
   * Private method: Detect banner element and extract its information
   * @param {boolean} includeScrollOffset - Whether to include pageRect with scroll offsets
   * @returns {Promise<Object>} Banner information object
   */
  async _detectBannerElement(includeScrollOffset = false) {
    const result = await this.page.evaluate(({ selector, includeScroll }) => {
      const el =
        document.querySelector(selector) ||
        document.querySelector('[data-testid="container-fullWidthBanner"]') ||
        document.querySelector('.m-fwBanner');

      if (!el) return { found: false };

      const anchor = el.closest('a') || el;
      anchor.scrollIntoView({ block: 'center', inline: 'center' });

      const rect = anchor.getBoundingClientRect();

      let imageSrc = '';
      const bgDiv = el.querySelector('.m-fwBanner__bg');
      if (bgDiv) {
        const bg = window.getComputedStyle(bgDiv).backgroundImage;
        imageSrc = bg.match(/url\(['"]?([^'"]+)['"]?\)/)?.[1] || '';
      }

      if (!imageSrc) {
        const img = anchor.querySelector('img');
        imageSrc = img?.currentSrc || img?.src || '';
      }

      const imageAlt = anchor.querySelector('img')?.alt || anchor.getAttribute('aria-label') || '';

      const response = {
        found: true,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        href: anchor?.href || '',
        target: anchor?.target || '',
        imageSrc,
        imageAlt
      };

      // Optionally include page coordinates with scroll offsets
      if (includeScroll) {
        const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        response.pageRect = {
          x: rect.x + scrollX,
          y: rect.y + scrollY,
          width: rect.width,
          height: rect.height
        };
      }

      return response;
    }, { selector: config.banner.selector, includeScroll: includeScrollOffset });

    return result;
  }

  // Detect banner on page and get its info
  async detectBanner() {
    return await this._detectBannerElement(true);
  }

  async setScrollbarVisibility(hidden) {
    if (!this.page) return;
    await this.page.evaluate((hide) => {
      const styleId = 'banner-hide-scrollbars';
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

  async ensureLoggedIn(job, options, loggedInHosts) {
    if (!options?.loginEnabled) return;
    if (!options.username || !options.password) {
      throw new Error('Username and password required for login');
    }

    let baseUrl = buildBannerUrl(options.environment, job.culture, '/');
    if (!baseUrl && job.url) {
      try {
        baseUrl = new URL(job.url).origin;
      } catch {
        baseUrl = null;
      }
    }

    if (!baseUrl) {
      throw new Error('Could not build login URL');
    }

    let loginOrigin = baseUrl;
    try {
      loginOrigin = new URL(baseUrl).origin;
    } catch {
      // Use raw base URL string as fallback key
    }

    if (loggedInHosts.has(loginOrigin)) {
      return;
    }

    const loginResult = await this.loginToMelaleuca({
      baseUrl,
      environment: options.environment,
      username: options.username,
      password: options.password,
      selectors: config.sku.selectors,
      timeouts: config.sku.timeouts
    });

    if (!loginResult.success) {
      throw new Error(`Login failed: ${loginResult.error}`);
    }

    loggedInHosts.add(loginOrigin);
    await this.page.waitForTimeout(2000);
  }

  /**
   * Optimized method: Capture banner at all widths with single navigation
   * Navigates once, then resizes viewport for each width (60% faster)
   * @param {Object} job - Job object with url, category, culture, etc.
   * @param {Array<number>} widths - Array of widths to capture
   * @param {Object} options - Options including environment
   * @returns {Promise<Array>} Array of result objects
   */
  async captureJobAtAllWidths(job, widths, options = {}) {
    const page = this.page;
    if (!page) {
      throw new Error('Capture page not initialized');
    }

    const results = [];
    let authHandledOnce = false;

    log('info', `Capturing banner for ${job.category} at ${widths.length} widths (optimized)`, { url: job.url });

    try {
      // Load page at desktop width first (matches user workflow: load desktop, then resize)
      // This ensures CSS/JS initializes at desktop width before resizing to test widths
      const desktopWidth = 1920;
      log('info', `[DESKTOP-FIRST] Loading page at ${desktopWidth}px before resizing to test widths`, { category: job.category });
      await page.setViewportSize({ width: desktopWidth, height: config.banner.browser.captureHeight });

      // Navigate to URL once
      await page.goto(job.url, {
        waitUntil: 'load',
        timeout: config.banner.timeouts.singleCapture
      });
      await page.waitForTimeout(config.banner.timeouts.pageLoad);

      // Wait for web fonts to load (critical for correct text wrapping)
      await page.evaluate(() => document.fonts.ready);
      // Extra wait for any JS layout recalculations after fonts load
      await page.waitForTimeout(1000);
      await this.setScrollbarVisibility(true);
      await page.waitForTimeout(100);
      log('info', `[DESKTOP-FIRST] Page and fonts loaded at ${desktopWidth}px, ready to resize to test widths`, { category: job.category });

      // Handle Microsoft authentication once (if needed)
      const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(options.environment, options.username, options.password, page);
      if (msAuthHandled) {
        authHandledOnce = true;
        // Navigate back to the original URL after auth
        await page.goto(job.url, {
          waitUntil: 'load',
          timeout: config.banner.timeouts.singleCapture
        });
        await page.waitForTimeout(config.banner.timeouts.pageLoad);
      }

      // Capture at each width (no additional navigation needed)
      for (let i = 0; i < widths.length; i++) {
        if (this.shouldStop) break;

        const width = widths[i];
        log('info', `  Capturing at ${width}px`, { category: job.category });

        try {
          // Set viewport size (triggers responsive banner re-render)
          log('info', `[DESKTOP-FIRST] Resizing from desktop to ${width}px`, { category: job.category });
          await page.setViewportSize({ width, height: config.banner.browser.captureHeight });
          // Wait for responsive layout and fonts to settle
          await page.waitForTimeout(config.banner.timeouts.pageLoad / 2);
          await page.evaluate(() => document.fonts.ready);
          // Extra wait for any JS layout recalculations after resize
          await page.waitForTimeout(500);
          await this.setScrollbarVisibility(true);
          await page.waitForTimeout(50);

          // Retry banner detection with exponential backoff
          let bannerInfo = null;
          const maxAttempts = 3;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
              await page.waitForTimeout(500 * attempt);
            }

            bannerInfo = await this._detectBannerElement(false);

            if (bannerInfo?.found) break;
          }

          if (!bannerInfo || !bannerInfo.found) {
            throw new Error('Banner not found after ' + maxAttempts + ' attempts');
          }

          // Wait for banner to be stable
          await page.waitForTimeout(config.banner.timeouts.bannerWait);

          // Calculate padding for screenshot
          const padX = 8;
          const padTop = width >= 1020 ? 32 : width >= 992 ? 48 : 24;
          const padBottom = width >= 1020 ? 12 : width >= 992 ? 12 : 24;

          // Capture screenshot with clip
          const clip = {
            x: Math.max(0, bannerInfo.rect.x - padX),
            y: Math.max(0, bannerInfo.rect.y - padTop),
            width: bannerInfo.rect.width + padX * 2,
            height: bannerInfo.rect.height + padTop + padBottom
          };

          const screenshotBuffer = await page.screenshot({
            type: 'jpeg',
            quality: 80,
            clip
          });

          const imageBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;

          results.push({
            width,
            image: imageBase64,
            href: bannerInfo.href,
            target: bannerInfo.target || '_self',
            category: job.category || '',
            culture: job.culture || '',
            order: job.order ?? null,
            imageLocale: detectImageLocale(bannerInfo.imageSrc),
            imageSrc: bannerInfo.imageSrc,
            imageAlt: bannerInfo.imageAlt || '',
            mainCategory: job.mainCategory || '',
            environment: options.environment || 'stage',
            url: job.url
          });

        } catch (err) {
          log('error', `Error capturing at ${width}px`, { error: err.message, category: job.category });
          results.push({
            error: true,
            message: err.message,
            width,
            category: job.category || '',
            culture: job.culture || '',
            mainCategory: job.mainCategory || '',
            environment: options.environment || 'stage',
            url: job.url
          });
        }
      }

      return results;

    } catch (err) {
      log('error', `Error in optimized capture for ${job.category}`, { error: err.message });
      // Return error results for all widths
      return widths.map(width => ({
        error: true,
        message: err.message,
        width,
        category: job.category || '',
        culture: job.culture || '',
        mainCategory: job.mainCategory || '',
        environment: options.environment || 'stage',
        url: job.url
      }));
    }
  }

  // Capture banner at a specific width
  async captureAtWidth(url, width, meta = {}) {
    log('info', `Capturing banner at ${width}px`, { url });

    const page = this.page;
    if (!page) {
      throw new Error('Capture page not initialized');
    }

    try {
      await page.setViewportSize({ width, height: config.banner.browser.captureHeight });

      // Navigate to URL
      await page.goto(url, {
        waitUntil: 'load',
        timeout: config.banner.timeouts.singleCapture
      });

      // Wait for page to settle
      await page.waitForTimeout(config.banner.timeouts.pageLoad);
      await this.setScrollbarVisibility(true);
      await page.waitForTimeout(50);

      // Handle Microsoft authentication for stage/UAT environments
      const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(meta.environment, meta.username, meta.password, page);
      if (msAuthHandled) {
        // Navigate back to the original URL after auth
        await page.goto(url, {
          waitUntil: 'load',
          timeout: config.banner.timeouts.singleCapture
        });
        await page.waitForTimeout(config.banner.timeouts.pageLoad);
      }

      // Retry banner detection with exponential backoff
      let bannerInfo = null;
      const maxAttempts = 3;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await page.waitForTimeout(500 * attempt);
        }

        bannerInfo = await this._detectBannerElement(false);

        if (bannerInfo?.found) break;
      }

      if (!bannerInfo || !bannerInfo.found) {
        throw new Error('Banner not found after ' + maxAttempts + ' attempts');
      }

      // Wait for banner to be stable
      await page.waitForTimeout(config.banner.timeouts.bannerWait);

      // Calculate padding for screenshot
      const padX = 8;
      const padTop = width >= 1020 ? 32 : width >= 992 ? 48 : 24;
      const padBottom = width >= 1020 ? 12 : width >= 992 ? 12 : 24;

      // Capture screenshot with clip
      const clip = {
        x: Math.max(0, bannerInfo.rect.x - padX),
        y: Math.max(0, bannerInfo.rect.y - padTop),
        width: bannerInfo.rect.width + padX * 2,
        height: bannerInfo.rect.height + padTop + padBottom
      };

      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 80,
        clip
      });

      const imageBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;

      return {
        width,
        image: imageBase64,
        href: bannerInfo.href,
        target: bannerInfo.target || '_self',
        category: meta.category || '',
        culture: meta.culture || '',
        order: meta.order ?? null,
        imageLocale: detectImageLocale(bannerInfo.imageSrc),
        imageSrc: bannerInfo.imageSrc,
        imageAlt: bannerInfo.imageAlt || '',
        mainCategory: meta.mainCategory || '',
        environment: meta.environment || 'stage',
        url
      };

    } catch (err) {
      log('error', `Error capturing at ${width}px`, { error: err.message });
      return {
        error: true,
        message: err.message,
        width,
        culture: meta.culture,
        category: meta.category,
        mainCategory: meta.mainCategory,
        environment: meta.environment || 'stage',
        url
      };
    }
  }

  // Start capture process
  async start(options) {
    log('info', '========================================');
    log('info', 'STARTING BANNER CAPTURE PROCESS');
    log('info', '========================================');
    log('info', 'Options received', options);

    if (this.isRunning) {
      log('error', 'Capture already in progress');
      throw new Error('Capture already in progress');
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.results = [];
    this.currentOptions = options;

    const startTime = Date.now();

    // Build job list from selections
    const jobs = this.buildJobList(options);
    const selectedWidths = options.widths || config.banner.defaults.widths;
    const totalCaptures = jobs.length * selectedWidths.length;
    const totalBanners = jobs.length;

    log('info', `Total banners: ${totalBanners}, Widths: ${selectedWidths.length}, Total captures: ${totalCaptures}`);

    this.emitStatus( {
      type: 'started',
      jobCount: jobs.length,
      widthCount: selectedWidths.length,
      widths: selectedWidths,
      totalCaptures,
      totalBanners
    });

    let completedCaptures = 0;

    try {
      // Launch browser
      await this.launchBrowser();

      // Create context at desktop width (page loads at desktop, then resizes to test widths)
      await this.createContext({
        viewport: { width: 1920, height: config.banner.browser.captureHeight }
      });
      await this.createPage();

      // Note: Using optimized capture - navigates once per banner at desktop width, resizes viewport for each test width

      const loggedInHosts = new Set();

      // Process each job (banner) - optimized approach
      let completedBanners = 0;
      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
        const job = jobs[jobIndex];
        if (this.shouldStop) break;

        await this.ensureLoggedIn(job, options, loggedInHosts);

        // Emit initial progress for first width
        this.emitProgress({
          type: 'capture-progress',
          width: selectedWidths[0],
          state: 'working',
          category: job.category,
          culture: job.culture,
          mainCategory: job.mainCategory,
          remaining: totalCaptures - completedCaptures,
          total: totalCaptures,
          completed: completedCaptures,
          totalBanners,
          completedBanners,
          currentBanner: jobIndex + 1,
          isLastWidthForBanner: false
        });

        try {
          // Capture all widths for this job with single navigation (optimized)
          const jobResults = await this.captureJobAtAllWidths(job, selectedWidths, options);

          // Process each result (one per width)
          for (let widthIndex = 0; widthIndex < jobResults.length; widthIndex++) {
            if (this.shouldStop) break;

            const result = jobResults[widthIndex];
            const isLastWidthForBanner = widthIndex === jobResults.length - 1;

            this.results.push(result);
            completedCaptures++;

            // Enhanced memory warning with actual usage metrics
            if (this.results.length % MEMORY.SCREENSHOT_WARNING_INTERVAL === 0 && this.results.length > 0) {
              const memUsage = getMemoryUsageMB();
              log('warn', `${this.results.length} screenshots in memory. Heap: ${memUsage.heapUsed}MB / ${memUsage.heapTotal}MB. Consider reducing batch size for very large runs.`);

              // Suggest generating report early if memory is high
              if (checkMemoryThreshold(1024)) {
                log('warn', 'Memory usage high (>1GB heap). Consider stopping and generating report to free memory.');
              }
            }

            // Validate against Excel data if available
            let validation = null;
            const excelData = options.excelValidation?.data;
            if (excelData && excelData.length > 0 && !result.error) {
              validation = validateSingleResult(result, excelData, 'category-banner');
              result.validation = validation;
              log('debug', `Excel validation for ${job.category}: ${validation.status}`, validation.failures || []);
            }

            // Update completedBanners when we finish the last width for a banner
            if (isLastWidthForBanner) {
              completedBanners++;
            }

            this.emitProgress({
              type: 'capture-progress',
              width: result.width,
              state: result.error ? 'error' : 'done',
              category: job.category,
              culture: job.culture,
              mainCategory: job.mainCategory,
              remaining: totalCaptures - completedCaptures,
              total: totalCaptures,
              completed: completedCaptures,
              // Banner-level progress
              totalBanners,
              completedBanners,
              currentBanner: jobIndex + 1,
              isLastWidthForBanner,
              // Include result data for validation display
              result: {
                url: result.url,
                href: result.href,
                target: result.target,
                imageLocale: result.imageLocale,
                error: result.error,
                message: result.message,
                validation: validation
              }
            });

            // Wait between width captures (optional, can be reduced or removed)
            if (!this.shouldStop && widthIndex < jobResults.length - 1) {
              await new Promise(r => setTimeout(r, config.banner.timeouts.betweenCaptures / 2));
            }
          }

        } catch (err) {
          // Catch-all for unexpected errors at job level
          log('error', 'Job capture failed', { error: err.message, job: job.category });

          // Create error results for all widths in this job
          for (let widthIndex = 0; widthIndex < selectedWidths.length; widthIndex++) {
            const width = selectedWidths[widthIndex];

            this.results.push({
              error: true,
              message: err.message,
              width,
              culture: job.category,
              category: job.category,
              mainCategory: job.mainCategory,
              environment: options.environment,
              url: job.url
            });
            completedCaptures++;
          }
          completedBanners++;
        }

        // Wait between jobs
        if (!this.shouldStop && jobIndex < jobs.length - 1) {
          await new Promise(r => setTimeout(r, config.banner.timeouts.betweenCaptures));
        }
      }

    } catch (err) {
      log('error', 'FATAL ERROR during banner capture', { error: err.message, stack: err.stack });
      this.emit('error', { message: err.message });
    } finally {
      await this.closeBrowser();

      this.isRunning = false;

      const duration = Date.now() - startTime;
      const successCount = this.results.filter(r => !r.error).length;
      const errorCount = this.results.filter(r => r.error).length;

      log('info', '========================================');
      log('info', 'BANNER CAPTURE PROCESS COMPLETE');
      log('info', '========================================');
      log('info', 'Results summary', { duration, successCount, errorCount, total: this.results.length });

      if (!this.shouldStop) {
        this.emitStatus( {
          type: 'completed',
          results: this.results,
          duration,
          successCount,
          errorCount
        });
      } else {
        this.emitStatus( {
          type: 'cancelled',
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

  // Build job list from options
  buildJobList(options) {
    const jobs = [];
    const { environment, region, cultures, categories } = options;

    const regionConfig = config.banner.regions[region];
    if (!regionConfig) {
      log('error', 'Invalid banner region', { region });
      return jobs;
    }

    // Filter cultures
    const selectedCultures = cultures && cultures.length > 0
      ? regionConfig.cultures.filter(c => cultures.includes(c.code))
      : regionConfig.cultures;

    let order = 0;

    for (const cultureInfo of selectedCultures) {
      const culture = cultureInfo.code;

      // Get categories for this region
      for (const mainCategory of regionConfig.categories) {
        // Check if this main category or any of its items are selected
        const selectedItems = categories && categories.length > 0
          ? mainCategory.items.filter(item => {
            const itemKey = `${mainCategory.name}|${item.label}`;
            return categories.includes(itemKey) || categories.includes(mainCategory.name);
          })
          : mainCategory.items;

        if (selectedItems.length === 0) continue;

        for (const item of selectedItems) {
          // Handle both simple path and culture-specific paths object
          let path = item.path;

          // If item has paths object (Europe region), get culture-specific path
          if (!path && item.paths) {
            const langCode = config.banner.cultureLangMap[culture] || culture;
            path = item.paths[langCode];

            if (!path && typeof langCode === 'string' && langCode.includes('-')) {
              const regionKey = langCode.split('-')[1];
              path = item.paths[regionKey] || item.paths[regionKey?.toUpperCase?.()];
            }

            if (!path) {
              path = item.paths[culture];
            }

            if (!path) {
              log('warn', 'No path found for culture in paths object', {
                culture,
                langCode,
                availablePaths: Object.keys(item.paths),
                item: item.label
              });
              continue;
            }
          }

          const url = buildBannerUrl(environment, culture, path);
          if (!url) {
            log('warn', 'Could not build URL', { environment, culture, path });
            continue;
          }

          jobs.push({
            url,
            culture,
            category: item.label,
            mainCategory: mainCategory.name,
            order: order++
          });
        }
      }
    }

    log('info', `Built ${jobs.length} capture jobs`);
    return jobs;
  }
}

/**
 * Get or create the singleton BannerProcessor instance
 * @returns {BannerProcessor} The singleton instance
 */
export function getBannerProcessor() {
  return getSingleton('BannerProcessor', () => new BannerProcessor());
}
