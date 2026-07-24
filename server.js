require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const fetch      = require("node-fetch");
const fs         = require("fs");
const path       = require("path");
const cron       = require("node-cron");
const nodemailer = require("nodemailer");

let auditModule = null;
try {
  auditModule = require("./audit/index");
  console.log("✅ Audit module loaded from ./audit/index");
} catch (e) {
  console.warn("⚠️  Audit module not loaded (SEO features unaffected):", e.message);
}

const app  = express();
const PORT = process.env.PORT || 3001;

const TOKEN_FILE      = path.join(__dirname, ".shopify_token");
const RANK_DATA_FILE  = path.join(__dirname, ".rank_data.json");
const KEYWORDS_FILE   = path.join(__dirname, ".keywords.json");
const CITATION_QUERIES_FILE = path.join(__dirname, ".citation_queries.json");
const CITATION_DATA_FILE    = path.join(__dirname, ".citation_data.json");

function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      if (t) return t;
    }
  } catch (e) { console.warn("⚠️  Token file error:", e.message); }
  return process.env.SHOPIFY_ACCESS_TOKEN || null;
}

function saveToken(token) {
  try { fs.writeFileSync(TOKEN_FILE, token, "utf8"); console.log("💾 Token saved"); }
  catch (e) { console.warn("⚠️  Token save error:", e.message); }
}

function loadRankData() {
  try {
    if (fs.existsSync(RANK_DATA_FILE)) return JSON.parse(fs.readFileSync(RANK_DATA_FILE, "utf8"));
  } catch (e) { console.warn("⚠️  Rank data load error:", e.message); }
  return {};
}

function saveRankData(data) {
  try { fs.writeFileSync(RANK_DATA_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.warn("⚠️  Rank data save error:", e.message); }
}

function loadKeywords() {
  try {
    if (fs.existsSync(KEYWORDS_FILE)) return JSON.parse(fs.readFileSync(KEYWORDS_FILE, "utf8"));
  } catch (e) { console.warn("⚠️  Keywords load error:", e.message); }
  return {};
}

function saveKeywords(data) {
  try { fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.warn("⚠️  Keywords save error:", e.message); }
}

function loadCitationQueries() {
  try {
    if (fs.existsSync(CITATION_QUERIES_FILE)) return JSON.parse(fs.readFileSync(CITATION_QUERIES_FILE, "utf8"));
  } catch (e) { console.warn("⚠️  Citation queries load error:", e.message); }
  return {};
}

function saveCitationQueries(data) {
  try { fs.writeFileSync(CITATION_QUERIES_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.warn("⚠️  Citation queries save error:", e.message); }
}

function loadCitationData() {
  try {
    if (fs.existsSync(CITATION_DATA_FILE)) return JSON.parse(fs.readFileSync(CITATION_DATA_FILE, "utf8"));
  } catch (e) { console.warn("⚠️  Citation data load error:", e.message); }
  return {};
}

function saveCitationData(data) {
  try { fs.writeFileSync(CITATION_DATA_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.warn("⚠️  Citation data save error:", e.message); }
}

const SHOPIFY_CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_STORE_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_API_VERSION   = "2024-01";
const APP_URL               = process.env.APP_URL || "https://rk-seo-proxy.onrender.com";
const STORE_DOMAIN_SHORT    = "rudrakailash.com";

let storedAccessToken = loadToken();
const pendingApprovals = new Map();

function generateApprovalToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Store-Domain", "X-Access-Token"],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (auditModule && typeof auditModule.register === "function") {
  auditModule.register(app);
  console.log("✅ Audit routes registered");
} else {
  console.warn("⚠️  Audit routes not registered — /audit endpoint unavailable");
}

app.get("/seo", (req, res) => {
  res.sendFile(path.join(__dirname, "rk-seo-v8.html"));
});

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_SMTP_HOST || "smtp.hostinger.com",
  port:   parseInt(process.env.EMAIL_SMTP_PORT || "465"),
  secure: true,
  auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS },
});

async function sendEmail(subject, htmlBody) {
  try {
    await transporter.sendMail({
      from: `"RudraKailash SEO Agent" <${process.env.EMAIL_FROM}>`,
      to:   process.env.EMAIL_TO,
      subject, html: htmlBody,
    });
    console.log(`📧 Email sent: ${subject}`);
  } catch (e) { console.error("❌ Email failed:", e.message); }
}

app.get("/", (req, res) => {
  const rankData     = loadRankData();
  const keywords     = loadKeywords();
  const trackedCount = Object.keys(keywords).length;
  res.json({
    status: "ok", service: "RudraKailash SEO Proxy", store: SHOPIFY_STORE_DOMAIN,
    tokenConfigured:        !!storedAccessToken,
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    serperConfigured:       !!process.env.SERPER_API_KEY,
    emailConfigured:        !!(process.env.EMAIL_SMTP_USER && process.env.EMAIL_SMTP_PASS),
    auditModuleLoaded:      !!auditModule,
    rankTracking: {
      trackedProducts: trackedCount,
      dataPoints: Object.values(rankData).reduce((s, p) => s + (p.history?.length || 0), 0),
    },
    pendingApprovals: pendingApprovals.size,
  });
});

app.get("/auth/install", (req, res) => {
  const scopes      = "read_products,write_products,read_product_listings";
  const redirectUri = `${APP_URL}/auth/callback`;
  const state       = Math.random().toString(36).substring(7);
  res.redirect(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.status(400).json({ error: "Missing code or shop" });
  try {
    const tokenRes  = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      storedAccessToken = tokenData.access_token;
      saveToken(storedAccessToken);
      await registerWebhooks();
      res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;"><div style="font-size:48px;margin-bottom:16px;">✅</div><h2 style="color:#F0C84A;margin-bottom:8px;">Connected!</h2><p style="color:#9A7050;">Store linked · Token saved · Webhooks registered · Rank tracking active</p></div></body></html>`);
    } else res.status(400).json({ error: "Failed to get access token", details: tokenData });
  } catch (err) { res.status(500).json({ error: "OAuth failed", message: err.message }); }
});

app.get("/auth/status", (req, res) => {
  res.json({
    connected: !!storedAccessToken, store: SHOPIFY_STORE_DOMAIN,
    tokenSource: fs.existsSync(TOKEN_FILE) ? "disk" : (process.env.SHOPIFY_ACCESS_TOKEN ? "env" : "memory"),
  });
});

app.get("/auth/token", (req, res) => {
  if (req.query.secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!storedAccessToken) return res.status(404).json({ error: "No token" });
  res.json({ token: storedAccessToken });
});

app.get("/products", async (req, res) => {
  if (!storedAccessToken) return res.status(401).json({ error: "Not authenticated" });
  try {
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`,
      { headers: { "X-Shopify-Access-Token": storedAccessToken } }
    );
    const data = await shopifyRes.json();
    if (!shopifyRes.ok) return res.status(shopifyRes.status).json({ error: "Shopify error", details: data });
    res.json(data);
  } catch (err) { res.status(500).json({ error: "Failed to fetch products", message: err.message }); }
});

app.put("/products/:id", async (req, res) => {
  if (!storedAccessToken) return res.status(401).json({ error: "Not authenticated" });
  const { id } = req.params;
  try {
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${id}.json`,
      {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": storedAccessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ product: { id, ...req.body } }),
      }
    );
    const data = await shopifyRes.json();
    if (!shopifyRes.ok) return res.status(shopifyRes.status).json({ error: "Update failed", details: data });
    res.json({ success: true, product: data.product });
  } catch (err) { res.status(500).json({ error: "Failed to update product", message: err.message }); }
});

app.post("/ai/generate", async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  try {
    const { system, user, max_tokens = 1200 } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY.trim(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens, system, messages: [{ role: "user", content: user }] }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: "Anthropic error", details: data });
    res.json({ success: true, text: data.content?.map(b => b.text || "").join("") || "" });
  } catch (err) { res.status(500).json({ error: "AI failed", message: err.message }); }
});

const MARKETPLACE_DOMAINS = [
  "amazon.","flipkart.","snapdeal.","meesho.","myntra.","indiamart.",
  "alibaba.","ebay.","etsy.","walmart.","paytmmall.","shopclues.",
  "tatacliq.","ajio.","nykaa.","jiomart.",
];

function isMarketplace(url) {
  return MARKETPLACE_DOMAINS.some(d => url.toLowerCase().includes(d));
}

function extractTextFromHTML(html) {
  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  const h1s = h1Matches.map(m => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5);
  const h2h3Matches = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)];
  const h2h3s = h2h3Matches.map(m => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 12);
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "").replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 3000);
  return { text: bodyText, headings: { h1: h1s, h2h3: h2h3s } };
}

async function fetchPageText(url) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);
    const res        = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; RudraKailashSEOBot/1.0)", "Accept": "text/html" } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return extractTextFromHTML(await res.text());
  } catch (e) { return null; }
}

async function runCompetitorResearch(productTitle) {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return [];
  const coreTitle = productTitle.replace(/\s*(bracelet|mala|pendant|ring|set|combo|pack|pair)\s*$/i, "").trim();
  const queries = [
    `${coreTitle} benefits significance`,
    `${coreTitle} Shiva Purana Vedic meaning`,
    `${coreTitle} certification authentic`,
    `${coreTitle}`,
  ];
  try {
    const seenUrls = new Set(), allResults = [];
    for (const query of queries) {
      if (allResults.length >= 12) break;
      const serperRes  = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 10 }) });
      const serperData = await serperRes.json();
      for (const result of (serperData.organic || [])) {
        const url = result.link || "";
        if (url && !isMarketplace(url) && !url.includes("rudrakailash.com") && !url.includes("google.") && !seenUrls.has(url)) {
          seenUrls.add(url);
          allResults.push({ url, title: result.title || "", snippet: result.snippet || "" });
        }
      }
    }
    console.log(`🔍 Competitor candidates for "${productTitle}": ${allResults.length}`);
    const competitors = [];
    for (const result of allResults.slice(0, 10)) {
      const extracted = await fetchPageText(result.url);
      competitors.push({ ...result, content: extracted ? extracted.text : result.snippet, headings: extracted ? extracted.headings : { h1: [], h2h3: [] }, fetched: !!extracted });
    }
    console.log(`🔍 Fetched: ${competitors.filter(c => c.fetched).length}/${competitors.length}`);
    return competitors;
  } catch (e) { console.warn("Competitor research failed:", e.message); return []; }
}

app.post("/competitor/research", async (req, res) => {
  const { productTitle } = req.body;
  if (!productTitle) return res.status(400).json({ error: "productTitle required" });
  try {
    const competitors = await runCompetitorResearch(productTitle);
    res.json({ success: true, competitors, totalFound: competitors.length });
  } catch (err) { res.status(500).json({ error: "Research failed", message: err.message }); }
});

function autoKeyword(productTitle) { return `${productTitle} buy online`; }

async function checkRankPosition(keyword, gl = "in") {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return null;
  try {
    const serperRes  = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ q: keyword, gl, hl: "en", num: 100 }) });
    const serperData = await serperRes.json();
    const organic    = serperData.organic || [];
    for (let i = 0; i < organic.length; i++) {
      if ((organic[i].link || "").includes(STORE_DOMAIN_SHORT)) return i + 1;
    }
    return null;
  } catch (e) { console.warn(`Rank check failed for "${keyword}" (${gl}):`, e.message); return null; }
}

app.get("/rank/keywords", (req, res) => { res.json({ success: true, keywords: loadKeywords() }); });

app.post("/rank/keywords", (req, res) => {
  const { productId, productTitle, keyword } = req.body;
  if (!productId || !productTitle) return res.status(400).json({ error: "productId and productTitle required" });
  const keywords = loadKeywords();
  keywords[productId] = { productId, productTitle, keyword: keyword || autoKeyword(productTitle), isCustom: !!keyword, addedAt: new Date().toISOString() };
  saveKeywords(keywords);
  res.json({ success: true, entry: keywords[productId] });
});

app.delete("/rank/keywords/:productId", (req, res) => {
  const keywords = loadKeywords();
  delete keywords[req.params.productId];
  saveKeywords(keywords);
  res.json({ success: true });
});

app.get("/rank/data", (req, res) => { res.json({ success: true, rankData: loadRankData(), keywords: loadKeywords() }); });

app.post("/rank/check/:productId", async (req, res) => {
  const keywords = loadKeywords();
  const entry    = keywords[req.params.productId];
  if (!entry) return res.status(404).json({ error: "Product not tracked. Add keyword first." });
  res.json({ message: "Rank check started — results in ~30 seconds.", keyword: entry.keyword });
  setTimeout(async () => { await checkAndStoreRank(entry); }, 100);
});

async function checkAndStoreRank(entry) {
  const { productId, productTitle, keyword } = entry;
  console.log(`📊 Checking rank: "${keyword}"`);
  const [posIN, posGlobal] = await Promise.all([checkRankPosition(keyword, "in"), checkRankPosition(keyword, "us")]);
  const today    = new Date().toISOString().split("T")[0];
  const rankData = loadRankData();
  if (!rankData[productId]) rankData[productId] = { productId, productTitle, keyword, history: [] };
  rankData[productId].history = rankData[productId].history.filter(h => h.date !== today);
  rankData[productId].history.push({ date: today, posIN, posGlobal, checkedAt: new Date().toISOString() });
  rankData[productId].history = rankData[productId].history.sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  rankData[productId].lastChecked  = new Date().toISOString();
  rankData[productId].latestIN     = posIN;
  rankData[productId].latestGlobal = posGlobal;
  saveRankData(rankData);
  console.log(`✅ Rank stored: "${keyword}" — IN: ${posIN || "Not found"}, Global: ${posGlobal || "Not found"}`);
  return { posIN, posGlobal };
}

