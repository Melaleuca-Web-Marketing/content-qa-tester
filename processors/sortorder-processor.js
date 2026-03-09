// sortorder-processor.js - Playwright Sort Order processing engine

import { BaseProcessor, log, summarizeOptions } from './base-processor.js';
import { config, buildBannerUrl } from '../config.js';

export class SortOrderProcessor extends BaseProcessor {
  constructor() {
    super('SortOrder');
  }

  summarizeProductSignals(products, sampleSize = 6) {
    const list = Array.isArray(products) ? products : [];
    const pointsValueCount = list.filter((item) => Number.isFinite(item?.points)).length;
    const pointsTextCount = list.filter((item) => this.normalizeMatchText(item?.pointsText)).length;
    const soldOutCount = list.filter((item) => Boolean(item?.soldOut)).length;
    const pointsSourceCounts = {};
    const soldOutSourceCounts = {};

    for (const item of list) {
      const pointsSource = this.normalizeMatchText(item?.debugPointsSource || 'none');
      const soldOutSource = this.normalizeMatchText(item?.debugSoldOutSource || 'none');
      pointsSourceCounts[pointsSource] = (pointsSourceCounts[pointsSource] || 0) + 1;
      soldOutSourceCounts[soldOutSource] = (soldOutSourceCounts[soldOutSource] || 0) + 1;
    }

    const missingPoints = list
      .filter((item) => !Number.isFinite(item?.points) && !this.normalizeMatchText(item?.pointsText))
      .slice(0, sampleSize)
      .map((item) => ({
        position: item?.position ?? null,
        sku: item?.sku || '',
        title: this.normalizeMatchText(item?.title || item?.name)
      }));

    const soldOutKeywordMisses = list
      .filter((item) => Boolean(item?.debugHasSoldOutKeyword) && !Boolean(item?.soldOut))
      .slice(0, sampleSize)
      .map((item) => ({
        position: item?.position ?? null,
        sku: item?.sku || '',
        title: this.normalizeMatchText(item?.title || item?.name),
        soldOutSource: this.normalizeMatchText(item?.debugSoldOutSource),
        soldOutText: this.normalizeMatchText(item?.soldOutText),
        signalSnippet: this.normalizeMatchText(item?.debugSignalSnippet)
      }));

    const tailSample = list.slice(-sampleSize).map((item) => ({
      position: item?.position ?? null,
      sku: item?.sku || '',
      title: this.normalizeMatchText(item?.title || item?.name),
      pointsText: this.normalizeMatchText(item?.pointsText),
      points: Number.isFinite(item?.points) ? item.points : null,
      soldOut: Boolean(item?.soldOut),
      soldOutText: this.normalizeMatchText(item?.soldOutText),
      pointsSource: this.normalizeMatchText(item?.debugPointsSource),
      soldOutSource: this.normalizeMatchText(item?.debugSoldOutSource),
      hasSoldOutKeyword: Boolean(item?.debugHasSoldOutKeyword),
      signalSnippet: this.normalizeMatchText(item?.debugSignalSnippet)
    }));

    return {
      productCount: list.length,
      pointsValueCount,
      pointsTextCount,
      soldOutCount,
      pointsSourceCounts,
      soldOutSourceCounts,
      missingPointsSample: missingPoints,
      soldOutKeywordMisses,
      tailSample
    };
  }

