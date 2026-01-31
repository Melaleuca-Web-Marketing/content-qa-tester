// mixinad-processor.js - Playwright Mix-In Ad processing engine

import { BaseProcessor, log, summarizeOptions } from './base-processor.js';
import { config, buildBannerUrl } from '../config.js';
import { detectImageLocale } from '../utils/image-utils.js';
import { MEMORY } from '../utils/constants.js';
import { validateSingleResult } from '../utils/excel-validation.js';
import { getMemoryUsageMB, checkMemoryThreshold } from '../utils/memory-monitor.js';
import { getSingleton } from '../utils/singleton.js';

export class MixInAdProcessor extends BaseProcessor {
    constructor() {
        super('MixInAd');
    }

    // Detect all mix-in ads on page and get their info
    async detectAllMixInAds() {
        const results = await this.page.evaluate((selector) => {
            const ads = document.querySelectorAll(selector);

            if (!ads || ads.length === 0) {
                return [];
            }

            const adInfos = [];
            ads.forEach((ad, index) => {
                const anchor = ad.querySelector('a') || ad.closest('a') || ad;
                anchor.scrollIntoView({ block: 'center', inline: 'center' });

                const rect = ad.getBoundingClientRect();
                const bgDiv = ad.querySelector('.m-mixinAd__bg');
                let imageUrl = '';
                const selectButton = ad.querySelector('.m-mixinAd__row.-ctaButton button')
                  || ad.querySelector('button[aria-label*="Select"]');
                const selectLabel = selectButton
                  ? (selectButton.getAttribute('aria-label') || selectButton.textContent || '').trim()
                  : '';

                if (bgDiv) {
                    const bgImage = window.getComputedStyle(bgDiv).backgroundImage;
                    imageUrl = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/)?.[1] || '';
                }

                if (!imageUrl) {
                    const img = ad.querySelector('img');
                    if (img) imageUrl = img.currentSrc || img.src || '';
                }

                const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
                const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

                // Find the position in the product grid
                let domPosition = null;
                const parentLi = ad.closest('li.p-catListing__col');
                if (parentLi) {
                    const grid = parentLi.closest('ul.p-catListing__grid');
                    if (grid) {
                        const allItems = Array.from(grid.querySelectorAll('li.p-catListing__col'));
                        domPosition = allItems.indexOf(parentLi) + 1; // 1-indexed
                    }
                }

                adInfos.push({
                    index,
                    domPosition,
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
                    imageSrc: imageUrl,
                    imageAlt: anchor?.getAttribute('aria-label') || '',
                    hasSelectButton: Boolean(selectButton),
                    selectLabel
                });
            });

            return adInfos;
        }, config.mixinad.selector);

        return results;
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

        const lastCulture = loggedInHosts.get(loginOrigin) || null;

        if (!lastCulture) {
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

            loggedInHosts.set(loginOrigin, job.culture);
            await this.page.waitForTimeout(2000);
            return;
        }