cron.schedule("30 0 * * *", async () => {
  console.log("📊 Daily rank check — 6am IST");
  const keywords = loadKeywords();
  const entries  = Object.values(keywords);
  if (entries.length === 0) { console.log("📊 No products tracked yet."); return; }
  for (const entry of entries) { await checkAndStoreRank(entry); await new Promise(r => setTimeout(r, 2000)); }
  console.log("📊 Daily rank check complete.");
}, { timezone: "UTC" });

cron.schedule("30 1 * * 1", async () => {
  console.log("📊 Weekly rank report — Monday 7am IST");
  const rankData = loadRankData();
  const entries  = Object.values(rankData);
  if (entries.length === 0) return;
  const rows = entries.map(entry => {
    const history = entry.history || [], latest = history[history.length - 1], prev = history[history.length - 8];
    const posIN = latest?.posIN || null, posGlobal = latest?.posGlobal || null, prevIN = prev?.posIN || null;
    const deltaIN = prevIN && posIN ? prevIN - posIN : null;
    const trend = deltaIN === null ? "—" : deltaIN > 0 ? `▲ ${deltaIN}` : deltaIN < 0 ? `▼ ${Math.abs(deltaIN)}` : "→ same";
    return { title: entry.productTitle, keyword: entry.keyword, posIN, posGlobal, trend, deltaIN };
  });
  rows.sort((a, b) => (b.deltaIN || 0) - (a.deltaIN || 0));
  const tableRows = rows.map(r => `<tr style="border-bottom:1px solid #2E1500"><td style="padding:10px 14px;color:#F5E6C8;font-size:13px">${r.title}</td><td style="padding:10px 14px;color:#9A7050;font-size:11px">${r.keyword}</td><td style="padding:10px 14px;text-align:center;color:${r.posIN ? '#7FD48A' : '#9A7050'};font-weight:bold">${r.posIN ? '#' + r.posIN : 'Not found'}</td><td style="padding:10px 14px;text-align:center;color:${r.posGlobal ? '#80C0F0' : '#9A7050'};font-weight:bold">${r.posGlobal ? '#' + r.posGlobal : 'Not found'}</td><td style="padding:10px 14px;text-align:center;color:${r.deltaIN > 0 ? '#7FD48A' : r.deltaIN < 0 ? '#F08080' : '#9A7050'};font-weight:bold">${r.trend}</td></tr>`).join("");
  const inTop10 = rows.filter(r => r.posIN && r.posIN <= 10).length, inTop50 = rows.filter(r => r.posIN && r.posIN <= 50).length, improved = rows.filter(r => r.deltaIN > 0).length;
  const emailHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif"><div style="max-width:720px;margin:0 auto;padding:32px 20px"><div style="text-align:center;margin-bottom:32px"><div style="font-size:36px">ॐ</div><h1 style="color:#F0C84A;font-size:22px;margin:8px 0">RudraKailash SEO — Weekly Rank Report</h1><p style="color:#9A7050;font-size:13px">${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p></div><div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:20px;margin-bottom:24px"><table width="100%"><tr><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">TRACKED</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">${entries.length}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">TOP 10 (IN)</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${inTop10}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">TOP 50 (IN)</div><div style="color:#80C0F0;font-size:28px;font-weight:bold">${inTop50}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">IMPROVED</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${improved}</div></td></tr></table></div><table style="width:100%;border-collapse:collapse;background:#120600;border:1px solid #2E1500;border-radius:10px;overflow:hidden"><thead><tr style="background:#160800"><th style="padding:10px 14px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">PRODUCT</th><th style="padding:10px 14px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">KEYWORD</th><th style="padding:10px 14px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GOOGLE.CO.IN</th><th style="padding:10px 14px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GOOGLE.COM</th><th style="padding:10px 14px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">7-DAY TREND</th></tr></thead><tbody>${tableRows}</tbody></table><div style="text-align:center;margin-top:32px;border-top:1px solid #2E1500;padding-top:20px"><p style="color:#5A3020;font-size:11px">RudraKailash Agentic SEO · Daily tracking at 6am IST · Weekly report every Monday</p></div></div></body></html>`;
  await sendEmail(`📊 RudraKailash Weekly Rank Report — ${new Date().toLocaleDateString("en-IN")}`, emailHtml);
  console.log("📊 Weekly rank report sent.");
}, { timezone: "UTC" });

// ─── LLM Citation Tracking ─────────────────────────────────────────────────────
async function checkCitation(query) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: "You are a helpful assistant answering a shopper's question with current, accurate information. Search the web as needed. Recommend specific brands, sellers, or websites where relevant, and cite your sources.",
      messages: [{ role: "user", content: query }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Anthropic API error");

  let combinedText = "";
  const citedDomains = new Set();

  for (const block of (data.content || [])) {
    if (block.type === "text") {
      combinedText += (block.text || "") + " ";
      for (const citation of (block.citations || [])) {
        if (citation.url) { try { citedDomains.add(new URL(citation.url).hostname.replace(/^www\./, "")); } catch (_) {} }
      }
    }
    if (block.type === "web_search_tool_result") {
      for (const item of (Array.isArray(block.content) ? block.content : [])) {
        if (item.url) { try { citedDomains.add(new URL(item.url).hostname.replace(/^www\./, "")); } catch (_) {} }
      }
    }
  }

  const mentionedInText = combinedText.toLowerCase().includes("rudrakailash");
  const mentionedInCitations = [...citedDomains].some(d => d.includes("rudrakailash.com"));
  const otherDomains = [...citedDomains].filter(d => !d.includes("rudrakailash.com")).sort();

  return {
    mentioned: mentionedInText || mentionedInCitations,
    citedDomains: [...citedDomains],
    otherDomains,
    responseSnippet: combinedText.trim().slice(0, 1500),
  };
}

app.get("/citations/queries", (req, res) => { res.json({ success: true, queries: loadCitationQueries() }); });

app.post("/citations/queries", (req, res) => {
  const { query, label } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  const queries = loadCitationQueries();
  const id = String(Date.now());
  queries[id] = { id, query, label: label || query, addedAt: new Date().toISOString() };
  saveCitationQueries(queries);
  res.json({ success: true, entry: queries[id] });
});

app.delete("/citations/queries/:id", (req, res) => {
  const queries = loadCitationQueries();
  delete queries[req.params.id];
  saveCitationQueries(queries);
  res.json({ success: true });
});

app.get("/citations/data", (req, res) => { res.json({ success: true, citationData: loadCitationData(), queries: loadCitationQueries() }); });

app.post("/citations/check/:id", async (req, res) => {
  const queries = loadCitationQueries();
  const entry   = queries[req.params.id];
  if (!entry) return res.status(404).json({ error: "Query not tracked. Add it first." });
  res.json({ message: "Citation check started — results in ~15-30 seconds.", query: entry.query });
  setTimeout(async () => { await checkAndStoreCitation(entry); }, 100);
});

async function checkAndStoreCitation(entry) {
  const { id, query, label } = entry;
  console.log(`🔎 Checking citation: "${query}"`);
  try {
    const result   = await checkCitation(query);
    const today    = new Date().toISOString().split("T")[0];
    const citationData = loadCitationData();
    if (!citationData[id]) citationData[id] = { id, query, label, history: [] };
    citationData[id].history = citationData[id].history.filter(h => h.date !== today);
    citationData[id].history.push({ date: today, mentioned: result.mentioned, otherDomains: result.otherDomains, responseSnippet: result.responseSnippet, checkedAt: new Date().toISOString() });
    citationData[id].history = citationData[id].history.sort((a, b) => a.date.localeCompare(b.date)).slice(-52);
    citationData[id].lastChecked = new Date().toISOString();
    citationData[id].lastMentioned = result.mentioned;
    saveCitationData(citationData);
    console.log(`✅ Citation stored: "${query}" — ${result.mentioned ? "MENTIONED ✅" : "not mentioned ❌"}`);
    return result;
  } catch (e) {
    console.warn(`⚠️  Citation check failed for "${query}":`, e.message);
    return null;
  }
}

cron.schedule("0 2 * * 1", async () => {
  console.log("🔎 Weekly citation check — Monday 7:30am IST");
  const queries = loadCitationQueries();
  const entries = Object.values(queries);
  if (entries.length === 0) { console.log("🔎 No citation queries tracked yet."); return; }
  for (const entry of entries) { await checkAndStoreCitation(entry); await new Promise(r => setTimeout(r, 3000)); }
  const citationData = loadCitationData();
  const rows = Object.values(citationData).map(e => {
    const latest = e.history[e.history.length - 1];
    return { label: e.label, mentioned: latest?.mentioned, otherDomains: (latest?.otherDomains || []).slice(0, 4).join(", ") };
  });
  const mentionedCount = rows.filter(r => r.mentioned).length;
  const tableRows = rows.map(r => `<tr style="border-bottom:1px solid #2E1500"><td style="padding:10px 14px;color:#F5E6C8;font-size:13px">${r.label}</td><td style="padding:10px 14px;text-align:center;color:${r.mentioned ? '#7FD48A' : '#F08080'};font-weight:bold">${r.mentioned ? '✅ Cited' : '❌ Not cited'}</td><td style="padding:10px 14px;color:#9A7050;font-size:11px">${r.otherDomains || '—'}</td></tr>`).join("");
  const emailHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif"><div style="max-width:720px;margin:0 auto;padding:32px 20px"><div style="text-align:center;margin-bottom:32px"><div style="font-size:36px">ॐ</div><h1 style="color:#F0C84A;font-size:22px;margin:8px 0">RudraKailash — Weekly LLM Citation Report</h1><p style="color:#9A7050;font-size:13px">${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p></div><div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:20px;margin-bottom:24px"><table width="100%"><tr><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">TRACKED QUERIES</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">${rows.length}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">CITED IN</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${mentionedCount}/${rows.length}</div></td></tr></table></div><table style="width:100%;border-collapse:collapse;background:#120600;border:1px solid #2E1500;border-radius:10px;overflow:hidden"><thead><tr style="background:#160800"><th style="padding:10px 14px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">QUERY</th><th style="padding:10px 14px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">RUDRAKAILASH CITED?</th><th style="padding:10px 14px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">OTHER SOURCES CITED</th></tr></thead><tbody>${tableRows}</tbody></table><div style="text-align:center;margin-top:32px;border-top:1px solid #2E1500;padding-top:20px"><p style="color:#5A3020;font-size:11px">RudraKailash Agentic SEO · LLM Citation Tracker · Weekly, Monday 7:30am IST</p></div></div></body></html>`;
  await sendEmail(`🔎 RudraKailash Weekly Citation Report — ${mentionedCount}/${rows.length} cited`, emailHtml);
  console.log("🔎 Weekly citation report sent.");
}, { timezone: "UTC" });

// ─── Service product detection ────────────────────────────────────────────────
function isServiceProduct(product) {
  const title = (product.title || "").toLowerCase();
  const tags  = (product.tags  || "").toLowerCase();
  const body  = (product.body_html || "").toLowerCase().slice(0, 300);
  const serviceKeywords = [
    "homa", "homam", "puja", "pooja", "parayanam", "parayana",
    "abhishek", "archana", "yagna", "yajna", "ritual", "fire ritual",
    "vedic fire", "online puja", "online homa", "rudra abhishek",
    "sundara kanda", "vishnu sahasranama", "kanda parayanam",
  ];
  return serviceKeywords.some(kw => title.includes(kw) || tags.includes(kw) || body.includes(kw));
}

// ─── Karungali product detection ─────────────────────────────────────────────
function isKarungaliProduct(product) {
  const title = (product.title || "").toLowerCase();
  const tags  = (product.tags  || "").toLowerCase();
  const body  = (product.body_html || "").toLowerCase().slice(0, 300);
  const karungaliKeywords = [
    "karungali", "karungal", "ebony", "ebony wood", "ebony mala",
    "ebony bracelet", "karungali mala", "karungali bracelet",
    "diospyros ebenum", "karungali kattai",
  ];
  return karungaliKeywords.some(kw => title.includes(kw) || tags.includes(kw) || body.includes(kw));
}

// ─── Sphatik product detection ────────────────────────────────────────────────
// Returns true for Sphatik (natural rock crystal / clear quartz) products —
// NOT Rudraksha beads. Before this branch existed, these products silently
// fell through to the default Rudraksha branch and would have received
// false RKRTL X-ray / Elaeocarpus ganitrus / mukhi-count content — Sphatik
// is a mineral (SiO2), not a seed, and has no "mukhi" structure at all.
function isSphatikProduct(product) {
  const title = (product.title || "").toLowerCase();
  const tags  = (product.tags  || "").toLowerCase();
  const body  = (product.body_html || "").toLowerCase().slice(0, 300);
  const sphatikKeywords = [
    "sphatik", "sphatika", "sphatik mala", "sphatik bracelet",
    "clear quartz", "rock crystal", "quartz crystal", "crystal mala",
  ];
  return sphatikKeywords.some(kw => title.includes(kw) || tags.includes(kw) || body.includes(kw));
}

