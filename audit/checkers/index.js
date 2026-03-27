const { URL } = require('url');
const axios = require('axios');

// ─── LINKS & URLS ────────────────────────────────────────────────────────────

function checkLinksAndUrls(pages) {
  const issues = [];

  // Group by URL for cross-page checks
  const urlMap = new Map(pages.map(p => [p.url, p]));

  for (const page of pages) {
    const url = page.url;

    // Broken internal page
    if (page.status_code >= 400) {
      issues.push({
        page_url: url, category: 'links_urls',
        severity: page.status_code >= 500 ? 'critical' : 'critical',
        check_name: `${page.status_code}_page`,
        description: `Page returns HTTP ${page.status_code}`,
        affected_url: url
      });
    }

    // Redirect chains (3+ hops)
    if (page.redirect_chain && page.redirect_chain.length >= 3) {
      issues.push({
        page_url: url, category: 'links_urls', severity: 'warning',
        check_name: 'redirect_chain',
        description: `Redirect chain of ${page.redirect_chain.length} hops: ${page.redirect_chain.map(r => r.url).join(' → ')}`,
        affected_url: url,
        extra_data: { chain: page.redirect_chain }
      });
    }

    // Broken redirect (redirect to 4xx)
    if (page.redirect_url && page.status_code >= 400) {
      issues.push({
        page_url: url, category: 'links_urls', severity: 'critical',
        check_name: 'broken_redirect',
        description: `Redirects to ${page.redirect_url} which returns ${page.status_code}`,
        affected_url: url
      });
    }

    // Bad URL format
    try {
      const parsed = new URL(url);
      if (parsed.pathname !== parsed.pathname.toLowerCase()) {
        issues.push({
          page_url: url, category: 'links_urls', severity: 'warning',
          check_name: 'url_uppercase',
          description: `URL contains uppercase characters: ${url}`,
          affected_url: url
        });
      }
      if (parsed.pathname.includes('//')) {
        issues.push({
          page_url: url, category: 'links_urls', severity: 'warning',
          check_name: 'url_double_slash',
          description: `URL contains double slashes: ${url}`,
          affected_url: url
        });
      }
      if (parsed.pathname.includes('_')) {
        issues.push({
          page_url: url, category: 'links_urls', severity: 'info',
          check_name: 'url_underscores',
          description: `URL uses underscores instead of hyphens: ${url}`,
          affected_url: url
        });
      }
      if (url.includes(' ') || url.includes('%20')) {
        issues.push({
          page_url: url, category: 'links_urls', severity: 'warning',
          check_name: 'url_spaces',
          description: `URL contains spaces: ${url}`,
          affected_url: url
        });
      }
      if (url.length > 115) {
        issues.push({
          page_url: url, category: 'links_urls', severity: 'info',
          check_name: 'url_too_long',
          description: `URL is ${url.length} characters (recommended < 115)`,
          affected_url: url
        });
      }
    } catch {}

    // noindex pages being linked internally
    if (!page.is_indexable && page.internal_link_count > 0) {
      issues.push({
        page_url: url, category: 'links_urls', severity: 'warning',
        check_name: 'noindex_linked_internally',
        description: `Noindex page is still linked internally`,
        affected_url: url
      });
    }
  }

  return issues;
}

// ─── ON-PAGE SEO ─────────────────────────────────────────────────────────────

