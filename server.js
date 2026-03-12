require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const fetch      = require("node-fetch");
const fs         = require("fs");
const path       = require("path");
const cron       = require("node-cron");
const nodemailer = require("nodemailer");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Token persistence ────────────────────────────────────────────────────────
const TOKEN_FILE      = path.join(__dirname, ".shopify_token");
const RANK_DATA_FILE  = path.join(__dirname, ".rank_data.json");
const KEYWORDS_FILE   = path.join(__dirname, ".keywords.json");

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

// ─── Rank data helpers ────────────────────────────────────────────────────────
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

// ─── Config ───────────────────────────────────────────────────────────────────
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

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Store-Domain", "X-Access-Token"],
  credentials: true,
}));
app.use(express.json());

// ─── Email transporter ────────────────────────────────────────────────────────
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

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const rankData   = loadRankData();
  const keywords   = loadKeywords();
  const trackedCount = Object.keys(keywords).length;
  res.json({
    status: "ok", service: "RudraKailash SEO Proxy", store: SHOPIFY_STORE_DOMAIN,
    tokenConfigured: !!storedAccessToken,
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    serperConfigured: !!process.env.SERPER_API_KEY,
    emailConfigured: !!(process.env.EMAIL_SMTP_USER && process.env.EMAIL_SMTP_PASS),
    rankTracking: { trackedProducts: trackedCount, dataPoints: Object.values(rankData).reduce((s, p) => s + (p.history?.length || 0), 0) },
    pendingApprovals: pendingApprovals.size,
  });
});