// ─── Tulsi product detection ─────────────────────────────────────────────────
// Returns true for Tulsi (Holy Basil, Ocimum tenuiflorum) products — NOT
// Rudraksha beads. Same reasoning as Sphatik above: no RKRTL/X-ray/mukhi/
// ganitrus content applies here. NOTE: Subbu has not yet established a
// verification/authentication method for Tulsi (confirmed July 2026) — the
// Tulsi content branch below deliberately does NOT claim any specific
// authentication process, to avoid inventing a claim that isn't real.
function isTulsiProduct(product) {
  const title = (product.title || "").toLowerCase();
  const tags  = (product.tags  || "").toLowerCase();
  const body  = (product.body_html || "").toLowerCase().slice(0, 300);
  const tulsiKeywords = [
    "tulsi", "tulasi", "holy basil", "tulsi mala", "tulasi mala",
    "tulsi bracelet", "ocimum tenuiflorum",
  ];
  return tulsiKeywords.some(kw => title.includes(kw) || tags.includes(kw) || body.includes(kw));
}

// ─── Origin resolution ─────────────────────────────────────────────────────────
// Returns the verified geographic origin for a given Rudraksha bead/mala,
// confirmed by Subbu against actual sourcing (July 2026). This replaces a
// prior system-prompt rule that hardcoded EVERY product's origin as Nepal
// ("...it MUST match the site's single canonical sourcing line: 'sourced
// directly from Rudraksha tree farmers in Nepal.' NEVER introduce alternate
// origin phrasing...") — that rule was simply wrong for several specific
// products, and worse, it directly contradicted the separate isHalfMoon
// special-case note that told the model 1 Mukhi Half-Moon is South Indian.
// Both instructions fired in the same prompt, producing live content that
// asserted both origins in the same paragraph (1 Mukhi Half-Moon FAQ, July
// 2026). Fields left undefined must not be invented downstream — omit
// rather than guess.
//
// isMala: true for mala/rosary products (multiple beads strung together),
// false for a single loose bead. Origin differs by product FORM, not just
// mukhi count — e.g. 5 Mukhi single beads are Nepal, but 5 Mukhi malas are
// Indonesian (Java), reflecting actual sourcing/wholesale reality.
function resolveOrigin(title, isMala) {
  const t = (title || "").toLowerCase();
  const mukhiMatch = t.match(/(\d{1,2})\s*mukhi/);
  const mukhi = mukhiMatch ? parseInt(mukhiMatch[1], 10) : null;
  const isHalfMoonShape = /half.?moon/.test(t);

  if (!isMala) {
    if (mukhi === 1 && isHalfMoonShape) {
      return {
        region: "South India",
        sourcingLine: "this Half-Moon form is sourced from South India — the authentic, scripturally valid form of 1 Mukhi available today, since the round Nepali 1 Mukhi is virtually non-existent in nature",
        metaShort: "South Indian",
        species: "Elaeocarpus tuberculatus",
        speciesNote: "Disclose transparently that this Half-Moon (Chandrakar / Kaju Dana) form is Elaeocarpus tuberculatus, a different species from Elaeocarpus ganitrus (the species most Rudraksha beads belong to). Do not obscure, omit, or soften this. Frame it as the accepted traditional alternative to the round Nepal 1 Mukhi, which is virtually unavailable today — an honest, disclosed positioning (per Subbu, July 2026: full transparency), not a claim of being true E. ganitrus Rudraksha.",
      };
    }
    if (mukhi === 1) {
      // Round 1 Mukhi — genuinely rare, Nepal-origin
      return { region: "Nepal", sourcingLine: "sourced directly from Rudraksha tree farmers in Nepal", metaShort: "Nepali", species: "Elaeocarpus ganitrus" };
    }
    if (mukhi === 2) {
      return {
        region: "Haridwar variety (Himalayan, Uttarakhand)",
        sourcingLine: "sourced from the Haridwar variety, grown in the Himalayan foothills of Uttarakhand — distinct from the Nepal-origin varieties",
        metaShort: "Haridwar",
        species: "Elaeocarpus ganitrus",
      };
    }
    if (mukhi !== null && mukhi >= 3 && mukhi <= 14) {
      return { region: "Nepal", sourcingLine: "sourced directly from Rudraksha tree farmers in Nepal", metaShort: "Nepali", species: "Elaeocarpus ganitrus" };
    }
    if (/gauri\s*shankar/.test(t) || /ganesh(a)?\s*rudraksha/.test(t)) {
      return { region: "Nepal", sourcingLine: "sourced directly from Rudraksha tree farmers in Nepal", metaShort: "Nepali", species: "Elaeocarpus ganitrus" };
    }
    return null; // uncatalogued single bead — do not assert an origin or species
  } else {
    if (mukhi !== null && mukhi >= 2 && mukhi <= 10) {
      return {
        region: "Indonesia (Java)",
        sourcingLine: "sourced from Java, Indonesia",
        metaShort: "Indonesian",
        species: "Elaeocarpus ganitrus",
        positioning: "Position this mala for its practical, everyday use — well suited to japa (mantra-counting meditation practice) and daily wear. Do NOT compare, contrast, or reference this product against Nepali single beads, Nepali malas, collector-grade pieces, or price differences with any other product on the site — it must stand entirely on its own as a functional daily-practice item, never framed as a lower-cost alternative to anything else (Subbu, July 2026: doing so would cannibalize premium Nepali collector bead sales).",
      };
    }
    if (mukhi !== null && mukhi >= 11 && mukhi <= 14) {
      return { notStocked: true }; // 11-14 Mukhi malas are not currently stocked
    }
    return null; // mixed-mukhi or unspecified mala — do not assert an origin or species
  }
}

function isMalaProduct(title) {
  return /\bmala\b/i.test(title || "");
}

// Builds the VERIFIED ORIGIN prompt block. Mirrors buildMukhiFactsBlock's
// pattern: state exactly what's known, explicitly forbid inventing/defaulting
// when nothing is known, rather than silently falling back to Nepal.
function buildOriginBlock(origin) {
  if (!origin) {
    return `ORIGIN: No verified origin mapping exists for this specific product. Do NOT default to Nepal or any other origin — state origin only if it is already present in CURRENT DESCRIPTION below, otherwise omit origin claims entirely rather than guess.\n`;
  }
  if (origin.notStocked) {
    return `ORIGIN WARNING: This mukhi count in mala form is not currently stocked by RudraKailash (per Subbu, July 2026 — very low customer demand, primarily wholesaler-pushed). Do not generate a sourcing claim for this product; flag it for manual review instead.\n`;
  }
  let block = `VERIFIED ORIGIN (mandatory): ${origin.sourcingLine}. Whenever origin is mentioned anywhere in the output — opening paragraph, meta title, meta description, tags, or FAQ — it MUST use this exact origin consistently. Do NOT default to Nepal or introduce any other origin not stated here.\n`;
  if (origin.species) {
    block += `SPECIES (mandatory): The correct botanical species for this specific product is ${origin.species}. Cite this exact species name wherever botanical species is mentioned — RKRTL Authentication/Certification section, opening paragraph if species is referenced, and FAQ. Do NOT default to Elaeocarpus ganitrus if a different species is verified here.\n`;
  }
  if (origin.speciesNote) {
    block += `${origin.speciesNote}\n`;
  }
  if (origin.positioning) {
    block += `POSITIONING (mandatory): ${origin.positioning}\n`;
  }
  return block;
}

// ─── Canonical Mukhi Facts Table ──────────────────────────────────────────────
// Verified deity/planet/chakra/mantra per mukhi, confirmed by Subbu against his
// own Jyotish sources (July 2026). This replaces freeform AI recall for these
// fields — the model was previously inventing plausible-sounding but wrong or
// inconsistent scriptural details (e.g. missing Saptamatrikas on 7 Mukhi,
// three different RKRTL expansions). Do not edit without Subbu's sign-off.
//
// Schema: `deity` is kept short and literal — this is the exact name that MUST
// appear in the Vedic Tradition & Significance bullets (previously, when this
// field was one long combined sentence, the model would name adjacent scripture
// groups like the Sapta Matrikas/Sapta Rishi but quietly drop the primary deity
// itself — e.g. 7 Mukhi shipped live without "Mahalakshmi" anywhere on the page).
// `additionalAssociations` holds the longer scriptural detail. `notes` holds
// specific traditional use-cases (e.g. 7 Mukhi's cash-box/wealth association)
// that should be worked into the Traditional Benefits section. `planet`/
// `chakra`/`mantra` may be omitted (left undefined) where not yet confirmed —
// the prompt is instructed to state nothing rather than invent a value.
const MUKHI_FACTS = {
  1:  { deity: "Lord Shiva", additionalAssociations: "regarded in this form as Paramshiva, the supreme, formless aspect of Shiva", planet: "Sun (Surya)", chakra: "Sahasrara (Crown Chakra)", mantra: "Om Hreem Namah" },
  2:  { deity: "Ardhanarishvara", additionalAssociations: "the united form of Shiva and Shakti, representing the inseparable union of masculine and feminine cosmic energy", planet: "Moon (Chandra)", chakra: "Swadhisthana (Sacral Chakra)", mantra: "Om Namah" },
  3:  { deity: "Agni Deva", planet: "Mars (Mangal)", chakra: "Manipura (Solar Plexus Chakra)", mantra: "Om Kleem Namah" },
  4:  { deity: "Lord Brahma", planet: "Mercury (Budha)", chakra: "Vishuddha (Throat Chakra)", mantra: "Om Hreem Namah" },
  5:  { deity: "Kalagni Rudra", additionalAssociations: "a form of Lord Shiva, linked to the Panchmukhi Shiva — the five faces Sadyojata, Vamadeva, Aghora, Tatpurusha, and Ishana", planet: "Jupiter (Brihaspati)", chakra: "Vishuddha (Throat Chakra)", mantra: "Om Hreem Namah" },
  6:  { deity: "Lord Kartikeya", additionalAssociations: "the Shrimad Devibhagwat and Nirnaya Sindhu term this bead \"Guhasangyak\"; the Jabalopanishad assigns it jointly to Kartikeya and Ganesha; it also invokes Goddess Mahalakshmi and Goddess Parvati", planet: "Venus (Shukra) — governs luxury, comfort, and material happiness", chakra: "Muladhara (Root Chakra)", mantra: "Om Hreem Hoom Namah" },
  7:  { deity: "Goddess Mahalakshmi", additionalAssociations: "also linked, per the Jabalopanishad, to the Sapta Matrikas (Brahmi, Maheshwari, Kaumari, Vaishnavi, Varahi, Indrani, Chamunda) and the Sapta Rishi (Marichi, Atri, Angira, Pulatsya, Pulaha, Kratu, Vashishtha)", planet: "Saturn (Shani)", chakra: "Hrit Padma (Sacred Heart Chakra)", mantra: "Om Hoom Namah", notes: "Owing to its association with Goddess Mahalakshmi, this bead is traditionally kept in the cash box or cash drawer of a home or business, and worn to help overcome financial obstacles and support financial stability — this wealth association is one of the most common reasons seekers choose the 7 Mukhi specifically, so it should be reflected as a traditional benefit, properly hedged, not omitted." },
  8:  { deity: "Lord Ganesha", planet: "Rahu", chakra: "Muladhara (Root Chakra)", mantra: "Om Hoom Namah" },
  9:  { deity: "Goddess Durga", additionalAssociations: "the nine forms of Navadurga (Shailaputri, Brahmacharini, Chandraghanta, Kushmanda, Skandamata, Katyayani, Kaalaratri, Mahagauri, Siddhidatri); also Bhairava (Shiva) per the Padma Purana and Shrimad Devibhagwat", planet: "Ketu", chakra: "Sahasrara (Crown Chakra)", mantra: "Om Hreem Hoom Namah" },
  10: { deity: "Lord Vishnu", planet: "All Navagrahas — no single ruling planet", chakra: "Swadhisthana (Sacral Chakra)", mantra: "Om Hreem Namah" },
  11: { deity: "Lord Hanuman", additionalAssociations: "also traditionally linked to the Ekadasha Rudras, the eleven forms of Lord Shiva", planet: "Mars (Mangal)", chakra: "Vishuddha (Throat Chakra)", mantra: "Om Hreem Hoom Namah" },
  12: { deity: "Surya Deva", additionalAssociations: "the Sun God", planet: "Sun (Surya)", chakra: "Manipura (Solar Plexus Chakra)", mantra: "Om Kraum Sraum Raum Namah" },
  13: { deity: "Kamadeva and Lord Indra", planet: "Venus (Shukra)", chakra: "Swadhisthana (Sacral Chakra)", mantra: "Om Hreem Namah" },
  14: { deity: "Maha Rudra", additionalAssociations: "a form of Lord Shiva; also linked to Lord Hanuman", planet: "Saturn (Shani)", chakra: "Muladhara (Root Chakra)", mantra: "Om Namah" },
};