function checkOnPageSeo(pages) {
  const issues = [];
  const titleCounts = {};
  const descCounts = {};
  const h1Counts = {};

  // Count duplicates
  for (const p of pages) {
    if (p.title) titleCounts[p.title] = (titleCounts[p.title] || 0) + 1;
    if (p.meta_description) descCounts[p.meta_description] = (descCounts[p.meta_description] || 0) + 1;
    if (p.h1) h1Counts[p.h1] = (h1Counts[p.h1] || 0) + 1;
  }

  for (const page of pages) {
    const url = page.url;
    if (page.status_code >= 400) continue; // Skip broken pages

    // Title checks
    if (!page.title) {
      issues.push({ page_url: url, category: 'on_page_seo', severity: 'critical', check_name: 'missing_title', description: 'Page has no title tag', affected_url: url });
    } else {
      if (page.title.length < 30) issues.push({ page_url: url, category: 'on_page_seo', severity: 'warning', check_name: 'title_too_short', description: `Title is only ${page.title.length} chars (recommended 30–60): "${page.title}"`, affected_url: url });
      if (page.title.length > 60) issues.push({ page_url: url, category: 'on_page_seo', severity: 'warning', check_name: 'title_too_long', description: `Title is ${page.title.length} chars (recommended max 60): "${page.title}"`, affected_url: url });
      if (titleCounts[page.title] > 1) issues.push({ page_url: url, category: 'on_page_seo', severity: 'critical', check_name: 'duplicate_title', description: `Title is duplicated across ${titleCounts[page.title]} pages: "${page.title}"`, affected_url: url });
    }

    // Meta description checks
    if (!page.meta_description || page.meta_description.trim() === '') {
      issues.push({ page_url: url, category: 'on_page_seo', severity: 'critical', check_name: 'missing_meta_description', description: 'Page has no meta description', affected_url: url });
    } else {
      if (page.meta_description.length < 120) issues.push({ page_url: url, category: 'on_page_seo', severity: 'warning', check_name: 'meta_description_too_short', description: `Meta description is only ${page.meta_description.length} chars (recommended 120–160)`, affected_url: url });
      if (page.meta_description.length > 160) issues.push({ page_url: url, category: 'on_page_seo', severity: 'warning', check_name: 'meta_description_too_long', description: `Meta description is ${page.meta_description.length} chars (recommended max 160)`, affected_url: url });
      if (descCounts[page.meta_description] > 1) issues.push({ page_url: url, category: 'on_page_seo', severity: 'critical', check_name: 'duplicate_meta_description', description: `Meta description duplicated across ${descCounts[page.meta_description]} pages`, affected_url: url });
    }

    // H1 checks
    if (!page.h1 || page.h1.trim() === '') {
      issues.push({ page_url: url, category: 'on_page_seo', severity: 'critical', check_name: 'missing_h1', description: 'Page has no H1 tag', affected_url: url });
    } else {
      if (h1Counts[page.h1] > 1) issues.push({ page_url: url, category: 'on_page_seo', severity: 'warning', check_name: 'duplicate_h1', description: `H1 "${page.h1}" is duplicated across ${h1Counts[page.h1]} pages`, affected_url: url });
      if (page.title && page.h1 === page.title) issues.push({ page_url: url, category: 'on_page_seo', severity: 'info', check_name: 'h1_same_as_title', description: `H1 and title tag are identical: "${page.h1}"`, affected_url: url });
    }

    // Canonical checks
    if (!page.canonical_url) {
      issues.push({ page_url: url, category: 'on_page_seo', severity: 'warning', check_name: 'missing_canonical', description: 'Page has no canonical tag', affected_url: url });
    } else if (page.canonical_url !== url && !page.canonical_url.startsWith('https://www.rudrakailash.com')) {
      issues.push({ page_url: url, category: 'on_page_seo', severity: 'warning', check_name: 'canonical_external', description: `Canonical points to external URL: ${page.canonical_url}`, affected_url: url });
    }

    // Open Graph
    if (!page.og_title) issues.push({ page_url: url, category: 'on_page_seo', severity: 'info', check_name: 'missing_og_title', description: 'Missing og:title meta tag', affected_url: url });
    if (!page.og_description) issues.push({ page_url: url, category: 'on_page_seo', severity: 'info', check_name: 'missing_og_description', description: 'Missing og:description meta tag', affected_url: url });
    if (!page.og_image) issues.push({ page_url: url, category: 'on_page_seo', severity: 'info', check_name: 'missing_og_image', description: 'Missing og:image meta tag', affected_url: url });
  }

  return issues;
}

// ─── IMAGES ──────────────────────────────────────────────────────────────────

function checkImages(pages, rawHtmlMap) {
  const issues = [];

  for (const page of pages) {
    const url = page.url;
    if (page.status_code >= 400) continue;
    const html = rawHtmlMap.get(url);
    if (!html) continue;

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    $('img').each((_, el) => {
      const src = $(el).attr('src') || '';
      const alt = $(el).attr('alt');
      const width = $(el).attr('width');
      const height = $(el).attr('height');
      const loading = $(el).attr('loading');

      if (alt === undefined || alt === null) {
        issues.push({ page_url: url, category: 'images', severity: 'warning', check_name: 'image_missing_alt', description: `Image missing alt attribute: ${src}`, affected_url: url, extra_data: { src } });
      } else if (alt.trim() === '') {
        issues.push({ page_url: url, category: 'images', severity: 'info', check_name: 'image_empty_alt', description: `Image has empty alt attribute: ${src}`, affected_url: url, extra_data: { src } });
      } else if (alt.length > 125) {
        issues.push({ page_url: url, category: 'images', severity: 'info', check_name: 'image_alt_too_long', description: `Image alt text is ${alt.length} chars (recommended max 125)`, affected_url: url, extra_data: { src, alt } });
      }

      if (!width || !height) {
        issues.push({ page_url: url, category: 'images', severity: 'info', check_name: 'image_missing_dimensions', description: `Image missing width/height attributes (causes layout shift): ${src}`, affected_url: url, extra_data: { src } });
      }

      if (!loading || loading !== 'lazy') {
        issues.push({ page_url: url, category: 'images', severity: 'info', check_name: 'image_missing_lazy_load', description: `Image missing loading="lazy": ${src}`, affected_url: url, extra_data: { src } });
      }
    });
  }

  return issues;
}