        if (lastCulture !== job.culture) {
            log('info', 'Switching culture for logged-in session', {
                from: lastCulture,
                to: job.culture,
                url: baseUrl
            });
            await this.page.goto(baseUrl, {
                waitUntil: 'load',
                timeout: config.mixinad.timeouts.singleCapture
            });
            await this.page.waitForTimeout(config.mixinad.timeouts.pageLoad);
            await this.handleMicrosoftAuthIfNeeded(options.environment, options.username, options.password);
            loggedInHosts.set(loginOrigin, job.culture);
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

    async getVisibleShelf() {
        const shelves = await this.page.$$(config.sku.selectors.cartShelf);
        for (const shelf of shelves) {
            try {
                if (await shelf.isVisible()) {
                    return shelf;
                }
            } catch {
                // Ignore detached elements
            }
        }
        return null;
    }

    extractSkuFromImageUrl(url) {
        if (!url) return '';
        const cleanUrl = url.split('?')[0];
        const match = cleanUrl.match(/\/(\d{4,})h[-_]/i)
            || cleanUrl.match(/\/(\d{4,})h/i)
            || cleanUrl.match(/\/(\d{4,})\.(png|jpg|jpeg|gif)$/i);
        return match ? match[1] : '';
    }

    extractSkuFromHref(href) {
        if (!href) return '';
        const match = href.match(/\/Product\/(\d+)/i);
        return match ? match[1] : '';
    }

    async getImageSource(element) {
        if (!element) return '';
        const attrs = ['src', 'data-src', 'data-lazy', 'data-original', 'srcset', 'data-srcset'];
        for (const attr of attrs) {
            const value = await element.getAttribute(attr);
            if (!value) continue;
            if (attr.includes('srcset')) {
                return value.split(',')[0].trim().split(' ')[0];
            }
            return value;
        }
        return '';
    }

    async readSkuFromShelf(shelf) {
        const selectors = [
            '[data-sku]',
            '.m-shelfConfirm__img',
            '.m-shelfConfirm__summary img',
            '.m-productInfo img',
            '.o-shelfCart img'
        ];

        for (const selector of selectors) {
            const el = shelf ? await shelf.$(selector) : await this.page.$(selector);
            if (!el) continue;
            const dataSku = await el.getAttribute('data-sku');
            if (dataSku && dataSku.trim()) {
                return dataSku.trim();
            }
            if (selector !== '[data-sku]') {
                const src = await this.getImageSource(el);
                const sku = this.extractSkuFromImageUrl(src);
                if (sku) return sku;
            }
        }

        const linkSelectors = [
            '.m-shelfConfirm__product',
            'a[href*="/Product/"]'
        ];

        for (const selector of linkSelectors) {
            const link = shelf ? await shelf.$(selector) : await this.page.$(selector);
            if (!link) continue;
            const href = await link.getAttribute('href');
            const sku = this.extractSkuFromHref(href);
            if (sku) return sku;
        }

        return '';
    }

    getAddedToCartSelector() {
        const base = config.sku.selectors.addedToCartMessage;
        const extra = '.m-shelfConfirm__heading';
        if (base && base.includes(extra)) {
            return base;
        }
        return base ? `${base}, ${extra}` : extra;
    }

    async waitForShelfContent() {
        const timeout = Math.min(config.sku.timeouts.shelfAppear || 5000, 5000);
        const addedSelector = this.getAddedToCartSelector();
        const addToCartSelectors = [
            config.sku.selectors.addToCartButton,
            '.m-cartAddConfig__btn button'
        ].filter(Boolean);

        const waiters = [];
        if (addedSelector) {
            waiters.push(this.page.waitForSelector(addedSelector, {
                state: 'visible',
                timeout
            }));
        }
        for (const selector of addToCartSelectors) {
            waiters.push(this.page.waitForSelector(selector, {
                state: 'visible',
                timeout
            }));
        }
        if (config.sku.selectors.errorMessage) {
            waiters.push(this.page.waitForSelector(config.sku.selectors.errorMessage, {
                state: 'visible',
                timeout
            }));
        }

        if (waiters.length === 0) return;

        try {
            await Promise.race(waiters);
        } catch {
            // Continue if shelf content takes longer to render
        }
    }

    async readAddedToCartMessage(shelf) {
        const headerSelector = this.getAddedToCartSelector();
        const headerEl = (shelf ? await shelf.$(headerSelector) : null)
            || await this.page.$(headerSelector);
        const message = headerEl ? await headerEl.textContent() : '';
        return message ? message.trim() : '';
    }

    async readAddToCartError() {
        const errorEl = await this.page.$(config.sku.selectors.errorMessage);
        if (!errorEl) return '';
        const errorText = await errorEl.textContent();
        return errorText ? errorText.trim() : '';
    }

    async isShelfVisible() {
        try {
            const shelf = await this.getVisibleShelf();
            return Boolean(shelf);
        } catch {
            return false;
        }
    }

    async closeShelf() {
        const isVisible = await this.isShelfVisible();
        if (!isVisible) return;

        const closeSelectors = [
            config.sku.selectors.closeShelfButton,
            'button:has-text("Keep Shopping")',
            'button:has-text("Continue Shopping")',
            'button[aria-label="Close"]'
        ];

        for (const selector of closeSelectors) {
            if (!selector) continue;
            const btn = this.page.locator(selector).first();
            const canClick = await btn.isVisible().catch(() => false);
            if (!canClick) continue;
            try {
                await btn.click({ timeout: 2000 });
                break;
            } catch {
                // Try next fallback
            }
        }

        try {
            await this.page.keyboard.press('Escape');
        } catch {
            // Ignore escape errors
        }

        try {
            await this.page.waitForSelector(config.sku.selectors.cartShelf, {
                state: 'hidden',
                timeout: 5000
            });
        } catch {
            // Ignore if shelf stays open
        }

        await this.page.waitForTimeout(200);
    }

    async addToCartFromShelf() {
        try {
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
            log('warn', 'Timeout waiting for cart shelf', { error: e.message });
        }

        const shelf = await this.getVisibleShelf();
        if (!shelf) {
            const errorText = await this.readAddToCartError();
            if (errorText) {
                return { attempted: true, success: false, error: errorText };
            }
            return { attempted: true, success: false, error: 'Cart shelf did not appear within timeout' };
        }

        await this.waitForShelfContent();

        const addedMessage = await this.readAddedToCartMessage(shelf);
        if (addedMessage) {
            const sku = await this.readSkuFromShelf(shelf);
            await this.closeShelf();
            return { attempted: true, success: true, message: addedMessage, sku };
        }

        const opened = await this.expandConfiguratorAccordions();
        const selections = await this.selectConfiguratorOptions();
        if (opened > 0 || selections > 0) {
            await this.page.waitForTimeout(300);
        }

        await this.waitForShelfContent();

        const addToCartBtn = await shelf.$(config.sku.selectors.addToCartButton)
            || await shelf.$('.m-cartAddConfig__btn button')
            || await this.page.$(config.sku.selectors.addToCartButton)
            || await this.page.$('.m-cartAddConfig__btn button');
        if (!addToCartBtn) {
            const confirmMessage = await this.readAddedToCartMessage(shelf);
            if (confirmMessage) {
                const sku = await this.readSkuFromShelf(shelf);
                await this.closeShelf();
                return { attempted: true, success: true, message: confirmMessage, sku };
            }
            log('warn', 'Add To Cart button not found on shelf');
            await this.closeShelf();
            return { attempted: true, success: false, error: 'Add To Cart button not found' };
        }

        await addToCartBtn.click();

        try {
            await Promise.race([
                this.page.waitForSelector(config.sku.selectors.addedToCartMessage, {
                    state: 'visible',
                    timeout: config.sku.timeouts.shelfAppear
                }),
                this.page.waitForSelector(config.sku.selectors.errorMessage, {
                    state: 'visible',
                    timeout: config.sku.timeouts.shelfAppear
                })
            ]);
        } catch (e) {
            log('warn', 'Timeout waiting for cart confirmation', { error: e.message });
        }

        const confirmMessage = await this.readAddedToCartMessage(shelf);
        if (confirmMessage) {
            const sku = await this.readSkuFromShelf(shelf);
            await this.closeShelf();
            return { attempted: true, success: true, message: confirmMessage, sku };
        }

        const errorText = await this.readAddToCartError();
        if (errorText) {
            await this.closeShelf();
            return { attempted: true, success: false, error: errorText };
        }

        await this.closeShelf();
        return { attempted: true, success: false, error: 'Cart shelf did not confirm add to cart' };
    }

    async findMixInSelectButton(adIndex) {
        const adLocator = this.page.locator(config.mixinad.selector).nth(adIndex);
        let selectBtn = adLocator.locator('.m-mixinAd__row.-ctaButton button').first();
        if (await selectBtn.count()) {
            return selectBtn;
        }
        selectBtn = adLocator.locator('button', { hasText: /select/i }).first();
        if (await selectBtn.count()) {
            return selectBtn;
        }
        selectBtn = adLocator.locator('button[aria-label*="Select"]').first();
        if (await selectBtn.count()) {
            return selectBtn;
        }
        return null;
    }

    async attemptAddToCartForAd(adIndex) {
        try {
            await this.closeShelf();
            if (await this.isShelfVisible()) {
                return { attempted: true, success: false, error: 'Shelf is still visible' };
            }

            const selectBtn = await this.findMixInSelectButton(adIndex);
            if (!selectBtn) {
                return { attempted: true, success: false, error: 'Select button not found' };
            }

            try {
                await selectBtn.scrollIntoViewIfNeeded();
            } catch {
                // Ignore scroll errors
            }

            await selectBtn.click({ timeout: 5000 });
            return await this.addToCartFromShelf();
        } catch (err) {
            log('warn', 'Mix-in ad add to cart failed', { error: err.message });
            await this.closeShelf();
            return { attempted: true, success: false, error: err.message };
        }
    }

    // Capture all mix-in ads at a specific width
    async captureAtWidth(url, width, meta = {}) {
        log('info', `Capturing mix-in ads at ${width}px`, { url });

        const page = this.page;
        if (!page) {
            throw new Error('Capture page not initialized');
        }

        try {
            await page.setViewportSize({ width, height: config.mixinad.browser.captureHeight });

            // Navigate to URL (needed for proper layout at each width)
            await page.goto(url, {
                waitUntil: 'load',
                timeout: config.mixinad.timeouts.singleCapture
            });

            // Wait for page to settle
            await page.waitForTimeout(config.mixinad.timeouts.pageLoad);

            // Handle Microsoft authentication for stage/UAT environments
            // Skip if we've already authenticated at the start of the process
            if (!meta.skipAuthCheck) {
                const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(meta.environment, meta.username, meta.password, page);
                if (msAuthHandled) {
                    // Navigate back to the original URL after auth
                    await page.goto(url, {
                        waitUntil: 'load',
                        timeout: config.mixinad.timeouts.singleCapture
                    });
                    await page.waitForTimeout(config.mixinad.timeouts.pageLoad);
                }
            }

            // Detect all mix-in ads with retry logic
            let adsInfo = [];
            const maxAttempts = 3;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (attempt > 0) {
                    await page.waitForTimeout(500 * attempt);
                }

                adsInfo = await this.detectAllMixInAds();

                if (adsInfo.length > 0) break;
            }

            if (adsInfo.length === 0) {
                // Extra fallback to catch lazy-loaded ads at small widths
                try {
                    await page.waitForSelector(config.mixinad.selector, { state: 'attached', timeout: 2000 });
                } catch {
                    // Ignore selector timeout
                }
                try {
                    await page.evaluate(() => {
                        const maxScroll = document.body.scrollHeight || document.documentElement.scrollHeight || 0;
                        window.scrollTo(0, Math.floor(maxScroll * 0.35));
                    });
                } catch {
                    // Ignore scroll errors
                }
                await page.waitForTimeout(600);
                adsInfo = await this.detectAllMixInAds();
            }

            // If no ads found, return informational result (not an error)
            if (adsInfo.length === 0) {
                log('info', `No mix-in ads found on page at ${width}px`);
                return [{
                    width,
                    adIndex: 0,
                    noAdsFound: true,
                    message: 'No mix-in ads found on this page',
                    category: meta.category || '',
                    culture: meta.culture || '',
                    order: meta.order ?? null,
                    mainCategory: meta.mainCategory || '',
                    environment: meta.environment || 'stage',
                    url
                }];
            }

            // Wait for ads to be stable
            await page.waitForTimeout(config.mixinad.timeouts.mixinAdWait);

            // Capture each ad
            const results = [];
            for (let i = 0; i < adsInfo.length; i++) {
                const adInfo = adsInfo[i];

                log('info', `Capturing ad ${i + 1} of ${adsInfo.length} at ${width}px`);

                // Scroll ad into view
                await page.evaluate(({ index, selector }) => {
                    const ads = document.querySelectorAll(selector);
                    if (ads[index]) {
                        ads[index].scrollIntoView({ block: 'center', inline: 'center' });
                    }
                }, { index: i, selector: config.mixinad.selector });

                await page.waitForTimeout(300);

                // Get fresh rect for accurate screenshot
                const freshRect = await page.evaluate(({ index, selector }) => {
                    const ads = document.querySelectorAll(selector);
                    const ad = ads[index];
                    if (ad) {
                        const r = ad.getBoundingClientRect();
                        return { x: r.x, y: r.y, width: r.width, height: r.height };
                    }
                    return null;
                }, { index: i, selector: config.mixinad.selector });

                if (!freshRect) {
                    log('warn', `Could not find ad ${i} for screenshot`);
                    continue;
                }

                // Calculate padding for screenshot (smaller than banners)
                const padX = 4;
                const padTop = width >= 768 ? 12 : 8;
                const padBottom = width >= 768 ? 12 : 8;

                // Capture screenshot with clip using fresh coordinates
                const clip = {
                    x: Math.max(0, freshRect.x - padX),
                    y: Math.max(0, freshRect.y - padTop),
                    width: freshRect.width + padX * 2,
                    height: freshRect.height + padTop + padBottom
                };

                const screenshotBuffer = await page.screenshot({
                    type: 'jpeg',
                    quality: 80,
                    clip
                });

                const imageBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
                const addToCartKey = String(adInfo.domPosition ?? i);

                if (meta.selectableAds && adInfo.hasSelectButton && !meta.selectableAds.has(addToCartKey)) {
                    meta.selectableAds.set(addToCartKey, {
                        index: i,
                        domPosition: adInfo.domPosition ?? null
                    });
                }

                results.push({
                    width,
                    adIndex: i,
                    domPosition: adInfo.domPosition,
                    position: Number.isFinite(adInfo.domPosition) ? adInfo.domPosition : undefined,
                    image: imageBase64,
                    href: adInfo.href,
                    target: adInfo.target || '_self',
                    category: meta.category || '',
                    culture: meta.culture || '',
                    order: meta.order ?? null,
                    imageLocale: detectImageLocale(adInfo.imageSrc),
                    imageSrc: adInfo.imageSrc,
                    imageAlt: adInfo.imageAlt || '',
                    addToCartKey,
                    mainCategory: meta.mainCategory || '',
                    environment: meta.environment || 'stage',
                    url
                });
            }

            return results;

        } catch (err) {
            log('error', `Error capturing at ${width}px`, { error: err.message });
            return [{
                error: true,
                adIndex: 0,
                message: err.message,
                width,
                culture: meta.culture,
                category: meta.category,
                mainCategory: meta.mainCategory,
                environment: meta.environment || 'stage',
                url
            }];
        }
    }

