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
    this.mobileContext = null;
    this.mobilePage = null;
    this.mobileEmulation = null;
  }

  /**
   * Private method: Detect banner element and extract its information
   * @param {boolean} includeScrollOffset - Whether to include pageRect with scroll offsets
   * @returns {Promise<Object>} Banner information object
   */
  async _detectBannerElement(includeScrollOffset = false, page = this.page) {
    if (!page) return { found: false };
    const result = await page.evaluate(({ selector, includeScroll }) => {
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
    return await this._detectBannerElement(true, this.page);
  }

  async setScrollbarVisibility(hidden, page = this.page) {
    if (!page) return;
    await page.evaluate((hide) => {
      const styleId = 'banner-hide-scrollbars';
      const existing = document.getElementById(styleId);
      if (hide) {
        if (existing) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          * { scrollbar-width: none !important; }
          *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
          html, body { overflow: hidden !important; }
        `;
        document.head.appendChild(style);
      } else if (existing) {
        existing.remove();
      }
    }, hidden);
  }

  getBannerDiagnosticsMode() {
    const raw = process.env.BANNER_DIAGNOSTICS;
    if (!raw) return 'off';
    const value = String(raw).toLowerCase();
    if (['1', 'true', 'yes', 'on', 'summary'].includes(value)) return 'summary';
    if (['full', 'verbose', '2'].includes(value)) return 'full';
    return 'off';
  }

  shouldLogBannerDiagnostics(width) {
    const mode = this.getBannerDiagnosticsMode();
    if (mode === 'off') return false;
    return typeof width === 'number' ? width <= 415 : true;
  }

  shouldFixChevronWidth(width) {
    return typeof width === 'number' ? width <= 415 : false;
  }

  async applyChevronWidthFix(width, page = this.page, label = 'CAPTURE') {
    if (!page || !this.shouldFixChevronWidth(width)) return;
    try {
      const result = await page.evaluate(({ selector, maxOverflow }) => {
        const bannerEl =
          document.querySelector(selector) ||
          document.querySelector('[data-testid="container-fullWidthBanner"]') ||
          document.querySelector('.m-fwBanner');

        const anchor = bannerEl ? (bannerEl.closest('a') || bannerEl) : null;
        if (!anchor) return { applied: false, reason: 'no-banner' };

        const chevronChar = '\u276f';
        const chevronFallback = '\u00e2\u009d\u00af';
        const chevronPattern = `${chevronChar}|${chevronFallback}`;
        const chevronRegex = new RegExp(chevronPattern, 'g');
        const chevronTokenRegex = new RegExp(`\\u00a0?(?:${chevronPattern})`, 'g');
        const chevronTest = new RegExp(chevronPattern);
        const textNodes = [];
        const walker = document.createTreeWalker(
          anchor,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const text = node.textContent || '';
              return chevronTest.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
          }
        );
        while (walker.nextNode()) {
          textNodes.push(walker.currentNode);
        }

        let chevronCount = 0;
        if (textNodes.length > 0) {
          textNodes.forEach((node) => {
            const parent = node.parentNode;
            if (!parent) return;
            if (parent.getAttribute && parent.getAttribute('data-banner-chevron') === 'true') return;
            if (parent.querySelector && parent.querySelector('span[data-banner-chevron="true"]')) return;

            const text = node.textContent || '';
            if (!chevronTest.test(text)) return;

            const matches = Array.from(text.matchAll(chevronTokenRegex));
            if (matches.length === 0) return;

            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            matches.forEach((match) => {
              const start = match.index || 0;
              if (start > lastIndex) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
              }

              const token = match[0];
              const span = document.createElement('span');
              span.setAttribute('data-banner-chevron', 'true');
              span.style.whiteSpace = 'nowrap';

              const glyph = document.createElement('span');
              glyph.setAttribute('data-banner-chevron-glyph', 'true');

              if (token.charCodeAt(0) === 160) {
                span.appendChild(document.createTextNode('\u00a0'));
                glyph.textContent = token.slice(1);
              } else {
                glyph.textContent = token;
              }

              span.appendChild(glyph);
              frag.appendChild(span);
              chevronCount += 1;
              lastIndex = start + token.length;
            });

            if (lastIndex < text.length) {
              frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            parent.replaceChild(frag, node);
          });
        }

        const chevronSpans = anchor.querySelectorAll('span[data-banner-chevron="true"]');
        const chevronGlyphs = anchor.querySelectorAll('span[data-banner-chevron-glyph="true"]');
        if (chevronGlyphs.length === 0) {
          return { applied: false, reason: 'no-chevron' };
        }

        const targets = new Set();
        chevronSpans.forEach(span => {
          if (span.parentElement) targets.add(span.parentElement);
        });

        let adjustedCount = 0;
        const adjustments = [];

        targets.forEach((parent) => {
          const style = getComputedStyle(parent);
          const fontSpec = style.fontFamily && style.fontSize
            ? `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize} ${style.fontFamily}`
            : null;
          if (!fontSpec) return;

          const paddingLeft = parseFloat(style.paddingLeft || '0') || 0;
          const paddingRight = parseFloat(style.paddingRight || '0') || 0;
          const rect = parent.getBoundingClientRect();
          const availableWidth = Math.round(rect.width - paddingLeft - paddingRight);

          const text = parent.textContent || '';
          if (!chevronTest.test(text)) return;

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.font = fontSpec;

          const fullWidth = Math.round(ctx.measureText(text).width);
          const noChevronText = text.replace(chevronRegex, '');
          const noChevronWidth = Math.round(ctx.measureText(noChevronText).width);
          const chevronWidth = Math.max(1, fullWidth - noChevronWidth);
          const overflow = fullWidth - availableWidth;

          if (overflow <= 0) return;
          if (overflow > maxOverflow) return;

          let scale = (availableWidth - noChevronWidth) / chevronWidth;
          if (!Number.isFinite(scale)) return;
          scale = Math.max(0.6, Math.min(1, scale));

          const spans = parent.querySelectorAll('span[data-banner-chevron-glyph="true"]');
          spans.forEach(span => {
            span.style.display = 'inline-block';
            span.style.transformOrigin = 'left center';
            span.style.transform = `scaleX(${scale})`;
          });

          adjustedCount += spans.length;
          adjustments.push({
            availableWidth,
            fullWidth,
            noChevronWidth,
            chevronWidth,
            overflow,
            scale
          });
        });

        return {
          applied: adjustedCount > 0,
          chevronCount,
          adjustedCount,
          adjustments
        };
      }, { selector: config.banner.selector, maxOverflow: 6 });

      if (result?.applied) {
        log('info', `[${label}] Chevron width normalized`, {
          width,
          ...result
        });
      }
    } catch (err) {
      log('warn', `[${label}] Chevron normalization failed`, {
        width,
        error: err.message
      });
    }
  }

  async logBannerDiagnostics(width, context = {}, page = this.page) {
    if (!page || !this.shouldLogBannerDiagnostics(width)) return;
    const diagMode = this.getBannerDiagnosticsMode();
    const includeTextSamples = diagMode === 'full';
    try {
      const data = await page.evaluate(({ selector, includeTextSamples }) => {
        const bannerEl =
          document.querySelector(selector) ||
          document.querySelector('[data-testid="container-fullWidthBanner"]') ||
          document.querySelector('.m-fwBanner');

        const anchor = bannerEl ? (bannerEl.closest('a') || bannerEl) : null;
        const bannerRect = bannerEl ? bannerEl.getBoundingClientRect() : null;
        const anchorRect = anchor ? anchor.getBoundingClientRect() : null;

        const viewport = {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          scrollbarWidth: Math.max(0, window.innerWidth - document.documentElement.clientWidth),
          devicePixelRatio: window.devicePixelRatio || 1,
          visualViewport: window.visualViewport ? {
            width: window.visualViewport.width,
            height: window.visualViewport.height,
            scale: window.visualViewport.scale
          } : null
        };

        const inputMedia = {
          hover: matchMedia('(hover: none)').matches ? 'none' : 'hover',
          pointer: matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
          maxTouchPoints: navigator.maxTouchPoints || 0
        };

        const fontStatus = document.fonts ? document.fonts.status : 'unsupported';
        const userAgent = navigator.userAgent;
        const platform = navigator.platform;
        const uaData = navigator.userAgentData || null;
        const uaMobile = uaData ? uaData.mobile : null;
        const uaPlatform = uaData ? uaData.platform : null;
        const uaBrands = uaData ? uaData.brands : null;
        const webdriver = navigator.webdriver;

        let anchorStyle = null;
        if (anchor) {
          const style = getComputedStyle(anchor);
          anchorStyle = {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            letterSpacing: style.letterSpacing,
            lineHeight: style.lineHeight,
            textRendering: style.textRendering,
            color: style.color
          };
        }

        const textSamples = [];
        if (includeTextSamples && anchor) {
          const walker = document.createTreeWalker(
            anchor,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode(node) {
                const text = node.textContent ? node.textContent.trim() : '';
                if (!text) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );
          const nodes = [];
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = node.textContent ? node.textContent.trim() : '';
            if (!text) continue;
            nodes.push({ node, text });
          }

          nodes
            .sort((a, b) => b.text.length - a.text.length)
            .slice(0, 3)
            .forEach(({ node, text }) => {
              const parent = node.parentElement;
              const range = document.createRange();
              range.selectNodeContents(node);
              const rects = Array.from(range.getClientRects());
              const style = parent ? getComputedStyle(parent) : null;
              let parentRect = null;
              if (parent) {
                const parentBox = parent.getBoundingClientRect();
                parentRect = {
                  width: Math.round(parentBox.width),
                  height: Math.round(parentBox.height)
                };
              }

              const fontFamily = style ? style.fontFamily : null;
              const fontSize = style ? style.fontSize : null;
              const fontWeight = style ? style.fontWeight : null;
              const fontStyle = style ? style.fontStyle : 'normal';
              const fontLineHeight = style ? style.lineHeight : null;
              const fontLetterSpacing = style ? style.letterSpacing : null;
              const fontColor = style ? style.color : null;

              const fontSpec = fontSize && fontFamily
                ? `${fontStyle} ${fontWeight || '400'} ${fontSize} ${fontFamily}`
                : null;

              let measuredWidth = null;
              let measuredWidthNoChevron = null;
              let measuredWidthWithArrow = null;

              if (fontSpec) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.font = fontSpec;
                  measuredWidth = Math.round(ctx.measureText(text).width);
                  const chevronChar = "\u276f";
                  const chevronFallback = "\u00e2\u009d\u00af";
                  const stripped = text.replace(chevronChar, '').replace(chevronFallback, '').trim();
                  const replaced = text.replace(chevronChar, '>').replace(chevronFallback, '>');
                  measuredWidthNoChevron = Math.round(ctx.measureText(stripped).width);
                  measuredWidthWithArrow = Math.round(ctx.measureText(replaced).width);
                }
              }

              const chevronChar = "\u276f";
              const robotoHasChevron = document.fonts ? document.fonts.check(`16px "Roboto"`, chevronChar) : null;
              const notoHasChevron = document.fonts ? document.fonts.check(`16px "Noto Sans"`, chevronChar) : null;

              textSamples.push({
                text: text.slice(0, 120),
                textLength: text.length,
                lineCount: rects.length,
                rects: rects.map(r => ({
                  width: Math.round(r.width),
                  height: Math.round(r.height)
                })),
                tag: parent ? parent.tagName : null,
                className: parent ? parent.className : null,
                fontFamily,
                fontSize,
                fontWeight,
                letterSpacing: fontLetterSpacing,
                lineHeight: fontLineHeight,
                color: fontColor,
                inlineColor: parent ? parent.style.color || null : null,
                display: style ? style.display : null,
                whiteSpace: style ? style.whiteSpace : null,
                maxWidth: style ? style.maxWidth : null,
                width: style ? style.width : null,
                paddingLeft: style ? style.paddingLeft : null,
                paddingRight: style ? style.paddingRight : null,
                parentRect,
                measuredWidth,
                measuredWidthNoChevron,
                measuredWidthWithArrow,
                robotoHasChevron,
                notoHasChevron
              });
            });
        }

        return {
          bannerFound: !!bannerEl,
          bannerRect,
          anchorRect,
          viewport,
          inputMedia,
          fontStatus,
          userAgent,
          uaMobile,
          uaPlatform,
          uaBrands,
          platform,
          webdriver,
          anchorStyle,
          textSamples: includeTextSamples ? textSamples : null
        };
      }, { selector: config.banner.selector, includeTextSamples });

      const payload = diagMode === 'full'
        ? {
          width,
          url: page.url(),
          ...context,
          ...data
        }
        : {
          width,
          url: page.url(),
          ...context,
          bannerFound: data.bannerFound,
          bannerRect: data.bannerRect,
          anchorRect: data.anchorRect,
          viewport: data.viewport ? {
            innerWidth: data.viewport.innerWidth,
            innerHeight: data.viewport.innerHeight,
            clientWidth: data.viewport.clientWidth,
            clientHeight: data.viewport.clientHeight,
            scrollbarWidth: data.viewport.scrollbarWidth,
            devicePixelRatio: data.viewport.devicePixelRatio
          } : null,
          inputMedia: data.inputMedia,
          fontStatus: data.fontStatus,
          userAgent: data.userAgent,
          uaMobile: data.uaMobile,
          uaPlatform: data.uaPlatform,
          platform: data.platform,
          anchorStyle: data.anchorStyle
        };

      log('info', '[BANNER-DIAG] Layout snapshot', payload);
    } catch (err) {
      log('warn', '[BANNER-DIAG] Failed to collect layout snapshot', {
        width,
        url: page.url(),
        error: err.message
      });
    }
  }

  getMobileEmulationConfig() {
    const defaults = config.banner?.mobileEmulation || {};

    const rawEnabled = process.env.BANNER_MOBILE_EMULATION;
    const enabled = rawEnabled === undefined
      ? (defaults.enabled ?? true)
      : ['1', 'true', 'yes', 'on'].includes(String(rawEnabled).toLowerCase());

    const dprRaw = Number(process.env.BANNER_MOBILE_DPR);
    const deviceScaleFactor = Number.isFinite(dprRaw) && dprRaw > 0
      ? dprRaw
      : (defaults.deviceScaleFactor ?? 2);

    const userAgentEnv = (process.env.BANNER_MOBILE_UA || '').trim();
    const userAgentDefault = (defaults.userAgent || '').trim();
    const platform = typeof defaults.platform === 'string' ? defaults.platform.trim() : null;
    const clientHints = defaults.clientHints && typeof defaults.clientHints === 'object'
      ? defaults.clientHints
      : null;

    return {
      enabled,
      deviceScaleFactor,
      userAgent: userAgentEnv || userAgentDefault || null,
      widths: Array.isArray(defaults.widths) ? defaults.widths : null,
      isMobile: defaults.isMobile ?? false,
      hasTouch: defaults.hasTouch ?? true,
      platform,
      clientHints
    };
  }

  isMobileEmulationWidth(width) {
    if (typeof width !== 'number') return false;
    const configured = this.mobileEmulation?.widths;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.includes(width);
    }
    const fallback = config.banner?.mobileEmulation?.widths;
    if (Array.isArray(fallback) && fallback.length > 0) {
      return fallback.includes(width);
    }
    return width <= 415;
  }

  async createMobileContext(contextOptions = {}) {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const emulation = this.mobileEmulation || this.getMobileEmulationConfig();
    const emulationHeaders = this.getClientHintHeaders(emulation);
    const { extraHTTPHeaders: contextHeaders, ...restContextOptions } = contextOptions;
    const mergedHeaders = {
      ...(contextHeaders || {}),
      ...(emulationHeaders || {})
    };
    const defaultOptions = {
      viewport: { width: 320, height: config.banner.browser.captureHeight },
      isMobile: Boolean(emulation.isMobile),
      hasTouch: Boolean(emulation.hasTouch),
      deviceScaleFactor: emulation.deviceScaleFactor
    };

    if (emulation.userAgent) {
      defaultOptions.userAgent = emulation.userAgent;
    }

    this.mobileContext = await this.browser.newContext({
      ...defaultOptions,
      ...restContextOptions,
      ...(Object.keys(mergedHeaders).length > 0 ? { extraHTTPHeaders: mergedHeaders } : {})
    });

    log('info', 'Mobile emulation context created', {
      deviceScaleFactor: defaultOptions.deviceScaleFactor,
      userAgent: defaultOptions.userAgent || 'default',
      platform: emulation.platform || 'default',
      clientHints: emulationHeaders || {}
    });

    return this.mobileContext;
  }

  async createMobilePage() {
    if (!this.mobileContext) return null;
    log('info', 'Creating mobile emulation page...');
    this.mobilePage = await this.mobileContext.newPage();

    this.mobilePage.on('console', msg => {
      if (msg.type() === 'error') {
        log('debug', `[MOBILE PAGE CONSOLE ERROR] ${msg.text()}`);
      }
    });

    this.mobilePage.on('pageerror', err => {
      log('debug', `[MOBILE PAGE ERROR] ${err.message}`);
    });

    await this.applyEmulationOverrides(this.mobilePage, this.mobileEmulation, 'MOBILE-EMU');

    log('info', 'Mobile emulation page created successfully');
    return this.mobilePage;
  }

  getClientHintHeaders(emulation) {
    if (!emulation?.clientHints) return null;
    const headers = {};
    if (emulation.clientHints.mobile) {
      headers['sec-ch-ua-mobile'] = String(emulation.clientHints.mobile);
    }
    if (emulation.clientHints.platform) {
      headers['sec-ch-ua-platform'] = String(emulation.clientHints.platform);
    }
    return Object.keys(headers).length > 0 ? headers : null;
  }

  buildEmulationOverrides(emulation) {
    if (!emulation) return null;
    const overrides = {};
    if (emulation.platform) {
      overrides.platform = emulation.platform;
    }
    if (emulation.clientHints?.platform) {
      overrides.uaPlatform = String(emulation.clientHints.platform).replace(/"/g, '');
    }
    if (!overrides.uaPlatform && overrides.platform) {
      overrides.uaPlatform = overrides.platform === 'Win32' ? 'Windows' : overrides.platform;
    }
    if (emulation.clientHints?.mobile !== undefined) {
      const rawMobile = String(emulation.clientHints.mobile).trim().toLowerCase();
      overrides.uaMobile = rawMobile === '?1' || rawMobile === '1' || rawMobile === 'true';
    } else {
      overrides.uaMobile = false;
    }
    return Object.keys(overrides).length > 0 ? overrides : null;
  }

  async applyEmulationOverrides(page, emulation, label = 'MOBILE-EMU') {
    if (!page || !emulation) return;
    if (page.__bannerEmulationOverridesApplied) return;

    const overrides = this.buildEmulationOverrides(emulation);
    if (!overrides) return;

    page.__bannerEmulationOverridesApplied = true;

    await page.addInitScript((data) => {
      const { platform, uaPlatform, uaMobile } = data || {};

      if (platform) {
        try {
          Object.defineProperty(navigator, 'platform', {
            get: () => platform,
            configurable: true
          });
        } catch {}
      }

      if (typeof navigator.webdriver !== 'undefined') {
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true
          });
        } catch {}
      }

      if (navigator.userAgentData) {
        try {
          const original = navigator.userAgentData;
          const brands = Array.isArray(original.brands) ? original.brands : [];
          const mobile = typeof uaMobile === 'boolean' ? uaMobile : original.mobile;
          const platformValue = uaPlatform || original.platform;
          const getHighEntropyValues = original.getHighEntropyValues?.bind(original);

          const patched = {
            brands,
            mobile,
            platform: platformValue
          };

          if (getHighEntropyValues) {
            patched.getHighEntropyValues = (hints) => {
              return getHighEntropyValues(hints).then((values) => ({
                ...values,
                mobile,
                platform: platformValue
              }));
            };
          }

          Object.defineProperty(navigator, 'userAgentData', {
            get: () => patched,
            configurable: true
          });
        } catch {}
      }
    }, overrides);

    log('info', `[${label}] Applied emulation overrides`, overrides);
  }

  async syncCookiesToMobile() {
    if (!this.context || !this.mobileContext) return;
    const cookies = await this.context.cookies();
    if (!cookies || cookies.length === 0) return;
    await this.mobileContext.addCookies(cookies);
  }

  async ensureLoggedIn(job, options, loggedInHosts, page = this.page) {
    if (!options?.loginEnabled) return false;
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
      return false;
    }

    const previousPage = this.page;
    this.page = page;
    let loginResult;
    try {
      loginResult = await this.loginToMelaleuca({
        baseUrl,
        environment: options.environment,
        username: options.username,
        password: options.password,
        selectors: config.sku.selectors,
        timeouts: config.sku.timeouts
      });
    } finally {
      this.page = previousPage;
    }

    if (!loginResult.success) {
      throw new Error(`Login failed: ${loginResult.error}`);
    }

    loggedInHosts.add(loginOrigin);
    await page.waitForTimeout(2000);
    return true;
  }

  /**
   * Optimized method: Capture banner at all widths with single navigation
   * Navigates once, then resizes viewport for each width (60% faster)
   * @param {Object} job - Job object with url, category, culture, etc.
   * @param {Array<number>} widths - Array of widths to capture
   * @param {Object} options - Options including environment
   * @returns {Promise<Array>} Array of result objects
   */
  async captureWidthsOnPage(page, widths, job, options = {}, captureLabel = 'DESKTOP', initialWidth = null, desktopFirst = true) {
    if (!page || !widths || widths.length === 0) return [];

    const results = [];
    const captureHeight = config.banner.browser.captureHeight;
    const desktopWidth = 1920;
    const loadWidth = desktopFirst ? desktopWidth : (initialWidth || widths[0]);

    log('info', `[${captureLabel}] Loading page at ${loadWidth}px before capturing widths`, { category: job.category });
    await page.setViewportSize({ width: loadWidth, height: captureHeight });

    await page.goto(job.url, {
      waitUntil: 'load',
      timeout: config.banner.timeouts.singleCapture
    });
    await page.waitForTimeout(config.banner.timeouts.pageLoad);

    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    await this.setScrollbarVisibility(true, page);
    await page.waitForTimeout(100);
    log('info', `[${captureLabel}] Page and fonts loaded at ${loadWidth}px`, { category: job.category });

    const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(options.environment, options.username, options.password, page);
    if (msAuthHandled) {
      await page.goto(job.url, {
        waitUntil: 'load',
        timeout: config.banner.timeouts.singleCapture
      });
      await page.waitForTimeout(config.banner.timeouts.pageLoad);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await this.setScrollbarVisibility(true, page);
      await page.waitForTimeout(50);
    }

    for (let i = 0; i < widths.length; i++) {
      if (this.shouldStop) break;

      const width = widths[i];
      log('info', `  [${captureLabel}] Capturing at ${width}px`, { category: job.category });

      try {
        await page.setViewportSize({ width, height: captureHeight });
        await page.waitForTimeout(config.banner.timeouts.pageLoad / 2);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        await this.setScrollbarVisibility(true, page);
        await page.waitForTimeout(50);
        await this.applyChevronWidthFix(width, page, captureLabel);
        await this.logBannerDiagnostics(width, { category: job.category, culture: job.culture, mode: captureLabel }, page);

        let bannerInfo = null;
        const maxAttempts = 3;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            await page.waitForTimeout(500 * attempt);
          }

          bannerInfo = await this._detectBannerElement(false, page);

          if (bannerInfo?.found) break;
        }

        if (!bannerInfo || !bannerInfo.found) {
          throw new Error('Banner not found after ' + maxAttempts + ' attempts');
        }

        await page.waitForTimeout(config.banner.timeouts.bannerWait);

        const padX = 8;
        const padTop = width >= 1020 ? 32 : width >= 992 ? 48 : 24;
        const padBottom = width >= 1020 ? 12 : width >= 992 ? 12 : 24;

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
  }

  async captureJobAtAllWidths(job, widths, options = {}) {
    const page = this.page;
    if (!page) {
      throw new Error('Capture page not initialized');
    }

    const results = [];
    log('info', `Capturing banner for ${job.category} at ${widths.length} widths (optimized)`, { url: job.url });

    try {
      const useMobileEmulation = this.mobileEmulation?.enabled && this.mobilePage;
      const mobileWidths = useMobileEmulation
        ? widths.filter((width) => this.isMobileEmulationWidth(width))
        : [];
      const desktopWidths = widths.filter((width) => !useMobileEmulation || !this.isMobileEmulationWidth(width));

      const widthOrder = new Map(widths.map((width, index) => [width, index]));

      const mobileResults = await this.captureWidthsOnPage(
        this.mobilePage,
        mobileWidths,
        job,
        options,
        'MOBILE-EMU',
        mobileWidths[0] || null,
        false
      );

      const desktopResults = await this.captureWidthsOnPage(
        page,
        desktopWidths,
        job,
        options,
        'DESKTOP',
        1920,
        true
      );

      results.push(...mobileResults, ...desktopResults);

      results.sort((a, b) => {
        const wa = widthOrder.get(a.width) ?? 999;
        const wb = widthOrder.get(b.width) ?? 999;
        return wa - wb;
      });

      return results;

    } catch (err) {
      log('error', `Error in optimized capture for ${job.category}`, { error: err.message });
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
      await this.applyChevronWidthFix(width, page, 'CAPTURE');
      await this.logBannerDiagnostics(width, { url });

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
    this.mobileEmulation = this.getMobileEmulationConfig();
    const mobileWidths = this.mobileEmulation.enabled
      ? selectedWidths.filter((width) => this.isMobileEmulationWidth(width))
      : [];
    const desktopWidths = selectedWidths.filter((width) => !this.mobileEmulation.enabled || !this.isMobileEmulationWidth(width));
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

      if (mobileWidths.length > 0 && this.mobileEmulation.enabled) {
        await this.createMobileContext({
          viewport: { width: mobileWidths[0], height: config.banner.browser.captureHeight }
        });
        await this.createMobilePage();
        log('info', 'Mobile emulation enabled for banner capture', {
          widths: mobileWidths,
          deviceScaleFactor: this.mobileEmulation.deviceScaleFactor,
          userAgent: this.mobileEmulation.userAgent || 'default'
        });
      }

      // Note: Using optimized capture - navigates once per banner at desktop width, resizes viewport for each test width

      const loggedInHosts = new Set();
      const loggedInHostsMobile = new Set();

      // Process each job (banner) - optimized approach
      let completedBanners = 0;
      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
        const job = jobs[jobIndex];
        if (this.shouldStop) break;

        let didLoginDesktop = false;
        if (desktopWidths.length > 0) {
          didLoginDesktop = await this.ensureLoggedIn(job, options, loggedInHosts, this.page);
        }

        if (this.mobilePage && mobileWidths.length > 0) {
          if (desktopWidths.length === 0) {
            await this.ensureLoggedIn(job, options, loggedInHostsMobile, this.mobilePage);
          } else if (didLoginDesktop) {
            await this.syncCookiesToMobile();
          }
        }

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
      this.mobilePage = null;
      this.mobileContext = null;
      this.mobileEmulation = null;

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
