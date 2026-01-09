// mixinad-processor.js - Playwright Mix-In Ad processing engine

import { BaseProcessor, log } from './base-processor.js';
import { config, buildBannerUrl } from '../config.js';
import { detectImageLocale } from '../utils/image-utils.js';
import { MEMORY } from '../utils/constants.js';
import { validateSingleResult } from '../utils/excel-validation.js';

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
                    imageAlt: anchor?.getAttribute('aria-label') || ''
                });
            });

            return adInfos;
        }, config.mixinad.selector);

        return results;
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
            if (!meta.skipAuthCheck && (meta.environment === 'stage' || meta.environment === 'uat')) {
                const isMicrosoftLogin = page.url().includes('login.microsoftonline.com') ||
                    page.url().includes('login.windows.net');
                if (isMicrosoftLogin) {
                    log('info', 'Detected Microsoft login page, waiting for user to sign in...');
                    await this.waitForManualAuth(meta.environment.toUpperCase());

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
        const selectedWidths = options.widths || config.mixinad.defaults.widths;

        // Note: totalCaptures is estimated - actual count depends on how many ads per page
        const estimatedCaptures = jobs.length * selectedWidths.length;
        const totalCategories = jobs.length;

        log('info', `Total categories: ${totalCategories}, Widths: ${selectedWidths.length}, Estimated captures: ${estimatedCaptures}`);

        this.emit('status', {
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

            await this.createContext({
                viewport: { width: initialWidth, height: config.mixinad.browser.captureHeight },
                userAgent: config.mixinad.browser.userAgent,
                isMobile: config.mixinad.browser.isMobile,
                hasTouch: config.mixinad.browser.hasTouch,
                deviceScaleFactor: config.mixinad.browser.deviceScaleFactor
            });
            await this.createPage();

            // Handle authentication ONCE before the capture loop for stage/uat
            let hasAuthenticated = false;
            if ((options.environment === 'stage' || options.environment === 'uat') && jobs.length > 0) {
                log('info', 'Performing initial authentication check...');
                const firstJob = jobs[0];
                await this.page.goto(firstJob.url, {
                    waitUntil: 'load',
                    timeout: config.mixinad.timeouts.singleCapture
                });
                await this.page.waitForTimeout(config.mixinad.timeouts.pageLoad);

                const isMicrosoftLogin = this.page.url().includes('login.microsoftonline.com') ||
                    this.page.url().includes('login.windows.net');
                if (isMicrosoftLogin) {
                    log('info', 'Detected Microsoft login page, waiting for user to sign in...');
                    await this.waitForManualAuth(options.environment.toUpperCase());
                    hasAuthenticated = true;
                }
            }

            // Process each job (category)
            let completedCategories = 0;
            for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
                const job = jobs[jobIndex];
                if (this.shouldStop) break;

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
                        currentBanner: jobIndex + 1,
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
                            skipAuthCheck: hasAuthenticated
                        });

                        // pageResults is an array (one result per ad found, or one error/noAdsFound result)
                        for (const result of pageResults) {
                            this.results.push(result);
                        }

                        // Warn about memory usage for very large test runs
                        if (this.results.length % MEMORY.SCREENSHOT_WARNING_INTERVAL === 0 && this.results.length > 0) {
                            log('warn', `${this.results.length} screenshots captured. Large test runs may consume significant memory.`);
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
                            currentBanner: jobIndex + 1,
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
                this.emit('status', {
                    type: 'completed',
                    results: this.results,
                    duration,
                    successCount,
                    errorCount,
                    noAdsCount
                });
            } else {
                this.emit('status', {
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

export function getMixInAdProcessor() {
    if (!processorInstance) {
        processorInstance = new MixInAdProcessor();
    }
    return processorInstance;
}
