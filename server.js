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
// Asks Claude a real target question WITH live web search enabled, then checks
// whether rudrakailash.com actually gets surfaced/cited in the grounded answer,
// and which other domains show up instead. This tests live web-grounded
// citation behavior, not the model's frozen training data — that distinction
// matters because a plain (non-search) call would just reflect Claude's
// knowledge cutoff, not what a real user asking today would actually see.
// Uses the ANTHROPIC_API_KEY already configured — no new API keys/costs.
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

// Weekly (not daily) — each check is a real Claude + web search call, so this
// keeps API cost predictable. Runs Monday 7:30am IST, alongside the existing
// rank report.
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
// Returns true for Karungali (Ebony) wood products — NOT Rudraksha beads
// These get wood-authentication content, NOT RKRTL X-ray language
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
// The prompt has repeatedly failed to reliably include the required deity name
// in the description body — even with an explicit "MUST appear" instruction
// and a worked compliant example, the model still omitted "Mahalakshmi" from
// 7 Mukhi's live output (July 2026). The theory: the system prompt is dense
// with repeated "NEVER use deity names" warnings, and the single positive
// requirement gets drowned out by that volume regardless of wording. Rather
// than keep tuning prompt language against an unreliable behavior, this
// verifies the requirement in code after generation and deterministically
// injects a compliant sentence if the model still dropped it.
function ensureDeityPresent(html, facts, productTitle) {
  if (!facts || !facts.deity || !html) return html;
  // Use the most distinctive word in the deity name for the presence check
  // (e.g. "Mahalakshmi" rather than the generic "Goddess") so a near-miss
  // paraphrase doesn't falsely count as compliant.
  const words = facts.deity.replace(/[()]/g, "").split(/\s+/).filter(w => w.length > 3);
  const checkWord = words[words.length - 1] || facts.deity;
  const escaped = checkWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const present = new RegExp(escaped, "i").test(html);
  if (present) return html;

  console.warn(`⚠️  Deity name "${facts.deity}" missing from generated description for "${productTitle}" — injecting compliant sentence (model failed to follow the MUST-appear rule)`);
  const sentence = `Seekers traditionally associate ${productTitle} with ${facts.deity}${facts.additionalAssociations ? `, ${facts.additionalAssociations}` : ""}.`;

  // Prefer inserting as a new bullet inside the Vedic Tradition & Significance
  // (or Spiritual Significance) <ul>, immediately after its heading.
  const ulRe = /(<h3>(?:Vedic Tradition|Spiritual Significance)[^<]*<\/h3>\s*<ul>)/i;
  if (ulRe.test(html)) return html.replace(ulRe, `$1<li>${sentence}</li>`);

  // Fallback: that section used prose instead of a bullet list — append a
  // sentence directly after its heading.
  const headingRe = /(<h3>(?:Vedic Tradition|Spiritual Significance)[^<]*<\/h3>)/i;
  if (headingRe.test(html)) return html.replace(headingRe, `$1<p>${sentence}</p>`);

  // Last resort: couldn't find the expected section at all — prepend right
  // after the opening <h2> so the fact isn't lost entirely.
  const h2Re = /(<\/h2>)/i;
  if (h2Re.test(html)) return html.replace(h2Re, `$1<p>${sentence}</p>`);
  return html;
}