// ─── PERFORMANCE ─────────────────────────────────────────────────────────────

function checkPerformance(pages, rawHtmlMap) {
  const issues = [];

  for (const page of pages) {
    const url = page.url;
    if (page.status_code >= 400) continue;

    if (page.page_size_bytes > 3 * 1024 * 1024) {
      issues.push({ page_url: url, category: 'performance', severity: 'critical', check_name: 'page_too_large', description: `Page size is ${(page.page_size_bytes / 1024 / 1024).toFixed(2)}MB (recommended < 3MB)`, affected_url: url });
    }

    if (page.load_time_ms > 2000) {
      issues.push({ page_url: url, category: 'performance', severity: page.load_time_ms > 4000 ? 'critical' : 'warning', check_name: 'slow_load_time', description: `Page load time is ${page.load_time_ms}ms (recommended < 2000ms)`, affected_url: url });
    }

    const html = rawHtmlMap.get(url);
    if (!html) continue;
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // Render blocking resources in head
    let renderBlockingCount = 0;
    $('head link[rel="stylesheet"]').each(() => renderBlockingCount++);
    $('head script:not([async]):not([defer])').each(() => renderBlockingCount++);
    if (renderBlockingCount > 5) {
      issues.push({ page_url: url, category: 'performance', severity: 'warning', check_name: 'render_blocking_resources', description: `${renderBlockingCount} render-blocking resources in <head>`, affected_url: url });
    }

    // Too many requests
    const totalRequests = $('script').length + $('link[rel="stylesheet"]').length + $('img').length;
    if (totalRequests > 100) {
      issues.push({ page_url: url, category: 'performance', severity: 'warning', check_name: 'too_many_requests', description: `Page has ${totalRequests} resource requests (recommended < 100)`, affected_url: url });
    }
  }

  return issues;
}

// ─── CRAWLABILITY ─────────────────────────────────────────────────────────────

function checkCrawlability(pages, sitemapUrls, robotsTxt) {
  const issues = [];
  const indexablePages = pages.filter(p => p.is_indexable && p.status_code === 200);
  const inSitemap = pages.filter(p => p.is_in_sitemap);

  for (const page of pages) {
    const url = page.url;

    // Pages not in sitemap but accessible
    if (page.status_code === 200 && page.is_indexable && !page.is_in_sitemap) {
      issues.push({ page_url: url, category: 'crawlability', severity: 'info', check_name: 'page_not_in_sitemap', description: 'Indexable page not found in XML sitemap', affected_url: url });
    }

    // Pages in sitemap returning errors
    if (page.is_in_sitemap && page.status_code >= 400) {
      issues.push({ page_url: url, category: 'crawlability', severity: 'critical', check_name: 'sitemap_url_broken', description: `Sitemap URL returns ${page.status_code}`, affected_url: url });
    }

    // Pages in sitemap that are noindex
    if (page.is_in_sitemap && !page.is_indexable) {
      issues.push({ page_url: url, category: 'crawlability', severity: 'warning', check_name: 'sitemap_url_noindex', description: 'Sitemap contains URL marked as noindex', affected_url: url });
    }

    // Pages in sitemap that redirect
    if (page.is_in_sitemap && page.redirect_chain && page.redirect_chain.length > 1) {
      issues.push({ page_url: url, category: 'crawlability', severity: 'warning', check_name: 'sitemap_url_redirects', description: `Sitemap URL redirects to ${page.redirect_url}`, affected_url: url });
    }
  }

  // Sitemap too large
  if (sitemapUrls.size > 50000) {
    issues.push({ page_url: null, category: 'crawlability', severity: 'critical', check_name: 'sitemap_too_large', description: `Sitemap has ${sitemapUrls.size} URLs (max recommended 50,000)`, affected_url: 'https://www.rudrakailash.com/sitemap.xml' });
  }

  return issues;
}