// Named combination/special beads that don't carry a plain mukhi number, so the
// digit-based lookup below can't catch them. Facts here are DRAFTS pending
// Subbu's confirmation for planet/chakra/mantra — deity is well-established and
// safe to use now; fields left undefined must not be invented by the prompt.
const NAMED_BEAD_FACTS = {
  "gauri shankar": { deity: "Lord Shiva and Goddess Parvati jointly", additionalAssociations: "a naturally twin-fused bead (two lobes joined in natural formation, not cut or altered), traditionally regarded as Shiva and Parvati united — the same Ardhanarishvara principle as the 2 Mukhi, but in this naturally conjoined form", notes: "Traditionally associated with marital harmony and relationship strength — PENDING Subbu's confirmation on ruling planet, chakra, and beej mantra before these are asserted in content." },
  "ganesh":       { deity: "Lord Ganesha", additionalAssociations: "a naturally formed bead bearing a trunk-like protrusion resembling Ganesha's trunk, considered a rare and auspicious natural formation distinct from a standard mukhi count", notes: "Traditionally associated with the removal of obstacles and auspicious beginnings — PENDING Subbu's confirmation on ruling planet, chakra, and beej mantra before these are asserted in content." },
};

// Extracts the mukhi number (or named special bead) from a product title and
// returns its verified facts, or null if no table entry exists (e.g. 15-21
// Mukhi not yet catalogued).
function getMukhiFacts(title) {
  const t = (title || "").toLowerCase();
  if (/gauri\s*shankar/.test(t)) return NAMED_BEAD_FACTS["gauri shankar"];
  if (/ganesh(a)?\s*rudraksha/.test(t)) return NAMED_BEAD_FACTS["ganesh"];
  const m = (title || "").match(/(\d{1,2})\s*Mukhi/i);
  if (!m) return null;
  return MUKHI_FACTS[parseInt(m[1], 10)] || null;
}

// Builds the VERIFIED MUKHI FACTS prompt block from a facts entry (or the safe
// fallback instruction if no entry exists). Only includes fields that are
// actually present — planet/chakra/mantra are explicitly marked "not yet
// confirmed" rather than silently omitted, so the model can't quietly invent
// one to fill the gap.
function buildMukhiFactsBlock(facts) {
  if (!facts) {
    return `No verified facts table entry exists for this specific bead (e.g. it may be a 15-21 Mukhi or other bead not yet catalogued). Use only widely-corroborated, mainstream Vedic Rudraksha tradition sources for deity/planet/chakra/mantra — do not invent specifics you cannot support, and prefer omitting a detail over guessing one.\n`;
  }
  const lines = [
    `VERIFIED MUKHI FACTS (mandatory):`,
    `Primary Deity (this exact name MUST appear at least once, verbatim, inside the Vedic Tradition & Significance bullets — naming it there is required, not optional, and is NOT the same as making a benefit claim; see the CRITICAL CLARIFICATION rule below): ${facts.deity}`,
  ];
  if (facts.additionalAssociations) lines.push(`Additional Scriptural Associations: ${facts.additionalAssociations}`);
  lines.push(`Ruling Planet: ${facts.planet || "not yet confirmed — do not state a specific planet for this product"}`);
  lines.push(`Associated Chakra: ${facts.chakra || "not yet confirmed — do not state a specific chakra for this product"}`);
  lines.push(`Beej Mantra: ${facts.mantra || "not yet confirmed — do not state a specific mantra for this product"}`);
  if (facts.notes) lines.push(`Traditional Use-Case Note (work this into the Traditional Benefits section, properly hedged): ${facts.notes}`);
  return lines.join("\n") + "\n";
}

// ─── Deity-presence safety net ────────────────────────────────────────────────
function ensureDeityPresent(html, facts, productTitle) {
  if (!facts || !facts.deity || !html) return html;
  const words = facts.deity.replace(/[()]/g, "").split(/\s+/).filter(w => w.length > 3);
  const checkWord = words[words.length - 1] || facts.deity;
  const escaped = checkWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const present = new RegExp(escaped, "i").test(html);
  if (present) return html;

  console.warn(`⚠️  Deity name "${facts.deity}" missing from generated description for "${productTitle}" — injecting compliant sentence (model failed to follow the MUST-appear rule)`);
  const sentence = `Seekers traditionally associate ${productTitle} with ${facts.deity}${facts.additionalAssociations ? `, ${facts.additionalAssociations}` : ""}.`;

  const ulRe = /(<h3>(?:Vedic Tradition|Spiritual Significance)[^<]*<\/h3>\s*<ul>)/i;
  if (ulRe.test(html)) return html.replace(ulRe, `$1<li>${sentence}</li>`);

  const headingRe = /(<h3>(?:Vedic Tradition|Spiritual Significance)[^<]*<\/h3>)/i;
  if (headingRe.test(html)) return html.replace(headingRe, `$1<p>${sentence}</p>`);

  const h2Re = /(<\/h2>)/i;
  if (h2Re.test(html)) return html.replace(h2Re, `$1<p>${sentence}</p>`);
  return html;
}

