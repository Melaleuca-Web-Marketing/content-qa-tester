// ai-reviewer.js - AI review of Page Tester results via the Anthropic API
//
// Requires ANTHROPIC_API_KEY (loaded from .env.local / .env by server.js).
// Model can be overridden with TESTER_AI_MODEL (defaults to claude-opus-4-8).

import Anthropic from '@anthropic-ai/sdk';
import { log } from './logger.js';

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_PAGES_PER_REVIEW = 60;
const MAX_LIST_ITEMS = 20;
const MAX_TEXT_LENGTH = 300;

export function isAiReviewAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAiModel() {
  return process.env.TESTER_AI_MODEL || DEFAULT_MODEL;
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallSummary', 'overallStatus', 'pages'],
  properties: {
    overallSummary: {
      type: 'string',
      description: 'Plain-English overview of the whole test run: what was tested, overall health, and the most important problems in priority order.'
    },
    overallStatus: { type: 'string', enum: ['pass', 'warning', 'fail'] },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'culture', 'authMode', 'verdict', 'summary', 'findings'],
        properties: {
          url: { type: 'string', description: 'Echo the tested URL exactly as given in the input so it can be matched back.' },
          culture: { type: 'string' },
          authMode: { type: 'string', enum: ['signedOut', 'signedIn'] },
          verdict: { type: 'string', enum: ['pass', 'warning', 'fail'] },
          summary: { type: 'string', description: 'One or two sentences a content author can act on.' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['severity', 'title', 'explanation', 'recommendation'],
              properties: {
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
                title: { type: 'string' },
                explanation: { type: 'string', description: 'What the raw signal means in context and why it matters for this kind of page.' },
                recommendation: { type: 'string', description: 'Concrete next step for the QA/content team.' }
              }
            }
          }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = `You are a senior content QA analyst reviewing automated test results for melaleuca.com, a Sitecore-based e-commerce site with a Vue front end. The audience is the content team, not developers.

You receive structured results from a Playwright test run over one or more pages. Each entry includes the auth mode (signedOut/signedIn), culture, HTTP status, image health (broken images, missing alt text), content metadata (title, meta description, H1s, heading outline, text length, html lang), and a component inventory using known Melaleuca component selectors.

Your job is to add context the raw data lacks, focused on CONTENT quality:
- Consider page type. A product store landing page should have carousels/banners; a product detail page should have productDetails; a category page should have productGrid. Missing expected components for that page type matters; absent irrelevant components does not.
- Judge whether the content looks complete: broken or missing images, empty or thin pages, missing titles/descriptions/headings, suspicious heading outlines.
- Compare signed-out vs signed-in results for the same page when both are present and call out differences (e.g. content only broken when authenticated).
- Compare cultures for the same page and flag localization gaps (wrong lang attribute, sc_lang mismatch, headings that appear untranslated).
- Distinguish real content problems from noise; an HTTP 403 with a "Just a moment..." title is a bot-protection block, not a content defect — say so plainly.

Be specific and reference the actual data. Do not invent issues that are not supported by the input. When a page is healthy, say so briefly. Phrase findings and recommendations for content authors (what to fix in Sitecore), not engineers. Echo each page's url, culture, and authMode exactly so results can be matched back.`;

function truncate(value, max = MAX_TEXT_LENGTH) {
  const str = String(value ?? '');
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function capList(list, mapper) {
  if (!Array.isArray(list)) return [];
  const capped = list.slice(0, MAX_LIST_ITEMS).map(mapper);
  if (list.length > MAX_LIST_ITEMS) {
    capped.push(`(+${list.length - MAX_LIST_ITEMS} more)`);
  }
  return capped;
}

// Reduce a full page result to a compact, screenshot-free payload for the model
function summarizeResultForReview(result) {
  const checks = result.checks || {};
  return {
    page: result.page,
    url: result.url,
    culture: result.culture,
    authMode: result.authMode,
    success: result.success,
    error: result.error || null,
    httpStatus: result.httpStatus ?? null,
    redirectChain: capList(result.redirectChain, (u) => truncate(u, 200)),
    loadTimeMs: result.loadTimeMs ?? null,
    images: checks.images ? {
      total: checks.images.total,
      broken: capList(checks.images.broken, (src) => truncate(src, 200)),
      missingAltCount: checks.images.missingAltCount
    } : null,
    content: checks.content ? {
      ...checks.content,
      headings: capList(checks.content.headings, (h) => truncate(h, 120))
    } : null,
    components: checks.components || null,
    issues: capList(result.issues, (i) => truncate(i, 160))
  };
}

/**
 * Run an AI review over page test results.
 * @param {Array} results - Page Tester result objects
 * @param {object} context - { environment, region, cultures, authModes, testName }
 * @returns {Promise<object>} { enabled, model, overallSummary, overallStatus, pages, error }
 */
export async function reviewPageResults(results, context = {}) {
  if (!isAiReviewAvailable()) {
    return { enabled: false, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const model = getAiModel();
  const reviewable = results.slice(0, MAX_PAGES_PER_REVIEW);
  const payload = {
    context: {
      environment: context.environment || null,
      region: context.region || null,
      cultures: context.cultures || null,
      authModes: context.authModes || null,
      testName: context.testName || null,
      resultCount: results.length,
      truncated: results.length > MAX_PAGES_PER_REVIEW
    },
    results: reviewable.map(summarizeResultForReview)
  };

  log('info', '[AI Review] Requesting review', {
    model,
    resultCount: reviewable.length,
    payloadBytes: JSON.stringify(payload).length
  });

  const client = new Anthropic();
  const startedAt = Date.now();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Review these QA test results and return your analysis.\n\n${JSON.stringify(payload)}`
      }],
      output_config: {
        format: { type: 'json_schema', schema: REVIEW_SCHEMA }
      }
    });

    if (response.stop_reason === 'refusal') {
      log('warn', '[AI Review] Request was refused by the model');
      return { enabled: true, model, error: 'AI review request was refused' };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock) {
      return { enabled: true, model, error: 'AI review returned no text content' };
    }

    const parsed = JSON.parse(textBlock.text);
    log('info', '[AI Review] Review complete', {
      model,
      durationMs: Date.now() - startedAt,
      overallStatus: parsed.overallStatus,
      pageCount: parsed.pages?.length || 0,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens
    });

    return {
      enabled: true,
      model,
      overallSummary: parsed.overallSummary,
      overallStatus: parsed.overallStatus,
      pages: Array.isArray(parsed.pages) ? parsed.pages : []
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      log('error', '[AI Review] Authentication failed - check ANTHROPIC_API_KEY');
      return { enabled: true, model, error: 'AI review authentication failed (invalid API key)' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      log('error', '[AI Review] Rate limited');
      return { enabled: true, model, error: 'AI review rate limited - try again later' };
    }
    if (err instanceof Anthropic.APIError) {
      log('error', '[AI Review] API error', { status: err.status, message: err.message });
      return { enabled: true, model, error: `AI review failed (API ${err.status})` };
    }
    log('error', '[AI Review] Unexpected error', { error: err.message });
    return { enabled: true, model, error: `AI review failed: ${truncate(err.message, 200)}` };
  }
}