// ─── MOBILE & UX ─────────────────────────────────────────────────────────────

function checkMobileUx(pages, rawHtmlMap) {
  const issues = [];

  for (const page of pages) {
    const url = page.url;
    if (page.status_code >= 400) continue;
    const html = rawHtmlMap.get(url);
    if (!html) continue;

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    const viewport = $('meta[name="viewport"]').attr('content') || '';
    if (!viewport) {
      issues.push({ page_url: url, category: 'mobile_ux', severity: 'critical', check_name: 'missing_viewport', description: 'Missing viewport meta tag', affected_url: url });
    } else if (!viewport.includes('width=device-width')) {
      issues.push({ page_url: url, category: 'mobile_ux', severity: 'warning', check_name: 'invalid_viewport', description: `Viewport not set to device-width: "${viewport}"`, affected_url: url });
    }
  }

  return issues;
}

// ─── SECURITY & TECHNICAL ────────────────────────────────────────────────────

async function checkSecurity(pages) {
  const issues = [];

  // Check SSL
  try {
    const res = await axios.get('https://www.rudrakailash.com', { timeout: 10000, validateStatus: () => true });
    const hstsHeader = res.headers['strict-transport-security'];
    if (!hstsHeader) {
      issues.push({ page_url: 'https://www.rudrakailash.com', category: 'security', severity: 'warning', check_name: 'missing_hsts', description: 'Missing Strict-Transport-Security (HSTS) header', affected_url: 'https://www.rudrakailash.com' });
    }
    const xContentType = res.headers['x-content-type-options'];
    if (!xContentType) {
      issues.push({ page_url: 'https://www.rudrakailash.com', category: 'security', severity: 'info', check_name: 'missing_x_content_type', description: 'Missing X-Content-Type-Options header', affected_url: 'https://www.rudrakailash.com' });
    }
    const xFrame = res.headers['x-frame-options'];
    if (!xFrame) {
      issues.push({ page_url: 'https://www.rudrakailash.com', category: 'security', severity: 'info', check_name: 'missing_x_frame_options', description: 'Missing X-Frame-Options header', affected_url: 'https://www.rudrakailash.com' });
    }
  } catch (e) {
    issues.push({ page_url: 'https://www.rudrakailash.com', category: 'security', severity: 'critical', check_name: 'ssl_error', description: `SSL/connection error: ${e.message}`, affected_url: 'https://www.rudrakailash.com' });
  }

  // Check HTTP → HTTPS redirect
  try {
    const httpRes = await axios.get('http://www.rudrakailash.com', { maxRedirects: 0, validateStatus: () => true, timeout: 10000 });
    if (![301, 302, 307, 308].includes(httpRes.status)) {
      issues.push({ page_url: 'http://www.rudrakailash.com', category: 'security', severity: 'critical', check_name: 'no_https_redirect', description: 'HTTP does not redirect to HTTPS', affected_url: 'http://www.rudrakailash.com' });
    }
  } catch {}

  // Mixed content check
  for (const page of pages) {
    if (page.status_code >= 400) continue;
    // This is a basic check — full mixed content needs browser analysis
    if (page.url.startsWith('https://') && page.canonical_url?.startsWith('http://')) {
      issues.push({ page_url: page.url, category: 'security', severity: 'warning', check_name: 'mixed_content', description: `HTTPS page has HTTP canonical: ${page.canonical_url}`, affected_url: page.url });
    }
  }

  return issues;
}

// ─── CONTENT QUALITY ─────────────────────────────────────────────────────────

