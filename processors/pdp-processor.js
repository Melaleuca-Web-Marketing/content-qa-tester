// pdp-processor.js - PDP Tester processing engine

import { BaseProcessor, log, summarizeOptions } from './base-processor.js';
import { config, buildPdpUrl } from '../config.js';
import { getSingleton } from '../utils/singleton.js';

export class PDPProcessor extends BaseProcessor {
  constructor() {
    super('PDP');
  }

  // Perform login - goes to home page, clicks sign in, fills form
  async login(username, password, environment, region) {
    const baseUrl = config.environments[environment]?.[region];
    if (!baseUrl) {
      return { success: false, error: 'Invalid environment or region' };
    }

    const selectors = config.pdp.selectors.login;
    const timeouts = config.pdp.timeouts;

    return await this.loginToMelaleuca({
      baseUrl,
      environment,
      username,
      password,
      selectors: {
        homePageSignInButton: selectors.homePageSignInButton,
        loginUsernameField: selectors.username,
        loginPasswordField: selectors.password,
        loginSubmitButton: selectors.loginButton,
        loginErrorMessage: selectors.errorMessage
      },
      timeouts
    });
  }

  // Warm lazy images by scrolling through the page
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

  // Wait for images to load
  async waitForImagesToLoad() {
    await this.page.evaluate(async ({ timeoutMs }) => {
      const images = Array.from(document.querySelectorAll('img'));
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
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
    }, { timeoutMs: config.pdp.timeouts.imageLoad });
  }

  // Open all accordions on the page so content is visible in screenshots
  async openAllAccordions() {
    const accordionCount = await this.page.evaluate(() => {
      let opened = 0;

      // Method 1: Click all accordion togglers with data-accord="toggler"
      const togglers = document.querySelectorAll('[data-accord="toggler"]');
      togglers.forEach(toggler => {
        const isExpanded = toggler.getAttribute('aria-expanded') === 'true';
        if (!isExpanded) {
          toggler.click();
          opened++;
        }
      });

      // Method 2: Directly show hidden accordion content (as backup)
      const hiddenContent = document.querySelectorAll('.o-LTEAccordion__content.hidden');
      hiddenContent.forEach(content => {
        content.classList.remove('hidden');
      });

      // Method 3: Handle other common accordion patterns
      // Details/summary elements
      const details = document.querySelectorAll('details:not([open])');
      details.forEach(detail => {
        detail.setAttribute('open', '');
        opened++;
      });

      // Bootstrap-style accordions
      const collapsedPanels = document.querySelectorAll('.collapse:not(.show)');
      collapsedPanels.forEach(panel => {
        panel.classList.add('show');
      });

      return opened;
    });

    if (accordionCount > 0) {
      log('debug', `Opened ${accordionCount} accordions`);
      // Wait for accordion animations to complete
      await this.page.waitForTimeout(500);
    }
  }

  // Capture screenshots at all viewport widths
  async captureScreenshots() {
    const screenshots = [];
    const widths = this.currentOptions?.screenWidths || config.pdp.screenWidths;

    for (const width of widths) {
      log('debug', `Capturing screenshot at ${width}px width`);

      this.emit('progress', {
        type: 'pdp-screenshot',
        status: `Capturing screenshot at ${width}px`,
        width
      });

      // Set viewport width
      await this.page.setViewportSize({ width, height: 1080 });
      await this.page.waitForTimeout(500);

      // Warm lazy images and wait for them to load
      await this.warmLazyImages();
      await this.waitForImagesToLoad();
      await this.page.waitForTimeout(config.pdp.timeouts.screenshotDelay);

      // Capture full page screenshot
      const screenshotBuffer = await this.page.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: 80
      });

      screenshots.push({
        width,
        data: `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`
      });

