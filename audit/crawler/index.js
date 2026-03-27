const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const xml2js = require('xml2js');

const BASE_URL = 'https://www.rudrakailash.com';
const CRAWL_DELAY_MS = 1200;
const MAX_PAGES = 500;
const REQUEST_TIMEOUT = 15000;

const axiosInstance = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 0, // handle redirects manually
  validateStatus: () => true,
  headers: {
    'User-Agent': 'RudraKailash-SiteAudit/1.0 (+https://www.rudrakailash.com)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br'
  }
});

async function fetchWithRedirects(url, maxRedirects = 5) {
  const chain = [];
  let current = url;
  let response;

  for (let i = 0; i <= maxRedirects; i++) {
    const start = Date.now();
    try {
      response = await axiosInstance.get(current);
    } catch (err) {
      return { error: err.message, chain, final_url: current, status_code: 0, load_time_ms: 0 };
    }
    const elapsed = Date.now() - start;

    chain.push({ url: current, status: response.status });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers['location'];
      if (!location) break;
      try {
        current = new URL(location, current).href;
      } catch {
        current = location;
      }
    } else {
      return {
        response,
        chain,
        final_url: current,
        status_code: response.status,
        load_time_ms: elapsed,
        headers: response.headers,
        data: response.data
      };
    }
  }

  return { response, chain, final_url: current, status_code: response?.status || 0, load_time_ms: 0 };
}

async function fetchSitemapUrls() {
  const urls = new Set();
  const sitemapUrls = [
    `${BASE_URL}/sitemap.xml`,
    `${BASE_URL}/sitemap_products_1.xml`,
    `${BASE_URL}/sitemap_pages_1.xml`,
    `${BASE_URL}/sitemap_collections_1.xml`,
    `${BASE_URL}/sitemap_blogs_1.xml`
  ];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const res = await axiosInstance.get(sitemapUrl);
      if (res.status !== 200) continue;
      const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });

      // Handle sitemap index
      if (parsed.sitemapindex?.sitemap) {
        const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
          ? parsed.sitemapindex.sitemap
          : [parsed.sitemapindex.sitemap];
        for (const s of sitemaps) {
          try {
            const subRes = await axiosInstance.get(s.loc);
            const subParsed = await xml2js.parseStringPromise(subRes.data, { explicitArray: false });
            if (subParsed.urlset?.url) {
              const subUrls = Array.isArray(subParsed.urlset.url)
                ? subParsed.urlset.url
                : [subParsed.urlset.url];
              subUrls.forEach(u => u.loc && urls.add(u.loc));
            }
          } catch {}
        }
      }

      // Handle urlset directly
      if (parsed.urlset?.url) {
        const urlList = Array.isArray(parsed.urlset.url)
          ? parsed.urlset.url
          : [parsed.urlset.url];
        urlList.forEach(u => u.loc && urls.add(u.loc));
      }
    } catch {}
  }

  return urls;
}

function extractPageData(url, fetchResult, sitemapUrls) {
  const { response, status_code, load_time_ms, chain, final_url, headers, data } = fetchResult;

  const pageData = {
    url,
    status_code,
    load_time_ms,
    redirect_chain: chain?.length > 1 ? chain : null,
    redirect_url: chain?.length > 1 ? final_url : null,
    is_in_sitemap: sitemapUrls.has(url),
    content_type: headers?.['content-type'] || null,
    page_size_bytes: data ? Buffer.byteLength(data, 'utf8') : 0,
    is_indexable: true,
    robots_directive: null,
    title: null,
    meta_description: null,
    h1: null,
    canonical_url: null,
    word_count: 0,
    image_count: 0,
    internal_link_count: 0,
    external_link_count: 0,
    schema_types: null,
    og_title: null,
    og_description: null,
    og_image: null,
    links: []
  };

  // Check X-Robots-Tag header
  const xRobots = headers?.['x-robots-tag'];
  if (xRobots) {
    pageData.robots_directive = xRobots;
    if (xRobots.includes('noindex')) pageData.is_indexable = false;
  }

  if (!data || typeof data !== 'string') return pageData;

  const $ = cheerio.load(data);

  // Meta robots
  const metaRobots = $('meta[name="robots"]').attr('content') || '';
  if (metaRobots) {
    pageData.robots_directive = metaRobots;
    if (metaRobots.includes('noindex')) pageData.is_indexable = false;
  }

  pageData.title = $('title').first().text().trim() || null;
  pageData.meta_description = $('meta[name="description"]').attr('content')?.trim() || null;
  pageData.h1 = $('h1').first().text().trim() || null;
  pageData.canonical_url = $('link[rel="canonical"]').attr('href') || null;
  pageData.og_title = $('meta[property="og:title"]').attr('content') || null;
  pageData.og_description = $('meta[property="og:description"]').attr('content') || null;
  pageData.og_image = $('meta[property="og:image"]').attr('content') || null;

  // Word count
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  pageData.word_count = bodyText ? bodyText.split(' ').filter(w => w.length > 0).length : 0;

  // Images
  pageData.image_count = $('img').length;

  // Schema types
  const schemas = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const type = json['@type'] || (Array.isArray(json) && json[0]?.['@type']);
      if (type) schemas.push(type);
    } catch {}
  });
  if (schemas.length > 0) pageData.schema_types = schemas;

  // Links
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const resolved = new URL(href, url).href;
      const isInternal = resolved.startsWith(BASE_URL) || resolved.includes('rudrakailash.com');
      links.push({ href: resolved, is_internal: isInternal, text: $(el).text().trim() });
      if (isInternal) pageData.internal_link_count++;
      else pageData.external_link_count++;
    } catch {}
  });
  pageData.links = links;

  return pageData;
}

async function crawl(onPageCrawled, onProgress) {
  const sitemapUrls = await fetchSitemapUrls();
  onProgress?.(`Found ${sitemapUrls.size} URLs in sitemap`);

  const visited = new Set();
  const queue = [BASE_URL, ...sitemapUrls];
  const allPageData = [];

  // Deduplicate queue
  const uniqueQueue = [...new Set(queue)].slice(0, MAX_PAGES);

  for (let i = 0; i < uniqueQueue.length; i++) {
    const url = uniqueQueue[i];
    if (visited.has(url)) continue;
    visited.add(url);

    onProgress?.(`Crawling ${i + 1}/${uniqueQueue.length}: ${url}`);

    const fetchResult = await fetchWithRedirects(url);
    const pageData = extractPageData(url, fetchResult, sitemapUrls);
    allPageData.push(pageData);

    // Add newly discovered internal links to queue
    if (pageData.links && uniqueQueue.length < MAX_PAGES) {
      for (const link of pageData.links) {
        if (link.is_internal && !visited.has(link.href) && !uniqueQueue.includes(link.href)) {
          uniqueQueue.push(link.href);
        }
      }
    }

    await onPageCrawled?.(pageData);
    await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
  }

  return allPageData;
}

module.exports = { crawl, fetchSitemapUrls, fetchWithRedirects, BASE_URL };