// ─── OAuth ────────────────────────────────────────────────────────────────────
app.get("/auth/install", (req, res) => {
  const scopes = "read_products,write_products,read_product_listings";
  const redirectUri = `${APP_URL}/auth/callback`;
  const state = Math.random().toString(36).substring(7);
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
      res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;">
          <div style="font-size:48px;margin-bottom:16px;">✅</div>
          <h2 style="color:#F0C84A;margin-bottom:8px;">Connected!</h2>
          <p style="color:#9A7050;">Store linked · Token saved · Webhooks registered · Rank tracking active</p>
        </div></body></html>`);
    } else res.status(400).json({ error: "Failed to get access token", details: tokenData });
  } catch (err) { res.status(500).json({ error: "OAuth failed", message: err.message }); }
});

app.get("/auth/status", (req, res) => {
  res.json({ connected: !!storedAccessToken, store: SHOPIFY_STORE_DOMAIN,
    tokenSource: fs.existsSync(TOKEN_FILE) ? "disk" : (process.env.SHOPIFY_ACCESS_TOKEN ? "env" : "memory") });
});

app.get("/auth/token", (req, res) => {
  if (req.query.secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!storedAccessToken) return res.status(404).json({ error: "No token" });
  res.json({ token: storedAccessToken });
});

// ─── Products ─────────────────────────────────────────────────────────────────
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
      { method: "PUT", headers: { "X-Shopify-Access-Token": storedAccessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ product: { id, ...req.body } }) }
    );
    const data = await shopifyRes.json();
    if (!shopifyRes.ok) return res.status(shopifyRes.status).json({ error: "Update failed", details: data });
    res.json({ success: true, product: data.product });
  } catch (err) { res.status(500).json({ error: "Failed to update product", message: err.message }); }
});

// ─── AI generate ──────────────────────────────────────────────────────────────
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

// ─── Competitor research ──────────────────────────────────────────────────────
const MARKETPLACE_DOMAINS = ["amazon.","flipkart.","snapdeal.","meesho.","myntra.","indiamart.","alibaba.","ebay.","etsy.","walmart.","paytmmall.","shopclues.","tatacliq.","ajio.","nykaa.","jiomart."];

function isMarketplace(url) { return MARKETPLACE_DOMAINS.some(d => url.toLowerCase().includes(d)); }

function extractTextFromHTML(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"")
    .replace(/<nav[\s\S]*?<\/nav>/gi,"").replace(/<footer[\s\S]*?<\/footer>/gi,"")
    .replace(/<header[\s\S]*?<\/header>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,3000);
}

async function fetchPageText(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; RudraKailashSEOBot/1.0)", "Accept": "text/html" } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return extractTextFromHTML(await res.text());
  } catch (e) { return null; }
}

async function runCompetitorResearch(productTitle) {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return [];
  try {
    const queries = [`${productTitle} buy online authentic certified`, `${productTitle} spiritual benefits Vedic`];
    const seenUrls = new Set(), allResults = [];
    for (const query of queries) {
      const serperRes  = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 10 }),
      });
      const serperData = await serperRes.json();
      for (const result of (serperData.organic || [])) {
        const url = result.link || "";
        if (url && !isMarketplace(url) && !url.includes("rudrakailash.com") && !seenUrls.has(url)) {
          seenUrls.add(url); allResults.push({ url, title: result.title || "", snippet: result.snippet || "" });
        }
      }
    }
    const competitors = [];
    for (const result of allResults.slice(0, 5)) {
      const text = await fetchPageText(result.url);
      competitors.push({ ...result, content: text || result.snippet, fetched: !!text });
    }
    return competitors;
  } catch (e) { return []; }
}

app.post("/competitor/research", async (req, res) => {
  const { productTitle } = req.body;
  if (!productTitle) return res.status(400).json({ error: "productTitle required" });
  try {
    const competitors = await runCompetitorResearch(productTitle);
    res.json({ success: true, competitors, totalFound: competitors.length });
  } catch (err) { res.status(500).json({ error: "Research failed", message: err.message }); }
});

// ─── RANK TRACKING ────────────────────────────────────────────────────────────

// Auto-generate keyword from product title
function autoKeyword(productTitle) {
  return `${productTitle} buy online`;
}

// Check position of rudrakailash.com for a keyword on a given Google TLD
async function checkRankPosition(keyword, gl = "in") {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return null;
  try {
    const serperRes  = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, gl, hl: "en", num: 100 }),
    });
    const serperData = await serperRes.json();
    const organic    = serperData.organic || [];
    for (let i = 0; i < organic.length; i++) {
      if ((organic[i].link || "").includes(STORE_DOMAIN_SHORT)) {
        return i + 1; // 1-based position
      }
    }
    return null; // Not in top 100
  } catch (e) { console.warn(`Rank check failed for "${keyword}" (${gl}):`, e.message); return null; }
}

// GET /rank/keywords — list all tracked keywords
app.get("/rank/keywords", (req, res) => {
  const keywords = loadKeywords();
  res.json({ success: true, keywords });
});

// POST /rank/keywords — set/override keyword for a product
app.post("/rank/keywords", (req, res) => {
  const { productId, productTitle, keyword } = req.body;
  if (!productId || !productTitle) return res.status(400).json({ error: "productId and productTitle required" });
  const keywords = loadKeywords();
  keywords[productId] = {
    productId,
    productTitle,
    keyword:      keyword || autoKeyword(productTitle),
    isCustom:     !!keyword,
    addedAt:      new Date().toISOString(),
  };
  saveKeywords(keywords);
  res.json({ success: true, entry: keywords[productId] });
});

// DELETE /rank/keywords/:productId — remove from tracking
app.delete("/rank/keywords/:productId", (req, res) => {
  const keywords = loadKeywords();
  delete keywords[req.params.productId];
  saveKeywords(keywords);
  res.json({ success: true });
});

// GET /rank/data — all rank history
app.get("/rank/data", (req, res) => {
  const rankData = loadRankData();
  const keywords = loadKeywords();
  res.json({ success: true, rankData, keywords });
});

// POST /rank/check/:productId — manual check for one product
app.post("/rank/check/:productId", async (req, res) => {
  const keywords  = loadKeywords();
  const entry     = keywords[req.params.productId];
  if (!entry) return res.status(404).json({ error: "Product not tracked. Add keyword first." });

  res.json({ message: "Rank check started — results in ~30 seconds.", keyword: entry.keyword });

  // Run async
  setTimeout(async () => {
    await checkAndStoreRank(entry);
  }, 100);
});

// Core rank check + store function
async function checkAndStoreRank(entry) {
  const { productId, productTitle, keyword } = entry;
  console.log(`📊 Checking rank: "${keyword}"`);

  const [posIN, posGlobal] = await Promise.all([
    checkRankPosition(keyword, "in"),
    checkRankPosition(keyword, "us"),
  ]);

  const today    = new Date().toISOString().split("T")[0];
  const rankData = loadRankData();

  if (!rankData[productId]) {
    rankData[productId] = { productId, productTitle, keyword, history: [] };
  }

  // Remove today's entry if it exists (overwrite)
  rankData[productId].history = rankData[productId].history.filter(h => h.date !== today);

  rankData[productId].history.push({
    date:      today,
    posIN:     posIN,
    posGlobal: posGlobal,
    checkedAt: new Date().toISOString(),
  });

  // Keep last 90 days only
  rankData[productId].history = rankData[productId].history
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-90);

  rankData[productId].lastChecked = new Date().toISOString();
  rankData[productId].latestIN    = posIN;
  rankData[productId].latestGlobal = posGlobal;

  saveRankData(rankData);
  console.log(`✅ Rank stored: "${keyword}" — IN: ${posIN || "Not found"}, Global: ${posGlobal || "Not found"}`);
  return { posIN, posGlobal };
}

// Daily rank check cron: 6am IST = 00:30 UTC
cron.schedule("30 0 * * *", async () => {
  console.log("📊 Daily rank check started — 6am IST");
  const keywords = loadKeywords();
  const entries  = Object.values(keywords);
  if (entries.length === 0) { console.log("📊 No products tracked yet."); return; }
  console.log(`📊 Checking ${entries.length} products…`);
  for (const entry of entries) {
    await checkAndStoreRank(entry);
    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }
  console.log("📊 Daily rank check complete.");
}, { timezone: "UTC" });

// Weekly rank report: Monday 7am IST = Monday 01:30 UTC
cron.schedule("30 1 * * 1", async () => {
  console.log("📊 Weekly rank report — Monday 7am IST");
  const rankData = loadRankData();
  const entries  = Object.values(rankData);
  if (entries.length === 0) return;

  const rows = entries.map(entry => {
    const history = entry.history || [];
    const latest  = history[history.length - 1];
    const prev    = history[history.length - 8]; // ~7 days ago

    const posIN     = latest?.posIN     || null;
    const posGlobal = latest?.posGlobal || null;
    const prevIN    = prev?.posIN       || null;

    const deltaIN = prevIN && posIN ? prevIN - posIN : null; // positive = improved
    const trend   = deltaIN === null ? "—" : deltaIN > 0 ? `▲ ${deltaIN}` : deltaIN < 0 ? `▼ ${Math.abs(deltaIN)}` : "→ same";

    return { title: entry.productTitle, keyword: entry.keyword, posIN, posGlobal, trend, deltaIN };
  });

  // Sort: biggest improvements first
  rows.sort((a, b) => (b.deltaIN || 0) - (a.deltaIN || 0));

  const tableRows = rows.map(r => `
    <tr style="border-bottom:1px solid #2E1500">
      <td style="padding:10px 14px;color:#F5E6C8;font-size:13px">${r.title}</td>
      <td style="padding:10px 14px;color:#9A7050;font-size:11px">${r.keyword}</td>
      <td style="padding:10px 14px;text-align:center;color:${r.posIN ? '#7FD48A' : '#9A7050'};font-weight:bold">${r.posIN ? '#' + r.posIN : 'Not found'}</td>
      <td style="padding:10px 14px;text-align:center;color:${r.posGlobal ? '#80C0F0' : '#9A7050'};font-weight:bold">${r.posGlobal ? '#' + r.posGlobal : 'Not found'}</td>
      <td style="padding:10px 14px;text-align:center;color:${r.deltaIN > 0 ? '#7FD48A' : r.deltaIN < 0 ? '#F08080' : '#9A7050'};font-weight:bold">${r.trend}</td>
    </tr>`).join("");

  const inTop10  = rows.filter(r => r.posIN && r.posIN <= 10).length;
  const inTop50  = rows.filter(r => r.posIN && r.posIN <= 50).length;
  const improved = rows.filter(r => r.deltaIN > 0).length;

  const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif">
<div style="max-width:720px;margin:0 auto;padding:32px 20px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:36px">ॐ</div>
    <h1 style="color:#F0C84A;font-size:22px;margin:8px 0">RudraKailash SEO — Weekly Rank Report</h1>
    <p style="color:#9A7050;font-size:13px">${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p>
  </div>
  <div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:20px;margin-bottom:24px">
    <table width="100%"><tr>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">TRACKED</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">${entries.length}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">TOP 10 (IN)</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${inTop10}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">TOP 50 (IN)</div><div style="color:#80C0F0;font-size:28px;font-weight:bold">${inTop50}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">IMPROVED</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${improved}</div></td>
    </tr></table>
  </div>
  <table style="width:100%;border-collapse:collapse;background:#120600;border:1px solid #2E1500;border-radius:10px;overflow:hidden">
    <thead><tr style="background:#160800">
      <th style="padding:10px 14px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">PRODUCT</th>
      <th style="padding:10px 14px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">KEYWORD</th>
      <th style="padding:10px 14px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GOOGLE.CO.IN</th>
      <th style="padding:10px 14px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GOOGLE.COM</th>
      <th style="padding:10px 14px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">7-DAY TREND</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div style="text-align:center;margin-top:32px;border-top:1px solid #2E1500;padding-top:20px">
    <p style="color:#5A3020;font-size:11px">RudraKailash Agentic SEO · Daily tracking at 6am IST · Weekly report every Monday</p>
  </div>
</div></body></html>`;

  await sendEmail(`📊 RudraKailash Weekly Rank Report — ${new Date().toLocaleDateString("en-IN")}`, emailHtml);
  console.log("📊 Weekly rank report sent.");
}, { timezone: "UTC" });

