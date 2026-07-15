// page-processor.js - Generic any-page content tester processing engine
//
// Tests arbitrary melaleuca.com pages (paths or full URLs) across cultures and
// auth modes (signed out / signed in), focused on CONTENT. For each page it:
//   - captures full-page screenshots at the selected viewport widths
//   - breaks the page's main content into numbered sections and captures a
//     screenshot of each, along with a per-section image alt-text audit and
//     link inventory (mirrors the PDP tester's "Content Sections" breakdown)
//   - records page metadata (title / description / headings / lang) and a known
//     Melaleuca component inventory
// Optionally runs an AI review over the collected results.

import { BaseProcessor, log } from './base-processor.js';
import { config, getBaseUrl, buildPageTestUrl } from '../config.js';
import { reviewPageResults, isAiReviewAvailable, getAiModel } from '../utils/ai-reviewer.js';

const MAX_SECTIONS = 40;

export class PageProcessor extends BaseProcessor {
  constructor() {
    super('Page');
    this.aiReview = null;
  }

  // Perform Melaleuca site login for signed-in testing (reuses BaseProcessor flow)
  async login(username, password, environment, region) {
    const baseUrl = getBaseUrl(environment, region);
    if (!baseUrl) {
      return { success: false, error: 'Invalid environment or region' };
    }

    const selectors = config.page.selectors.login;
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
      timeouts: config.page.timeouts
    });
  }

  normalizeOptions(options) {
    const defaults = config.page.defaults;
    return {
      ...options,
      cultures: Array.isArray(options.cultures) && options.cultures.length > 0
        ? options.cultures
        : [options.culture || defaults.culture],
      authModes: Array.isArray(options.authModes) && options.authModes.length > 0
        ? options.authModes
        : [...defaults.authModes],
      widths: Array.isArray(options.widths) && options.widths.length > 0
        ? options.widths.map(Number).filter(Number.isFinite)
        : [...defaults.widths]
    };
  }

  async start(options) {
    if (this.isRunning) {
      throw new Error('Page test already in progress');
    }

    const normalized = this.normalizeOptions(options);
    this.isRunning = true;
    this.shouldStop = false;
    this.results = [];
    this.aiReview = null;
    this.currentOptions = normalized;

    const { pages, cultures, authModes, environment, region } = normalized;
    const total = pages.length * cultures.length * authModes.length;
    const startTime = Date.now();

    log('info', 'Starting page content test run', {
      environment,
      region,
      pageCount: pages.length,
      cultures,
      authModes,
      widths: normalized.widths,
      aiReview: normalized.aiReview === true,
      total
    });

    this.emitStatus({
      type: 'started',
      pageCount: pages.length,
      total,
      environment,
      region
    });

    let current = 0;

    try {
      await this.launchBrowser();

      for (const culture of cultures) {
        if (this.shouldStop) break;

        for (const authMode of authModes) {
          if (this.shouldStop) break;

          const laneLabel = `${culture} / ${authMode === 'signedIn' ? 'signed in' : 'signed out'}`;
          log('info', `Preparing test lane: ${laneLabel}`);

          await this.createContext();
          await this.createPage();

          try {
            await this.prepareLane(normalized, culture, authMode, laneLabel);

            for (const pageEntry of pages) {
              if (this.shouldStop) break;
              current++;

              const result = await this.testPage(normalized, pageEntry, culture, authMode, current, total);
              this.results.push(result);

              if (result.success) {
                this.emitProgress({
                  type: 'page-complete',
                  page: pageEntry,
                  url: result.url,
                  culture,
                  authMode,
                  current,
                  total,
                  data: {
                    issueCount: result.issues.length,
                    issues: result.issues,
                    sectionCount: result.sections.length,
                    screenshotCount: result.screenshots.length,
                    httpStatus: result.httpStatus,
                    loadTimeMs: result.loadTimeMs
                  }
                });
              } else {
                this.emitProgress({
                  type: 'page-error',
                  page: pageEntry,
                  url: result.url,
                  culture,
                  authMode,
                  current,
                  total,
                  error: result.error
                });
              }

              await this.page.waitForTimeout(config.page.timeouts.betweenPages);
            }
          } catch (laneErr) {
            // A lane-level failure (auth failed, cancelled) marks remaining pages in the lane as failed
            log('error', `Test lane failed: ${laneLabel}`, { error: laneErr.message });
            if (this.shouldStop) throw laneErr;
            for (const pageEntry of pages.slice(this.results.filter(r => r.culture === culture && r.authMode === authMode).length)) {
              current++;
              const failed = this.buildFailedResult(normalized, pageEntry, culture, authMode, laneErr.message);
              this.results.push(failed);
              this.emitProgress({
                type: 'page-error',
                page: pageEntry,
                url: failed.url,
                culture,
                authMode,
                current,
                total,
                error: laneErr.message
              });
            }
          } finally {
            if (this.context) {
              await this.context.close().catch(() => {});
              this.context = null;
              this.page = null;
            }
          }
        }
      }

      // AI review pass over collected results
      if (!this.shouldStop && normalized.aiReview === true && this.results.length > 0) {
        if (isAiReviewAvailable()) {
          this.emitProgress({
            type: 'ai-review',
            status: `AI review in progress (${getAiModel()})...`,
            current,
            total
          });
          this.aiReview = await reviewPageResults(this.results, {
            environment,
            region,
            cultures,
            authModes,
            testName: normalized.testName || null
          });
          this.attachAiReviewToResults();
        } else {
          log('warn', 'AI review requested but ANTHROPIC_API_KEY is not configured - skipping');
          this.aiReview = { enabled: false, reason: 'ANTHROPIC_API_KEY not configured on the server' };
          this.attachAiReviewToResults();
        }
      }

      const duration = Date.now() - startTime;
      const successCount = this.results.filter(r => r.success).length;
      const errorCount = this.results.filter(r => !r.success).length;

      if (this.shouldStop) {
        log('info', 'Page test cancelled', { completed: this.results.length, duration });
        this.emitStatus({ type: 'cancelled', results: this.results.map(r => ({ success: r.success })) });
      } else {
        log('info', 'Page test completed', { successCount, errorCount, duration });
        this.emitStatus({
          type: 'completed',
          duration,
          successCount,
          errorCount,
          resultsCount: this.results.length
        });
      }
    } catch (err) {
      log('error', 'Page test run failed', { error: err.message });
      if (this.shouldStop) {
        this.emitStatus({ type: 'cancelled', results: this.results.map(r => ({ success: r.success })) });
      } else {
        this.emitError({ message: err.message });
        const duration = Date.now() - startTime;
        this.emitStatus({
          type: 'completed',
          duration,
          successCount: this.results.filter(r => r.success).length,
          errorCount: this.results.filter(r => !r.success).length,
          resultsCount: this.results.length
        });
      }
    } finally {
      await this.closeBrowser();
      this.isRunning = false;
      this.shouldStop = false;
    }

    return this.results;
  }

  // Attach per-page AI findings and the overall summary onto result objects so
  // the report generator (which only receives results) can render them.
  attachAiReviewToResults() {
    if (!this.aiReview) return;

    if (this.results.length > 0) {
      this.results[0].aiOverall = {
        enabled: this.aiReview.enabled,
        model: this.aiReview.model || null,
        overallSummary: this.aiReview.overallSummary || null,
        overallStatus: this.aiReview.overallStatus || null,
        error: this.aiReview.error || this.aiReview.reason || null
      };
    }

    const reviews = Array.isArray(this.aiReview.pages) ? this.aiReview.pages : [];
    for (const review of reviews) {
      const match = this.results.find(r =>
        r.url === review.url &&
        r.authMode === review.authMode &&
        (!review.culture || r.culture === review.culture) &&
        !r.aiReview
      );
      if (match) {
        match.aiReview = {
          verdict: review.verdict,
          summary: review.summary,
          findings: Array.isArray(review.findings) ? review.findings : []
        };
      } else {
        log('debug', '[AI Review] Could not match review to a result', { url: review.url, authMode: review.authMode });
      }
    }
  }

  // Prepare a (culture, authMode) lane: handle stage/UAT gateway auth and site login
  async prepareLane(options, culture, authMode, laneLabel) {
    const { environment, region, username, password } = options;
    const baseUrl = getBaseUrl(environment, region);
    if (!baseUrl) {
      throw new Error('Invalid environment or region');
    }

    this.emitProgress({
      type: 'lane-start',
      status: `Preparing ${laneLabel}`,
      culture,
      authMode
    });

    // Navigate to the site root first; stage/UAT environments sit behind Microsoft auth
    await this.page.goto(`${baseUrl}/?sc_lang=${culture}`, {
      waitUntil: 'load',
      timeout: config.page.timeouts.pageLoad
    });
    await this.page.waitForTimeout(1500);
    await this.handleMicrosoftAuthIfNeeded(environment, username, password);

    if (authMode === 'signedIn') {
      this.emitProgress({
        type: 'login',
        status: `Signing in (${laneLabel})`,
        culture,
        authMode
      });
      const loginResult = await this.login(username, password, environment, region);
      if (!loginResult.success) {
        throw new Error(`Login failed: ${loginResult.error || 'unknown error'}`);
      }
      log('info', `Signed in successfully for lane: ${laneLabel}`);
    }
  }

  buildFailedResult(options, pageEntry, culture, authMode, errorMessage) {
    return {
      page: pageEntry,
      url: buildPageTestUrl(options.environment, options.region, culture, pageEntry) || pageEntry,
      environment: options.environment,
      region: options.region,
      culture,
      authMode,
      success: false,
      error: errorMessage,
      issues: [errorMessage],
      checks: {},
      sections: [],
      screenshots: [],
      timestamp: new Date().toISOString()
    };
  }

  // Test a single page in the current context
  async testPage(options, pageEntry, culture, authMode, current, total) {
    const url = buildPageTestUrl(options.environment, options.region, culture, pageEntry);
    const timestamp = new Date().toISOString();

    this.emitProgress({
      type: 'page-start',
      page: pageEntry,
      url,
      culture,
      authMode,
      current,
      total,
      status: 'Navigating'
    });

    if (!url) {
      return this.buildFailedResult(options, pageEntry, culture, authMode, 'Could not build a valid URL for this page entry');
    }

    try {
      const navStart = Date.now();
      let response;
      try {
        response = await this.page.goto(url, {
          waitUntil: 'load',
          timeout: config.page.timeouts.pageLoad
        });
      } catch (navErr) {
        return {
          ...this.buildFailedResult(options, pageEntry, culture, authMode, `Navigation failed: ${navErr.message}`),
          url
        };
      }
      const loadTimeMs = Date.now() - navStart;

      // Collect redirect chain from the final request backwards
      const redirectChain = [];
      let req = response ? response.request().redirectedFrom() : null;
      while (req && redirectChain.length < 10) {
        redirectChain.unshift(req.url());
        req = req.redirectedFrom();
      }

      const httpStatus = response ? response.status() : null;

      // Let SPA hydration and lazy content settle
      await this.page.waitForTimeout(config.page.timeouts.settle);

      this.emitProgress({
        type: 'page-status',
        page: pageEntry,
        url,
        culture,
        authMode,
        current,
        total,
        status: `Loaded (HTTP ${httpStatus ?? '?'}) - analyzing content`
      });

      // Scroll through the page to trigger lazy images before analysis/screenshots
      await this.warmLazyImages();

      // Expand any accordions/collapsibles so their content is captured
      await this.openAllAccordions();

      const analysis = await this.analyzePage();

      // Full-page screenshots at the selected widths
      const screenshots = await this.captureScreenshots(options.widths, pageEntry, culture, authMode, current, total);

      // Section-by-section breakdown (desktop viewport for stable layout)
      this.emitProgress({
        type: 'page-status',
        page: pageEntry,
        url,
        culture,
        authMode,
        current,
        total,
        status: 'Breaking page into content sections'
      });
      await this.page.setViewportSize({ width: 1210, height: 1080 });
      await this.page.waitForTimeout(500);
      const rawSections = await this.extractSections();
      const sections = await this.captureSectionScreenshots(rawSections, pageEntry, culture, authMode, current, total);

      const resultChecks = {
        images: analysis.images,
        content: analysis.content,
        components: analysis.components
      };

      const issues = this.deriveIssues({ httpStatus, resultChecks, sections, culture });

      return {
        page: pageEntry,
        url,
        finalUrl: this.page.url(),
        environment: options.environment,
        region: options.region,
        culture,
        authMode,
        success: true,
        passed: issues.length === 0,
        httpStatus,
        redirectChain,
        loadTimeMs,
        issues,
        checks: resultChecks,
        sections,
        screenshots,
        timestamp
      };
    } catch (err) {
      log('error', 'Page test failed', { page: pageEntry, culture, authMode, error: err.message });
      return { ...this.buildFailedResult(options, pageEntry, culture, authMode, err.message), url };
    }
  }

  // Scroll through the page to trigger lazy-loaded content
  async warmLazyImages() {
    try {
      const viewport = this.page.viewportSize();
      const step = viewport ? Math.floor(viewport.height * 0.75) : 600;
      const scrollHeight = await this.page.evaluate(() => document.body.scrollHeight);

      for (let y = 0; y < Math.min(scrollHeight, 20000); y += step) {
        await this.page.evaluate((scrollTo) => window.scrollTo(0, scrollTo), y);
        await this.page.waitForTimeout(150);
      }
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await this.page.waitForTimeout(300);
    } catch (err) {
      log('debug', 'Lazy image warm-up failed', { error: err.message });
    }
  }

  // Open accordions / collapsible content so it is visible in screenshots
  async openAllAccordions() {
    try {
      await this.page.evaluate(() => {
        document.querySelectorAll('[data-accord="toggler"][aria-expanded="false"]').forEach(t => t.click());
        document.querySelectorAll('.o-LTEAccordion__content.hidden, .o-accordion__content.hidden').forEach(c => c.classList.remove('hidden'));
        document.querySelectorAll('details:not([open])').forEach(d => d.setAttribute('open', ''));
        document.querySelectorAll('.collapse:not(.show)').forEach(p => p.classList.add('show'));
      });
      await this.page.waitForTimeout(400);
    } catch (err) {
      log('debug', 'Accordion expansion failed', { error: err.message });
    }
  }

  // Single in-page evaluation collecting content metadata, image health, and component inventory
  async analyzePage() {
    return await this.page.evaluate(({ componentSelectors }) => {
      const analysis = { images: null, content: null, components: null };

      const meta = (name, attr = 'name') =>
        document.querySelector(`meta[${attr}="${name}"]`)?.getAttribute('content') || null;
      const h1s = Array.from(document.querySelectorAll('h1'));
      const h2s = Array.from(document.querySelectorAll('h2'));
      let envCulture = null;
      try {
        const envDiv = document.getElementById('environment-variables');
        if (envDiv) {
          const envJson = JSON.parse(envDiv.textContent);
          envCulture = envJson.Culture || envJson.culture || null;
        }
      } catch { /* env div absent or unparsable */ }

      analysis.content = {
        title: document.title || null,
        metaDescription: meta('description'),
        htmlLang: document.documentElement.getAttribute('lang') || null,
        h1Count: h1s.length,
        firstH1: h1s[0]?.textContent?.trim().slice(0, 200) || null,
        headings: h2s.slice(0, 20).map(h => h.textContent?.trim().slice(0, 120)).filter(Boolean),
        textLength: (document.body?.innerText || '').trim().length,
        environmentCulture: envCulture
      };

      const imgs = Array.from(document.querySelectorAll('img'));
      const broken = [];
      let missingAlt = 0;
      for (const img of imgs) {
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
        if (img.complete && img.naturalWidth === 0 && src && !src.startsWith('data:')) {
          if (broken.length < 50) broken.push(src);
        }
        if (!img.getAttribute('alt')) missingAlt++;
      }
      analysis.images = {
        total: imgs.length,
        brokenCount: broken.length,
        broken,
        missingAltCount: missingAlt
      };

      const counts = {};
      for (const [name, selector] of Object.entries(componentSelectors)) {
        try {
          counts[name] = document.querySelectorAll(selector).length;
        } catch {
          counts[name] = 0;
        }
      }
      analysis.components = counts;

      return analysis;
    }, { componentSelectors: config.page.componentSelectors });
  }

  // Break the page's main content into numbered sections. Ported from the PDP
  // tester's section extraction but rooted at the page's main content region
  // (skipping site chrome: header / nav / footer) so it works on any page.
  async extractSections() {
    return await this.page.evaluate(({ maxSections }) => {
      const sections = [];

      // Pick the main content root; fall back through common patterns to <body>
      const rootCandidates = ['main', '[role="main"]', '#maincontent', '#main-content', '.o-siteMain', '#vApp', 'body'];
      let root = null;
      for (const sel of rootCandidates) {
        const el = document.querySelector(sel);
        if (el && el.children.length > 0) { root = el; break; }
      }
      if (!root) return sections;

      const isChrome = (element) => {
        const tag = element.tagName.toLowerCase();
        if (['header', 'nav', 'footer'].includes(tag)) return true;
        const role = element.getAttribute('role');
        if (['banner', 'navigation', 'contentinfo'].includes(role)) return true;
        const cls = Array.from(element.classList).join(' ').toLowerCase();
        return /(^|\s|-)(header|footer|navbar|site-?nav|masthead|cookie|skip-link)/.test(cls);
      };

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

      const extractBackgroundUrl = (style) => {
        const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        return match ? match[1] : null;
      };

      const determineTarget = (anchor) => {
        const target = anchor.getAttribute('target');
        if (!target || target === '' || target === '|Custom') return 'same tab';
        if (target === '_blank') return 'new tab';
        return 'same tab';
      };

      const extractAllImages = (element) => {
        const images = [];
        element.querySelectorAll('picture').forEach(picture => {
          const sources = {};
          const img = picture.querySelector('img');
          const desktopSource = picture.querySelector('source[media*="1024px"], source[media*="min-width: 1024"]');
          if (desktopSource) sources.desktop = { url: desktopSource.getAttribute('srcset'), alt: img?.alt || '' };
          const tabletSource = picture.querySelector('source[media*="768px"], source[media*="min-width: 768"]');
          if (tabletSource) sources.tablet = { url: tabletSource.getAttribute('srcset'), alt: img?.alt || '' };
          const mobileSource = picture.querySelector('source[media*="575px"], source[media*="max-width: 575"]');
          if (mobileSource) sources.mobile = { url: mobileSource.getAttribute('srcset'), alt: img?.alt || '' };
          images.push({ type: 'picture', sources, url: img?.src || '', alt: img?.alt || '', visibility: 'all' });
        });
        element.querySelectorAll('img').forEach(img => {
          if (img.closest('picture')) return;
          const classList = Array.from(img.classList);
          let visibility = 'all';
          if (classList.some(c => c.includes('hidden')) && classList.some(c => c.includes('md:block'))) visibility = 'desktop-only';
          else if (classList.some(c => c.includes('md:hidden'))) visibility = 'mobile-only';
          images.push({ type: 'img', sources: {}, url: img.src || img.getAttribute('data-src') || '', alt: img.alt || '', visibility });
        });
        element.querySelectorAll('[style*="background-image"]').forEach(el => {
          const style = el.getAttribute('style') || '';
          const url = extractBackgroundUrl(style);
          if (!url) return;
          images.push({ type: 'background', sources: {}, url, alt: '', visibility: 'all' });
        });
        return images;
      };

      const extractAllLinks = (element) => {
        const links = [];
        element.querySelectorAll('a[href]').forEach(anchor => {
          links.push({
            url: anchor.getAttribute('href'),
            target: determineTarget(anchor),
            text: anchor.textContent?.trim().slice(0, 120) || '',
            ariaLabel: anchor.getAttribute('aria-label') || ''
          });
        });
        return links;
      };

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

      const isWrapperContainer = (element) => {
        const tagName = element.tagName.toLowerCase();
        const classList = Array.from(element.classList);
        const isFlexOrGridContainer = classList.some(c =>
          c === 'flex' || c === 'grid' || c.includes(':flex') || c.includes(':grid') ||
          c.startsWith('flex-') || c.startsWith('grid-'));
        if (isFlexOrGridContainer) return false;
        const wrapperPatterns = ['o-widthControl', 'container', 'wrapper'];
        const hasWrapperClass = wrapperPatterns.some(pattern => classList.some(c => c.includes(pattern) || c === pattern));
        const isLayoutContainer = classList.includes('mx-auto') &&
          (classList.some(c => c.includes('max-w-')) || classList.some(c => c.includes('w-full')));
        const isEmptyDivWrapper = tagName === 'div' && element.children.length > 0 && (() => {
          const children = Array.from(element.children);
          const hasOnlyStructuralChildren = children.every(child => ['div', 'article', 'section'].includes(child.tagName.toLowerCase()));
          const directText = Array.from(element.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim()).join('');
          return hasOnlyStructuralChildren && directText.length === 0;
        })();
        const isMixedContentWrapper = tagName === 'div' && element.children.length > 1 && (() => {
          const children = Array.from(element.children);
          const childrenWithContent = children.filter(child => hasContent(child));
          const sectionLikeChildren = childrenWithContent.filter(child => {
            const childTag = child.tagName.toLowerCase();
            if (childTag === 'article') return true;
            if (childTag === 'div') {
              const childClasses = Array.from(child.classList);
              const hasComponentClass = childClasses.some(c =>
                c.startsWith('m-') || c.startsWith('o-') || c.startsWith('a-') ||
                c.includes('text-') || c.includes('py-') || c.includes('px-') ||
                c.includes('flex') || c.includes('grid'));
              if (hasComponentClass) return true;
              return child.querySelector('article, img, picture, a[href]') !== null;
            }
            if (childTag === 'img' || childTag === 'picture') return true;
            return false;
          });
          return sectionLikeChildren.length > 1;
        })();
        if (hasWrapperClass || isLayoutContainer || isEmptyDivWrapper || isMixedContentWrapper) {
          return Array.from(element.children).filter(child => hasContent(child)).length > 0;
        }
        return false;
      };

      const createSection = (element) => {
        const sectionIndex = sections.length + 1;
        const sectionId = `page-section-${sectionIndex}`;
        element.setAttribute('data-page-section-id', sectionId);
        return {
          index: sectionIndex,
          sectionId,
          tagName: element.tagName.toLowerCase(),
          classes: Array.from(element.classList).slice(0, 12),
          contentType: determineSectionContentType(element),
          images: extractAllImages(element),
          links: extractAllLinks(element),
          textContent: (element.textContent?.trim() || '').substring(0, 500)
        };
      };

      const processElement = (element) => {
        if (sections.length >= maxSections) return;
        if (!hasContent(element) || isChrome(element)) return;
        if (isWrapperContainer(element)) {
          Array.from(element.children).forEach(child => processElement(child));
        } else {
          sections.push(createSection(element));
        }
      };

      Array.from(root.children).forEach(element => processElement(element));
      return sections;
    }, { maxSections: MAX_SECTIONS });
  }

  // Capture a screenshot of each extracted section (desktop viewport)
  async captureSectionScreenshots(sections, pageEntry, culture, authMode, current, total) {
    const out = [];
    for (const section of sections) {
      if (this.shouldStop) break;
      try {
        this.emitProgress({
          type: 'page-status',
          page: pageEntry,
          culture,
          authMode,
          current,
          total,
          status: `Capturing section ${section.index}/${sections.length}`
        });

        const el = await this.page.$(`[data-page-section-id="${section.sectionId}"]`);
        if (!el) {
          out.push({ ...section, screenshot: null, dimensions: null });
          continue;
        }
        const box = await el.boundingBox();
        if (!box || box.height <= 0) {
          out.push({ ...section, screenshot: null, dimensions: null });
          continue;
        }
        await el.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(250);
        const buffer = await el.screenshot({ type: 'jpeg', quality: 80 });
        out.push({
          ...section,
          screenshot: `data:image/jpeg;base64,${buffer.toString('base64')}`,
          dimensions: { width: Math.round(box.width), height: Math.round(box.height) }
        });
      } catch (err) {
        log('warn', `Section ${section.index} screenshot failed`, { page: pageEntry, error: err.message });
        out.push({ ...section, screenshot: null, dimensions: null, screenshotError: err.message });
      }
    }
    return out;
  }

  async captureScreenshots(widths, pageEntry, culture, authMode, current, total) {
    const screenshots = [];
    const originalViewport = this.page.viewportSize();

    for (const width of widths) {
      try {
        this.emitProgress({
          type: 'page-status',
          page: pageEntry,
          culture,
          authMode,
          current,
          total,
          status: `Capturing screenshot at ${width}px`
        });

        await this.page.setViewportSize({ width, height: 1080 });
        await this.page.waitForTimeout(config.page.timeouts.screenshotDelay);

        const buffer = await this.page.screenshot({
          fullPage: true,
          type: 'jpeg',
          quality: 70
        });
        screenshots.push({
          width,
          data: `data:image/jpeg;base64,${buffer.toString('base64')}`
        });
      } catch (err) {
        log('warn', `Screenshot failed at ${width}px`, { page: pageEntry, error: err.message });
      }
    }

    if (originalViewport) {
      await this.page.setViewportSize(originalViewport).catch(() => {});
    }

    return screenshots;
  }

  // Rule-based content issue derivation; the AI review adds contextual interpretation on top
  deriveIssues({ httpStatus, resultChecks, sections, culture }) {
    const issues = [];

    if (httpStatus && httpStatus >= 400) {
      issues.push(`Page returned HTTP ${httpStatus}`);
    }
    if (resultChecks.images && resultChecks.images.brokenCount > 0) {
      issues.push(`${resultChecks.images.brokenCount} broken image(s)`);
    }
    const content = resultChecks.content;
    if (content) {
      if (!content.title) issues.push('Missing page title');
      if (!content.metaDescription) issues.push('Missing meta description');
      if (content.h1Count === 0) issues.push('No H1 heading');
      if (content.h1Count > 1) issues.push(`Multiple H1 headings (${content.h1Count})`);
      if (content.textLength < 100) issues.push('Page has very little text content');
      if (content.htmlLang && culture
        && content.htmlLang.toLowerCase() !== culture.toLowerCase()
        && !culture.toLowerCase().startsWith(content.htmlLang.toLowerCase())) {
        issues.push(`html lang "${content.htmlLang}" does not match requested culture "${culture}"`);
      }
    }
    if (Array.isArray(sections)) {
      const missingAlt = sections.reduce((sum, s) =>
        sum + (Array.isArray(s.images) ? s.images.filter(img => !(img.alt || img.sources?.desktop?.alt)).length : 0), 0);
      if (missingAlt > 0) issues.push(`${missingAlt} image(s) missing alt text`);
      if (sections.length === 0) issues.push('No content sections detected');
    }

    return issues;
  }
}