// ─── FAQ formatting safety net ────────────────────────────────────────────────
function escapeFaqText(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function reformatFaqSection(html) {
  if (!html) return html;
  const headingRe = /<h3>\s*Frequently Asked Questions[^<]*<\/h3>/i;
  const headingMatch = html.match(headingRe);
  if (!headingMatch) return html; // no FAQ section found — nothing to fix

  const startIdx = headingMatch.index + headingMatch[0].length;
  const faqBody = html.slice(startIdx); // FAQ is always the last section in every branch's template

  const withBreaks = faqBody
    .replace(/<\/(p|dd|dt|li|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const plainLines = withBreaks
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (plainLines.length === 0) return html;

  const pairs = [];
  let current = null;
  for (const line of plainLines) {
    const isNumberedQuestionLine = /^\d+\.\s*.*\?\s*$/.test(line);
    const isPlainQuestionLine = /\?\s*$/.test(line);
    if (isNumberedQuestionLine || isPlainQuestionLine) {
      current = { question: line.replace(/^\d+\.\s*/, ""), answer: "" };
      pairs.push(current);
    } else if (current) {
      current.answer = current.answer ? `${current.answer} ${line}` : line;
    }
  }
  const complete = pairs.filter(p => p.question && p.answer);
  if (complete.length === 0) return html; // couldn't parse — leave the original untouched rather than risk corrupting it

  const rebuilt = complete.map((p, i) =>
    `<div style="margin-bottom:20px"><p style="font-weight:bold;margin:0 0 6px 0">${i + 1}. ${escapeFaqText(p.question)}</p><p style="margin:0">${escapeFaqText(p.answer)}</p></div>`
  ).join("");

  return html.slice(0, startIdx) + rebuilt;
}

// ─── SEO Pipeline ─────────────────────────────────────────────────────────────
function cleanAIOutput(text) {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function extractJsonValue(text) {
  const stripped = (text || "").replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const firstBrace   = stripped.indexOf("{");
  const firstBracket = stripped.indexOf("[");
  let openChar, closeChar, start;
  if (firstBrace === -1 && firstBracket === -1) return stripped; // no JSON found; let JSON.parse throw naturally
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    closeChar = "]"; start = firstBracket;
  } else {
    closeChar = "}"; start = firstBrace;
  }
  const end = stripped.lastIndexOf(closeChar);
  if (end === -1 || end < start) return stripped;
  return stripped.slice(start, end + 1);
}

async function callClaude(system, user, max_tokens = 1200) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Anthropic error");
  return cleanAIOutput(data.content?.map(b => b.text || "").join("") || "");
}

// ─── scoreSEO — Karungali-aware ───────────────────────────────────────────────
function scoreSEO(metaTitle, metaDesc, tags, desc, isService = false, isKarungali = false, isSphatik = false, isTulsi = false) {
  const titleLen = (metaTitle||"").length, descLen = (metaDesc||"").length;
  const tagCount = (tags||"").split(",").filter(Boolean).length;
  const descText = (desc||"").replace(/<[^>]+>/g, "");

  let certCheck, descCertCheck;
  if (isService) {
    certCheck     = /vedic|puja|homa|vadhyar|mvs/i.test(tags||"");
    descCertCheck = /mvs|vedapadasala|vadhyar|kanchi/i.test(descText);
  } else if (isKarungali) {
    certCheck     = /karungali|ebony|wood|certified|authentic/i.test(tags||"");
    descCertCheck = /karungali|ebony|diospyros|authentic|wood/i.test(descText);
  } else if (isSphatik) {
    certCheck     = /sphatik|crystal|quartz|natural/i.test(tags||"");
    descCertCheck = /sphatik|crystal|quartz|hardness|refractive/i.test(descText);
  } else if (isTulsi) {
    // No authentication claim exists for Tulsi (Subbu, July 2026) — score on
    // genuine sourcing/tradition language instead of a certification check.
    certCheck     = /tulsi|tulasi|holy basil|vaishnav/i.test(tags||"");
    descCertCheck = /tulsi|tulasi|ocimum|vaishnav|krishna|vishnu/i.test(descText);
  } else {
    certCheck     = /rkrtl|certified|authentic/i.test(tags||"");
    descCertCheck = /rkrtl|certified|x-ray/i.test(descText);
  }

  const checks = [
    titleLen>0, titleLen>=40&&titleLen<=75, /(rudrakailash)/i.test(metaTitle||""),
    descLen>0, descLen>=130&&descLen<=165, /shop|buy|order|get|explore|book/i.test(metaDesc||""),
    tagCount>0, tagCount>=6, certCheck,
    descText.length>100, descText.split(/\s+/).length>=300, /<h[23]/i.test(desc||""),
    descCertCheck,
  ];
  const pts = [10,10,5,10,10,5,5,8,7,10,10,5,5];
  return Math.round(checks.reduce((s,c,i) => s+(c?pts[i]:0), 0) / pts.reduce((s,p) => s+p, 0) * 100);
}

async function runSEOPipeline(product) {
  console.log(`🤖 SEO pipeline: ${product.title}`);
  const isService   = isServiceProduct(product);
  const isKarungali = !isService && isKarungaliProduct(product);
  const isSphatik   = !isService && !isKarungali && isSphatikProduct(product);
  const isTulsi     = !isService && !isKarungali && !isSphatik && isTulsiProduct(product);
  const isBead      = !isService && !isKarungali && !isSphatik && !isTulsi; // true Rudraksha bead/mala branch
  if (isService)   console.log(`🛕 Detected as SERVICE product — using service prompt`);
  if (isKarungali) console.log(`🪵 Detected as KARUNGALI product — using wood auth prompt`);
  if (isSphatik)   console.log(`💎 Detected as SPHATIK product — using crystal auth prompt`);
  if (isTulsi)     console.log(`🌿 Detected as TULSI product — using Tulsi prompt (no authentication claim)`);

  const descPlain   = (product.body_html||"").replace(/<[^>]+>/g,"").slice(0,400);
  const competitors = await runCompetitorResearch(product.title);

  let extractedKeywords = { h1: [], h2h3: [], phrases: [] };
  let keywordBrief = "";

  if (competitors.length > 0) {
    try {
      const compHeadingInput = competitors.map((c, i) => {
        const headings = c.headings || {};
        const h1s   = (headings.h1   || []).slice(0, 3).join(" | ");
        const h2h3s = (headings.h2h3 || []).slice(0, 6).join(" | ");
        const text  = (c.content || c.snippet || "").slice(0, 400);
        return `Competitor ${i+1} (${c.url}):\nH1: ${h1s || "none"}\nH2/H3: ${h2h3s || "none"}\nBody: ${text}`;
      }).join("\n\n---\n\n");

      const kwRaw = await callClaude(
        `You are an SEO keyword analyst. Output ONLY valid JSON. No markdown. No explanation.`,
        `Extract SEO keywords from these ${competitors.length} competitor pages for "${product.title}" on RudraKailash.com.\n\n${compHeadingInput}\n\nExtract:\n1. h1Keywords: Primary keywords from competitor H1 tags (max 8, exact phrases)\n2. h2h3Keywords: Sub-topic LSI keywords from H2/H3 headings (max 12, exact phrases)\n3. intentPhrases: Recurring long-tail intent phrases from body text across 2+ competitors (max 10)\n\nOutput ONLY:\n{"h1":["phrase1"],"h2h3":["phrase1"],"phrases":["phrase1"]}`, 1500
      );
      try {
        const kw = JSON.parse(extractJsonValue(kwRaw));
        extractedKeywords = { h1: kw.h1||[], h2h3: kw.h2h3||[], phrases: kw.phrases||[] };
        const h1List = extractedKeywords.h1.slice(0,5).join(" / ");
        const h2h3List = extractedKeywords.h2h3.slice(0,8).join(", ");
        const phraseList = extractedKeywords.phrases.slice(0,8).join(", ");
        keywordBrief = [
          h1List     ? `H1 PRIMARY KEYWORDS (use in <h2> and opening <p>): ${h1List}` : "",
          h2h3List   ? `H2/H3 SUB-TOPIC KEYWORDS (use as or inside <h3> headings — naturally, not forced): ${h2h3List}` : "",
          phraseList ? `LONG-TAIL INTENT PHRASES (weave into bullets and FAQ questions): ${phraseList}` : "",
        ].filter(Boolean).join("\n");
      } catch(e) { console.warn("Keyword JSON parse failed:", e.message, "— raw response (first 300 chars):", kwRaw.slice(0, 300)); keywordBrief = ""; }
    } catch(e) { console.warn("Keyword extraction failed:", e.message); }
  }

  let gapSummary = "Cover all key topics comprehensively.";
  if (competitors.length > 0) {
    try {
      const compTexts = competitors.map((c,i) => `Competitor ${i+1} (${c.url}):\n${(c.content||c.snippet).slice(0,500)}`).join("\n\n---\n\n");
      const gapRaw = await callClaude(`SEO strategist. Output ONLY JSON array of gap strings.`, `Product: "${product.title}". Our: "${descPlain}". Competitors:\n${compTexts}\nIdentify 5-8 gaps. Output ONLY JSON array.`, 700);
      try {
        const gaps = JSON.parse(extractJsonValue(gapRaw));
        gapSummary = `Fill: ${gaps.join("; ")}`;
      } catch(e) { console.warn("Gap analysis JSON parse failed:", e.message, "— falling back to raw text"); gapSummary = gapRaw.slice(0,300); }
    } catch(e) { console.warn("Gap analysis failed:", e.message); }
  }

  const isMalaProd = isMalaProduct(product.title);
  const origin = isBead ? resolveOrigin(product.title, isMalaProd) : null;
  const originBlock = buildOriginBlock(origin);
  const mukhiFacts = isBead ? getMukhiFacts(product.title) : null;
  const mukhiFactsBlock = buildMukhiFactsBlock(mukhiFacts);
  const selfContainedRule = `SELF-CONTAINED SENTENCE RULE (critical for AI/GEO extraction — this determines whether a passage can be lifted into an AI-generated answer): every bullet and every sentence must pass this test — read alone, with no heading and no surrounding text, does it still make complete sense? Concretely: (1) never open a bullet with a bare fragment like "Ruled by Shani (Saturn)…" — give it an explicit subject, e.g. "${product.title} is traditionally associated with Shani (Saturn)…"; (2) never start a bullet with a bare pronoun ("It…", "This…") with no stated antecedent in the same sentence — restate the product name or "this bead"/"this mala" instead; (3) each bullet must read as a complete, standalone claim understandable with zero prior context, not a continuation of the heading above it.`;
  const kwPlacementInstructions = keywordBrief
    ? `MANDATORY KEYWORD PLACEMENT:\n${keywordBrief}\n\nPLACEMENT RULES:\n- <h2>: Must contain one of the H1 PRIMARY KEYWORDS\n- Opening <p>: Naturally include the primary H1 keyword within first 60 words\n- <h3> headings: Use H2/H3 SUB-TOPIC KEYWORDS as heading phrases where they fit\n- Bullets: Address LONG-TAIL INTENT PHRASES as seeker experience\n- FAQ: Word at least 2 questions using the exact phrasing of LONG-TAIL INTENT phrases\n\n${selfContainedRule}`
    : `KEYWORD GUIDANCE: Use standard SEO keywords appropriate to this product.\n\n${selfContainedRule}`;

  // ── Description system prompt — three-way branch ──────────────────────────
  const descSystem = isService
    ? `You are a Vedic services SEO expert writing concise service page descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2> and opening <p>; (2) E-E-A-T — cite vadhyar credentials, MVS Vedapadasala, Kanchi Mutt VRNT achievement; (3) NO Rudraksha bead language, NO RKRTL certification, NO X-ray testing references — this is a SERVICE not a product. Output clean HTML only. No markdown. No preamble.`
    : isKarungali
    ? `You are a sacred wood jewellery SEO expert writing concise product descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2> and opening <p> within 100 words; (2) E-E-A-T — botanical name Diospyros ebenum, Shaiva Siddhanta tradition, Tamil Nadu heritage, wood grain authentication; (3) STRICT — NO X-ray testing, NO RKRTL certification language, NO Elaeocarpus ganitrus — Karungali is authenticated by botanical species, wood density, and grain pattern, NOT X-ray imaging. DEPTH RULE (mandatory, applies specifically to "What Seekers Experience" and "Who Should Wear" — see per-section instructions below): these two sections are deep-dive sections, not shallow one-line bullets — each bullet gets a bold lead-in label plus 2-3 full sentences of genuine substance. All other sections stay concise: MAX 4 lines of prose, or a <ul> if more structure helps. Keep total description under 850 words (higher than a typical product page, intentionally, to accommodate the two deep-dive sections). Output clean HTML only. No markdown. No preamble.`
    : isSphatik
    ? `You are a crystal/gemstone SEO expert writing concise product descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2> and opening <p> within 100 words; (2) E-E-A-T — Sphatik is natural rock crystal (clear quartz, chemically silicon dioxide), associated in Vedic tradition with Goddess Lakshmi and the Moon (Chandra), valued for purity, clarity, and meditation; (3) STRICT — NO X-ray testing, NO RKRTL X-ray certification language, NO Elaeocarpus ganitrus, NO "mukhi" or face-count language of any kind — Sphatik is a mineral, not a seed, and has no mukhi structure. Authentication is by refractive index testing and/or Mohs hardness testing (natural quartz = 7 on the Mohs scale; the main fraud risk in this category is glass sold as Sphatik, which is both optically and mechanically softer) — name this method directly and factually, not hedged, since it is a verifiable physical test, not a belief claim. DEPTH RULE (mandatory, applies specifically to "What Seekers Experience" and "Who Should Wear" — see per-section instructions below): these two sections are deep-dive sections, not shallow one-line bullets — each bullet gets a bold lead-in label plus 2-3 full sentences of genuine substance. All other sections stay concise: MAX 4 lines of prose, or a <ul> if more structure helps. Keep total description under 850 words (higher than a typical product page, intentionally, to accommodate the two deep-dive sections). Output clean HTML only. No markdown. No preamble.`
    : isTulsi
    ? `You are a Vedic jewellery SEO expert writing concise product descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2> and opening <p> within 100 words; (2) E-E-A-T — Tulsi (Holy Basil, botanical name Ocimum tenuiflorum) is sacred to Lord Vishnu and Krishna in Vaishnava tradition; (3) CRITICAL — RudraKailash does not currently have an established, verifiable authentication/testing method for Tulsi (unlike RKRTL's X-ray process for Rudraksha, or refractive-index/hardness testing for Sphatik). DO NOT invent, imply, or reference any authentication process, testing method, certificate, or verification claim for this product — no RKRTL, no "certified," no "verified authentic," no "tested." Describe sourcing honestly and modestly instead (e.g. "sourced from Tulsi plants," without an unsupported verification claim attached). NO X-ray, NO RKRTL, NO Elaeocarpus ganitrus, NO mukhi language — Tulsi is a different plant genus entirely. DEPTH RULE (mandatory, applies specifically to "What Seekers Experience" and "Who Should Wear" — see per-section instructions below): these two sections are deep-dive sections, not shallow one-line bullets — each bullet gets a bold lead-in label plus 2-3 full sentences of genuine substance. All other sections stay concise: MAX 4 lines of prose, or a <ul> if more structure helps. Keep total description under 850 words (higher than a typical product page, intentionally, to accommodate the two deep-dive sections). Output clean HTML only. No markdown. No preamble.`
    : `You are a Rudraksha SEO expert writing concise, scannable product descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2>, keyword in first <p> within 100 words, 1–2% density, LSI keywords in every <h3>, no stuffing; (2) E-E-A-T — experience framing ("seekers describe…") for subjective/spiritual claims ONLY, Vedic scripture citations, correct botanical species name for this specific product (see SPECIES block in the user message below — do not assume Elaeocarpus ganitrus by default, some products are a verified different species), zero direct health/benefit claims; (3) Feb 2026 Google Discover — original perspective, depth, clear non-clickbait headings, Indian audience.

LOCKED DEFINITION (mandatory): On first mention of RKRTL anywhere in the output, write it in full exactly as "RKRTL (Kailasha Rudraksha Testing Laboratory)" — this exact string, never paraphrased, never re-expanded, never given an alternate name. Every subsequent mention in the same output may use "RKRTL" alone. Never introduce any other expansion of the acronym in any output, ever.

OPENING PARAGRAPH ORDER (mandatory — this is a purchase-intent page, not an encyclopedia entry): (1) lead with the primary traditional use-case or astrological remedy that drives the purchase — never lead with species/botanical identification; (2) state certification per the LOCKED DEFINITION rule above; (3) origin/species/structural detail comes last, framed as evidence supporting the certification claim. BANNED opening pattern: "The [N] Mukhi Rudraksha is a [N]-faced bead from the Elaeocarpus ganitrus tree…" — do not use this or close variants.

ORIGIN RULE (mandatory — read carefully, this varies per product and is provided per-request below, NOT a fixed site-wide default): the VERIFIED ORIGIN block in the user message states the one correct origin claim for THIS specific product. Use that exact origin consistently everywhere origin is mentioned — intro, meta fields, tags, FAQ. Different products on this site legitimately have different origins (Nepal, South India, Haridwar/Uttarakhand, or Indonesia depending on mukhi count, shape, and whether it's a single bead or mala) — never assume Nepal as a universal default, and never introduce an origin not stated in that block.

SPECIES RULE (mandatory — same principle as ORIGIN RULE above): the SPECIES field in the VERIFIED ORIGIN block states the one correct botanical species for THIS specific product. Most Rudraksha on this site are Elaeocarpus ganitrus, but not all — the 1 Mukhi Half-Moon (Chandrakar) is Elaeocarpus tuberculatus, a genuinely different species, disclosed transparently rather than glossed over. Never assume Elaeocarpus ganitrus as a universal default; always use the exact species stated in that block, including in the RKRTL Authentication/Certification section.

MEASUREMENT ACCURACY RULE (mandatory): Never state a specific bead size (mm) or weight (grams) as fact anywhere in the output — intro, bullets, or FAQ — unless that exact figure appears in CURRENT DESCRIPTION below. Nothing in this prompt is fed real Shopify variant data, so any size/weight you generate is invented, not accurate, and risks contradicting the actual variant the customer selects. If no size/weight appears in CURRENT DESCRIPTION, omit specific measurements entirely and let the product's variant selector convey size instead.

GMC IDENTITY & BELIEF POLICY RULES (critical — violations cause ad restrictions):
- NEVER use deity names (Shiva, Vishnu, Ganesha, Hanuman, Lakshmi, Durga, Parvati, Brahma, Indra, etc.) in H1, H2, or H3 headings
- NEVER use deity names in the opening paragraph (first <p> tag)
- The deity name from VERIFIED MUKHI FACTS MUST appear at least once inside the "Vedic Tradition & Significance" bullets — omitting it entirely defeats the purpose of that section. It must never appear in any heading or in the opening paragraph — only there.
- CRITICAL CLARIFICATION ON DEITY NAMING (read carefully — this is where the model has previously failed): a hedged, traditionally-framed sentence that includes a deity's name IS compliant and IS required. It is NOT the same thing as a banned direct benefit claim. Do not omit a required deity name out of excess caution, especially for deities traditionally associated with wealth, love, or other benefits (e.g. Goddess Mahalakshmi, Kamadeva) — naming them is fine; asserting a guaranteed outcome is not. COMPLIANT (do this): "Seekers traditionally associate the 7 Mukhi with Goddess Mahalakshmi and report keeping it in a cash box or wearing it to support financial stability during difficult periods." NON-COMPLIANT (do not write this): "This bead pleases Goddess Mahalakshmi and attracts wealth and money." The difference is hedging language ("seekers traditionally associate / report") and avoiding absolute guarantees — not the presence or absence of the deity's name itself.
- NEVER write direct spiritual benefit claims like "attracts wealth", "removes negativity", "pleases Lord Shiva", "blesses the wearer" — use "seekers report…" framing only
- Position the product as a natural, scientifically authenticated seed bead — not a religious item

DEPTH RULE (mandatory, applies specifically to "Traditional Benefits" and "Who Should Wear" — see per-section instructions below): these two sections are deep-dive sections, not shallow one-line bullets — each bullet gets a bold lead-in label plus 2-3 full sentences of genuine substance, still hedged per the rules above. All other sections stay concise: MAX 4 lines of prose, or a <ul> if more structure helps. Keep total description under 900 words (higher than a typical product page, intentionally, to accommodate the two deep-dive sections). Output clean HTML only. No markdown. No preamble.`;

  // ── Description user prompt — three-way branch ────────────────────────────
  const descUser = isService
    ? `Write a concise SEO service description for "${product.title}" offered by RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n\nSERVICE CONTEXT:\n- Performed by: MVS Vedapadasala vadhyars, Coimbatore (Ghana Parayana trained)\n- Vadhyars Bhadrinath, Akshai Jayaraman, Harish secured 1st place in VRNT examination by Kanchi Mutt\n- Delivered online — customer books, vadhyars perform, video/photo documentation sent\n- Authentic traditional setting — real padashaala, not studio\n\nSTRUCTURE:\n<h2>${product.title} — Online Vedic Service by MVS Vedapadasala</h2>\n<p>[2–3 sentences: what this service is, who performs it, spiritual purpose]</p>\n<h3>Vedic Significance of ${product.title}</h3>\n[MAX 4 lines: scriptural basis, deity invoked, spiritual purpose]\n<h3>What You Receive — Complete Service Inclusions</h3>\n<ul>[4–5 bullets: performance by trained vadhyars, video/photo documentation, personalised sankalpa, date flexibility, prasad dispatch if applicable]</ul>\n<h3>Performed by MVS Vedapadasala — Authentic Coimbatore Vadhyars</h3>\n[2–3 lines: Ghana Parayana training, Kanchi Mutt VRNT 1st place, real padashaala environment]\n<h3>Who Should Book ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word devotee-profile label]:</strong> [2-3 full sentences, ~35-55 words, describing the life situation or need and why this service fits it]</li> — ideal devotee profiles, e.g. "Those seeking…", "Families facing…"]</ul>\n<h3>How to Book Your ${product.title}</h3>\n<ul>[4 bullets: step-by-step — select date, provide sankalpa details, vadhyars perform, receive documentation]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n[4 FAQs covering: how the online service works, vadhyar credentials, what is delivered, booking customisation. MANDATORY EXACT HTML TEMPLATE — repeat this block once per question, numbered 1-4; do NOT use <dl>/<dt>/<dd> tags, they render as an undifferentiated wall of text on this theme (no CSS styles them distinctly):\n<div style="margin-bottom:20px"><p style="font-weight:bold;margin:0 0 6px 0">1. [Question]</p><p style="margin:0">[Answer]</p></div>]\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>. Service content only — no bead/certification language.`
    : isKarungali
    ? `Write a concise SEO product description for "${product.title}" on RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n\nPRODUCT CONTEXT:\n- Material: Karungali (Ebony) wood — botanical name Diospyros ebenum\n- Origin: Tamil Nadu, South India — deeply rooted in Shaiva Siddhanta tradition\n- Authentication: Visual grain pattern inspection, wood density verification, species identification — NOT X-ray\n- Associated deity: Lord Shani (Saturn) — primary; also used for protection and grounding\n- Traditional use: Japa mala, daily wear, protection against negative energies\n\nSTRUCTURE:\n<h2>${product.title} — Authentic Karungali Ebony Wood from Tamil Nadu</h2>\n<p>[2–3 sentences: keyword in first sentence, material, traditional significance, seeker hook]</p>\n<h3>Significance of Karungali (Ebony) Wood in Shaiva Tradition</h3>\n[MAX 4 lines: Diospyros ebenum botanical name, Shaiva Siddhanta, Shani connection, Tamil Nadu heritage]\n<h3>What Seekers Experience with ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word benefit-topic label]:</strong> [2-3 full sentences, ~35-55 words, hedged with "seekers report/describe" — never a direct claim]</li> — covering grounding, focus, protection, Shani remediation]</ul>\n<h3>How Karungali Wood is Authenticated at RudraKailash</h3>\n[2–3 lines: species identification by grain pattern and wood density, Diospyros ebenum confirmed, sourced from certified artisans — NO X-ray language, NO RKRTL]\n<h3>Who Should Wear ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word seeker-profile label]:</strong> [2-3 full sentences, ~35-55 words]</li> — seeker profiles: Shani Mahadasha, Saturn transit, those seeking grounding, daily japa practitioners]</ul>\n<h3>How to Use Your ${product.title} — Wearing and Care</h3>\n<ul>[4–5 bullets: day to begin wearing (Saturday), mantra (Om Sham Shanicharaya Namah), care — no oil, store dry, avoid water immersion]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n[4 FAQs covering: what is karungali, Shani benefits, care, authenticity. MANDATORY EXACT HTML TEMPLATE — repeat this block once per question, numbered 1-4; do NOT use <dl>/<dt>/<dd> tags, they render as an undifferentiated wall of text on this theme (no CSS styles them distinctly):\n<div style="margin-bottom:20px"><p style="font-weight:bold;margin:0 0 6px 0">1. [Question]</p><p style="margin:0">[Answer]</p></div>]\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference only): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>. CRITICAL: No RKRTL, no X-ray, no Elaeocarpus ganitrus — this is WOOD not a Rudraksha bead.`
    : isSphatik
    ? `Write a concise SEO product description for "${product.title}" on RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n\nPRODUCT CONTEXT:\n- Material: Sphatik — natural rock crystal (clear quartz, chemically silicon dioxide)\n- Associated deity/planet: Goddess Lakshmi and the Moon (Chandra) in Vedic tradition\n- Authentication: refractive index testing and/or Mohs hardness testing (natural quartz = 7 on the Mohs scale) — this is a real, verifiable physical test; state it directly and factually, no hedging\n- Traditional use: meditation, purity, clarity, often worn or kept alongside Rudraksha\n- Main fraud risk in this category: glass sold as Sphatik, which is both optically and mechanically softer than genuine quartz — this is precisely what the hardness/refractive-index test distinguishes\n\nSTRUCTURE:\n<h2>${product.title} — Natural Sphatik (Rock Crystal)</h2>\n<p>[2–3 sentences: keyword in first sentence, material (natural rock crystal / clear quartz), traditional significance, seeker hook — NO deity name here]</p>\n<h3>Significance of Sphatik in Vedic Tradition</h3>\n[MAX 4 lines: natural quartz identity, association with Goddess Lakshmi and Chandra, purity/clarity symbolism]\n<h3>What Seekers Experience with ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word benefit-topic label]:</strong> [2-3 full sentences, ~35-55 words, hedged with "seekers report/describe" — never a direct claim]</li> — covering mental clarity, calm, purification]</ul>\n<h3>How Sphatik is Authenticated at RudraKailash</h3>\n[2–3 lines, DIRECT factual language, no hedging: refractive index and/or Mohs hardness testing (natural quartz = 7), distinguishing genuine crystal from glass imitations — NO X-ray, NO RKRTL, NO Elaeocarpus ganitrus]\n<h3>Who Should Wear ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word seeker-profile label]:</strong> [2-3 full sentences, ~35-55 words]</li> — seeker profiles: those seeking clarity, calm, meditation practice]</ul>\n<h3>How to Use Your ${product.title} — Wearing and Care</h3>\n<ul>[4–5 bullets: cleansing (e.g. moonlight, water), storage away from direct sunlight, handling with care as a natural mineral]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n[4 FAQs covering: what Sphatik is, how it's authenticated, who should wear it, care instructions. MANDATORY EXACT HTML TEMPLATE — repeat this block once per question, numbered 1-4; do NOT use <dl>/<dt>/<dd> tags, they render as an undifferentiated wall of text on this theme (no CSS styles them distinctly):\n<div style="margin-bottom:20px"><p style="font-weight:bold;margin:0 0 6px 0">1. [Question]</p><p style="margin:0">[Answer]</p></div>]\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference only): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>. CRITICAL: No RKRTL, no X-ray, no Elaeocarpus ganitrus, no mukhi/face-count language — this is a MINERAL not a Rudraksha bead.`
    : isTulsi
    ? `Write a concise SEO product description for "${product.title}" on RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n\nPRODUCT CONTEXT:\n- Material: Tulsi (Holy Basil) — botanical name Ocimum tenuiflorum\n- Associated deity: Lord Vishnu and Krishna, Vaishnava tradition\n- Authentication: NONE ESTABLISHED — RudraKailash does not currently have a verified testing/authentication method for Tulsi. Do NOT invent, imply, or reference any certification, testing, or verification claim (no "RKRTL," no "certified," no "verified authentic," no "tested"). Describe sourcing plainly instead (e.g. "sourced from Tulsi plants") without attaching an unsupported verification claim.\n- Traditional use: japa mala, daily wear, Vaishnava devotional practice\n\nSTRUCTURE:\n<h2>${product.title} — Sacred Tulsi (Holy Basil) Mala</h2>\n<p>[2–3 sentences: keyword in first sentence, material (Ocimum tenuiflorum / Holy Basil), traditional significance, seeker hook — NO deity name here, NO authentication/certification claim of any kind]</p>\n<h3>Significance of Tulsi in Vaishnava Tradition</h3>\n[MAX 4 lines: Ocimum tenuiflorum botanical name, Vishnu/Krishna association, devotional significance]\n<h3>What Seekers Experience with ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word benefit-topic label]:</strong> [2-3 full sentences, ~35-55 words, hedged with "seekers report/describe" — never a direct claim]</li> — covering devotional focus, purity, daily practice support]</ul>\n<h3>Sourcing of ${product.title}</h3>\n[2–3 lines: plainly describe sourcing (e.g. from Tulsi plants) — DO NOT claim any authentication, testing, or certification process, since none is currently established for this product]\n<h3>Who Should Wear ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word seeker-profile label]:</strong> [2-3 full sentences, ~35-55 words]</li> — seeker profiles: Vaishnava devotees, daily japa practitioners]</ul>\n<h3>How to Use Your ${product.title} — Wearing and Care</h3>\n<ul>[4–5 bullets: traditional wearing guidance, care — no chemicals, keep dry]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n[4 FAQs covering: what Tulsi mala is, its significance, who should wear it, care instructions. Do NOT include a question about authentication/certification, since none exists for this product. MANDATORY EXACT HTML TEMPLATE — repeat this block once per question, numbered 1-4; do NOT use <dl>/<dt>/<dd> tags, they render as an undifferentiated wall of text on this theme (no CSS styles them distinctly):\n<div style="margin-bottom:20px"><p style="font-weight:bold;margin:0 0 6px 0">1. [Question]</p><p style="margin:0">[Answer]</p></div>]\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference only): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>. CRITICAL: No RKRTL, no X-ray, no Elaeocarpus ganitrus, no mukhi language, and absolutely NO authentication/certification/testing claim of any kind — this is WOOD not a Rudraksha bead, and no verification process currently exists for it.`
    : `Write a concise SEO product description for "${product.title}" on RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n${originBlock}\n${mukhiFactsBlock}\nSTRUCTURE:\n<h2>${product.title} — Authentic RKRTL-Certified Rudraksha Bead</h2>\n<p>[2–3 sentences, IN THIS ORDER per the OPENING PARAGRAPH ORDER rule above: (1) primary traditional use-case / astrological remedy driving the purchase; (2) certification, first mention written in full per the LOCKED DEFINITION rule; (3) origin/species as supporting evidence, using the VERIFIED ORIGIN above — not a generic Nepal assumption]</p>\n<h3>Spiritual Significance of ${product.title} in Vedic Tradition</h3>\n[MAX 4 lines or <ul>: use the VERIFIED MUKHI FACTS above exactly — ruling deity, scripture references, mantra, planet, chakra. The deity name MUST appear at least once here (this is the one section it belongs in). Do not substitute a different deity, planet, or chakra than the one given.]\n<h3>Traditional Benefits Associated with ${product.title}</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word benefit-topic label]:</strong> [2-3 full sentences, ~35-55 words]</li>, one per seeker situation. Each bullet: hedge with "seekers report/describe" (required, no direct claims), THEN anchor it to one named specific from the VERIFIED MUKHI FACTS above — the scripture, mantra, planet, or chakra given, not an invented alternative. BANNED: a hedge with no named specific attached, e.g. "seekers report enhanced focus" alone. If a Traditional Use-Case Note is present above, one bullet MUST cover it in this same depth — this is a primary purchase driver for this product and must not be dropped or shortened.]</ul>\n<h3>RKRTL Certification — Verified Authentic ${product.title}</h3>\n[2–3 lines: X-ray imaging + microscopy, confirming the exact species stated in the SPECIES block above (do not default to "Elaeocarpus ganitrus confirmed" if a different species is verified there), certificate issued — do NOT include any verify/certificate links]\n<h3>Who Should Buy ${product.title} — Ideal Seekers</h3>\n<ul>[4–5 bullets, DEEP-DIVE FORMAT: each bullet is <li><strong>[3-6 word seeker-profile label]:</strong> [2-3 full sentences, ~35-55 words describing the seeker situation/life stage and, where natural, connecting back to the product's traditional association]</li>]</ul>\n<h3>How to Wear Your ${product.title} — Day, Mantra and Method</h3>\n<ul>[4–5 bullets: day to begin, thread/metal, mantra (use the VERIFIED MUKHI FACTS mantra), energisation steps]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n[4 FAQs, one of which MUST cover origin using the VERIFIED ORIGIN above exactly — never default to Nepal if the block above states a different origin. MANDATORY EXACT HTML TEMPLATE — repeat this block once per question, numbered 1-4; do NOT use <dl>/<dt>/<dd> tags, they render as an undifferentiated wall of text on this theme (no CSS styles them distinctly):\n<div style="margin-bottom:20px"><p style="font-weight:bold;margin:0 0 6px 0">1. [Question]</p><p style="margin:0">[Answer]</p></div>]\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference only): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>.`;

  // ── Meta & Tags prompts — three-way branch ────────────────────────────────
  const metaTitleUser = isService
    ? `Write a meta title for "${product.title}" service on RudraKailash.com. Max 60 chars. Include service keyword + "RudraKailash". Do NOT mention RKRTL or certification.`
    : isKarungali
    ? `Write a meta title for "${product.title}" on RudraKailash.com. Max 60 chars. Include "Karungali" or "Ebony" + "RudraKailash". Do NOT mention RKRTL or X-ray.`
    : isSphatik
    ? `Write a meta title for "${product.title}" on RudraKailash.com. Max 60 chars. Include "Sphatik" or "Crystal" + "Natural" + "RudraKailash". Do NOT mention RKRTL or X-ray.`
    : isTulsi
    ? `Write a meta title for "${product.title}" on RudraKailash.com. Max 60 chars. Include "Tulsi" + "Sacred" or "Holy" + "RudraKailash". Do NOT mention RKRTL, X-ray, "certified," or "verified" — no authentication method is established for this product.`
    : `Write a meta title for "${product.title}" on RudraKailash.com. LOCKED FORMAT — use this exact template, substituting only the mukhi/product name and the origin word, with identical wording and identical pipe spacing every time: "{Product Name} | Natural {Origin} Bead | RKRTL Certified | RudraKailash". The {Origin} word MUST be exactly this: "${origin && origin.metaShort ? origin.metaShort : "[no verified origin — omit the origin word and adjust template to \"Natural Bead\" instead]"}" — do not substitute "Nepali" or any other origin word regardless of what seems typical for Rudraksha in general; this product's verified origin is what's stated here. Example for a Nepal-origin product: "7 Mukhi Rudraksha | Natural Nepali Bead | RKRTL Certified | RudraKailash". Do not deviate from this template, add extra words, or reorder segments. Expected length is approximately 70-73 characters — this is intentional, do not shorten it to fit under 60.`;

  const metaDescUser = isService
    ? `Write a meta description for "${product.title}" service on RudraKailash.com. 145–155 characters. Mention MVS Vedapadasala vadhyars, authentic Vedic tradition, and include a booking CTA. Do NOT mention RKRTL.`
    : isKarungali
    ? `Write a meta description for "${product.title}" on RudraKailash.com. 145–155 characters. Mention authentic Karungali ebony wood, Tamil Nadu origin, Shani remedy, and include a buy CTA. Do NOT mention RKRTL or X-ray certification.`
    : isSphatik
    ? `Write a meta description for "${product.title}" on RudraKailash.com. 145–155 characters. Mention natural Sphatik (rock crystal), hardness/refractive-index verification, purity/clarity significance, and include a buy CTA. Do NOT mention RKRTL or X-ray.`
    : isTulsi
    ? `Write a meta description for "${product.title}" on RudraKailash.com. 145–155 characters. Mention sacred Tulsi (Holy Basil), Vaishnava devotional significance, and include a buy CTA. Do NOT mention RKRTL, X-ray, "certified," or "verified" — no authentication method is established for this product.`
    : `Write a meta description for "${product.title}" on RudraKailash.com. Approximately 145–160 characters. Structure: [mukhi count + origin] + [RKRTL X-ray certified] + [unique benefit in neutral language] + [CTA: Shop/Buy/Order]. ${originBlock}Use that exact origin word/phrase in the description — do not substitute "Nepali" if a different origin is verified above. NEVER state a specific bead size in mm — natural size ranges vary widely by mukhi count and origin and current inventory varies by batch, so any invented mm figure risks being factually wrong. STRICT RULES: NO deity names. NO spiritual benefit claims like "attracts wealth" or "removes negativity". Position as a certified natural bead. Example structure (Nepal-origin product): "Genuine Nepali 5 Mukhi Rudraksha, RKRTL X-ray certified for authenticity. Worn for clarity and calm. Buy authentic — RudraKailash."`;

  const tagsUser = isService
    ? `Generate 10–12 Shopify product tags for the "${product.title}" service on RudraKailash.com. Current tags: "${product.tags||"none"}". Include: online puja, vedic service, MVS Vedapadasala, homa/puja type, coimbatore vadhyar, authentic vedic ritual, book online.`
    : isKarungali
    ? `Generate 10–12 Shopify product tags for "${product.title}" on RudraKailash.com. Current tags: "${product.tags||"none"}". Include: karungali, ebony mala, karungali mala, diospyros ebenum, shani remedy, saturn remedy, karungali bracelet, authentic ebony, tamil nadu, shaiva tradition, wood mala, protection mala.`
    : isSphatik
    ? `Generate 10–12 Shopify product tags for "${product.title}" on RudraKailash.com. Current tags: "${product.tags||"none"}". Include: sphatik, natural crystal, rock crystal, clear quartz, sphatik mala, lakshmi crystal, moon crystal, meditation crystal, purity stone, natural sphatik. No RKRTL or X-ray tags.`
    : isTulsi
    ? `Generate 10–12 Shopify product tags for "${product.title}" on RudraKailash.com. Current tags: "${product.tags||"none"}". Include: tulsi, tulsi mala, holy basil, ocimum tenuiflorum, vaishnav mala, krishna tulsi, japa mala, sacred tulsi, devotional mala. No RKRTL, X-ray, "certified," or "verified" tags — no authentication method is established for this product.`
    : `Generate 10–12 Shopify product tags for "${product.title}". Current tags: "${product.tags||"none"}". Include mukhi number variants, rudraksha, RKRTL, certified, authentic, and relevant spiritual keywords. ${originBlock}Include an origin-specific tag matching that exact origin (e.g. "south indian rudraksha", "haridwar rudraksha", "indonesian rudraksha", or "nepali rudraksha" — whichever matches the VERIFIED ORIGIN above) — do not default to a Nepal tag if a different origin is verified.`;

  const faqUser = isService
    ? `Generate 6 voice-search FAQ pairs for the "${product.title}" service on RudraKailash.com.\n\nRules:\n- Natural spoken language questions\n- Answers 80-150 words, fully self-contained so each one stands alone as a citable passage — no dangling references to "as mentioned above"\n- Include: what the service is, who performs it (MVS Vedapadasala), how online delivery works, credentials (Kanchi Mutt VRNT), who should book, how to book\n- NO RKRTL certification language — this is a service not a product\n\nOutput ONLY JSON: [{"q":"Question?","a":"Answer, 80-150 words."},...] 6 items.`
    : isKarungali
    ? `Generate 6 voice-search FAQ pairs for "${product.title}" on RudraKailash.com.\n\nRules:\n- Natural spoken language questions\n- Answers 80-150 words, fully self-contained\n- Include: what karungali (ebony) wood is, Diospyros ebenum botanical identity, Shani/Saturn connection, Tamil Nadu/Shaiva Siddhanta origin, how authenticity is verified, care instructions\n- Authentication is by wood grain pattern, density, and species identification — NEVER X-ray, NEVER RKRTL, NEVER Elaeocarpus ganitrus — this is WOOD, not Rudraksha\n\nOutput ONLY JSON: [{"q":"Question?","a":"Answer, 80-150 words."},...] 6 items.`
    : isSphatik
    ? `Generate 6 voice-search FAQ pairs for "${product.title}" on RudraKailash.com.\n\nRules:\n- Natural spoken language questions\n- Answers 80-150 words, fully self-contained\n- Include: what Sphatik (natural rock crystal) is, its Vedic significance (Lakshmi, Chandra), how it's authenticated (refractive index / Mohs hardness testing — natural quartz = 7), who should wear it, care instructions\n- NEVER X-ray, NEVER RKRTL, NEVER Elaeocarpus ganitrus, NEVER mukhi language — this is a MINERAL, not Rudraksha\n\nOutput ONLY JSON: [{"q":"Question?","a":"Answer, 80-150 words."},...] 6 items.`
    : isTulsi
    ? `Generate 6 voice-search FAQ pairs for "${product.title}" on RudraKailash.com.\n\nRules:\n- Natural spoken language questions\n- Answers 80-150 words, fully self-contained\n- Include: what Tulsi (Holy Basil / Ocimum tenuiflorum) mala is, Vaishnava significance, who should wear it, care instructions\n- CRITICAL: no authentication/testing/certification method is established for this product — do NOT include a question about authenticity verification, and do NOT reference RKRTL, "certified," or "verified" anywhere\n- NEVER X-ray, NEVER Elaeocarpus ganitrus, NEVER mukhi language — this is a different plant genus entirely, not Rudraksha\n\nOutput ONLY JSON: [{"q":"Question?","a":"Answer, 80-150 words."},...] 6 items.`
    : `Generate 6 voice-search FAQ pairs for "${product.title}" Rudraksha bead on RudraKailash.com.\n\n${originBlock}\n${mukhiFactsBlock}\nRules:\n- Natural spoken language questions\n- Answers 80-150 words, fully self-contained so each one stands alone as a citable passage — no dangling references to "as mentioned above"\n- Include: what it is, who should wear it, how to wear it, RKRTL authentication process, botanical species (per the SPECIES block above), buying advice\n- If any answer touches origin, it MUST use the exact origin from the VERIFIED ORIGIN block above — do not default to Nepal or invent an alternate origin if a different one is stated there, and never state two different origins across different answers\n- If any answer touches botanical species, it MUST use the exact species from the SPECIES block above — do not default to Elaeocarpus ganitrus if a different species is stated there\n- If any answer touches deity, planet, chakra, or mantra, it MUST match the VERIFIED MUKHI FACTS above exactly — do not substitute or invent an alternative\n- Use "seekers report" framing — no direct benefit claims\n- If RKRTL is mentioned, expand it on first use exactly as "RKRTL (Kailasha Rudraksha Testing Laboratory)" — never any other expansion\n- NEVER state a specific bead size in mm or weight in grams in any answer\n\nOutput ONLY JSON: [{"q":"Question?","a":"Answer, 80-150 words."},...] 6 items.`;

  const [description, metaTitle, metaDesc, tags, faq] = await Promise.allSettled([
    callClaude(descSystem, descUser, 4000),
    callClaude(`SEO specialist. Output ONLY the meta title text. No quotes. No explanation.`, metaTitleUser),
    callClaude(`SEO specialist. Output ONLY the meta description text. No quotes. No explanation.`, metaDescUser),
    callClaude(`Shopify SEO expert. Output ONLY comma-separated tags. No explanation.`, tagsUser),
    callClaude(`Voice search SEO expert. Output ONLY valid JSON array. No markdown.`, faqUser, 2200),
  ]);

  let faqs = [];
  if (faq.status === "fulfilled") {
    try { faqs = JSON.parse(extractJsonValue(faq.value)); }
    catch (e) { console.warn("FAQ JSON parse failed:", e.message, "— raw response (first 300 chars):", faq.value.slice(0, 300)); faqs = []; }
  }

  const result = {
    description: description.status === "fulfilled" ? reformatFaqSection(ensureDeityPresent(description.value, mukhiFacts, product.title)) : "<p>Generation failed. Please re-run the agent.</p>",
    metaTitle:   metaTitle.status   === "fulfilled" ? metaTitle.value   : product.title,
    metaDesc:    metaDesc.status    === "fulfilled" ? metaDesc.value    : "",
    tags:        tags.status        === "fulfilled" ? tags.value        : product.tags || "",
    faqs,
  };

  [description, metaTitle, metaDesc, tags, faq].forEach((r, i) => {
    if (r.status === "rejected") console.error(`❌ Agent ${["description","metaTitle","metaDesc","tags","faq"][i]} failed:`, r.reason?.message || r.reason);
  });

  const keywords = loadKeywords();
  if (!keywords[product.id]) {
    keywords[product.id] = { productId: product.id, productTitle: product.title, keyword: autoKeyword(product.title), isCustom: false, addedAt: new Date().toISOString() };
    saveKeywords(keywords);
    console.log(`📊 Auto-registered for rank tracking: ${product.title}`);
  }

  const scoreBefore = scoreSEO(product.metafields_global_title_tag, product.metafields_global_description_tag, product.tags, product.body_html, isService, isKarungali, isSphatik, isTulsi);
  const scoreAfter  = scoreSEO(result.metaTitle, result.metaDesc, result.tags, result.description, isService, isKarungali, isSphatik, isTulsi);
  console.log(`✅ ${product.title}: ${scoreBefore} → ${scoreAfter}`);
  return { ...result, scoreBefore, scoreAfter };
}

app.get("/approve/:token", async (req, res) => {
  const approval = pendingApprovals.get(req.params.token);
  if (!approval) return res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;padding:40px;border:1px solid #7B1C1C;border-radius:12px;background:#1A0A00;"><div style="font-size:48px">❌</div><h2 style="color:#F08080;margin:16px 0">Link Expired</h2><p style="color:#9A7050">This approval link has expired or was already used.</p></div></body></html>`);
  try {
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${approval.productId}.json`, { method:"PUT", headers:{"X-Shopify-Access-Token":storedAccessToken,"Content-Type":"application/json"}, body:JSON.stringify({product:{id:approval.productId,...approval.payload}}) });
    const data = await shopifyRes.json();
    pendingApprovals.delete(req.params.token);
    if (shopifyRes.ok) {
      res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;max-width:500px"><div style="font-size:48px">✅</div><h2 style="color:#F0C84A;margin:16px 0">Pushed!</h2><p style="color:#9A7050"><strong style="color:#F5E6C8">${approval.productTitle}</strong> is live on RudraKailash.com</p><p style="color:#9A7050;margin-top:12px;font-size:13px">SEO: ${approval.scoreBefore} → ${approval.scoreAfter} (+${approval.scoreAfter-approval.scoreBefore} pts)</p></div></body></html>`);
    } else throw new Error(JSON.stringify(data));
  } catch (err) {
    res.send(`<html><body style="font-family:sans-serif;background:#0D0500;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;padding:40px;border:1px solid #7B1C1C;border-radius:12px;background:#1A0A00;"><div style="font-size:48px">❌</div><h2 style="color:#F08080">Push Failed</h2><p style="color:#9A7050">${err.message}</p></div></body></html>`);
  }
});