// ─── SEO Pipeline ─────────────────────────────────────────────────────────────
function cleanAIOutput(text) {
  return text.replace(/^```(?:html)?\s*/i,"").replace(/\s*```\s*$/,"").trim();
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

function scoreSEO(metaTitle, metaDesc, tags, desc) {
  const titleLen = (metaTitle||"").length, descLen = (metaDesc||"").length;
  const tagCount = (tags||"").split(",").filter(Boolean).length;
  const descText = (desc||"").replace(/<[^>]+>/g,"");
  const checks = [titleLen>0,titleLen>=40&&titleLen<=60,/(rudrakailash)/i.test(metaTitle||""),
    descLen>0,descLen>=130&&descLen<=155,/shop|buy|order|get|explore/i.test(metaDesc||""),
    tagCount>0,tagCount>=6,/rkrtl|certified|authentic/i.test(tags||""),
    descText.length>100,descText.split(/\s+/).length>=300,/<h[23]/i.test(desc||""),
    /rkrtl|certified|x-ray/i.test(descText)];
  const pts = [10,10,5,10,10,5,5,8,7,10,10,5,5];
  return Math.round(checks.reduce((s,c,i)=>s+(c?pts[i]:0),0)/pts.reduce((s,p)=>s+p,0)*100);
}

async function runSEOPipeline(product) {
  console.log(`🤖 SEO pipeline: ${product.title}`);
  const descPlain   = (product.body_html||"").replace(/<[^>]+>/g,"").slice(0,400);
  const competitors = await runCompetitorResearch(product.title);
  const compSummary = competitors.length>0 ? `Top ${competitors.length} competitors: ${competitors.map(c=>c.title).join(", ")}` : "No competitor data.";

  let gapSummary = "Cover all key topics comprehensively.";
  if (competitors.length>0) {
    try {
      const compTexts = competitors.map((c,i)=>`Competitor ${i+1} (${c.url}):\n${(c.content||c.snippet).slice(0,500)}`).join("\n\n---\n\n");
      const gapRaw = await callClaude(`SEO strategist. Output ONLY JSON array of gap strings.`,`Product: "${product.title}". Our: "${descPlain}". Competitors:\n${compTexts}\nIdentify 5-8 gaps. Output ONLY JSON array.`,600);
      try { const gaps = JSON.parse(gapRaw.replace(/^```json\s*/i,"").replace(/\s*```$/,"").trim()); gapSummary = `Fill: ${gaps.join("; ")}`; }
      catch (e) { gapSummary = gapRaw.slice(0,300); }
    } catch (e) { console.warn("Gap analysis failed:", e.message); }
  }

  const [description, metaTitle, metaDesc, tags] = await Promise.allSettled([
    callClaude(`Senior content strategist for RudraKailash.com. E-E-A-T (Feb 2026). NEVER direct benefit claims. Use "Seekers often describe…", "In Vedic tradition…". Output clean HTML only.`,
      `Full SEO description for "${product.title}". ${compSummary}. ${gapSummary}. Current: "${descPlain}". Structure: <h2> seeker opening, <h3>Spiritual Significance</h3>, <h3>What Seekers Experience</h3>, <h3>RKRTL Certification</h3>, <h3>Who Is Drawn to This Bead</h3> <ul>, <h3>How to Wear & Energise</h3>, <h3>FAQ</h3>. ONLY clean HTML.`),
    callClaude(`SEO specialist. Output ONLY meta title. No quotes.`,`Meta title for "${product.title}" on RudraKailash.com. Max 60 chars. Keyword + brand.`),
    callClaude(`SEO specialist. Output ONLY meta description. No quotes.`,`Meta desc for "${product.title}". 145-155 chars. RKRTL certified + CTA.`),
    callClaude(`Shopify SEO expert. Output ONLY comma-separated tags.`,`10-12 tags for "${product.title}". Current: "${product.tags||"none"}". Include mukhi variants, RKRTL, certified authentic.`),
  ]);

  const result = {
    description: description.status==="fulfilled" ? description.value : "<p>Generation failed</p>",
    metaTitle:   metaTitle.status==="fulfilled"   ? metaTitle.value   : product.title,
    metaDesc:    metaDesc.status==="fulfilled"     ? metaDesc.value    : "",
    tags:        tags.status==="fulfilled"         ? tags.value        : product.tags||"",
  };

  // Auto-register product for rank tracking after SEO push
  const keywords = loadKeywords();
  if (!keywords[product.id]) {
    keywords[product.id] = { productId: product.id, productTitle: product.title, keyword: autoKeyword(product.title), isCustom: false, addedAt: new Date().toISOString() };
    saveKeywords(keywords);
    console.log(`📊 Auto-registered for rank tracking: ${product.title}`);
  }

  const scoreBefore = scoreSEO(product.metafields_global_title_tag, product.metafields_global_description_tag, product.tags, product.body_html);
  const scoreAfter  = scoreSEO(result.metaTitle, result.metaDesc, result.tags, result.description);
  console.log(`✅ ${product.title}: ${scoreBefore} → ${scoreAfter}`);
  return { ...result, scoreBefore, scoreAfter };
}

// ─── Approval endpoint ────────────────────────────────────────────────────────
app.get("/approve/:token", async (req, res) => {
  const approval = pendingApprovals.get(req.params.token);
  if (!approval) return res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;padding:40px;border:1px solid #7B1C1C;border-radius:12px;background:#1A0A00;"><div style="font-size:48px">❌</div><h2 style="color:#F08080;margin:16px 0">Link Expired</h2><p style="color:#9A7050">This approval link has expired or was already used.</p></div></body></html>`);
  try {
    const shopifyRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${approval.productId}.json`,
      { method:"PUT", headers:{"X-Shopify-Access-Token":storedAccessToken,"Content-Type":"application/json"}, body:JSON.stringify({product:{id:approval.productId,...approval.payload}}) });
    const data = await shopifyRes.json();
    pendingApprovals.delete(req.params.token);
    if (shopifyRes.ok) {
      res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;max-width:500px"><div style="font-size:48px">✅</div><h2 style="color:#F0C84A;margin:16px 0">Pushed!</h2><p style="color:#9A7050"><strong style="color:#F5E6C8">${approval.productTitle}</strong> is live on RudraKailash.com</p><p style="color:#9A7050;margin-top:12px;font-size:13px">SEO: ${approval.scoreBefore} → ${approval.scoreAfter} (+${approval.scoreAfter-approval.scoreBefore} pts)</p></div></body></html>`);
    } else throw new Error(JSON.stringify(data));
  } catch (err) { res.send(`<html><body style="font-family:sans-serif;background:#0D0500;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;padding:40px;border:1px solid #7B1C1C;border-radius:12px;background:#1A0A00;"><div style="font-size:48px">❌</div><h2 style="color:#F08080">Push Failed</h2><p style="color:#9A7050">${err.message}</p></div></body></html>`); }
});