// ─── SEO Pipeline ─────────────────────────────────────────────────────────────
function cleanAIOutput(text) {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

// Pulls the JSON payload (object OR array) out of a raw model response,
// tolerating any preamble/postamble text the model adds despite "output only
// JSON" instructions, plus ```json code fences. Guards against a class of
// failure that's otherwise silent: a truncated or lightly-annotated response
// makes JSON.parse throw, which an empty catch block previously swallowed
// with zero trace. Used everywhere a model call expects JSON back: keyword
// extraction, gap analysis, FAQ generation, SGE analysis, cannibalization.
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
function scoreSEO(metaTitle, metaDesc, tags, desc, isService = false, isKarungali = false) {
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
  if (isService)   console.log(`🛕 Detected as SERVICE product — using service prompt`);
  if (isKarungali) console.log(`🪵 Detected as KARUNGALI product — using wood auth prompt`);

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

  const isHalfMoon = /half.?moon|1\s*mukhi/i.test(product.title);
  const mukhiFacts = (!isService && !isKarungali) ? getMukhiFacts(product.title) : null;
  const mukhiFactsBlock = buildMukhiFactsBlock(mukhiFacts);
  const selfContainedRule = `SELF-CONTAINED SENTENCE RULE (critical for AI/GEO extraction — this determines whether a passage can be lifted into an AI-generated answer): every bullet and every sentence must pass this test — read alone, with no heading and no surrounding text, does it still make complete sense? Concretely: (1) never open a bullet with a bare fragment like "Ruled by Shani (Saturn)…" — give it an explicit subject, e.g. "${product.title} is traditionally associated with Shani (Saturn)…"; (2) never start a bullet with a bare pronoun ("It…", "This…") with no stated antecedent in the same sentence — restate the product name or "this bead"/"this mala" instead; (3) each bullet must read as a complete, standalone claim understandable with zero prior context, not a continuation of the heading above it.`;
  const kwPlacementInstructions = keywordBrief
    ? `MANDATORY KEYWORD PLACEMENT:\n${keywordBrief}\n\nPLACEMENT RULES:\n- <h2>: Must contain one of the H1 PRIMARY KEYWORDS\n- Opening <p>: Naturally include the primary H1 keyword within first 60 words\n- <h3> headings: Use H2/H3 SUB-TOPIC KEYWORDS as heading phrases where they fit\n- Bullets: Address LONG-TAIL INTENT PHRASES as seeker experience\n- FAQ: Word at least 2 questions using the exact phrasing of LONG-TAIL INTENT phrases\n\n${selfContainedRule}`
    : `KEYWORD GUIDANCE: Use standard SEO keywords appropriate to this product.\n\n${selfContainedRule}`;

  // ── Description system prompt — three-way branch ──────────────────────────
  const descSystem = isService
    ? `You are a Vedic services SEO expert writing concise service page descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2> and opening <p>; (2) E-E-A-T — cite vadhyar credentials, MVS Vedapadasala, Kanchi Mutt VRNT achievement; (3) NO Rudraksha bead language, NO RKRTL certification, NO X-ray testing references — this is a SERVICE not a product. Output clean HTML only. No markdown. No preamble.`
    : isKarungali
    ? `You are a sacred wood jewellery SEO expert writing concise product descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2> and opening <p> within 100 words; (2) E-E-A-T — botanical name Diospyros ebenum, Shaiva Siddhanta tradition, Tamil Nadu heritage, wood grain authentication; (3) STRICT — NO X-ray testing, NO RKRTL certification language, NO Elaeocarpus ganitrus — Karungali is authenticated by botanical species, wood density, and grain pattern, NOT X-ray imaging. LENGTH RULE: Each section MAX 4 lines. Use <ul> if more. Under 600 words. Output clean HTML only. No markdown. No preamble.`
    : `You are a Rudraksha SEO expert writing concise, scannable product descriptions for RudraKailash.com. Rules: (1) SEO — keyword in first <h2>, keyword in first <p> within 100 words, 1–2% density, LSI keywords in every <h3>, no stuffing; (2) E-E-A-T — experience framing ("seekers describe…") for subjective/spiritual claims ONLY, Vedic scripture citations, Elaeocarpus ganitrus botanical name, zero direct health/benefit claims; (3) Feb 2026 Google Discover — original perspective, depth, clear non-clickbait headings, Indian audience.

LOCKED DEFINITION (mandatory): On first mention of RKRTL anywhere in the output, write it in full exactly as "RKRTL (Kailasha Rudraksha Testing Laboratory)" — this exact string, never paraphrased, never re-expanded, never given an alternate name. Every subsequent mention in the same output may use "RKRTL" alone. Never introduce any other expansion of the acronym in any output, ever.

OPENING PARAGRAPH ORDER (mandatory — this is a purchase-intent page, not an encyclopedia entry): (1) lead with the primary traditional use-case or astrological remedy that drives the purchase — never lead with species/botanical identification; (2) state certification per the LOCKED DEFINITION rule above; (3) origin/species/structural detail comes last, framed as evidence supporting the certification claim. BANNED opening pattern: "The [N] Mukhi Rudraksha is a [N]-faced bead from the Elaeocarpus ganitrus tree…" — do not use this or close variants.

MEASUREMENT ACCURACY RULE (mandatory): Never state a specific bead size (mm) or weight (grams) as fact anywhere in the output — intro, bullets, or FAQ — unless that exact figure appears in CURRENT DESCRIPTION below. Nothing in this prompt is fed real Shopify variant data, so any size/weight you generate is invented, not accurate, and risks contradicting the actual variant the customer selects. If no size/weight appears in CURRENT DESCRIPTION, omit specific measurements entirely and let the product's variant selector convey size instead.

GMC IDENTITY & BELIEF POLICY RULES (critical — violations cause ad restrictions):
- NEVER use deity names (Shiva, Vishnu, Ganesha, Hanuman, Lakshmi, Durga, Parvati, Brahma, Indra, etc.) in H1, H2, or H3 headings
- NEVER use deity names in the opening paragraph (first <p> tag)
- The deity name from VERIFIED MUKHI FACTS MUST appear at least once inside the "Vedic Tradition & Significance" bullets — omitting it entirely defeats the purpose of that section. It must never appear in any heading or in the opening paragraph — only there.
- CRITICAL CLARIFICATION ON DEITY NAMING (read carefully — this is where the model has previously failed): a hedged, traditionally-framed sentence that includes a deity's name IS compliant and IS required. It is NOT the same thing as a banned direct benefit claim. Do not omit a required deity name out of excess caution, especially for deities traditionally associated with wealth, love, or other benefits (e.g. Goddess Mahalakshmi, Kamadeva) — naming them is fine; asserting a guaranteed outcome is not. COMPLIANT (do this): "Seekers traditionally associate the 7 Mukhi with Goddess Mahalakshmi and report keeping it in a cash box or wearing it to support financial stability during difficult periods." NON-COMPLIANT (do not write this): "This bead pleases Goddess Mahalakshmi and attracts wealth and money." The difference is hedging language ("seekers traditionally associate / report") and avoiding absolute guarantees — not the presence or absence of the deity's name itself.
- NEVER write direct spiritual benefit claims like "attracts wealth", "removes negativity", "pleases Lord Shiva", "blesses the wearer" — use "seekers report…" framing only
- Position the product as a natural, scientifically authenticated seed bead — not a religious item

LENGTH RULE: Each section MAX 4 lines of prose. If a section needs more than 4 lines, use a <ul> bullet list instead of a paragraph. Keep total description under 600 words. Output clean HTML only. No markdown. No preamble.`;

  // ── Description user prompt — three-way branch ────────────────────────────
  const descUser = isService
    ? `Write a concise SEO service description for "${product.title}" offered by RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n\nSERVICE CONTEXT:\n- Performed by: MVS Vedapadasala vadhyars, Coimbatore (Ghana Parayana trained)\n- Vadhyars Bhadrinath, Akshai Jayaraman, Harish secured 1st place in VRNT examination by Kanchi Mutt\n- Delivered online — customer books, vadhyars perform, video/photo documentation sent\n- Authentic traditional setting — real padashaala, not studio\n\nSTRUCTURE:\n<h2>${product.title} — Online Vedic Service by MVS Vedapadasala</h2>\n<p>[2–3 sentences: what this service is, who performs it, spiritual purpose]</p>\n<h3>Vedic Significance of ${product.title}</h3>\n[MAX 4 lines: scriptural basis, deity invoked, spiritual purpose]\n<h3>What You Receive — Complete Service Inclusions</h3>\n<ul>[4–5 bullets: performance by trained vadhyars, video/photo documentation, personalised sankalpa, date flexibility, prasad dispatch if applicable]</ul>\n<h3>Performed by MVS Vedapadasala — Authentic Coimbatore Vadhyars</h3>\n[2–3 lines: Ghana Parayana training, Kanchi Mutt VRNT 1st place, real padashaala environment]\n<h3>Who Should Book ${product.title}</h3>\n<ul>[4–5 bullets: ideal devotee profiles — "Those seeking…", "Families facing…"]</ul>\n<h3>How to Book Your ${product.title}</h3>\n<ul>[4 bullets: step-by-step — select date, provide sankalpa details, vadhyars perform, receive documentation]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n<dl>[4 FAQs: how the online service works, vadhyar credentials, what is delivered, booking customisation]</dl>\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>. Service content only — no bead/certification language.`
    : isKarungali
    ? `Write a concise SEO product description for "${product.title}" on RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n\nPRODUCT CONTEXT:\n- Material: Karungali (Ebony) wood — botanical name Diospyros ebenum\n- Origin: Tamil Nadu, South India — deeply rooted in Shaiva Siddhanta tradition\n- Authentication: Visual grain pattern inspection, wood density verification, species identification — NOT X-ray\n- Associated deity: Lord Shani (Saturn) — primary; also used for protection and grounding\n- Traditional use: Japa mala, daily wear, protection against negative energies\n\nSTRUCTURE:\n<h2>${product.title} — Authentic Karungali Ebony Wood from Tamil Nadu</h2>\n<p>[2–3 sentences: keyword in first sentence, material, traditional significance, seeker hook]</p>\n<h3>Significance of Karungali (Ebony) Wood in Shaiva Tradition</h3>\n[MAX 4 lines: Diospyros ebenum botanical name, Shaiva Siddhanta, Shani connection, Tamil Nadu heritage]\n<h3>What Seekers Experience with ${product.title}</h3>\n<ul>[4–5 bullets: "Seekers report…" — grounding, focus, protection, Shani remediation — NO direct claims]</ul>\n<h3>How Karungali Wood is Authenticated at RudraKailash</h3>\n[2–3 lines: species identification by grain pattern and wood density, Diospyros ebenum confirmed, sourced from certified artisans — NO X-ray language, NO RKRTL]\n<h3>Who Should Wear ${product.title}</h3>\n<ul>[4–5 bullets: seeker profiles — Shani Mahadasha, Saturn transit, those seeking grounding, daily japa practitioners]</ul>\n<h3>How to Use Your ${product.title} — Wearing and Care</h3>\n<ul>[4–5 bullets: day to begin wearing (Saturday), mantra (Om Sham Shanicharaya Namah), care — no oil, store dry, avoid water immersion]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n<dl>[4 FAQs in <dt><strong>1. Question</strong></dt><dd>Answer</dd> format — cover: what is karungali, Shani benefits, care, authenticity]</dl>\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference only): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>. CRITICAL: No RKRTL, no X-ray, no Elaeocarpus ganitrus — this is WOOD not a Rudraksha bead.`
    : `Write a concise SEO product description for "${product.title}" on RudraKailash.com.\n\nMAIN KEYWORD: ${product.title}\n${isHalfMoon ? `SPECIAL NOTE — 1 Mukhi Half Moon: This is a South Indian Rudraksha (not Nepali). The round 1 Mukhi Nepali bead is virtually non-existent today. The Half Moon form from South India is the authentic, scripturally valid form of 1 Mukhi available. Present this positively — it IS the genuine option.\n` : ""}\n${mukhiFactsBlock}\nSTRUCTURE:\n<h2>${product.title} — Authentic RKRTL-Certified Rudraksha Bead</h2>\n<p>[2–3 sentences, IN THIS ORDER per the OPENING PARAGRAPH ORDER rule above: (1) primary traditional use-case / astrological remedy driving the purchase; (2) certification, first mention written in full per the LOCKED DEFINITION rule; (3) origin/species as supporting evidence]</p>\n<h3>Spiritual Significance of ${product.title} in Vedic Tradition</h3>\n[MAX 4 lines or <ul>: use the VERIFIED MUKHI FACTS above exactly — ruling deity, scripture references, mantra, planet, chakra. The deity name MUST appear at least once here (this is the one section it belongs in). Do not substitute a different deity, planet, or chakra than the one given.]\n<h3>Traditional Benefits Associated with ${product.title}</h3>\n<ul>[4–5 bullets, one per seeker situation. Each bullet: hedge with "seekers report/describe" (required, no direct claims), THEN anchor it in the same sentence to one named specific from the VERIFIED MUKHI FACTS above — the scripture, mantra, planet, or chakra given, not an invented alternative. BANNED: a hedge with no named specific attached, e.g. "seekers report enhanced focus" alone. If a Traditional Use-Case Note is present above, one bullet MUST cover it — this is a primary purchase driver for this product and must not be dropped.]</ul>\n<h3>RKRTL Certification — Verified Authentic ${product.title}</h3>\n[2–3 lines: X-ray imaging + microscopy, Elaeocarpus ganitrus confirmed, certificate issued — do NOT include any verify/certificate links]\n<h3>Who Should Buy ${product.title} — Ideal Seekers</h3>\n<ul>[4–5 bullets: seeker profiles]</ul>\n<h3>How to Wear Your ${product.title} — Day, Mantra and Method</h3>\n<ul>[4–5 bullets: day to begin, thread/metal, mantra (use the VERIFIED MUKHI FACTS mantra), energisation steps]</ul>\n<h3>Frequently Asked Questions About ${product.title}</h3>\n<dl>[4 FAQs in <dt><strong>1. Question</strong></dt><dd>Answer</dd> format]</dl>\n\n${kwPlacementInstructions}\n\nCONTENT GAPS TO COVER: ${gapSummary}\nCURRENT DESCRIPTION (for reference only): ${descPlain}\n\nOUTPUT: Clean HTML only, starting with <h2>.`;

  // ── Meta & Tags prompts — three-way branch ────────────────────────────────
  const metaTitleUser = isService
    ? `Write a meta title for "${product.title}" service on RudraKailash.com. Max 60 chars. Include service keyword + "RudraKailash". Do NOT mention RKRTL or certification.`
    : isKarungali
    ? `Write a meta title for "${product.title}" on RudraKailash.com. Max 60 chars. Include "Karungali" or "Ebony" + "RudraKailash". Do NOT mention RKRTL or X-ray.`
    : `Write a meta title for "${product.title}" on RudraKailash.com. LOCKED FORMAT — use this exact template for every single-mukhi Rudraksha product, substituting only the mukhi number, with identical wording and identical pipe spacing every time: "{N} Mukhi Rudraksha | Natural Nepali Bead | RKRTL Certified | RudraKailash". Example for 7 Mukhi: "7 Mukhi Rudraksha | Natural Nepali Bead | RKRTL Certified | RudraKailash". Do not deviate from this template, add extra words, or reorder segments. Expected length is approximately 70-73 characters — this is intentional, do not shorten it to fit under 60.`;

  const metaDescUser = isService
    ? `Write a meta description for "${product.title}" service on RudraKailash.com. 145–155 characters. Mention MVS Vedapadasala vadhyars, authentic Vedic tradition, and include a booking CTA. Do NOT mention RKRTL.`
    : isKarungali
    ? `Write a meta description for "${product.title}" on RudraKailash.com. 145–155 characters. Mention authentic Karungali ebony wood, Tamil Nadu origin, Shani remedy, and include a buy CTA. Do NOT mention RKRTL or X-ray certification.`
    : `Write a meta description for "${product.title}" on RudraKailash.com. Approximately 145–160 characters. Structure: [mukhi count + Nepali/Indonesian origin, e.g. "Genuine Nepali 7 Mukhi Rudraksha"] + [RKRTL X-ray certified] + [unique benefit in neutral language] + [CTA: Shop/Buy/Order]. NEVER state a specific bead size in mm — natural size ranges vary widely by mukhi count and origin (e.g. Nepali 7 Mukhi typically runs 15-30mm depending on the specimen) and current inventory varies by batch, so any invented mm figure risks being factually wrong. STRICT RULES: NO deity names. NO spiritual benefit claims like "attracts wealth" or "removes negativity". Position as a certified natural bead. Example structure: "Genuine Nepali 5 Mukhi Rudraksha, RKRTL X-ray certified for authenticity. Worn for clarity and calm. Buy authentic — RudraKailash."`;

  const tagsUser = isService
    ? `Generate 10–12 Shopify product tags for the "${product.title}" service on RudraKailash.com. Current tags: "${product.tags||"none"}". Include: online puja, vedic service, MVS Vedapadasala, homa/puja type, coimbatore vadhyar, authentic vedic ritual, book online.`
    : isKarungali
    ? `Generate 10–12 Shopify product tags for "${product.title}" on RudraKailash.com. Current tags: "${product.tags||"none"}". Include: karungali, ebony mala, karungali mala, diospyros ebenum, shani remedy, saturn remedy, karungali bracelet, authentic ebony, tamil nadu, shaiva tradition, wood mala, protection mala.`
    : `Generate 10–12 Shopify product tags for "${product.title}". Current tags: "${product.tags||"none"}". Include mukhi number variants, rudraksha, RKRTL, certified, authentic, and relevant spiritual keywords.`;

  const [description, metaTitle, metaDesc, tags] = await Promise.allSettled([
    callClaude(descSystem, descUser, 4000),
    callClaude(`SEO specialist. Output ONLY the meta title text. No quotes. No explanation.`, metaTitleUser),
    callClaude(`SEO specialist. Output ONLY the meta description text. No quotes. No explanation.`, metaDescUser),
    callClaude(`Shopify SEO expert. Output ONLY comma-separated tags. No explanation.`, tagsUser),
  ]);

  const result = {
    description: description.status === "fulfilled" ? ensureDeityPresent(description.value, mukhiFacts, product.title) : "<p>Generation failed. Please re-run the agent.</p>",
    metaTitle:   metaTitle.status   === "fulfilled" ? metaTitle.value   : product.title,
    metaDesc:    metaDesc.status    === "fulfilled" ? metaDesc.value    : "",
    tags:        tags.status        === "fulfilled" ? tags.value        : product.tags || "",
  };

  [description, metaTitle, metaDesc, tags].forEach((r, i) => {
    if (r.status === "rejected") console.error(`❌ Agent ${["description","metaTitle","metaDesc","tags"][i]} failed:`, r.reason?.message || r.reason);
  });

  const keywords = loadKeywords();
  if (!keywords[product.id]) {
    keywords[product.id] = { productId: product.id, productTitle: product.title, keyword: autoKeyword(product.title), isCustom: false, addedAt: new Date().toISOString() };
    saveKeywords(keywords);
    console.log(`📊 Auto-registered for rank tracking: ${product.title}`);
  }

  const scoreBefore = scoreSEO(product.metafields_global_title_tag, product.metafields_global_description_tag, product.tags, product.body_html, isService, isKarungali);
  const scoreAfter  = scoreSEO(result.metaTitle, result.metaDesc, result.tags, result.description, isService, isKarungali);
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
  const bulkToken = generateApprovalToken();
  pendingApprovals.set("bulk_" + bulkToken, { isBulk: true, productTokens: results.map(r => [...pendingApprovals.entries()].find(([k, v]) => !v.isBulk && v.productId === r.productId && v.productTitle === r.productTitle)?.[0]).filter(Boolean), createdAt: new Date() });
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif"><div style="max-width:680px;margin:0 auto;padding:32px 20px"><div style="text-align:center;margin-bottom:32px"><div style="font-size:36px">ॐ</div><h1 style="color:#F0C84A;font-size:22px;margin:0">RudraKailash SEO Agent</h1><p style="color:#9A7050;font-size:13px;margin:4px 0">Automated Optimisation Report · ${triggered}</p><p style="color:#5A3020;font-size:12px">${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p></div><div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:20px;margin-bottom:24px"><table width="100%"><tr><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">PRODUCTS</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">${totalProducts}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG BEFORE</div><div style="color:#F08080;font-size:28px;font-weight:bold">${avgBefore}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG AFTER</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${avgAfter}</div></td><td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">IMPROVEMENT</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">+${avgAfter-avgBefore}</div></td></tr></table></div><div style="text-align:center;margin-bottom:20px"><a href="${APP_URL}/approve-all/${bulkToken}" style="display:inline-block;background:#D4A017;color:#0D0500;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:0.5px">🔱 Bulk Approve All ${totalProducts} Products</a><p style="color:#5A3020;font-size:11px;margin-top:8px">Pushes all AI suggestions live in one click · Cannot be undone</p></div><table style="width:100%;border-collapse:collapse;background:#120600;border:1px solid #2E1500;border-radius:10px;overflow:hidden"><thead><tr style="background:#160800"><th style="padding:10px 16px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">PRODUCT</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">BEFORE</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">AFTER</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GAIN</th><th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">ACTION</th></tr></thead><tbody>${productRows}</tbody></table><div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #2E1500"><p style="color:#5A3020;font-size:11px">RudraKailash Agentic SEO · Approval links expire in 7 days</p></div></div></body></html>`;
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
        results.push({ productId:product.id, productTitle:product.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } });
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
    const results = [{ productId:fullProduct.id, productTitle:fullProduct.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } }];
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
          results.push({ productId:product.id, productTitle:product.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } });
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