      log('debug', `Screenshot captured at ${width}px`);
    }

    return screenshots;
  }

  // Detect content type in "About This Product" section
  async detectContentType() {
    return await this.page.evaluate((selectors) => {
      const aboutSection = document.querySelector(selectors.aboutSection);

      if (!aboutSection) {
        return { type: 'nothing', reason: 'About section not found' };
      }

      // Find the content container (skip the header)
      const contentContainer = aboutSection.querySelector(':scope > div');

      if (!contentContainer) {
        return { type: 'nothing', reason: 'Content container not found' };
      }

      // Check if content container is empty
      const hasContent = contentContainer.innerHTML.trim().length > 0;
      if (!hasContent) {
        return { type: 'nothing', reason: 'Content container is empty' };
      }

      // Check for rich media elements (images, links with images)
      const hasImages = contentContainer.querySelector('img, picture, [style*="background-image"]');
      const hasMultipleElements = contentContainer.children.length > 1 ||
        (contentContainer.children[0] && contentContainer.children[0].children.length > 1);

      // Check if it's just text content
      const textContent = contentContainer.textContent?.trim() || '';
      const hasTextOnly = textContent.length > 0 && !hasImages;

      if (hasImages || hasMultipleElements) {
        return { type: 'pdp', reason: 'Rich content with images or multiple sections' };
      }

      if (hasTextOnly) {
        return { type: 'longDescription', reason: 'Text content only, no images' };
      }

      return { type: 'nothing', reason: 'No meaningful content found' };
    }, config.pdp.selectors);
  }

  // Extract sections from "About This Product" content
  async extractSections() {
    return await this.page.evaluate((selectors) => {
      const sections = [];

      const aboutSection = document.querySelector(selectors.aboutSection);
      if (!aboutSection) return sections;

      const contentContainer = aboutSection.querySelector(':scope > div');
      if (!contentContainer) return sections;

      // Helper function to check if element has meaningful content
      const hasContent = (element) => {
        if (element.querySelector('img, picture')) return true;
        if (element.querySelector('a[href]')) return true;
        const text = element.textContent?.trim();
        if (text && text.length > 0) return true;
        const style = element.getAttribute('style') || '';
        if (style.includes('background-image')) return true;
        if (element.querySelector('[style*="background-image"]')) return true;
        return false;
      };

      // Helper function to extract background image URL
      const extractBackgroundUrl = (style) => {
        const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        return match ? match[1] : null;
      };

      // Helper function to determine target behavior
      const determineTarget = (anchor) => {
        const target = anchor.getAttribute('target');
        if (!target || target === '' || target === '|Custom') return 'same tab';
        if (target === '_blank') return 'new tab';
        return 'same tab';
      };

      // Helper function to extract all images from an element
      const extractAllImages = (element) => {
        const images = [];

        // Pattern 1: <picture> elements with <source>
        element.querySelectorAll('picture').forEach(picture => {
          const sources = {};
          const img = picture.querySelector('img');

          // Desktop source
          const desktopSource = picture.querySelector('source[media*="1024px"], source[media*="min-width: 1024"]');
          if (desktopSource) {
            sources.desktop = { url: desktopSource.getAttribute('srcset'), alt: img?.alt || '' };
          }

          // Tablet source
          const tabletSource = picture.querySelector('source[media*="768px"], source[media*="min-width: 768"]');
          if (tabletSource) {
            sources.tablet = { url: tabletSource.getAttribute('srcset'), alt: img?.alt || '' };
          }

          // Mobile source
          const mobileSource = picture.querySelector('source[media*="575px"], source[media*="max-width: 575"]');
          if (mobileSource) {
            sources.mobile = { url: mobileSource.getAttribute('srcset'), alt: img?.alt || '' };
          }

          images.push({
            type: 'picture',
            sources,
            url: img?.src || '',
            alt: img?.alt || '',
            visibility: 'all'
          });
        });

        // Pattern 2: Standalone <img> elements (not in <picture>)
        element.querySelectorAll('img').forEach(img => {
          if (img.closest('picture')) return; // Skip if already in picture

          const classList = Array.from(img.classList);
          let visibility = 'all';
          if (classList.some(c => c.includes('hidden') && classList.some(c2 => c2.includes('md:block')))) {
            visibility = 'desktop-only';
          } else if (classList.some(c => c.includes('md:hidden'))) {
            visibility = 'mobile-only';
          }

          images.push({
            type: 'img',
            sources: {},
            url: img.src || img.getAttribute('data-src') || '',
            alt: img.alt || '',
            visibility
          });
        });

        // Pattern 3: Background images
        element.querySelectorAll('[style*="background-image"]').forEach(el => {
          const style = el.getAttribute('style') || '';
          const url = extractBackgroundUrl(style);
          if (!url) return;

          const classList = Array.from(el.classList);
          let visibility = 'all';
          if (classList.some(c => c.includes('-desktop') || c === 'desktop')) {
            visibility = 'desktop-only';
          } else if (classList.some(c => c.includes('-mobile') || c === 'mobile')) {
            visibility = 'mobile-only';
          }

          images.push({
            type: 'background',
            sources: {},
            url,
            alt: '',
            visibility
          });
        });

        return images;
      };

      // Helper function to extract all links from an element
      const extractAllLinks = (element) => {
        const links = [];

        element.querySelectorAll('a[href]').forEach(anchor => {
          links.push({
            url: anchor.getAttribute('href'),
            target: determineTarget(anchor),
            text: anchor.textContent?.trim() || '',
            ariaLabel: anchor.getAttribute('aria-label') || ''
          });
        });

        return links;
      };

      // Helper function to determine section content type
      const determineSectionContentType = (element) => {
        const hasImages = element.querySelector('img, picture, [style*="background-image"]');
        const hasLinks = element.querySelector('a[href]');
        const hasText = element.textContent?.trim().length > 0;

        if (hasImages && hasLinks) return 'banner';
        if (hasImages && hasText) return 'content';
        if (hasImages) return 'image';
        if (hasLinks && hasText) return 'navigation';
        if (hasText) return 'text';
        return 'unknown';
      };

      // Helper function to check if element is a wrapper container (not a section itself)
      const isWrapperContainer = (element) => {
        const tagName = element.tagName.toLowerCase();
        const classList = Array.from(element.classList);

        // FIRST: Check if this is a flex or grid container - these are ALWAYS single sections, not wrappers
        // Elements with flex/grid classes should be treated as single cohesive layout sections
        const isFlexOrGridContainer = classList.some(c =>
          c === 'flex' || c === 'grid' ||
          c.includes(':flex') || c.includes(':grid') ||  // responsive flex like md:flex
          c.startsWith('flex-') || c.startsWith('grid-')
        );
        if (isFlexOrGridContainer) return false;  // Not a wrapper, it's a layout section

        // Check for common wrapper container class patterns
        const wrapperPatterns = [
          'o-widthControl',
          'container',
          'wrapper'
        ];
        const hasWrapperClass = wrapperPatterns.some(pattern =>
          classList.some(c => c.includes(pattern) || c === pattern)
        );

        // Check for layout container classes (mx-auto, max-w-contain, etc.)
        const isLayoutContainer = classList.includes('mx-auto') &&
          (classList.some(c => c.includes('max-w-')) || classList.some(c => c.includes('w-full')));

        // Check if it's an empty div wrapper (div with only structural children, no direct text)
        const isEmptyDivWrapper = tagName === 'div' && element.children.length > 0 && (() => {
          const children = Array.from(element.children);
          const hasOnlyStructuralChildren = children.every(child => {
            const childTag = child.tagName.toLowerCase();
            return childTag === 'div' || childTag === 'article' || childTag === 'section';
          });

          const directText = Array.from(element.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim())
            .join('');

          return hasOnlyStructuralChildren && directText.length === 0;
        })();

        // Check if it's a div with multiple meaningful children (mixed content wrapper)
        // This handles cases where a div contains articles, other divs, AND standalone images
        // Note: Flex/grid containers are already excluded at the top of isWrapperContainer
        const isMixedContentWrapper = tagName === 'div' && element.children.length > 1 && (() => {
          const children = Array.from(element.children);
          const childrenWithContent = children.filter(child => hasContent(child));

          // Count how many children are "section-like" (articles, divs with content, etc.)
          const sectionLikeChildren = childrenWithContent.filter(child => {
            const childTag = child.tagName.toLowerCase();
            // Articles are always section-like
            if (childTag === 'article') return true;
            // Divs with classes that indicate they're components (not just wrappers)
            if (childTag === 'div') {
              const childClasses = Array.from(child.classList);
              // If it has component-like classes, it's a section
              const hasComponentClass = childClasses.some(c =>
                c.startsWith('m-') || c.startsWith('o-') || c.startsWith('a-') ||
                c.includes('text-') || c.includes('py-') || c.includes('px-') ||
                c.includes('flex') || c.includes('grid')
              );
              if (hasComponentClass) return true;
              // If it's a plain div, check if it contains meaningful content
              return child.querySelector('article, img, picture, a[href]') !== null;
            }
            // Standalone images at root level are sections
            if (childTag === 'img' || childTag === 'picture') return true;
            return false;
          });

          // If we have multiple section-like children, this is a wrapper
          return sectionLikeChildren.length > 1;
        })();

        // Check if it's a wrapper based on class patterns, empty structure, or mixed content
        if (hasWrapperClass || isLayoutContainer || isEmptyDivWrapper || isMixedContentWrapper) {
          const childrenWithContent = Array.from(element.children).filter(child => hasContent(child));
          return childrenWithContent.length > 0;
        }

        return false;
      };

      // Helper function to create a section object from an element
      const createSection = (element) => {
        // Add a unique data attribute to identify this section for screenshots
        const sectionIndex = sections.length + 1;
        const sectionId = `pdp-section-${sectionIndex}`;
        element.setAttribute('data-pdp-section-id', sectionId);

        return {
          index: sectionIndex,
          sectionId: sectionId,
          tagName: element.tagName.toLowerCase(),
          classes: Array.from(element.classList),
          contentType: determineSectionContentType(element),
          images: extractAllImages(element),
          links: extractAllLinks(element),
          textContent: (element.textContent?.trim() || '').substring(0, 500)
        };
      };

      // Recursive function to process elements and extract sections
      const processElement = (element) => {
        // Skip empty elements
        if (!hasContent(element)) return;

        // Check if this is a wrapper container
        if (isWrapperContainer(element)) {
          // Process children of wrapper as sections instead
          Array.from(element.children).forEach(child => {
            processElement(child);
          });
        } else {
          // This is an actual section
          sections.push(createSection(element));
        }
      };

      // Get all direct children of the content container and process them
      const children = Array.from(contentContainer.children);
      children.forEach(element => {
        processElement(element);
      });

      return sections;
    }, config.pdp.selectors);
  }

  // Capture screenshots of individual sections
  async captureSectionScreenshots(sections) {
    const screenshotSections = [];

    for (const section of sections) {
      try {
        // Find the section element using the data attribute we added
        const sectionElement = await this.page.$(`[data-pdp-section-id="${section.sectionId}"]`);

        if (sectionElement) {
          // Get the bounding box to check if element is visible
          const boundingBox = await sectionElement.boundingBox();

          if (boundingBox && boundingBox.height > 0) {
            // Scroll element into view
            await sectionElement.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(300);

            // Capture screenshot of just this section
            const screenshotBuffer = await sectionElement.screenshot({
              type: 'jpeg',
              quality: 85
            });

            screenshotSections.push({
              ...section,
              screenshot: `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`,
              dimensions: {
                width: Math.round(boundingBox.width),
                height: Math.round(boundingBox.height)
              }
            });

            log('debug', `Captured screenshot for section ${section.index}`, {
              sectionId: section.sectionId,
              width: boundingBox.width,
              height: boundingBox.height
            });
          } else {
            // Element not visible, include section without screenshot
            screenshotSections.push({
              ...section,
              screenshot: null,
              dimensions: null
            });
            log('warn', `Section ${section.index} not visible for screenshot`);
          }
        } else {
          // Element not found, include section without screenshot
          screenshotSections.push({
            ...section,
            screenshot: null,
            dimensions: null
          });
          log('warn', `Section ${section.index} element not found`);
        }
      } catch (err) {
        log('error', `Error capturing section ${section.index} screenshot`, { error: err.message });
        screenshotSections.push({
          ...section,
          screenshot: null,
          dimensions: null,
          screenshotError: err.message
        });
      }
    }

    return screenshotSections;
  }

  // Extract long description text
  async extractLongDescription() {
    return await this.page.evaluate((selectors) => {
      const aboutSection = document.querySelector(selectors.aboutSection);
      if (!aboutSection) return { text: '' };

      const contentContainer = aboutSection.querySelector(':scope > div');
      if (!contentContainer) return { text: '' };

      return {
        text: contentContainer.textContent?.trim() || ''
      };
    }, config.pdp.selectors);
  }

  // Process a single SKU
  async processSku(sku, currentIndex, total, culture) {
    const options = this.currentOptions;
    const url = buildPdpUrl(options.environment, options.region, culture, sku);

    log('debug', `Processing SKU ${currentIndex}/${total}`, { sku, culture, url });

    this.emit('progress', {
      type: 'pdp-start',
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
      contentType: null,
      sections: [],
      longDescription: null,
      screenshots: []
    };

    try {
      log('debug', `Navigating to URL: ${url}`);

      const response = await this.page.goto(url, {
        waitUntil: 'load',
        timeout: config.pdp.timeouts.pageLoad
      });

      log('debug', 'Page navigation complete', {
        status: response?.status(),
        url: response?.url()
      });

      // Wait for page to settle
      await this.page.waitForTimeout(config.pdp.timeouts.screenshotDelay);

      if (this.shouldStop) {
        log('info', 'Capture cancelled by user');
        result.error = 'Capture cancelled';
        return result;
      }

      // Step 1: Open all accordions so content is visible
      log('debug', 'Opening all accordions...');
      await this.openAllAccordions();

      // Step 2: Capture screenshots at all viewport widths
      log('debug', 'Capturing screenshots at all viewport widths...');
      this.emit('progress', {
        type: 'pdp-status',
        sku,
        culture,
        current: currentIndex,
        total,
        status: 'Capturing screenshots',
        url
      });

      result.screenshots = await this.captureScreenshots();
      log('debug', `Captured ${result.screenshots.length} screenshots`);

      if (this.shouldStop) {
        log('info', 'Capture cancelled by user');
        result.error = 'Capture cancelled';
        return result;
      }

      // Step 3: Reset viewport to desktop for data extraction
      await this.page.setViewportSize({ width: 1210, height: 1080 });
      await this.page.waitForTimeout(500);

      // Step 4: Detect content type
      log('debug', 'Detecting content type...');
      this.emit('progress', {
        type: 'pdp-status',
        sku,
        culture,
        current: currentIndex,
        total,
        status: 'Detecting content type',
        url
      });

      const contentTypeResult = await this.detectContentType();
      result.contentType = contentTypeResult.type;
      log('debug', `Content type: ${result.contentType}`, { reason: contentTypeResult.reason });

      // Step 5: Extract section data based on content type
      if (result.contentType === 'pdp') {
        log('debug', 'Extracting PDP sections...');
        this.emit('progress', {
          type: 'pdp-status',
          sku,
          culture,
          current: currentIndex,
          total,
          status: 'Extracting sections',
          url
        });

        const extractedSections = await this.extractSections();
        log('debug', `Extracted ${extractedSections.length} sections`);

        // Step 5: Capture desktop screenshots of each section
        if (extractedSections.length > 0) {
          log('debug', 'Capturing section screenshots...');
          this.emit('progress', {
            type: 'pdp-status',
            sku,
            culture,
            current: currentIndex,
            total,
            status: `Capturing ${extractedSections.length} section screenshots`,
            url
          });

          // Ensure we're at desktop viewport for section screenshots
          await this.page.setViewportSize({ width: 1210, height: 1080 });
          await this.warmLazyImages();
          await this.waitForImagesToLoad();
          await this.page.waitForTimeout(500);

          result.sections = await this.captureSectionScreenshots(extractedSections);
          log('debug', `Captured screenshots for ${result.sections.length} sections`);
        } else {
          result.sections = extractedSections;
        }
      } else if (result.contentType === 'longDescription') {
        log('debug', 'Extracting long description...');
        result.longDescription = await this.extractLongDescription();
      }

      result.success = true;
      log('debug', `SKU ${sku} processed successfully`);

      this.emit('progress', {
        type: 'pdp-complete',
        sku,
        culture,
        current: currentIndex,
        total,
        status: 'Complete',
        url,
        data: {
          contentType: result.contentType,
          sectionCount: result.sections.length,
          screenshotCount: result.screenshots.length
        }
      });

    } catch (err) {
      log('error', `Error processing SKU ${sku}`, { error: err.message, stack: err.stack });
      result.error = err.message;
      this.emit('progress', {
        type: 'pdp-error',
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
    log('info', 'STARTING PDP CAPTURE PROCESS');
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

    this.emitStatus({
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

        log('info', 'Login successful, proceeding with PDP capture');
        await this.page.waitForTimeout(2000);
      }

      // Process each SKU
      log('info', `Processing ${options.skus.length} SKUs across ${selectedCultures.length} cultures...`);
      let runIndex = 0;
      outer: for (const culture of selectedCultures) {
        for (let i = 0; i < options.skus.length; i++) {
          if (this.shouldStop) {
            log('info', 'Capture stopped by user');
            this.emitStatus({ type: 'cancelled', results: this.results });
            break outer;
          }

          const sku = options.skus[i];
          log('debug', `\n--- Processing SKU ${sku} (${culture}) ---`);
          const result = await this.processSku(sku, runIndex + 1, totalRuns, culture);
          this.results.push(result);
          runIndex += 1;

          // Wait between SKUs
          if (runIndex < totalRuns && !this.shouldStop) {
            log('debug', `Waiting ${config.pdp.timeouts.betweenSkus}ms before next SKU...`);
            await this.page.waitForTimeout(config.pdp.timeouts.betweenSkus);
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
      log('info', 'PDP CAPTURE PROCESS COMPLETE');
      log('info', '========================================');
      log('info', 'Results summary', { duration, successCount, errorCount, totalSkus: this.results.length });

      if (!this.shouldStop) {
        this.emitStatus({
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

  // Override getResults to return structured data with environment, region, culture
  getResults() {
    const options = this.currentOptions || {};
    const cultures = options.cultures || (options.culture ? [options.culture] : []);

    // Group results by culture for multi-culture runs
    if (cultures.length > 1) {
      const runs = cultures.map(culture => ({
        culture,
        environment: options.environment,
        region: options.region,
        results: this.results.filter(r => r.culture === culture)
      }));

      return {
        environment: options.environment,
        region: options.region,
        cultures,
        runs
      };
    }

    // Single culture run
    return {
      environment: options.environment,
      region: options.region,
      culture: cultures[0] || options.culture,
      results: this.results
    };
  }
}

/**
 * Get or create the singleton PDPProcessor instance
 * @returns {PDPProcessor} The singleton instance
 */
export function getPdpProcessor() {
  return getSingleton('PDPProcessor', () => new PDPProcessor());
}
