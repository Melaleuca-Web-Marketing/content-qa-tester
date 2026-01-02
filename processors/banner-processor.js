// banner-processor.js - Playwright Banner processing engine

import { BaseProcessor, log } from './base-processor.js';
import { config, buildBannerUrl } from '../config.js';

export class BannerProcessor extends BaseProcessor {
  constructor() {
    super('Banner');
  }

  // Detect banner on page and get its info
  async detectBanner() {
    const result = await this.page.evaluate((selector) => {
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

      const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

      return {
        found: true,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        pageRect: {
          x: rect.x + scrollX,
          y: rect.y + scrollY,
          width: rect.width,
          height: rect.height
        },
        href: anchor?.href || '',
        target: anchor?.target || '',
        imageSrc,
        imageAlt
      };
    }, config.banner.selector);

    return result;
  }

  // Detect image locale from src URL
  // Detect image locale from src URL
  detectImageLocale(imageSrc) {
    if (!imageSrc) return null;
    const localeMap = {
      'enus': 'US', 'en-us': 'US', 'esus': 'US', 'es-us': 'US',
      'enca': 'CA', 'en-ca': 'CA', 'frca': 'CA', 'fr-ca': 'CA',
      'esmx': 'MX', 'es-mx': 'MX',
      'engb': 'UK', 'en-gb': 'UK', 'enie': 'IE', 'en-ie': 'IE',
      'dede': 'DE', 'de-de': 'DE', 'plpl': 'PL', 'pl-pl': 'PL',
      'nlnl': 'NL', 'nl-nl': 'NL', 'ltlt': 'LT', 'lt-lt': 'LT',
      'uk': 'UK', 'ie': 'IE', 'de': 'DE', 'pl': 'PL', 'nl': 'NL', 'lt': 'LT' // Keep short codes just in case
    };
    const lowerSrc = imageSrc.toLowerCase();

    for (const [code, region] of Object.entries(localeMap)) {
      // Check for code with common delimiters
      const patterns = [
        `-${code}-`, `_${code}_`, `/${code}/`,
        `-${code}.`, `_${code}.`, `--${code}.`, `--${code}-`
      ];

      if (patterns.some(p => lowerSrc.includes(p))) {
        return region;
      }
    }
    return null;
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

      // Handle Microsoft authentication for stage/UAT environments
      // User must manually sign in, then click Resume
      if (meta.environment === 'stage' || meta.environment === 'uat') {
        const isMicrosoftLogin = page.url().includes('login.microsoftonline.com') ||
          page.url().includes('login.windows.net');
        if (isMicrosoftLogin) {
          log('info', 'Detected Microsoft login page, waiting for user to sign in...');
          await this.waitForManualAuth(meta.environment.toUpperCase());

          // Navigate back to the original URL after auth
          await page.goto(url, {
            waitUntil: 'load',
            timeout: config.banner.timeouts.singleCapture
          });
          await page.waitForTimeout(config.banner.timeouts.pageLoad);
        }
      }

      // Retry banner detection with exponential backoff
      let bannerInfo = null;
      const maxAttempts = 3;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await page.waitForTimeout(500 * attempt);
        }

        bannerInfo = await page.evaluate((selector) => {
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

          return {
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
        }, config.banner.selector);

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
        imageLocale: this.detectImageLocale(bannerInfo.imageSrc),
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

    log('info', `Total jobs: ${jobs.length}, Widths: ${selectedWidths.length}, Total captures: ${totalCaptures}`);

    this.emit('status', {
      type: 'started',
      jobCount: jobs.length,
      widthCount: selectedWidths.length,
      totalCaptures
    });

    let completedCaptures = 0;

    try {
      // Launch browser
      await this.launchBrowser({ headless: false });
      const initialWidth = selectedWidths[0] || config.banner.widths[0] || 320;

      await this.createContext({
        viewport: { width: initialWidth, height: config.banner.browser.captureHeight },
        userAgent: config.banner.browser.userAgent,
        isMobile: config.banner.browser.isMobile,
        hasTouch: config.banner.browser.hasTouch,
        deviceScaleFactor: config.banner.browser.deviceScaleFactor
      });
      await this.createPage();

      // Note: Authentication is handled within captureAtWidth() for each job
      // This ensures auth works correctly even if session expires mid-process

      // Process each job
      for (const job of jobs) {
        if (this.shouldStop) break;

        for (const width of selectedWidths) {
          if (this.shouldStop) break;

          const remaining = totalCaptures - completedCaptures;

          this.emit('progress', {
            type: 'capture-progress',
            width,
            state: 'working',
            category: job.category,
            culture: job.culture,
            mainCategory: job.mainCategory,
            remaining,
            total: totalCaptures,
            completed: completedCaptures
          });

          try {
            const result = await this.captureAtWidth(job.url, width, {
              category: job.category,
              culture: job.culture,
              order: job.order,
              mainCategory: job.mainCategory,
              environment: options.environment
            });

            this.results.push(result);
            completedCaptures++;

            // Warn about memory usage for very large test runs
            if (this.results.length % 50 === 0 && this.results.length > 0) {
              log('warn', `${this.results.length} screenshots captured. Large test runs may consume significant memory.`);
            }

            this.emit('progress', {
              type: 'capture-progress',
              width,
              state: result.error ? 'error' : 'done',
              category: job.category,
              culture: job.culture,
              mainCategory: job.mainCategory,
              remaining: totalCaptures - completedCaptures,
              total: totalCaptures,
              completed: completedCaptures
            });

          } catch (err) {
            log('error', 'Capture failed', { error: err.message });
            this.results.push({
              error: true,
              message: err.message,
              width,
              culture: job.culture,
              category: job.category,
              mainCategory: job.mainCategory,
              environment: options.environment,
              url: job.url
            });
            completedCaptures++;
          }

          // Wait between captures
          if (!this.shouldStop) {
            await new Promise(r => setTimeout(r, config.banner.timeouts.betweenCaptures));
          }
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
        this.emit('status', {
          type: 'completed',
          results: this.results,
          duration,
          successCount,
          errorCount
        });
      } else {
        this.emit('status', {
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
          const url = buildBannerUrl(environment, culture, item.path);
          if (!url) {
            log('warn', 'Could not build URL', { environment, culture, path: item.path });
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

// Singleton instance
let processorInstance = null;

export function getBannerProcessor() {
  if (!processorInstance) {
    processorInstance = new BannerProcessor();
  }
  return processorInstance;
}