function checkContentQuality(pages, rawHtmlMap) {
  const issues = [];

  for (const page of pages) {
    const url = page.url;
    if (page.status_code >= 400) continue;

    // Thin content
    if (page.word_count > 0 && page.word_count < 300) {
      issues.push({ page_url: url, category: 'content_quality', severity: 'warning', check_name: 'thin_content', description: `Page has only ${page.word_count} words (recommended minimum 300)`, affected_url: url });
    }

    // No text content
    if (page.word_count === 0) {
      issues.push({ page_url: url, category: 'content_quality', severity: 'warning', check_name: 'no_text_content', description: 'Page has no readable text content', affected_url: url });
    }

    const html = rawHtmlMap.get(url);
    if (!html) continue;

    // Lorem ipsum check
    if (html.toLowerCase().includes('lorem ipsum')) {
      issues.push({ page_url: url, category: 'content_quality', severity: 'critical', check_name: 'lorem_ipsum', description: 'Page contains lorem ipsum placeholder text', affected_url: url });
    }
  }

  // Duplicate content detection (basic - compare titles + descriptions)
  const contentMap = new Map();
  for (const page of pages) {
    if (page.status_code >= 400 || !page.title) continue;
    const key = `${page.title}|${page.meta_description}`;
    if (!contentMap.has(key)) contentMap.set(key, []);
    contentMap.get(key).push(page.url);
  }
  for (const [key, urls] of contentMap.entries()) {
    if (urls.length > 1) {
      urls.forEach(url => {
        issues.push({ page_url: url, category: 'content_quality', severity: 'warning', check_name: 'potential_duplicate_content', description: `Page shares identical title+description with ${urls.length - 1} other page(s)`, affected_url: url, extra_data: { duplicate_urls: urls } });
      });
    }
  }

  return issues;
}

// ─── STRUCTURED DATA ─────────────────────────────────────────────────────────

function checkStructuredData(pages, rawHtmlMap) {
  const issues = [];

  for (const page of pages) {
    const url = page.url;
    if (page.status_code >= 400) continue;
    const html = rawHtmlMap.get(url);
    if (!html) continue;

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).html();
      try {
        const json = JSON.parse(raw);
        const type = json['@type'];

        // Product page checks
        if (type === 'Product') {
          if (!json.name) issues.push({ page_url: url, category: 'structured_data', severity: 'critical', check_name: 'schema_product_missing_name', description: 'Product schema missing required "name" field', affected_url: url });
          if (!json.offers) issues.push({ page_url: url, category: 'structured_data', severity: 'critical', check_name: 'schema_product_missing_offers', description: 'Product schema missing "offers" field', affected_url: url });
          if (!json.description) issues.push({ page_url: url, category: 'structured_data', severity: 'warning', check_name: 'schema_product_missing_description', description: 'Product schema missing "description" field', affected_url: url });
          if (!json.image) issues.push({ page_url: url, category: 'structured_data', severity: 'warning', check_name: 'schema_product_missing_image', description: 'Product schema missing "image" field', affected_url: url });
        }

        // Check for @context
        if (!json['@context']) {
          issues.push({ page_url: url, category: 'structured_data', severity: 'warning', check_name: 'schema_missing_context', description: 'JSON-LD schema missing @context field', affected_url: url });
        }
      } catch (e) {
        issues.push({ page_url: url, category: 'structured_data', severity: 'critical', check_name: 'schema_invalid_json', description: `Invalid JSON-LD syntax: ${e.message}`, affected_url: url });
      }
    });

    // Product pages should have Product schema
    if (url.includes('/products/') && (!page.schema_types || !page.schema_types.includes('Product'))) {
      issues.push({ page_url: url, category: 'structured_data', severity: 'warning', check_name: 'missing_product_schema', description: 'Product page has no Product schema markup', affected_url: url });
    }

    // BreadcrumbList check on product/collection pages
    if ((url.includes('/products/') || url.includes('/collections/')) &&
        (!page.schema_types || !page.schema_types.includes('BreadcrumbList'))) {
      issues.push({ page_url: url, category: 'structured_data', severity: 'info', check_name: 'missing_breadcrumb_schema', description: 'Page missing BreadcrumbList schema', affected_url: url });
    }
  }

  return issues;
}

// ─── MASTER RUNNER ───────────────────────────────────────────────────────────

async function runAllCheckers(pages, rawHtmlMap, sitemapUrls) {
  const allIssues = [];

  allIssues.push(...checkLinksAndUrls(pages));
  allIssues.push(...checkOnPageSeo(pages));
  allIssues.push(...checkImages(pages, rawHtmlMap));
  allIssues.push(...checkPerformance(pages, rawHtmlMap));
  allIssues.push(...checkCrawlability(pages, sitemapUrls, null));
  allIssues.push(...checkMobileUx(pages, rawHtmlMap));
  allIssues.push(...await checkSecurity(pages));
  allIssues.push(...checkContentQuality(pages, rawHtmlMap));
  allIssues.push(...checkStructuredData(pages, rawHtmlMap));

  return allIssues;
}

module.exports = { runAllCheckers };