    // Start capture process
    async start(options) {
        log('info', '========================================');
        log('info', 'STARTING MIX-IN AD CAPTURE PROCESS');
        log('info', '========================================');
        log('info', 'Options received', summarizeOptions(options));

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
        const selectedWidths = options.widths || config.mixinad.defaults.widths;

        // Note: totalCaptures is estimated - actual count depends on how many ads per page
        const estimatedCaptures = jobs.length * selectedWidths.length;
        const totalCategories = jobs.length;

        log('info', `Total categories: ${totalCategories}, Widths: ${selectedWidths.length}, Estimated captures: ${estimatedCaptures}`);

        this.emitStatus( {
            type: 'started',
            jobCount: jobs.length,
            widthCount: selectedWidths.length,
            widths: selectedWidths,
            estimatedCaptures,
            totalBanners: totalCategories  // Use totalBanners for frontend compatibility
        });

        let completedCaptures = 0;

        try {
            // Launch browser
            await this.launchBrowser();
            const initialWidth = selectedWidths[0] || config.mixinad.widths[0] || 320;
            let completedCategories = 0;

            // Create single context without locale settings (like banner processor)
            // This ensures sc_lang URL parameter is used instead of browser locale
            await this.createContext({
                viewport: { width: initialWidth, height: config.mixinad.browser.captureHeight }
            });
            await this.createPage();

            const loggedInHosts = new Map();
            let hasAuthenticated = false;

            // Perform initial auth check for stage/UAT
            if ((options.environment === 'stage' || options.environment === 'uat') && jobs.length > 0) {
                log('info', 'Performing initial authentication check...');
                const firstJob = jobs[0];
                await this.page.goto(firstJob.url, {
                    waitUntil: 'load',
                    timeout: config.mixinad.timeouts.singleCapture
                });
                await this.page.waitForTimeout(config.mixinad.timeouts.pageLoad);

                const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(options.environment, options.username, options.password);
                if (msAuthHandled) {
                    hasAuthenticated = true;
                }
            }

            // Process each job
            for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
                const job = jobs[jobIndex];
                if (this.shouldStop) break;

                const currentBanner = jobIndex + 1;
                const addToCartResults = new Map();
                const selectableAds = new Map();

                await this.ensureLoggedIn(job, options, loggedInHosts);

                for (let widthIndex = 0; widthIndex < selectedWidths.length; widthIndex++) {
                    const width = selectedWidths[widthIndex];
                    if (this.shouldStop) break;

                    const isLastWidthForCategory = widthIndex === selectedWidths.length - 1;

                    this.emitProgress({
                        type: 'capture-progress',
                        width,
                        state: 'working',
                        category: job.category,
                        culture: job.culture,
                        mainCategory: job.mainCategory,
                        // Category-level progress
                        totalBanners: totalCategories,
                        completedBanners: completedCategories,
                        currentBanner: currentBanner,
                        isLastWidthForBanner: isLastWidthForCategory
                    });

                    try {
                        // Pass hasAuthenticated flag to skip auth checks during captures
                        const pageResults = await this.captureAtWidth(job.url, width, {
                            category: job.category,
                            culture: job.culture,
                            order: job.order,
                            mainCategory: job.mainCategory,
                            environment: options.environment,
                            skipAuthCheck: hasAuthenticated,
                            username: options.username,
                            password: options.password,
                            selectableAds
                        });

                        // pageResults is an array (one result per ad found, or one error/noAdsFound result)
                        for (const result of pageResults) {
                            this.results.push(result);
                        }

                        // Enhanced memory warning with actual usage metrics
                        if (this.results.length % MEMORY.SCREENSHOT_WARNING_INTERVAL === 0 && this.results.length > 0) {
                            const memUsage = getMemoryUsageMB();
                            log('warn', `${this.results.length} screenshots in memory. Heap: ${memUsage.heapUsed}MB / ${memUsage.heapTotal}MB. Consider reducing batch size for very large runs.`);

                            // Suggest generating report early if memory is high
                            if (checkMemoryThreshold(1024)) {
                                log('warn', 'Memory usage high (>1GB heap). Consider stopping and generating report to free memory.');
                            }
                        }

                        completedCaptures++;

                        // Build result summary for progress event
                        const adsFound = pageResults.filter(r => !r.error && !r.noAdsFound).length;
                        const noAdsFound = pageResults.some(r => r.noAdsFound);
                        const hasError = pageResults.some(r => r.error);

                        // Validate each ad result against Excel if data available
                        const excelData = options.excelValidation?.data;
                        let validationResults = [];
                        if (excelData && excelData.length > 0 && adsFound > 0) {
                            for (const result of pageResults) {
                                if (!result.error && !result.noAdsFound) {
                                    const validation = validateSingleResult(result, excelData, 'mix-in-ad');
                                    result.validation = validation;
                                    validationResults.push({
                                        adIndex: result.adIndex,
                                        position: result.position,
                                        validation
                                    });
                                }
                            }
                        }

                        // Update completedCategories when we finish the last width for a category
                        if (isLastWidthForCategory) {
                            completedCategories++;
                        }

                        this.emitProgress({
                            type: 'capture-progress',
                            width,
                            state: hasError ? 'error' : 'done',
                            category: job.category,
                            culture: job.culture,
                            mainCategory: job.mainCategory,
                            remaining: estimatedCaptures - completedCaptures,
                            total: estimatedCaptures,
                            completed: completedCaptures,
                            // Category-level progress
                            totalBanners: totalCategories,
                            completedBanners: completedCategories,
                            currentBanner: currentBanner,
                            isLastWidthForBanner: isLastWidthForCategory,
                            // Include result data for activity feed
                            result: {
                                url: job.url,
                                adsFound,
                                noAdsFound,
                                hasError,
                                errorMessage: hasError ? pageResults.find(r => r.error)?.message : null,
                                validations: validationResults
                            }
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
                        await new Promise(r => setTimeout(r, config.mixinad.timeouts.betweenCaptures));
                    }
                }

                if (selectableAds.size > 0) {
                    if (!options.loginEnabled) {
                        for (const key of selectableAds.keys()) {
                            addToCartResults.set(key, {
                                attempted: false,
                                success: false,
                                reason: 'Login disabled'
                            });
                        }
                    } else {
                        await this.page.goto(job.url, {
                            waitUntil: 'load',
                            timeout: config.mixinad.timeouts.singleCapture
                        });
                        await this.page.waitForTimeout(config.mixinad.timeouts.pageLoad);

                        if (!hasAuthenticated) {
                            const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(
                                options.environment,
                                options.username,
                                options.password
                            );
                            if (msAuthHandled) {
                                await this.page.goto(job.url, {
                                    waitUntil: 'load',
                                    timeout: config.mixinad.timeouts.singleCapture
                                });
                                await this.page.waitForTimeout(config.mixinad.timeouts.pageLoad);
                            }
                        }

                        const orderedAds = Array.from(selectableAds.entries())
                            .map(([key, value]) => ({ key, ...value }))
                            .sort((a, b) => {
                                const aPos = Number.isFinite(a.domPosition) ? a.domPosition : a.index;
                                const bPos = Number.isFinite(b.domPosition) ? b.domPosition : b.index;
                                return aPos - bPos;
                            });

                        for (const ad of orderedAds) {
                            if (this.shouldStop) break;
                            await this.closeShelf();
                            const result = await this.attemptAddToCartForAd(ad.index);
                            addToCartResults.set(ad.key, result);
                        }
                    }

                    if (addToCartResults.size > 0) {
                        for (const result of this.results) {
                            if (result.culture !== job.culture
                                || result.category !== job.category
                                || (result.mainCategory || '') !== (job.mainCategory || '')) {
                                continue;
                            }

                            const key = result.addToCartKey;
                            if (key && addToCartResults.has(key)) {
                                result.addToCartResult = addToCartResults.get(key);
                            }
                        }
                    }
                }

                const categoryResults = this.results.filter(result =>
                    result.culture === job.culture
                    && result.category === job.category
                    && (result.mainCategory || '') === (job.mainCategory || '')
                );

                const excelData = options.excelValidation?.data;
                if (excelData && excelData.length > 0) {
                    for (const result of categoryResults) {
                        if (!result.error && !result.noAdsFound) {
                            const validation = validateSingleResult(result, excelData, 'mix-in-ad');
                            result.validation = validation;
                        }
                    }
                }

                if (categoryResults.length > 0) {
                    const activityResults = categoryResults.map(result => ({
                        culture: result.culture,
                        category: result.category,
                        mainCategory: result.mainCategory,
                        adIndex: result.adIndex,
                        position: result.position,
                        width: result.width,
                        error: result.error,
                        message: result.message,
                        noAdsFound: result.noAdsFound,
                        validation: result.validation,
                        addToCartResult: result.addToCartResult,
                        href: result.href,
                        target: result.target,
                        imageLocale: result.imageLocale,
                        url: result.url,
                        timestamp: result.timestamp
                    }));

                    this.emitProgress({
                        type: 'add-to-cart-complete',
                        culture: job.culture,
                        category: job.category,
                        mainCategory: job.mainCategory,
                        result: {
                            url: job.url,
                            results: activityResults
                        }
                    });
                }
            }

        } catch (err) {
            log('error', 'FATAL ERROR during mix-in ad capture', { error: err.message, stack: err.stack });
            this.emit('error', { message: err.message });
        } finally {
            await this.closeBrowser();

            this.isRunning = false;

            const duration = Date.now() - startTime;
            const successCount = this.results.filter(r => !r.error && !r.noAdsFound).length;
            const errorCount = this.results.filter(r => r.error).length;
            const noAdsCount = this.results.filter(r => r.noAdsFound).length;

            log('info', '========================================');
            log('info', 'MIX-IN AD CAPTURE PROCESS COMPLETE');
            log('info', '========================================');
            log('info', 'Results summary', { duration, successCount, errorCount, noAdsCount, total: this.results.length });

            if (!this.shouldStop) {
                this.emitStatus( {
                    type: 'completed',
                    results: this.results,
                    duration,
                    successCount,
                    errorCount,
                    noAdsCount
                });
            } else {
                this.emitStatus( {
                    type: 'cancelled',
                    results: this.results,
                    duration,
                    successCount,
                    errorCount,
                    noAdsCount
                });
            }
        }

        return {
            results: this.results,
            duration: Date.now() - startTime
        };
    }

    // Build job list from options (reuse banner's category structure)
    buildJobList(options) {
        const jobs = [];
        const { environment, region, cultures, categories } = options;

        const regionConfig = config.mixinad.regions[region];
        if (!regionConfig) {
            log('error', 'Invalid mix-in ad region', { region });
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
                      let path = item.path;
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
 * Get or create the singleton MixInAdProcessor instance
 * @returns {MixInAdProcessor} The singleton instance
 */
export function getMixInAdProcessor() {
    return getSingleton('MixInAdProcessor', () => new MixInAdProcessor());
}