  summarizeFamilyMapSignals(familyMaps, sampleSize = 6) {
    if (!familyMaps || typeof familyMaps !== 'object') {
      return {
        entryCount: 0,
        pointsValueCount: 0,
        pointsTextCount: 0,
        soldOutCount: 0,
        sample: []
      };
    }

    const collectValues = (map) => (map instanceof Map ? Array.from(map.values()) : []);
    const rawRecords = [
      ...collectValues(familyMaps.bySku),
      ...collectValues(familyMaps.byPath),
      ...collectValues(familyMaps.byTitle)
    ];

    const seen = new Set();
    const records = [];
    for (const record of rawRecords) {
      const dedupeKey = [
        this.normalizeMatchText(record?.familyId),
        Number.isFinite(record?.points) ? String(record.points) : '',
        this.normalizeMatchText(record?.pointsText),
        record?.soldOut ? '1' : '0',
        this.normalizeMatchText(record?.soldOutText)
      ].join('|');
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      records.push(record || {});
    }

    const pointsValueCount = records.filter((item) => Number.isFinite(item?.points)).length;
    const pointsTextCount = records.filter((item) => this.normalizeMatchText(item?.pointsText)).length;
    const soldOutCount = records.filter((item) => Boolean(item?.soldOut)).length;

    return {
      entryCount: Number(familyMaps.entryCount || 0),
      pointsValueCount,
      pointsTextCount,
      soldOutCount,
      sample: records.slice(0, sampleSize).map((item) => ({
        familyId: this.normalizeMatchText(item?.familyId),
        points: Number.isFinite(item?.points) ? item.points : null,
        pointsText: this.normalizeMatchText(item?.pointsText),
        soldOut: Boolean(item?.soldOut),
        soldOutText: this.normalizeMatchText(item?.soldOutText)
      }))
    };
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
        timeout: config.sortorder.timeouts.singleCapture
      });
      await this.page.waitForTimeout(config.sortorder.timeouts.pageLoad);
      await this.handleMicrosoftAuthIfNeeded(options.environment, options.username, options.password);
      loggedInHosts.set(loginOrigin, job.culture);
    }
  }

  async countGridItems(page = this.page) {
    if (!page) return 0;
    return page.evaluate(() => {
      return document.querySelectorAll('ul.p-catListing__grid > li.p-catListing__col').length;
    });
  }

  async waitForGridStability(page = this.page, timeoutMs = 12000) {
    if (!page) return;

    const start = Date.now();
    let lastCount = -1;
    let stableIterations = 0;

    while (Date.now() - start < timeoutMs) {
      const snapshot = await page.evaluate(() => {
        const count = document.querySelectorAll('ul.p-catListing__grid > li.p-catListing__col').length;
        const spinner =
          document.querySelector('.p-catListing__loading') ||
          document.querySelector('.a-loadingSpinner');
        const spinnerVisible = spinner ? spinner.offsetParent !== null : false;
        return { count, spinnerVisible };
      });

      if (!snapshot.spinnerVisible && snapshot.count === lastCount) {
        stableIterations += 1;
      } else {
        stableIterations = 0;
      }

      lastCount = snapshot.count;

      if (stableIterations >= 3) {
        return;
      }

      await page.waitForTimeout(350);
    }
  }

  async ensureShowAllProducts(page = this.page) {
    if (!page) {
      return {
        found: false,
        clicked: false,
        clicks: 0,
        beforeCount: 0,
        afterCount: 0
      };
    }

    const beforeCount = await this.countGridItems(page);
    let clicked = false;
    let found = false;
    let clicks = 0;

    for (let attempt = 0; attempt < 3; attempt++) {
      const button = page
        .locator(config.sortorder.selectors.showAllButton)
        .first();
      const count = await button.count();
      if (count === 0) break;

      found = true;
      const isVisible = await button.isVisible().catch(() => false);
      if (!isVisible) break;

      const isDisabled = await button.isDisabled().catch(() => false);
      if (isDisabled) break;

      try {
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await button.click({ timeout: 5000 });
        clicked = true;
        clicks += 1;
        await this.waitForGridStability(page, 15000);
      } catch (err) {
        log('warn', 'Show All click failed', { error: err.message });
        break;
      }
    }

    const afterCount = await this.countGridItems(page);
    return {
      found,
      clicked,
      clicks,
      beforeCount,
      afterCount
    };
  }

  normalizeMatchText(value) {
    return String(value || '').trim();
  }

  normalizePathForMatch(value) {
    const text = this.normalizeMatchText(value);
    if (!text) return '';
    try {
      const parsed = new URL(text, 'https://example.invalid');
      const path = (parsed.pathname || '').replace(/\/+$/, '');
      return path.toLowerCase();
    } catch {
      return text.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    }
  }

  normalizeLooseText(value) {
    const text = this.normalizeMatchText(value);
    if (!text) return '';
    return text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  normalizeSlugForMatch(value) {
    const path = this.normalizePathForMatch(value);
    if (!path) return '';
    const lastSegment = path.split('/').filter(Boolean).pop() || '';
    return this.normalizeLooseText(lastSegment).replace(/\s+/g, '-');
  }

  normalizeStampText(value) {
    return this.normalizeMatchText(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toUpperCase();
  }

  getStampPriority(stamp) {
    const normalized = this.normalizeStampText(stamp);
    if (/\bLIMITED\s+TIME\b/.test(normalized)) return 1;
    if (/\bNEW\b/.test(normalized)) return 2;
    return 3;
  }

  getStampPriorityLabel(priority) {
    if (priority === 1) return 'LIMITED TIME';
    if (priority === 2) return 'NEW';
    return 'OPEN-STOCK';
  }

  buildSortOrderBusinessValidation(products) {
    const list = Array.isArray(products) ? [...products] : [];
    if (list.length === 0) {
      return {
        pass: null,
        status: 'info',
        message: 'No products captured for business-rule validation',
        rules: []
      };
    }

    const orderedProducts = list
      .filter((item) => item && Number.isFinite(item.position))
      .sort((a, b) => a.position - b.position);

    const seenFamilies = new Set();
    const familyRecordsByKey = new Map();
    const orderedFamilies = [];
    for (const product of orderedProducts) {
      const familyKey = this.normalizeMatchText(product.familyId)
        || this.normalizeMatchText(product.sku)
        || this.normalizePathForMatch(product.href)
        || `pos:${product.position}`;
      const productStamp = this.normalizeMatchText(product.stamp);
      const productPriority = this.getStampPriority(productStamp);
      const productSoldOut = Boolean(product.soldOut);
      if (!seenFamilies.has(familyKey)) {
        seenFamilies.add(familyKey);
        const record = {
          familyKey,
          position: product.position,
          familyId: this.normalizeMatchText(product.familyId),
          sku: this.normalizeMatchText(product.sku),
          name: this.normalizeMatchText(product.name || product.title),
          stamp: productStamp,
          priority: productPriority,
          priorityPosition: product.position,
          prioritySku: this.normalizeMatchText(product.sku),
          priorityName: this.normalizeMatchText(product.name || product.title),
          soldOut: productSoldOut,
          soldOutText: this.normalizeMatchText(product.soldOutText),
          productCount: 1,
          soldOutProductCount: productSoldOut ? 1 : 0
        };
        orderedFamilies.push(record);
        familyRecordsByKey.set(familyKey, record);
        continue;
      }

      const existing = familyRecordsByKey.get(familyKey);
      if (existing) {
        existing.productCount = Number(existing.productCount || 0) + 1;

        if (productSoldOut) {
          existing.soldOutProductCount = Number(existing.soldOutProductCount || 0) + 1;
          if (!existing.soldOutText) {
            existing.soldOutText = this.normalizeMatchText(product.soldOutText);
          }
        }

        // Use the highest-priority stamp seen in the family (LIMITED TIME > NEW > OTHER).
        if (productPriority < existing.priority) {
          existing.priority = productPriority;
          existing.stamp = productStamp;
          existing.priorityPosition = product.position;
          existing.prioritySku = this.normalizeMatchText(product.sku) || existing.prioritySku;
          existing.priorityName = this.normalizeMatchText(product.name || product.title) || existing.priorityName;
        }
      }
    }

    for (const family of orderedFamilies) {
      const productCount = Number.isFinite(family.productCount) ? family.productCount : 1;
      const soldOutProductCount = Number.isFinite(family.soldOutProductCount)
        ? family.soldOutProductCount
        : (family.soldOut ? 1 : 0);
      // Family sold-out status requires all captured products in the family to be sold out.
      family.soldOut = productCount > 0 && soldOutProductCount === productCount;
      if (!family.soldOut) {
        family.soldOutText = '';
      }
    }

    const nonSoldOutFamilies = orderedFamilies.filter((item) => !item.soldOut);
    const stampPriorityViolations = [];
    let highestPrioritySeen = 1;
    const firstFamilyByPriority = new Map();
    for (const family of nonSoldOutFamilies) {
      if (!firstFamilyByPriority.has(family.priority)) {
        firstFamilyByPriority.set(family.priority, family);
      }

      if (family.priority < highestPrioritySeen) {
        const blockingFamily = firstFamilyByPriority.get(highestPrioritySeen) || null;
        stampPriorityViolations.push({
          position: Number.isFinite(family.priorityPosition) ? family.priorityPosition : family.position,
          familyId: family.familyId || '',
          sku: family.prioritySku || family.sku || '',
          name: family.priorityName || family.name || '',
          stamp: family.stamp || '',
          expectedGroup: this.getStampPriorityLabel(highestPrioritySeen),
          actualGroup: this.getStampPriorityLabel(family.priority),
          higherPriorityPosition: blockingFamily?.position ?? null,
          higherPriorityFamilyId: blockingFamily?.familyId || '',
          higherPriorityName: blockingFamily?.name || ''
        });
      } else if (family.priority > highestPrioritySeen) {
        highestPrioritySeen = family.priority;
      }
    }

    const limitedCount = nonSoldOutFamilies.filter((item) => item.priority === 1).length;
    const newCount = nonSoldOutFamilies.filter((item) => item.priority === 2).length;
    const otherCount = nonSoldOutFamilies.filter((item) => item.priority === 3).length;
    const soldOutCount = orderedFamilies.filter((item) => item.soldOut).length;

    const stampRulePass = stampPriorityViolations.length === 0;
    const transitionSummary = Array.from(new Set(
      stampPriorityViolations
        .map((violation) => `${violation.actualGroup} after ${violation.expectedGroup}`)
        .filter(Boolean)
    ));
    const stampRuleMessage = stampRulePass
      ? 'All LIMITED TIME families appear first, followed by NEW families'
      : `${stampPriorityViolations.length} family ordering violation(s) found. `
        + 'Expected order: LIMITED TIME -> NEW -> OPEN-STOCK. '
        + (transitionSummary.length > 0
          ? `Detected: ${transitionSummary.join(', ')}.`
          : 'Detected families out of expected stamp sequence.');

    const stampRule = {
      id: 'stamp-priority-limited-new',
      title: 'Stamp Priority Order',
      pass: stampRulePass,
      message: stampRuleMessage,
      details: {
        limitedCount,
        newCount,
        otherCount,
        familyCount: nonSoldOutFamilies.length,
        skippedSoldOutFamilies: soldOutCount,
        violations: stampPriorityViolations.slice(0, 25)
      }
    };

    const soldOutTailViolations = [];
    let encounteredSoldOut = false;
    for (const family of orderedFamilies) {
      if (family.soldOut) {
        encounteredSoldOut = true;
        continue;
      }

      if (encounteredSoldOut) {
        soldOutTailViolations.push({
          position: family.position,
          familyId: family.familyId || '',
          sku: family.sku || '',
          name: family.name || '',
          stamp: family.stamp || '',
          expectedGroup: 'SOLD OUT TAIL',
          actualGroup: 'ACTIVE FAMILY'
        });
      }
    }

    const soldOutRulePass = soldOutTailViolations.length === 0;
    const soldOutRuleMessage = soldOutRulePass
      ? 'Sold-out families are grouped at the end of the sort order'
      : `${soldOutTailViolations.length} active family/families found after sold-out families`;

    const soldOutRule = {
      id: 'sold-out-at-end',
      title: 'Sold-Out Families At End',
      pass: soldOutRulePass,
      message: soldOutRuleMessage,
      details: {
        familyCount: orderedFamilies.length,
        soldOutFamilyCount: soldOutCount,
        activeFamilyCount: orderedFamilies.length - soldOutCount,
        violations: soldOutTailViolations.slice(0, 25)
      }
    };

    const rules = [stampRule, soldOutRule];
    const allRulesPass = rules.every((rule) => rule.pass);

    return {
      pass: allRulesPass,
      status: allRulesPass ? 'pass' : 'fail',
      message: allRulesPass
        ? 'Business rules passed'
        : 'Business rules failed',
      rules
    };
  }

  buildFamilyMapsFromCategoryPayload(payload) {
    const cards = Array.isArray(payload?.Cards) ? payload.Cards : [];
    const bySku = new Map();
    const byPath = new Map();
    const bySlug = new Map();
    const byTitle = new Map();
    const orderedEntries = [];

    const parseNumberish = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const text = this.normalizeMatchText(value);
      if (!text) return null;
      const matched = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      if (!matched) return null;
      const parsed = Number.parseFloat(matched[0]);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const extractSoldOutMeta = (source) => {
      if (!source || typeof source !== 'object') {
        return { soldOut: false, soldOutText: '' };
      }

      const soldOut = Boolean(
        source.IsSoldout
        || source.IsSoldOut
        || source.isSoldout
        || source.isSoldOut
        || source.IsOffSale
        || source.isOffSale
        || source.IsOutOfStock
        || source.isOutOfStock
        || source.IsUnavailable
        || source.isUnavailable
        || source.IsTemporarilyUnavailable
        || source.isTemporarilyUnavailable
      );

      const soldOutText = this.normalizeMatchText(
        source.OffSaleTitle
        || source.OffSaleMessage
        || source.SoldOutText
        || source.SoldoutText
        || source.SoldOutMessage
        || source.OutOfStockText
        || source.UnavailableText
        || source.UnavailableMessage
        || source.TemporarilyUnavailableText
        || source.StatusText
      );

      return { soldOut, soldOutText };
    };

    const extractDeepPointSignal = (source, depth = 0) => {
      if (!source || depth > 5) return { points: null, pointsText: '' };

      const inspectValue = (key, value, currentDepth) => {
        const keyText = this.normalizeMatchText(key).toLowerCase();
        const valueText = this.normalizeMatchText(value);
        const keyLooksPointLike = /(point|points|pv|pointvalue|memberpoints)/i.test(keyText)
          && !/(price|cost|amount|dollar|usd|save|discount|memberprice|nonmember)/i.test(keyText);

        if (typeof value === 'number' && Number.isFinite(value) && keyLooksPointLike) {
          return { points: value, pointsText: `${value} Points` };
        }

        if (typeof value === 'string' && valueText) {
          if (/(points?|pts|pv)\b/i.test(valueText)) {
            const parsed = parseNumberish(valueText);
            if (parsed !== null) return { points: parsed, pointsText: valueText };
          }

          if (keyLooksPointLike) {
            const parsed = parseNumberish(valueText);
            if (parsed !== null) return { points: parsed, pointsText: `${parsed} Points` };
          }
        }

        if (value && typeof value === 'object' && currentDepth < 5) {
          return extractDeepPointSignal(value, currentDepth + 1);
        }

        return null;
      };

      if (Array.isArray(source)) {
        for (const item of source) {
          const found = inspectValue('', item, depth + 1);
          if (found && (Number.isFinite(found.points) || found.pointsText)) return found;
        }
        return { points: null, pointsText: '' };
      }

      if (typeof source !== 'object') return { points: null, pointsText: '' };
      for (const [key, value] of Object.entries(source)) {
        const found = inspectValue(key, value, depth + 1);
        if (found && (Number.isFinite(found.points) || found.pointsText)) return found;
      }
      return { points: null, pointsText: '' };
    };

    const extractPointsMeta = (source) => {
      if (!source || typeof source !== 'object') {
        return { points: null, pointsText: '' };
      }

      const pointsText = this.normalizeMatchText(
        source.PointsText
        || source.PointText
        || source.PointRange
        || source.PointsLabel
      );

      const points = parseNumberish(
        source.Points
        ?? source.PointValue
        ?? source.PV
        ?? source.MemberPoints
        ?? pointsText
      );

      if (Number.isFinite(points) || pointsText) {
        return { points, pointsText };
      }

      const deepSignal = extractDeepPointSignal(source);
      return {
        points: Number.isFinite(deepSignal.points) ? deepSignal.points : null,
        pointsText: this.normalizeMatchText(deepSignal.pointsText)
      };
    };

    const readBooleanFlag = (source, keys) => {
      if (!source || typeof source !== 'object' || !Array.isArray(keys)) return null;
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const value = source[key];
        if (value === null || value === undefined) continue;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
          const normalized = this.normalizeMatchText(value).toLowerCase();
          if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
          if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        }
      }
      return null;
    };

    const buildMetaRecord = (primary, secondary = null) => {
      const familyId = this.normalizeMatchText(
        primary?.FamilyID
        || primary?.familyId
        || primary?.familyID
        || primary?.ProductFamilyId
        || primary?.productFamilyId
        || secondary?.FamilyID
        || secondary?.familyId
        || secondary?.familyID
        || secondary?.ProductFamilyId
        || secondary?.productFamilyId
      );

      const primaryPoints = extractPointsMeta(primary);
      const secondaryPoints = extractPointsMeta(secondary);
      const primarySoldOut = extractSoldOutMeta(primary);
      const secondarySoldOut = extractSoldOutMeta(secondary);
      const familyAllProductsSoldOut = readBooleanFlag(primary, ['IsAllProductsSoldOut', 'isAllProductsSoldOut'])
        ?? readBooleanFlag(secondary, ['IsAllProductsSoldOut', 'isAllProductsSoldOut']);
      const soldOut = familyAllProductsSoldOut === null
        ? (primarySoldOut.soldOut || secondarySoldOut.soldOut)
        : familyAllProductsSoldOut;
      const soldOutText = soldOut
        ? (primarySoldOut.soldOutText || secondarySoldOut.soldOutText || '')
        : '';

      return {
        familyId,
        points: primaryPoints.points ?? secondaryPoints.points ?? null,
        pointsText: primaryPoints.pointsText || secondaryPoints.pointsText || '',
        familyAllProductsSoldOut,
        soldOut,
        soldOutText
      };
    };

    const mergeBooleanFlag = (left, right) => {
      const hasLeft = typeof left === 'boolean';
      const hasRight = typeof right === 'boolean';
      if (hasLeft && hasRight) {
        return left && right;
      }
      if (hasLeft) return left;
      if (hasRight) return right;
      return null;
    };

    const mergeMeta = (existing, incoming) => {
      const base = existing || {};
      const next = incoming || {};
      const mergedFamilyAllProductsSoldOut = mergeBooleanFlag(
        base.familyAllProductsSoldOut,
        next.familyAllProductsSoldOut
      );
      const mergedSoldOut = mergedFamilyAllProductsSoldOut === null
        ? Boolean(base.soldOut || next.soldOut)
        : mergedFamilyAllProductsSoldOut;
      return {
        familyId: this.normalizeMatchText(base.familyId || next.familyId),
        points: Number.isFinite(base.points) ? base.points : (Number.isFinite(next.points) ? next.points : null),
        pointsText: this.normalizeMatchText(base.pointsText || next.pointsText),
        familyAllProductsSoldOut: mergedFamilyAllProductsSoldOut,
        soldOut: mergedSoldOut,
        soldOutText: this.normalizeMatchText(base.soldOutText || next.soldOutText)
      };
    };

    const addMapValue = (map, key, value) => {
      const normalizedKey = this.normalizeMatchText(key);
      if (!normalizedKey) return;
      const existing = map.get(normalizedKey);
      const merged = mergeMeta(existing, value);
      if (!merged.familyId && !Number.isFinite(merged.points) && !merged.pointsText && !merged.soldOut) return;
      map.set(normalizedKey, merged);
    };

    const addFamilyMappings = (data, familyIdFallback = '') => {
      if (!data || typeof data !== 'object') return;
      const fallbackData = { FamilyID: familyIdFallback };
      const cardMeta = buildMetaRecord(data, fallbackData);
      if (!cardMeta.familyId && !Number.isFinite(cardMeta.points) && !cardMeta.pointsText && !cardMeta.soldOut) {
        return;
      }

      addMapValue(bySku, data.Sku || data.SKU || data.ProductSku, cardMeta);
      addMapValue(byTitle, this.normalizeLooseText(data.Title || data.Name || data.ProductName || ''), cardMeta);

      const pathCandidate = data.PdpLink || data.PDPLink || data.Url || data.URL || '';
      const normalizedPath = this.normalizePathForMatch(pathCandidate);
      if (normalizedPath) {
        addMapValue(byPath, normalizedPath, cardMeta);
        addMapValue(bySlug, this.normalizeSlugForMatch(pathCandidate), cardMeta);
      }

      const products = Array.isArray(data.Products) ? data.Products : [];
      for (const product of products) {
        if (!product || typeof product !== 'object') continue;
        const productMeta = buildMetaRecord(product, data);
        addMapValue(bySku, product.Sku || product.SKU || product.ProductSku, productMeta);
        addMapValue(
          byTitle,
          this.normalizeLooseText(product.Title || product.Name || product.ProductName || ''),
          productMeta
        );
        const productPath = this.normalizePathForMatch(product.PdpLink || product.Url || product.URL || '');
        if (productPath) {
          addMapValue(byPath, productPath, productMeta);
          addMapValue(bySlug, this.normalizeSlugForMatch(product.PdpLink || product.Url || product.URL || ''), productMeta);
        }
      }

      orderedEntries.push({
        familyId: cardMeta.familyId,
        path: normalizedPath,
        slug: this.normalizeSlugForMatch(pathCandidate),
        title: this.normalizeLooseText(data.Title || data.Name || data.ProductName || ''),
        meta: cardMeta
      });
    };

    for (const card of cards) {
      const data = card?.InnerData?.Data;
      if (data && typeof data === 'object') {
        addFamilyMappings(data);
      }
    }

    return {
      bySku,
      byPath,
      bySlug,
      byTitle,
      orderedEntries,
      cardCount: cards.length,
      entryCount: bySku.size + byPath.size + bySlug.size + byTitle.size
    };
  }

  selectBestFamilyMaps(snapshots) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
    const sorted = [...snapshots].sort((a, b) => {
      const cardDelta = Number(b?.cardCount || 0) - Number(a?.cardCount || 0);
      if (cardDelta !== 0) return cardDelta;
      return Number(b?.entryCount || 0) - Number(a?.entryCount || 0);
    });
    return sorted[0] || null;
  }

  enrichProductsWithFamilyIds(products, familyMaps) {
    if (!Array.isArray(products) || products.length === 0) return [];
    if (!familyMaps || familyMaps.entryCount <= 0) return products;

    const bySku = familyMaps.bySku || new Map();
    const byPath = familyMaps.byPath || new Map();
    const bySlug = familyMaps.bySlug || new Map();
    const byTitle = familyMaps.byTitle || new Map();
    const orderedEntries = Array.isArray(familyMaps.orderedEntries) ? familyMaps.orderedEntries : [];

    return products.map((product) => {
      const existingFamilyId = this.normalizeMatchText(product?.familyId);
      const domSoldOut = Boolean(product?.soldOut);
      const domSoldOutText = this.normalizeMatchText(product?.soldOutText || '');

      const skuKey = this.normalizeMatchText(product?.sku);
      const pathKey = this.normalizePathForMatch(product?.href);
      const slugKey = this.normalizeSlugForMatch(product?.href);
      const titleKey = this.normalizeLooseText(product?.name || product?.title);

      const matchedMeta =
        bySku.get(skuKey)
        || byPath.get(pathKey)
        || bySlug.get(slugKey)
        || byTitle.get(titleKey)
        || null;

      const positionIndex = Number.isFinite(product?.productIndex) ? product.productIndex : null;
      const orderedMeta = (
        !matchedMeta
        && positionIndex
        && positionIndex > 0
        && orderedEntries[positionIndex - 1]
      )
        ? orderedEntries[positionIndex - 1].meta
        : null;
      const effectiveMeta = matchedMeta || orderedMeta;

      if (!effectiveMeta) {
        return {
          ...product,
          familyId: existingFamilyId || product?.familyId || '',
          soldOut: domSoldOut,
          soldOutText: domSoldOutText
        };
      }

      const familyId = this.normalizeMatchText(existingFamilyId || effectiveMeta.familyId);
      const points = Number.isFinite(product?.points)
        ? product.points
        : (Number.isFinite(effectiveMeta.points) ? effectiveMeta.points : product?.points ?? null);
      const pointsText = this.normalizeMatchText(product?.pointsText || effectiveMeta.pointsText);
      const apiFamilySoldOutKnown = typeof effectiveMeta.familyAllProductsSoldOut === 'boolean';
      const apiFamilySoldOut = apiFamilySoldOutKnown ? Boolean(effectiveMeta.familyAllProductsSoldOut) : null;
      const apiSoldOut = apiFamilySoldOutKnown ? apiFamilySoldOut : Boolean(effectiveMeta.soldOut);
      const apiSoldOutText = this.normalizeMatchText(effectiveMeta.soldOutText || '');
      // When family-level sold-out is available from API, it wins over DOM/per-item hints.
      const soldOut = apiFamilySoldOutKnown
        ? apiFamilySoldOut
        : (domSoldOut || (!domSoldOut && apiSoldOut));
      const soldOutText = soldOut
        ? (apiFamilySoldOutKnown ? (apiSoldOutText || domSoldOutText) : (domSoldOutText || apiSoldOutText))
        : '';
      const soldOutSource = apiFamilySoldOutKnown
        ? 'category-api-family-flag'
        : (domSoldOut
          ? this.normalizeMatchText(product?.debugSoldOutSource || '')
          : (apiSoldOut ? 'category-api' : this.normalizeMatchText(product?.debugSoldOutSource || '')));

      return {
        ...product,
        familyId,
        points,
        pointsText,
        soldOut,
        soldOutText,
        debugSoldOutSource: soldOutSource
      };
    });
  }

  async collectGridData(page = this.page) {
    if (!page) {
      return {
        sortLabel: '',
        totalItems: 0,
        productCount: 0,
        mixinAdCount: 0,
        products: [],
        mixinAds: []
      };
    }

    return page.evaluate(() => {
      const textOrEmpty = (value) => String(value || '').trim();

      const parseNumber = (value) => {
        if (!value) return null;
        const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        if (!match) return null;
        const parsed = Number.parseFloat(match[0]);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const normalizeWhitespace = (value) => textOrEmpty(value).replace(/\s+/g, ' ');

      const readStampStyle = (element) => {
        if (!element) return null;
        const computed = window.getComputedStyle(element);
        if (!computed) return null;

        return {
          className: textOrEmpty(element.className),
          backgroundColor: textOrEmpty(computed.backgroundColor),
          color: textOrEmpty(computed.color),
          borderColor: textOrEmpty(computed.borderColor),
          borderWidth: textOrEmpty(computed.borderWidth),
          borderStyle: textOrEmpty(computed.borderStyle),
          borderRadius: textOrEmpty(computed.borderRadius),
          fontSize: textOrEmpty(computed.fontSize),
          fontWeight: textOrEmpty(computed.fontWeight),
          textTransform: textOrEmpty(computed.textTransform),
          letterSpacing: textOrEmpty(computed.letterSpacing),
          paddingTop: textOrEmpty(computed.paddingTop),
          paddingRight: textOrEmpty(computed.paddingRight),
          paddingBottom: textOrEmpty(computed.paddingBottom),
          paddingLeft: textOrEmpty(computed.paddingLeft)
        };
      };

      const extractPointsData = (card, pointsElement, container = null) => {
        const directCandidates = [
          normalizeWhitespace(pointsElement?.querySelector('.m-prodCard__text.-points')?.textContent),
          normalizeWhitespace(pointsElement?.querySelector('.m-prodCard__text')?.textContent),
          normalizeWhitespace(pointsElement?.textContent)
        ].filter(Boolean);

        for (const directText of directCandidates) {
          if (!/(points?|pts|pv)/i.test(directText)) continue;
          const parsed = parseNumber(directText);
          if (parsed !== null) {
            return { pointsText: directText, points: parsed, source: 'points-element-text' };
          }
        }

        // Strong selector fallback based on known card markup.
        const knownPointNodes = Array.from(card.querySelectorAll(
          '.m-prodCard__points .m-prodCard__text.-points, .m-prodCard__points .m-prodCard__text, .m-prodCard__points'
        ));
        for (const node of knownPointNodes) {
          const text = normalizeWhitespace(node.textContent);
          if (!text) continue;
          const parsed = parseNumber(text);
          if (parsed !== null) {
            return { pointsText: text, points: parsed, source: 'known-points-selector' };
          }
        }

        // Broader scan for point-like content.
        const nodes = Array.from(card.querySelectorAll('[class], [data-testid], [aria-label]'));
        for (const node of nodes) {
          const className = textOrEmpty(node.getAttribute('class')).toLowerCase();
          const testId = textOrEmpty(node.getAttribute('data-testid')).toLowerCase();
          const ariaLabel = normalizeWhitespace(node.getAttribute('aria-label'));
          const text = normalizeWhitespace(node.textContent);
          const haystack = `${className} ${testId} ${ariaLabel} ${text}`.toLowerCase();
          if (!/(point|pts|pv)/i.test(haystack)) continue;

          const parsed = parseNumber(text || ariaLabel);
          if (parsed !== null) {
            const pointsText = text || ariaLabel || `${parsed}`;
            return { pointsText, points: parsed, source: 'keyword-node-scan' };
          }
        }

        // Last-resort fallback from full visible text.
        const aggregateText = normalizeWhitespace(
          (container?.innerText || container?.textContent || '')
          || (card.innerText || card.textContent)
        );
        const matched = aggregateText.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(points?|pts|pv)\b/i);
        if (matched) {
          const parsed = parseNumber(matched[1]);
          if (parsed !== null) {
            return {
              pointsText: `${matched[1]} ${matched[2]}`,
              points: parsed,
              source: 'aggregate-text'
            };
          }
        }

        return { pointsText: '', points: null, source: 'none' };
      };

      const extractSoldOutData = (card, container = null) => {
        const soldOutPattern = /\b(sold\s*out|out\s*of\s*stock|off\s*sale|temporarily\s*unavailable)\b/i;
        const soldClassPattern = /soldout|sold-out|offsale|off-sale|outofstock|out-of-stock/i;
        const isElementVisible = (element) => {
          if (!element || !(element instanceof Element)) return false;
          const style = window.getComputedStyle(element);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (Number(style.opacity || '1') === 0) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const readPseudoContent = (element, pseudo) => {
          try {
            const raw = window.getComputedStyle(element, pseudo)?.content;
            if (!raw || raw === 'none' || raw === 'normal') return '';
            return normalizeWhitespace(String(raw).replace(/^["']|["']$/g, ''));
          } catch {
            return '';
          }
        };

        const soldSelector = [
          '.m-prodCard__disabled',
          '.m-prodCard__offSale',
          '.m-prodCard__text.-offSale',
          '[class*="offSale"]',
          '[class*="off-sale"]',
          '[class*="soldOut"]',
          '[class*="sold-out"]',
          '[class*="SoldOut"]',
          '[class*="Sold-Out"]',
          '[data-testid*="sold"]',
          '[aria-label*="sold"]',
          '[aria-label*="unavailable"]',
          '[title*="sold"]',
          '[title*="unavailable"]'
        ].join(', ');

        const searchRoots = [card, container].filter(Boolean);
        for (const root of searchRoots) {
          const nodes = Array.from(root.querySelectorAll(soldSelector));
          for (const node of nodes) {
            if (!isElementVisible(node)) continue;

            const text = normalizeWhitespace(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title'));
            if (soldOutPattern.test(text)) {
              return { soldOut: true, soldOutText: text, source: 'sold-selector-text' };
            }

            const pseudoAfter = readPseudoContent(node, '::after');
            const pseudoBefore = readPseudoContent(node, '::before');
            if (soldOutPattern.test(pseudoAfter) || soldOutPattern.test(pseudoBefore)) {
              return {
                soldOut: true,
                soldOutText: pseudoAfter || pseudoBefore || 'Sold Out',
                source: 'sold-selector-pseudo'
              };
            }

            const className = textOrEmpty(node.getAttribute('class')).toLowerCase();
            if (soldClassPattern.test(className)) {
              const inActions = Boolean(node.closest('.m-prodCard__row.-actions, .m-prodCard__button.-shelfToggle'));
              if (!inActions && !text && !pseudoAfter && !pseudoBefore) {
                continue;
              }
              return { soldOut: true, soldOutText: text || 'Sold Out', source: 'sold-selector-class' };
            }
          }

          const signalNodes = Array.from(root.querySelectorAll('[class], [aria-label], [title], [data-testid]'));
          for (const node of signalNodes) {
            if (!isElementVisible(node)) continue;

            const className = textOrEmpty(node.getAttribute('class'));
            const ariaLabel = normalizeWhitespace(node.getAttribute('aria-label'));
            const title = normalizeWhitespace(node.getAttribute('title'));
            const testId = textOrEmpty(node.getAttribute('data-testid'));
            const text = normalizeWhitespace(node.textContent);
            const pseudoAfter = readPseudoContent(node, '::after');
            const pseudoBefore = readPseudoContent(node, '::before');
            const textualSignals = `${ariaLabel} ${title} ${text} ${pseudoAfter} ${pseudoBefore}`;

            if (soldOutPattern.test(textualSignals)) {
              return {
                soldOut: true,
                soldOutText: text || ariaLabel || title || pseudoAfter || pseudoBefore || 'Sold Out',
                source: 'sold-scan-pattern'
              };
            }

            if (soldClassPattern.test(`${className} ${testId}`)) {
              const inActions = Boolean(node.closest('.m-prodCard__row.-actions, .m-prodCard__button.-shelfToggle'));
              if (inActions || text || ariaLabel || title || pseudoAfter || pseudoBefore) {
                return {
                  soldOut: true,
                  soldOutText: text || ariaLabel || title || pseudoAfter || pseudoBefore || 'Sold Out',
                  source: 'sold-scan-class-hint'
                };
              }
            }
          }
        }

        const fullText = normalizeWhitespace(
          (container?.innerText || container?.textContent || '')
          || (card.innerText || card.textContent)
        );
        const matched = fullText.match(soldOutPattern);
        if (matched) {
          return { soldOut: true, soldOutText: matched[0], source: 'aggregate-text' };
        }

        return { soldOut: false, soldOutText: '', source: 'none' };
      };

      const firstNonEmpty = (...values) => {
        for (const value of values) {
          const text = textOrEmpty(value);
          if (text) return text;
        }
        return '';
      };

      const familyAttrNames = [
        'data-family-id',
        'data-familyid',
        'family-id',
        'familyid',
        'data-family',
        'data-product-family-id',
        'data-productfamilyid'
      ];

      const parseJson = (value) => {
        const text = textOrEmpty(value);
        if (!text) return null;
        if (!text.startsWith('{') && !text.startsWith('[')) return null;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };

      const findFamilyIdInObject = (value, depth = 0) => {
        if (depth > 4 || value === null || value === undefined) return '';
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = findFamilyIdInObject(item, depth + 1);
            if (found) return found;
          }
          return '';
        }

        if (typeof value !== 'object') return '';

        for (const [key, child] of Object.entries(value)) {
          const normalizedKey = String(key || '').toLowerCase();
          if (normalizedKey === 'familyid' || normalizedKey === 'family_id' || normalizedKey === 'productfamilyid') {
            const found = textOrEmpty(child);
            if (found) return found;
          }
          const nestedFound = findFamilyIdInObject(child, depth + 1);
          if (nestedFound) return nestedFound;
        }
        return '';
      };

      const readFamilyIdFromElement = (element) => {
        if (!element) return '';

        for (const attr of familyAttrNames) {
          const found = textOrEmpty(element.getAttribute(attr));
          if (found) return found;
        }

        const dataset = element.dataset || {};
        for (const [key, value] of Object.entries(dataset)) {
          const normalizedKey = String(key || '').toLowerCase();
          if (
            normalizedKey === 'familyid'
            || normalizedKey === 'family_id'
            || normalizedKey === 'productfamilyid'
            || normalizedKey.includes('family')
          ) {
            const found = textOrEmpty(value);
            if (found) return found;
          }

          const parsed = parseJson(value);
          if (parsed) {
            const parsedFamilyId = findFamilyIdInObject(parsed);
            if (parsedFamilyId) return parsedFamilyId;
          }
        }

        for (const attr of Array.from(element.attributes || [])) {
          const attrName = String(attr?.name || '').toLowerCase();
          const attrValue = textOrEmpty(attr?.value);
          if (!attrName || !attrValue) continue;

          if (attrName.includes('family')) {
            return attrValue;
          }

          const parsed = parseJson(attrValue);
          if (parsed) {
            const parsedFamilyId = findFamilyIdInObject(parsed);
            if (parsedFamilyId) return parsedFamilyId;
          }
        }

        return '';
      };

      const readFamilyIdFromHref = (href) => {
        const hrefText = textOrEmpty(href);
        if (!hrefText) return '';

        try {
          const parsedUrl = new URL(hrefText, window.location.origin);
          const familyQueryParams = [
            'familyId',
            'familyid',
            'productFamilyId',
            'productfamilyid',
            'idFamily',
            'idfamily'
          ];
          for (const key of familyQueryParams) {
            const value = textOrEmpty(parsedUrl.searchParams.get(key));
            if (value) return value;
          }
        } catch {
          // Ignore URL parse failures and continue with regex
        }

        const familyPathMatch = hrefText.match(/\/(?:productfamily|family)\/(\d+)/i);
        if (familyPathMatch) return textOrEmpty(familyPathMatch[1]);

        return '';
      };

      const items = Array.from(document.querySelectorAll('ul.p-catListing__grid > li.p-catListing__col'));
      const products = [];
      const mixinAds = [];

      items.forEach((li, idx) => {
        const position = idx + 1;
        const mixin = li.querySelector('.m-mixinAd, article.m-mixinAd');
        if (mixin) {
          const anchor = mixin.querySelector('a') || mixin.closest('a');
          const headline =
            mixin.querySelector('.m-mixinAd__headline') ||
            mixin.querySelector('.m-mixinAd__title') ||
            mixin.querySelector('h2, h3, h4');
          const image = mixin.querySelector('img');
          mixinAds.push({
            position,
            title: textOrEmpty(headline?.textContent || anchor?.getAttribute('aria-label')),
            href: anchor?.href || '',
            target: anchor?.target || '',
            imageAlt: textOrEmpty(image?.alt),
            imageSrc: image?.currentSrc || image?.src || ''
          });
          return;
        }

        const card = li.querySelector('.m-prodCard');
        if (!card) return;

        const rowLink = card.querySelector('a.m-prodCard__row.-content') || card.querySelector('a[href]');
        const nameEl = card.querySelector('.m-prodCard__title');
        const pointsEl = card.querySelector('.m-prodCard__points');
        const imageEl = card.querySelector('img');
        const stampEl =
          card.querySelector('.m-prodCard__stamp')
          || card.querySelector('.a-stamp')
          || card.querySelector('[data-testid*="stamp"]')
          || card.querySelector('[class*="stamp"]');

        let memberPrice = null;
        let memberPriceText = '';
        const priceCandidates = [
          card.querySelector('.m-prodCard__pricing .text-gray-150.text-xl'),
          card.querySelector('.m-prodCard__pricing [class*="text-xl"]'),
          card.querySelector('.m-prodCard__pricing')
        ].filter(Boolean);

        for (const candidate of priceCandidates) {
          const text = (candidate.textContent || '').trim();
          const parsed = parseNumber(text);
          if (parsed !== null) {
            memberPrice = parsed;
            memberPriceText = text;
            break;
          }
        }

        const pointsData = extractPointsData(card, pointsEl, li);
        const pointsText = pointsData.pointsText;
        const points = pointsData.points;
        const href = rowLink?.href || '';
        const skuMatchFromHref = href.match(/\/Product\/(\d+)/i);
        const skuMatchFromImage = (imageEl?.currentSrc || imageEl?.src || '').match(/\/products\/(\d+)[a-z]?[-_]/i)
          || (imageEl?.currentSrc || imageEl?.src || '').match(/\/products\/(\d+)/i);
        const sku = skuMatchFromHref?.[1] || skuMatchFromImage?.[1] || '';
        const name = textOrEmpty(nameEl?.textContent);
        const stamp = textOrEmpty(stampEl?.textContent);
        const stampStyle = readStampStyle(stampEl);
        const soldOutData = extractSoldOutData(card, li);
        const signalSnippet = normalizeWhitespace(li?.innerText || li?.textContent || '').slice(0, 220);
        const hasSoldOutKeyword = /sold\s*out|out\s*of\s*stock|off\s*sale/i.test(signalSnippet);
        const familyId = firstNonEmpty(
          readFamilyIdFromElement(card),
          readFamilyIdFromElement(rowLink),
          readFamilyIdFromElement(li),
          readFamilyIdFromHref(href)
        );

        products.push({
          position,
          productIndex: products.length + 1,
          name,
          title: name,
          familyId,
          stamp,
          stampStyle,
          soldOut: Boolean(soldOutData.soldOut),
          soldOutText: textOrEmpty(soldOutData.soldOutText),
          href,
          sku,
          imageSrc: imageEl?.currentSrc || imageEl?.src || '',
          imageAlt: textOrEmpty(imageEl?.alt),
          memberPrice,
          memberPriceText,
          points,
          pointsText,
          debugPointsSource: textOrEmpty(pointsData.source),
          debugSoldOutSource: textOrEmpty(soldOutData.source),
          debugHasSoldOutKeyword: hasSoldOutKeyword,
          debugSignalSnippet: signalSnippet
        });
      });

      return {
        sortLabel: 'Default order',
        totalItems: items.length,
        productCount: products.length,
        mixinAdCount: mixinAds.length,
        products,
        mixinAds
      };
    });
  }

  async primeGridByScrolling(page = this.page) {
    if (!page) return;

    await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const maxPasses = 60;
      let previousHeight = 0;
      let stableHeightPasses = 0;

      for (let i = 0; i < maxPasses; i++) {
        window.scrollBy(0, Math.max(420, Math.floor(window.innerHeight * 0.9)));
        await wait(90);

        const currentHeight = Math.max(
          document.documentElement?.scrollHeight || 0,
          document.body?.scrollHeight || 0
        );

        if (currentHeight === previousHeight) {
          stableHeightPasses += 1;
        } else {
          stableHeightPasses = 0;
          previousHeight = currentHeight;
        }

        const nearBottom = (window.innerHeight + window.scrollY) >= (currentHeight - 24);
        if (nearBottom && stableHeightPasses >= 2) break;
      }

      await wait(200);
      window.scrollTo({ top: 0, behavior: 'auto' });
      await wait(120);
    });
  }

  async captureSortsAtWidth(url, width, meta = {}) {
    log('info', `Capturing sort order data at ${width}px`, { url });

    const page = this.page;
    if (!page) {
      throw new Error('Capture page not initialized');
    }

    const categoryApiSnapshots = [];
    const pendingResponseParses = new Set();
    const trackCategoryResponse = (response) => {
      const task = (async () => {
        try {
          const responseUrl = response.url();
          if (!responseUrl.includes('/api/category/search/')) return;

          const status = response.status();
          if (status < 200 || status >= 300) return;

          const headers = response.headers();
          const contentType = String(headers['content-type'] || '').toLowerCase();
          if (!contentType.includes('json')) return;

          const payload = await response.json();
          const maps = this.buildFamilyMapsFromCategoryPayload(payload);
          if (maps.entryCount <= 0) return;

          categoryApiSnapshots.push({
            responseUrl,
            cardCount: maps.cardCount,
            entryCount: maps.entryCount,
            maps
          });
        } catch {
          // Ignore parse failures from non-category payloads
        }
      })();

      pendingResponseParses.add(task);
      task.finally(() => pendingResponseParses.delete(task));
    };

    page.on('response', trackCategoryResponse);

    try {
      await page.setViewportSize({ width, height: config.sortorder.browser.captureHeight });
      await page.goto(url, {
        waitUntil: 'load',
        timeout: config.sortorder.timeouts.singleCapture
      });
      await page.waitForTimeout(config.sortorder.timeouts.pageLoad);

      if (!meta.skipAuthCheck) {
        const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(
          meta.environment,
          meta.username,
          meta.password,
          page
        );
        if (msAuthHandled) {
          await page.goto(url, {
            waitUntil: 'load',
            timeout: config.sortorder.timeouts.singleCapture
          });
          await page.waitForTimeout(config.sortorder.timeouts.pageLoad);
        }
      }

      const initialShowAll = await this.ensureShowAllProducts(page);
      await this.primeGridByScrolling(page);
      this.emitProgress({
        type: 'capture-progress',
        state: 'sorting',
        sortLabel: 'Default order',
        sortIndex: 1,
        sortCount: 1,
        width,
        culture: meta.culture,
        category: meta.category,
        mainCategory: meta.mainCategory
      });

      const gridData = await this.collectGridData(page);
      const domSignalSummary = this.summarizeProductSignals(gridData.products);
      log('info', 'SortOrder DOM extraction summary', {
        category: meta.category,
        culture: meta.culture,
        width,
        ...domSignalSummary
      });

      if (pendingResponseParses.size > 0) {
        await Promise.allSettled(Array.from(pendingResponseParses));
      }

      const bestFamilySnapshot = this.selectBestFamilyMaps(categoryApiSnapshots);
      log('info', 'SortOrder category API enrichment snapshot', {
        category: meta.category,
        culture: meta.culture,
        width,
        snapshotCount: categoryApiSnapshots.length,
        bestCardCount: bestFamilySnapshot?.cardCount || 0,
        bestEntryCount: bestFamilySnapshot?.entryCount || 0,
        bestUrl: bestFamilySnapshot?.responseUrl || '',
        bestSignalSummary: this.summarizeFamilyMapSignals(bestFamilySnapshot?.maps || null)
      });

      const enrichedProducts = this.enrichProductsWithFamilyIds(
        gridData.products,
        bestFamilySnapshot?.maps || null
      );
      const validationEnabled = this.currentOptions?.sortValidationEnabled !== false;
      const businessValidation = validationEnabled
        ? this.buildSortOrderBusinessValidation(enrichedProducts)
        : {
          pass: null,
          status: 'info',
          message: 'Sort order validation disabled',
          rules: []
        };
      const enrichedSignalSummary = this.summarizeProductSignals(enrichedProducts);
      log('info', 'SortOrder enriched product summary', {
        category: meta.category,
        culture: meta.culture,
        width,
        ...enrichedSignalSummary
      });
      if (validationEnabled) {
        log('info', 'SortOrder business validation summary', {
          category: meta.category,
          culture: meta.culture,
          width,
          pass: businessValidation.pass,
          status: businessValidation.status,
          message: businessValidation.message,
          rules: businessValidation.rules?.map((rule) => ({
            id: rule.id,
            pass: rule.pass,
            message: rule.message,
            violations: Array.isArray(rule.details?.violations) ? rule.details.violations.length : 0
          }))
        });
      } else {
        log('info', 'SortOrder business validation skipped', {
          category: meta.category,
          culture: meta.culture,
          width
        });
      }

      return [{
        width,
        culture: meta.culture || '',
        category: meta.category || '',
        mainCategory: meta.mainCategory || '',
        order: meta.order ?? null,
        environment: meta.environment || 'stage',
        url,
        sortLabel: gridData.sortLabel || 'Default order',
        sortValue: '',
        sortKey: 'default',
        validation: businessValidation,
        showAll: {
          initial: initialShowAll
        },
        totalItems: gridData.totalItems,
        productCount: gridData.productCount,
        mixinAdCount: gridData.mixinAdCount,
        products: enrichedProducts,
        mixinAds: gridData.mixinAds,
        timestamp: Date.now()
      }];
    } catch (err) {
      log('error', `Error capturing sort order at ${width}px`, { error: err.message });
      return [{
        error: true,
        message: err.message,
        width,
        culture: meta.culture || '',
        category: meta.category || '',
        mainCategory: meta.mainCategory || '',
        environment: meta.environment || 'stage',
        order: meta.order ?? null,
        url
      }];
    } finally {
      page.off('response', trackCategoryResponse);
    }
  }

  async start(options) {
    log('info', '========================================');
    log('info', 'STARTING SORT ORDER CAPTURE PROCESS');
    log('info', '========================================');
    log('info', 'Options received', summarizeOptions(options));

    if (this.isRunning) {
      throw new Error('Capture already in progress');
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.results = [];
    this.currentOptions = options;

    const startTime = Date.now();
    const jobs = this.buildJobList(options);
    const selectedWidths = (Array.isArray(options.widths) && options.widths.length > 0)
      ? options.widths
      : [config.sortorder.defaults.width];
    const totalCaptures = jobs.length * selectedWidths.length;
    const totalCategories = jobs.length;

    this.emitStatus({
      type: 'started',
      jobCount: jobs.length,
      widthCount: selectedWidths.length,
      widths: selectedWidths,
      total: totalCaptures,
      totalBanners: totalCategories
    });

    let completedCaptures = 0;

    try {
      await this.launchBrowser();
      const initialWidth = selectedWidths[0] || config.sortorder.defaults.width || 1210;
      let completedCategories = 0;

      await this.createContext({
        viewport: { width: initialWidth, height: config.sortorder.browser.captureHeight }
      });
      await this.createPage();

      const loggedInHosts = new Map();
      let hasAuthenticated = false;

      if ((options.environment === 'stage' || options.environment === 'uat') && jobs.length > 0) {
        const firstJob = jobs[0];
        await this.page.goto(firstJob.url, {
          waitUntil: 'load',
          timeout: config.sortorder.timeouts.singleCapture
        });
        await this.page.waitForTimeout(config.sortorder.timeouts.pageLoad);

        const msAuthHandled = await this.handleMicrosoftAuthIfNeeded(
          options.environment,
          options.username,
          options.password
        );
        if (msAuthHandled) {
          hasAuthenticated = true;
        }
      }

      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
        const job = jobs[jobIndex];
        if (this.shouldStop) break;

        await this.ensureLoggedIn(job, options, loggedInHosts);
        const currentCategory = jobIndex + 1;
        const validationEnabled = this.currentOptions?.sortValidationEnabled !== false;
        const categorySummary = {
          url: job.url,
          capturesCollected: 0,
          failedCaptures: 0,
          mixinAds: 0,
          products: 0,
          validationEnabled,
          validationFailedCaptures: 0,
          validationFailedRules: 0,
          validationIssues: new Set()
        };

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
            total: totalCaptures,
            completed: completedCaptures,
            totalBanners: totalCategories,
            completedBanners: completedCategories,
            currentBanner: currentCategory,
            isLastWidthForBanner: isLastWidthForCategory
          });

          try {
            const pageResults = await this.captureSortsAtWidth(job.url, width, {
              category: job.category,
              culture: job.culture,
              order: job.order,
              mainCategory: job.mainCategory,
              environment: options.environment,
              skipAuthCheck: hasAuthenticated,
              username: options.username,
              password: options.password
            });

            for (const result of pageResults) {
              this.results.push(result);
            }

            completedCaptures++;
            if (isLastWidthForCategory) completedCategories++;

            const failedRuns = pageResults.filter((result) => result.error).length;
            const mixinAds = pageResults.reduce((sum, result) => {
              return sum + (Number.isFinite(result.mixinAdCount) ? result.mixinAdCount : 0);
            }, 0);
            const products = pageResults.reduce((sum, result) => {
              return sum + (Number.isFinite(result.productCount) ? result.productCount : 0);
            }, 0);
            const failedValidationResults = pageResults.filter((result) => (
              !result.error
              && result.validation
              && result.validation.pass === false
            ));
            const failedValidationRules = failedValidationResults.reduce((sum, result) => {
              const rules = Array.isArray(result.validation?.rules) ? result.validation.rules : [];
              return sum + rules.filter((rule) => rule && rule.pass === false).length;
            }, 0);

            categorySummary.capturesCollected += pageResults.length;
            categorySummary.failedCaptures += failedRuns;
            categorySummary.mixinAds += mixinAds;
            categorySummary.products += products;
            categorySummary.validationFailedCaptures += failedValidationResults.length;
            categorySummary.validationFailedRules += failedValidationRules;

            for (const validationResult of failedValidationResults) {
              const rules = Array.isArray(validationResult.validation?.rules)
                ? validationResult.validation.rules
                : [];
              for (const rule of rules) {
                if (!rule || rule.pass !== false) continue;
                const title = this.normalizeMatchText(rule.title || rule.id || 'Validation rule');
                const message = this.normalizeMatchText(rule.message || '');
                categorySummary.validationIssues.add(
                  message
                    ? `${title}: ${message}`
                    : title
                );
              }
            }

            this.emitProgress({
              type: 'capture-progress',
              width,
              state: failedRuns > 0 ? 'error' : 'done',
              category: job.category,
              culture: job.culture,
              mainCategory: job.mainCategory,
              total: totalCaptures,
              completed: completedCaptures,
              totalBanners: totalCategories,
              completedBanners: completedCategories,
              currentBanner: currentCategory,
              isLastWidthForBanner: isLastWidthForCategory,
              result: {
                url: job.url,
                capturesCollected: categorySummary.capturesCollected,
                failedCaptures: categorySummary.failedCaptures,
                mixinAds: categorySummary.mixinAds,
                products: categorySummary.products,
                validationEnabled: categorySummary.validationEnabled,
                validationFailedCaptures: categorySummary.validationFailedCaptures,
                validationFailedRules: categorySummary.validationFailedRules,
                validationIssues: Array.from(categorySummary.validationIssues).slice(0, 8)
              }
            });
          } catch (err) {
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
            if (isLastWidthForCategory) completedCategories++;
            categorySummary.capturesCollected += 1;
            categorySummary.failedCaptures += 1;

            this.emitProgress({
              type: 'capture-progress',
              width,
              state: 'error',
              category: job.category,
              culture: job.culture,
              mainCategory: job.mainCategory,
              total: totalCaptures,
              completed: completedCaptures,
              totalBanners: totalCategories,
              completedBanners: completedCategories,
              currentBanner: currentCategory,
              isLastWidthForBanner: isLastWidthForCategory,
              result: {
                url: job.url,
                capturesCollected: categorySummary.capturesCollected,
                failedCaptures: categorySummary.failedCaptures,
                mixinAds: categorySummary.mixinAds,
                products: categorySummary.products,
                validationEnabled: categorySummary.validationEnabled,
                validationFailedCaptures: categorySummary.validationFailedCaptures,
                validationFailedRules: categorySummary.validationFailedRules,
                validationIssues: Array.from(categorySummary.validationIssues).slice(0, 8),
                captureError: err.message
              }
            });
          }

          if (!this.shouldStop) {
            await new Promise((resolve) => setTimeout(resolve, config.sortorder.timeouts.betweenCaptures));
          }
        }
      }
    } catch (err) {
      log('error', 'FATAL ERROR during sort order capture', { error: err.message, stack: err.stack });
      this.emitError({ message: err.message });
    } finally {
      await this.closeBrowser();

      this.isRunning = false;
      const duration = Date.now() - startTime;
      const successCount = this.results.filter((result) => !result.error).length;
      const errorCount = this.results.filter((result) => result.error).length;
      const infoCount = 0;

      if (!this.shouldStop) {
        this.emitStatus({
          type: 'completed',
          results: this.results,
          duration,
          successCount,
          errorCount,
          infoCount
        });
      } else {
        this.emitStatus({
          type: 'cancelled',
          results: this.results,
          duration,
          successCount,
          errorCount,
          infoCount
        });
      }
    }

    return {
      results: this.results,
      duration: Date.now() - startTime
    };
  }

  buildJobList(options) {
    const jobs = [];
    const { environment, region, cultures, categories } = options;
    const regionConfig = config.sortorder.regions[region];
    if (!regionConfig) {
      log('error', 'Invalid sort order region', { region });
      return jobs;
    }

    const selectedCultures = cultures && cultures.length > 0
      ? regionConfig.cultures.filter((culture) => cultures.includes(culture.code))
      : regionConfig.cultures;

    let order = 0;
    for (const cultureInfo of selectedCultures) {
      const culture = cultureInfo.code;
      for (const mainCategory of regionConfig.categories) {
        const selectedItems = categories && categories.length > 0
          ? mainCategory.items.filter((item) => {
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

    log('info', `Built ${jobs.length} sort order jobs`);
    return jobs;
  }
}