function buildApprovalEmail(results, triggerType) {
  const totalProducts = results.length;
  const avgBefore = Math.round(results.reduce((s,r) => s+r.scoreBefore, 0) / totalProducts);
  const avgAfter  = Math.round(results.reduce((s,r) => s+r.scoreAfter,  0) / totalProducts);
  const triggered = triggerType==="webhook" ? "New Product Added" : triggerType==="manual" ? "Manual Trigger" : "Weekly Scheduled Run";
  const productRows = results.map(r => {
    const approvalToken = generateApprovalToken();
    pendingApprovals.set(approvalToken, { productId:r.productId, productTitle:r.productTitle, payload:r.payload, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, createdAt:new Date() });
    return `<tr style="border-bottom:1px solid #2E1500"><td style="padding:12px 16px;color:#F5E6C8;font-size:13px">${r.productTitle}</td><td style="padding:12px 16px;text-align:center;color:#F08080;font-weight:bold">${r.scoreBefore}</td><td style="padding:12px 16px;text-align:center;color:#7FD48A;font-weight:bold">${r.scoreAfter}</td><td style="padding:12px 16px;text-align:center;color:#F0C84A;font-weight:bold">+${r.scoreAfter-r.scoreBefore}</td><td style="padding:12px 16px;text-align:center"><a href="${APP_URL}/approve/${approvalToken}" style="background:#D4A017;color:#0D0500;padding:6px 16px;border-radius:5px;text-decoration:none;font-size:12px;font-weight:bold">✓ Approve &amp; Push</a></td></tr>`;
  }).join("");
  // FAQ section — rendered separately from the product table since FAQs don't
  // push to Shopify product fields directly (they're for Schema Plus, which
  // still needs the CSV attachment / manual upload step) — this just makes
  // the generated Q&A pairs visible in the email itself, rather than only
  // reachable by opening the manual /seo UI tool.
  const faqBlocks = results.filter(r => r.faqs && r.faqs.length > 0).map(r => {
    const qas = r.faqs.map((f,i) => `<div style="margin-bottom:12px"><p style="color:#F0C84A;font-size:12px;font-weight:bold;margin:0 0 4px 0">${i+1}. ${escapeFaqText(f.q)}</p><p style="color:#9A7050;font-size:12px;margin:0;line-height:1.5">${escapeFaqText(f.a)}</p></div>`).join("");
    return `<div style="background:#120600;border:1px solid #2E1500;border-radius:8px;padding:16px 18px;margin-bottom:12px"><div style="color:#F5E6C8;font-size:13px;font-weight:bold;margin-bottom:10px">${r.productTitle}</div>${qas}</div>`;
  }).join("");
  const faqSection = faqBlocks ? `<div style="margin-top:24px"><div style="color:#9A7050;font-size:11px;letter-spacing:1px;margin-bottom:12px">GENERATED FAQ — COPY TO SCHEMA PLUS</div>${faqBlocks}</div>` : "";
  const bulkToken = generateApprovalToken();
  pendingApprovals.set("bulk_" + bulkToken, { isBulk: true, productTokens: results.map(r => [...pendingApprovals.entries()].find(([k, v]) => !v.isBulk && v.productId === r.productId && v.productTitle === r.productTitle)?.[0]).filter(Boolean), createdAt: new Date() });
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif"><div style="max-width:680px;margin:0 auto;padding:32px 20px"><div style="text-align:center;margin-bottom:32px"><div style="font-size:36px">ॐ</div><h1 style="color:#F0C84A;font-size:22px;margin:0">RudraKailash SEO Agent</h1><p style="color:#9A7050;font-size:13px;margin:4px 0">Automated Optimisation Report · ${triggered}</p><p style="color:#5A3020;font-size:12px">${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p></div><div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:20px;margin-bottom:24px"><table width="100%"><tr><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">PRODUCTS</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">${totalProducts}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG BEFORE</div><div style="color:#F08080;font-size:28px;font-weight:bold">${avgBefore}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG AFTER</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${avgAfter}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">IMPROVEMENT</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">+${avgAfter-avgBefore}</div></td></tr></table></div><div style="text-align:center;margin-bottom:20px"><a href="${APP_URL}/approve-all/${bulkToken}" style="display:inline-block;background:#D4A017;color:#0D0500;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:0.5px">🔱 Bulk Approve All ${totalProducts} Products</a><p style="color:#5A3020;font-size:11px;margin-top:8px">Pushes all AI suggestions live in one click · Cannot be undone</p></div><table style="width:100%;border-collapse:collapse;background:#120600;border:1px solid #2E1500;border-radius:10px;overflow:hidden"><thead><tr style="background:#160800"><th style="padding:10px 16px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">PRODUCT</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">BEFORE</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">AFTER</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GAIN</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">ACTION</th></tr></thead><tbody>${productRows}</tbody></table>${faqSection}<div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #2E1500"><p style="color:#5A3020;font-size:11px">RudraKailash Agentic SEO · Approval links expire in 7 days</p></div></div></body></html>`;
}