// ─── Email builder ────────────────────────────────────────────────────────────
function buildApprovalEmail(results, triggerType) {
  const totalProducts = results.length;
  const avgBefore = Math.round(results.reduce((s,r)=>s+r.scoreBefore,0)/totalProducts);
  const avgAfter  = Math.round(results.reduce((s,r)=>s+r.scoreAfter,0)/totalProducts);
  const triggered = triggerType==="webhook"?"New Product Added":triggerType==="manual"?"Manual Trigger":"Weekly Scheduled Run";

  const productRows = results.map(r => {
    const approvalToken = generateApprovalToken();
    pendingApprovals.set(approvalToken, { productId:r.productId, productTitle:r.productTitle, payload:r.payload, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter, createdAt:new Date() });
    return `<tr style="border-bottom:1px solid #2E1500">
      <td style="padding:12px 16px;color:#F5E6C8;font-size:13px">${r.productTitle}</td>
      <td style="padding:12px 16px;text-align:center;color:#F08080;font-weight:bold">${r.scoreBefore}</td>
      <td style="padding:12px 16px;text-align:center;color:#7FD48A;font-weight:bold">${r.scoreAfter}</td>
      <td style="padding:12px 16px;text-align:center;color:#F0C84A;font-weight:bold">+${r.scoreAfter-r.scoreBefore}</td>
      <td style="padding:12px 16px;text-align:center"><a href="${APP_URL}/approve/${approvalToken}" style="background:#D4A017;color:#0D0500;padding:6px 16px;border-radius:5px;text-decoration:none;font-size:12px;font-weight:bold">✓ Approve & Push</a></td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif">
<div style="max-width:680px;margin:0 auto;padding:32px 20px">
  <div style="text-align:center;margin-bottom:32px"><div style="font-size:36px">ॐ</div>
    <h1 style="color:#F0C84A;font-size:22px;margin:0">RudraKailash SEO Agent</h1>
    <p style="color:#9A7050;font-size:13px;margin:4px 0">Automated Optimisation Report · ${triggered}</p>
    <p style="color:#5A3020;font-size:12px">${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p>
  </div>
  <div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:20px;margin-bottom:24px">
    <table width="100%"><tr>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">PRODUCTS</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">${totalProducts}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG BEFORE</div><div style="color:#F08080;font-size:28px;font-weight:bold">${avgBefore}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG AFTER</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${avgAfter}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">IMPROVEMENT</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">+${avgAfter-avgBefore}</div></td>
    </tr></table>
  </div>
  <div style="background:#1A0A00;border:1px solid #5A2A00;border-radius:8px;padding:14px 18px;margin-bottom:20px">
    <p style="color:#F0C060;font-size:13px;margin:0">✦ Click <strong>Approve & Push</strong> to publish live. Links expire in 7 days.</p>
  </div>
  <table style="width:100%;border-collapse:collapse;background:#120600;border:1px solid #2E1500;border-radius:10px;overflow:hidden">
    <thead><tr style="background:#160800">
      <th style="padding:10px 16px;text-align:left;color:#9A7050;font-size:11px;font-weight:normal">PRODUCT</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">BEFORE</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">AFTER</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GAIN</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">ACTION</th>
    </tr></thead>
    <tbody>${productRows}</tbody>
  </table>
  <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #2E1500">
    <p style="color:#5A3020;font-size:11px">RudraKailash Agentic SEO · Approval links expire in 7 days</p>
  </div>
</div></body></html>`;
}

// ─── Weekly SEO cron: Sunday 11pm IST = 17:30 UTC ────────────────────────────
cron.schedule("30 17 * * 0", async () => {
  console.log("⏰ Weekly SEO cron — Sunday 11pm IST");
  if (!storedAccessToken) return;
  try {
    const res      = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
    const data     = await res.json();
    const products = (data.products||[]).filter(p=>p.status==="active");
    const results  = [];
    for (const product of products) {
      try {
        const r = await runSEOPipeline(product);
        results.push({ productId:product.id, productTitle:product.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter,
          payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } });
        await new Promise(r=>setTimeout(r,3000));
      } catch (e) { console.error(`Cron failed for ${product.title}:`, e.message); }
    }
    if (results.length>0) await sendEmail(`🔱 RudraKailash SEO Weekly Report — ${results.length} products`, buildApprovalEmail(results,"cron"));
  } catch (e) { console.error("Weekly cron error:", e.message); }
}, { timezone: "UTC" });

// ─── Shopify webhook ──────────────────────────────────────────────────────────
app.post("/webhooks/products/create", async (req, res) => {
  res.status(200).json({ received: true });
  const product = req.body;
  if (!product?.id) return;
  console.log(`🔔 Webhook: New product — ${product.title}`);
  await new Promise(r=>setTimeout(r,5000));
  try {
    const productRes  = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${product.id}.json?fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
    const fullProduct = (await productRes.json()).product;
    if (!fullProduct) return;
    const r = await runSEOPipeline(fullProduct);
    const results = [{ productId:fullProduct.id, productTitle:fullProduct.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter,
      payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } }];
    await sendEmail(`🔔 New Product SEO Ready — "${fullProduct.title}"`, buildApprovalEmail(results,"webhook"));
  } catch (e) { console.error("Webhook error:", e.message); }
});