app.get("/approve-all/:token", async (req, res) => {
  const bulkKey = "bulk_" + req.params.token;
  const bulk    = pendingApprovals.get(bulkKey);
  if (!bulk || !bulk.isBulk) return res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;padding:40px;border:1px solid #7B1C1C;border-radius:12px;background:#1A0A00;"><div style="font-size:48px">❌</div><h2 style="color:#F08080;margin:16px 0">Link Expired</h2></div></body></html>`);
  let pushed = 0, failed = 0;
  const details = [];
  for (const token of bulk.productTokens) {
    const approval = pendingApprovals.get(token);
    if (!approval) { failed++; continue; }
    try {
      const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${approval.productId}.json`, { method:"PUT", headers:{"X-Shopify-Access-Token":storedAccessToken,"Content-Type":"application/json"}, body:JSON.stringify({ product:{ id:approval.productId, ...approval.payload } }) });
      if (shopifyRes.ok) { pushed++; details.push(`<li style="color:#7FD48A;padding:4px 0">✅ ${approval.productTitle} — SEO: ${approval.scoreBefore} → ${approval.scoreAfter}</li>`); pendingApprovals.delete(token); }
      else { failed++; details.push(`<li style="color:#F08080;padding:4px 0">❌ ${approval.productTitle} — Push failed</li>`); }
    } catch(e) { failed++; details.push(`<li style="color:#F08080;padding:4px 0">❌ ${approval.productTitle} — ${e.message}</li>`); }
    await new Promise(r => setTimeout(r, 500));
  }
  pendingApprovals.delete(bulkKey);
  res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box"><div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;max-width:560px;width:100%"><div style="font-size:48px">🔱</div><h2 style="color:#F0C84A;margin:16px 0">Bulk Push Complete</h2><p style="color:#9A7050;margin-bottom:20px">${pushed} pushed · ${failed} failed</p><ul style="list-style:none;padding:0;margin:0 0 20px;text-align:left;font-size:13px;max-height:400px;overflow-y:auto">${details.join("")}</ul></div></body></html>`);
});

cron.schedule("30 17 * * 0", async () => {
  console.log("⏰ Weekly SEO cron — Sunday 11pm IST");
  if (!storedAccessToken) return;
  try {
    const res      = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
    const data     = await res.json();
    const products = (data.products||[]).filter(p => p.status==="active");
    const results  = [];
    for (const product of products) {
      try {
        const r = await runSEOPipeline(product);
        results.push({ productId:product.id, productTitle:product.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, faqs:r.faqs, payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } });
        await new Promise(r => setTimeout(r, 3000));
      } catch(e) { console.error(`Cron failed for ${product.title}:`, e.message); }
    }
    if (results.length > 0) await sendEmail(`🔱 RudraKailash SEO Weekly Report — ${results.length} products`, buildApprovalEmail(results, "cron"));
  } catch(e) { console.error("Weekly cron error:", e.message); }
}, { timezone: "UTC" });