// ─── Register webhooks ────────────────────────────────────────────────────────
async function registerWebhooks() {
  if (!storedAccessToken) return;
  try {
    const webhookUrl = `${APP_URL}/webhooks/products/create`;
    const listRes    = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
    const listData   = await listRes.json();
    if ((listData.webhooks||[]).find(w=>w.address===webhookUrl)) { console.log("✅ Webhook already registered"); return; }
    const createRes  = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`,
      { method:"POST", headers:{"X-Shopify-Access-Token":storedAccessToken,"Content-Type":"application/json"},
        body:JSON.stringify({webhook:{topic:"products/create",address:webhookUrl,format:"json"}}) });
    const createData = await createRes.json();
    console.log(createData.webhook ? `✅ Webhook registered` : `⚠️  Webhook issue: ${JSON.stringify(createData)}`);
  } catch (e) { console.error("Webhook registration failed:", e.message); }
}

// ─── Manual triggers ──────────────────────────────────────────────────────────
app.post("/cron/trigger", async (req, res) => {
  if (req.query.secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  res.json({ message: "Manual cron triggered — email arriving shortly." });
  setTimeout(async () => {
    try {
      const fetchRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`, { headers:{"X-Shopify-Access-Token":storedAccessToken} });
      const data     = await fetchRes.json();
      const products = (data.products||[]).filter(p=>p.status==="active");
      const results  = [];
      for (const product of products) {
        try {
          const r = await runSEOPipeline(product);
          results.push({ productId:product.id, productTitle:product.title, scoreBefore:r.scoreBefore, scoreAfter:r.scoreAfter,
            payload:{ body_html:r.description, metafields_global_title_tag:r.metaTitle, metafields_global_description_tag:r.metaDesc, tags:r.tags } });
          await new Promise(r=>setTimeout(r,3000));
        } catch (e) { console.error(`Manual cron failed for ${product.title}:`, e.message); }
      }
      if (results.length>0) await sendEmail(`🔱 RudraKailash SEO Manual Report — ${results.length} products`, buildApprovalEmail(results,"manual"));
    } catch (e) { console.error("Manual cron error:", e.message); }
  }, 100);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 RudraKailash SEO Proxy running on port ${PORT}`);
  console.log(`   Store:         ${SHOPIFY_STORE_DOMAIN}`);
  console.log(`   Token:         ${storedAccessToken ? "✅ Loaded (" + (fs.existsSync(TOKEN_FILE) ? "disk" : "env") + ")" : "⚠️  Not yet"}`);
  console.log(`   Anthropic:     ${process.env.ANTHROPIC_API_KEY ? "✅" : "❌ NOT SET"}`);
  console.log(`   Serper:        ${process.env.SERPER_API_KEY    ? "✅" : "❌ NOT SET"}`);
  console.log(`   Email:         ${process.env.EMAIL_SMTP_USER   ? "✅ " + process.env.EMAIL_SMTP_USER : "❌ NOT SET"}`);
  console.log(`   Rank Tracking: ✅ Daily 6am IST · Weekly report Monday 7am IST`);
  console.log(`   SEO Cron:      ✅ Sunday 11pm IST`);
  if (storedAccessToken) await registerWebhooks();
});