app.post("/webhooks/products/create", async (req, res) => {
  res.status(200).json({ received: true });
  const product = req.body;
  if (!product?.id) return;
  console.log(`🔔 Webhook: New product — ${product.title}`);
  await new Promise(r => setTimeout(r, 5000));
  try {
    const productRes  = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${product.id}.json?fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
    const fullProduct = (await productRes.json()).product;
    if (!fullProduct) return;
    const r = await runSEOPipeline(fullProduct);
    const results = [{ productId:fullProduct.id, productTitle:fullProduct.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, faqs:r.faqs, payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } }];
    await sendEmail(`🔔 New Product SEO Ready — "${fullProduct.title}"`, buildApprovalEmail(results, "webhook"));
  } catch(e) { console.error("Webhook error:", e.message); }
});

async function registerWebhooks() {
  if (!storedAccessToken) return;
  try {
    const webhookUrl = `${APP_URL}/webhooks/products/create`;
    const listRes    = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
    const listData   = await listRes.json();
    if ((listData.webhooks||[]).find(w => w.address===webhookUrl)) { console.log("✅ Webhook already registered"); return; }
    const createRes  = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, { method:"POST", headers:{"X-Shopify-Access-Token":storedAccessToken,"Content-Type":"application/json"}, body:JSON.stringify({ webhook:{ topic:"products/create", address:webhookUrl, format:"json" } }) });
    const createData = await createRes.json();
    console.log(createData.webhook ? `✅ Webhook registered` : `⚠️  Webhook issue: ${JSON.stringify(createData)}`);
  } catch(e) { console.error("Webhook registration failed:", e.message); }
}

app.post("/cron/trigger", async (req, res) => {
  if (req.query.secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  res.json({ message: "Manual cron triggered — email arriving shortly." });
  setTimeout(async () => {
    try {
      const fetchRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
      const data     = await fetchRes.json();
      const products = (data.products||[]).filter(p => p.status==="active");
      const results  = [];
      for (const product of products) {
        try {
          const r = await runSEOPipeline(product);
          results.push({ productId:product.id, productTitle:product.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, faqs:r.faqs, payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } });
          await new Promise(r => setTimeout(r, 3000));
        } catch(e) { console.error(`Manual cron failed for ${product.title}:`, e.message); }
      }
      if (results.length > 0) await sendEmail(`🔱 RudraKailash SEO Manual Report — ${results.length} products`, buildApprovalEmail(results, "manual"));
    } catch(e) { console.error("Manual cron error:", e.message); }
  }, 100);
});

app.post("/citations/check-all", async (req, res) => {
  if (req.query.secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  const queries = loadCitationQueries();
  const entries = Object.values(queries);
  if (entries.length === 0) return res.json({ message: "No citation queries tracked yet. Add some via POST /citations/queries first." });
  res.json({ message: `Citation check started for ${entries.length} queries — check /citations/dashboard in a minute or two.` });
  setTimeout(async () => {
    for (const entry of entries) { await checkAndStoreCitation(entry); await new Promise(r => setTimeout(r, 3000)); }
    console.log("🔎 Manual citation check-all complete.");
  }, 100);
});

app.get("/citations/dashboard", (req, res) => {
  const citationData = loadCitationData();
  const rows = Object.values(citationData).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  const cards = rows.map(e => {
    const latest = e.history[e.history.length - 1] || {};
    const historyStrip = e.history.slice(-12).map(h => `<span title="${h.date}" style="display:inline-block;width:14px;height:14px;margin-right:2px;border-radius:3px;background:${h.mentioned ? '#7FD48A' : '#F08080'}"></span>`).join("");
    return `<div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:18px 20px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="color:#F5E6C8;font-size:15px;font-weight:bold">${e.label}</div>
        <div style="color:${latest.mentioned ? '#7FD48A' : '#F08080'};font-weight:bold;font-size:13px">${latest.mentioned === undefined ? '— not checked yet' : (latest.mentioned ? '✅ Cited' : '❌ Not cited')}</div>
      </div>
      <div style="color:#9A7050;font-size:12px;margin:6px 0">"${e.query}"</div>
      <div style="margin:8px 0">${historyStrip}<span style="color:#5A3020;font-size:10px;margin-left:6px">last ${e.history.length} checks</span></div>
      ${latest.otherDomains && latest.otherDomains.length ? `<div style="color:#80C0F0;font-size:11px">Also cited: ${latest.otherDomains.join(", ")}</div>` : ""}
    </div>`;
  }).join("") || `<div style="color:#9A7050;text-align:center;padding:40px">No citation checks run yet. POST a query to /citations/queries, then POST /citations/check/:id — or trigger all via POST /citations/check-all?secret=...</div>`;
  res.send(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif"><div style="max-width:760px;margin:0 auto;padding:32px 20px"><div style="text-align:center;margin-bottom:28px"><div style="font-size:36px">ॐ</div><h1 style="color:#F0C84A;font-size:22px;margin:8px 0">LLM Citation Tracker</h1><p style="color:#9A7050;font-size:13px">Checked weekly · Monday 7:30am IST</p></div>${cards}</div></body></html>`);
});

app.listen(PORT, async () => {
  console.log(`🚀 RudraKailash SEO Proxy v8 running on port ${PORT}`);
  console.log(`   Store:         ${SHOPIFY_STORE_DOMAIN}`);
  console.log(`   Token:         ${storedAccessToken ? "✅ Loaded (" + (fs.existsSync(TOKEN_FILE) ? "disk" : "env") + ")" : "⚠️  Not yet"}`);
  console.log(`   Anthropic:     ${process.env.ANTHROPIC_API_KEY ? "✅" : "❌ NOT SET"}`);
  console.log(`   Serper:        ${process.env.SERPER_API_KEY    ? "✅" : "❌ NOT SET"}`);
  console.log(`   Email:         ${process.env.EMAIL_SMTP_USER   ? "✅ " + process.env.EMAIL_SMTP_USER : "❌ NOT SET"}`);
  console.log(`   SEO Tool:      ✅ Served at /seo`);
  console.log(`   Rank Tracking: ✅ Daily 6am IST · Weekly report Monday 7am IST`);
  console.log(`   Citations:     ✅ Weekly Monday 7:30am IST · Dashboard at /citations/dashboard`);
  console.log(`   SEO Cron:      ✅ Sunday 11pm IST`);
  console.log(`   Audit Module:  ${auditModule ? "✅ Loaded" : "⚠️  Not loaded"}`);
  if (storedAccessToken) await registerWebhooks();
});
